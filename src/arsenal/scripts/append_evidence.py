"""Append Evidence record - Port of append-evidence.ps1.

Appends an immutable Evidence item under work/<case>/evidence/E-xxx.md
and updates the evidence index table in work/<case>/evidence/INDEX.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes

ALLOWED_SEVERITIES = {"critical", "high", "medium", "low", "info", "n/a", "n/a_re"}
ALLOWED_STATUSES = {"observed", "candidate", "validated", "false_positive", "accepted_risk"}


def to_yaml_block(text: str) -> str:
    """Format multiline text as an indented YAML literal block."""
    if not text or not text.strip():
        return "    n/a"
    clean = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", text)
    lines = clean.splitlines()
    if not lines:
        return "    n/a"
    return "\n".join("    " + line for line in lines)


def to_single_line(text: str) -> str:
    """Flatten multiline text into a clean single line."""
    if not text or not text.strip():
        return "n/a"
    clean = re.sub(r"[\x00-\x1F]", " ", text)
    clean = re.sub(r"\s+", " ", clean)
    return clean.strip() or "n/a"


def read_file_or_string(direct_value: str, file_path: str) -> str:
    """Read value from file path if provided, else use direct string value."""
    if file_path:
        p = Path(file_path).resolve()
        if not p.is_file():
            raise FileNotFoundError(f"Referenced file not found: {file_path}")
        return p.read_text(encoding="utf-8")
    return direct_value or ""


def append_evidence(
    case_root: Path,
    evidence_id: str,
    title: str,
    repro_command: str,
    severity: str = "info",
    status: str = "observed",
    source_type: str = "command",
    raw_excerpt: str = "",
    location: str = "",
    notes: str = "",
    artifact_path: str = "",
) -> dict[str, Any]:
    """Append one evidence item to the case evidence directory."""
    case_root = case_root.resolve()
    if not case_root.is_dir():
        raise FileNotFoundError(f"Case root does not exist: {case_root}")

    # Validate ID
    clean_id = re.sub(r"[^\w\-]+", "-", evidence_id).strip("-")
    if not clean_id.startswith("E-"):
        clean_id = f"E-{clean_id}"

    # Validate severity and status
    sev = to_single_line(severity).lower()
    if sev not in ALLOWED_SEVERITIES:
        raise ValueError(f"Invalid severity '{severity}'. Allowed: {', '.join(sorted(ALLOWED_SEVERITIES))}")

    st = to_single_line(status).lower()
    if st not in ALLOWED_STATUSES:
        raise ValueError(f"Invalid status '{status}'. Allowed: {', '.join(sorted(ALLOWED_STATUSES))}")

    if not repro_command or not repro_command.strip():
        raise ValueError("repro_command is required and must not be empty")

    # Resolve artifact path and hash
    content_hash = "n/a"
    artifact_ref = "n/a"
    if artifact_path:
        art_path = Path(artifact_path)
        if not art_path.is_absolute():
            candidate = case_root / art_path
            if candidate.is_file():
                art_path = candidate
            else:
                art_path = art_path.resolve()
        if not art_path.is_file():
            raise FileNotFoundError(f"ArtifactPath must point to a file inside CaseRoot: {artifact_path}")

        # Check containment
        try:
            rel_art = art_path.relative_to(case_root)
            artifact_ref = rel_art.as_posix()
        except ValueError:
            raise ValueError(f"ArtifactPath must be located inside CaseRoot: {artifact_path}")

        file_bytes = art_path.read_bytes()
        sha256_hex = hashlib.sha256(file_bytes).hexdigest()
        content_hash = f"sha256:{sha256_hex}"

    # Ensure evidence dir
    ev_dir = case_root / "evidence"
    ev_dir.mkdir(parents=True, exist_ok=True)

    record_path = ev_dir / f"{clean_id}.md"
    if record_path.exists():
        raise FileExistsError(
            f"Evidence record already exists and is immutable: {record_path.name}. Use a new ID."
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    title_line = to_single_line(title)
    src_type = to_single_line(source_type)
    loc_line = to_single_line(location) if location else "n/a"

    repro_block = to_yaml_block(repro_command)
    excerpt_block = to_yaml_block(raw_excerpt)
    notes_block = to_yaml_block(notes)

    body = f"""### {clean_id}
- title: {title_line}
- observed_at: {now_iso}
- source_type: {src_type}
- source_ref: arsenal scripts append-evidence
- content_hash: {content_hash}
- artifact_path: {artifact_ref}
- severity: {sev}
- status: {st}
- location: {loc_line}
- repro_command: |
{repro_block}
- raw_excerpt: |
{excerpt_block}
- linked_workitem: n/a
- supersedes: none
- notes: |
{notes_block}
"""

    record_path.write_text(body, encoding="utf-8")

    # Update INDEX.md
    index_path = ev_dir / "INDEX.md"
    index_line = f"- {clean_id} | {sev} | {st} | {title_line} | {record_path.name}\n"
    if not index_path.exists():
        hdr = """# Evidence index

| id | severity | status | title | file |
|----|----------|--------|-------|------|

"""
        index_path.write_text(hdr, encoding="utf-8")

    with open(index_path, "a", encoding="utf-8") as f:
        f.write(index_line)

    return {
        "id": clean_id,
        "title": title_line,
        "severity": sev,
        "status": st,
        "file": str(record_path),
        "content_hash": content_hash,
        "artifact_path": artifact_ref,
    }


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal scripts append-evidence'."""
    parser = argparse.ArgumentParser(
        prog="arsenal scripts append-evidence", description="Append Evidence item to case"
    )
    parser.add_argument("--case-root", "-CaseRoot", required=True, help="Path to case root directory")
    parser.add_argument("--id", "-Id", required=True, help="Evidence record identifier (e.g. E-001)")
    parser.add_argument("--title", "-Title", required=True, help="Short title describing evidence")
    parser.add_argument("--repro-command", "-ReproCommand", default="", help="Command used to produce evidence")
    parser.add_argument("--repro-command-file", "-ReproCommandFile", default="", help="Path to file with repro command")
    parser.add_argument("--severity", "-Severity", default="info", help="Severity level")
    parser.add_argument("--status", "-Status", default="observed", help="Observation status")
    parser.add_argument("--source-type", "-SourceType", default="command", help="Source type")
    parser.add_argument("--raw-excerpt", "-RawExcerpt", default="", help="Direct raw excerpt text")
    parser.add_argument("--raw-excerpt-file", "-RawExcerptFile", default="", help="Path to raw excerpt file")
    parser.add_argument("--location", "-Location", default="", help="Observed location/URL/file")
    parser.add_argument("--notes", "-Notes", default="", help="Analyst notes")
    parser.add_argument("--notes-file", "-NotesFile", default="", help="Path to notes file")
    parser.add_argument("--artifact-path", "-ArtifactPath", default="", help="Path to case-local artifact")

    argv = list(ctx.positionals)
    if not argv and ctx.values:
        for option, value in ctx.values.items():
            if option in {"json", "write", "check", "force"} or value is None:
                continue
            argv.extend([f"--{option.replace('_', '-')}", str(value)])
    if ctx.remainder:
        argv.extend(ctx.remainder)

    try:
        args, _ = parser.parse_known_args(argv)

        repro_cmd = read_file_or_string(args.repro_command, args.repro_command_file)
        excerpt = read_file_or_string(args.raw_excerpt, args.raw_excerpt_file)
        notes = read_file_or_string(args.notes, args.notes_file)

        result = append_evidence(
            case_root=Path(args.case_root),
            evidence_id=args.id,
            title=args.title,
            repro_command=repro_cmd,
            severity=args.severity,
            status=args.status,
            source_type=args.source_type,
            raw_excerpt=excerpt,
            location=args.location,
            notes=notes,
            artifact_path=args.artifact_path,
        )

        if not ctx.is_json:
            print(f"EVIDENCE -> {result['file']}")
            print(f"ID: {result['id']} | {result['severity']} | {result['status']} | {result['title']}")
        return ctx.result(result, code=ExitCodes.SUCCESS)
    except Exception as exc:
        return ctx.fail(str(exc), code=ExitCodes.CLI_USAGE_ERROR)
