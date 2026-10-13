"""Case review and evidence consolidation engine.

Implements contracts/skill-standard.md §2.5, case-consistency linting over
E-/WI-/F-/P- identifiers, field values, enum sets, and section structure across
all 37 validation codes, with full strict and verify_hashes support.
Port of review_case.py and consolidate_evidence.py with complete behavioral parity.
"""

from __future__ import annotations
import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from markdown_it import MarkdownIt

from arsenal.common import Context, ExitCodes, create_json_envelope, emit_json
MD_PARSER = MarkdownIt()
# Identifier and structure regular expressions
EVIDENCE_ID = re.compile(r"\bE-[A-Za-z0-9][A-Za-z0-9_-]*\b")
WORKITEM_ID = re.compile(r"\bWI-[A-Za-z0-9][A-Za-z0-9_-]*\b")
FINDING_ID = re.compile(r"\bF-[A-Za-z0-9][A-Za-z0-9_-]*\b")
PATH_ID = re.compile(r"\bP-[A-Za-z0-9][A-Za-z0-9_-]*\b")

WORKITEM_ID_EXACT = re.compile(r"^WI-[A-Za-z0-9][A-Za-z0-9_-]*$")

FIELD_LINE = re.compile(r"^\s*-\s+([A-Za-z0-9_]+):\s*(.*)$")
SECTION_HEADING = re.compile(r"^#{2,6}\s+(.+?)\s*$")
EVIDENCE_HEADING = re.compile(r"^###\s+(E-[A-Za-z0-9][A-Za-z0-9_-]*)\b", re.MULTILINE)
FINDING_HEADING = re.compile(r"^###\s+(F-[A-Za-z0-9][A-Za-z0-9_-]*)\b", re.MULTILINE)
PATH_HEADING = re.compile(r"^###\s+(P-[A-Za-z0-9][A-Za-z0-9_-]*)\b", re.MULTILINE)

# Allowed enumerations per skill-standard.md §2.5
SEVERITIES: set[str] = {"critical", "high", "medium", "low", "info", "n/a", "n/a_re"}
EVIDENCE_STATUSES: set[str] = {
    "observed",
    "candidate",
    "validated",
    "false_positive",
    "accepted_risk",
    "superseded",
}
WORKITEM_STATUSES: set[str] = {
    "pending",
    "in_progress",
    "blocked",
    "done",
    "completed",
    "cancelled",
}
PATH_TYPES: set[str] = {"attack", "callflow", "solve"}
NETWORK_MODES: set[str] = {
    "offline",
    "lab_only",
    "authorized_target_only",
    "unrestricted_lab",
}


def field_value(text: str, name: str) -> str:
    """Extract a named field value from list item declarations (- key: val)."""
    lines = text.splitlines()
    for index, line in enumerate(lines):
        match = FIELD_LINE.match(line)
        if not match or match.group(1) != name:
            continue
        value = match.group(2).strip()
        if value != "|":
            return value
        block: list[str] = []
        for continuation in lines[index + 1 :]:
            if FIELD_LINE.match(continuation):
                break
            if SECTION_HEADING.match(continuation):
                break
            if continuation.strip():
                block.append(continuation.strip())
        return "\n".join(block).strip()
    return ""


def section_text(text: str, title: str) -> str:
    """Extract markdown subsection content under a ## heading using MarkdownIt AST."""
    clean = text[1:] if text.startswith("\ufeff") else text
    tokens = MD_PARSER.parse(clean)
    lines = clean.splitlines(keepends=True)
    target = title.strip().lower()

    for i, t in enumerate(tokens):
        if t.type == "heading_open" and t.tag == "h2":
            if i + 1 < len(tokens):
                heading_content = tokens[i + 1].content.strip().lower()
                if heading_content == target:
                    start_line = t.map[1] if t.map else 0
                    end_line = len(lines)
                    for j in range(i + 2, len(tokens)):
                        tj = tokens[j]
                        if tj.type == "heading_open" and tj.tag in ("h1", "h2"):
                            if tj.map:
                                end_line = tj.map[0]
                            break
                    return "".join(lines[start_line:end_line])
    return ""


def extract_scope_assets(scope_section: str) -> list[str]:
    """Extract in-scope assets using MarkdownIt AST token traversal."""
    tokens = MD_PARSER.parse(scope_section)
    assets: list[str] = []
    in_assets_item = False
    in_nested_list = False

    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.type == "paragraph_open":
            if i + 1 < len(tokens):
                inline = tokens[i + 1]
                content = inline.content.strip()
                if content.startswith("assets:"):
                    rest = content[len("assets:") :].strip()
                    if rest and rest != "[]":
                        if rest.startswith("[") and rest.endswith("]"):
                            items = [x.strip() for x in rest[1:-1].split(",") if x.strip()]
                            assets.extend(items)
                        else:
                            assets.append(rest)
                    in_assets_item = True
        elif in_assets_item:
            if t.type == "bullet_list_open":
                in_nested_list = True
            elif t.type == "bullet_list_close" and in_nested_list:
                in_nested_list = False
                in_assets_item = False
            elif in_nested_list and t.type == "inline":
                val = t.content.strip()
                if val and val != "[]":
                    assets.append(val)
            elif not in_nested_list and t.type == "list_item_close":
                in_assets_item = False
        i += 1
    return assets


def ids_in(value: str | None, pattern: re.Pattern[str]) -> list[str]:
    """Find unique, sorted matching identifier tokens within a text string."""
    if not value:
        return []
    return sorted(set(pattern.findall(value)))


def issue(
    issues: list[dict[str, Any]],
    level: str,
    code: str,
    message: str,
    path: str = "",
) -> None:
    """Append a structured review issue to the issues accumulator."""
    issues.append({"level": level, "code": code, "message": message, "path": path})


def relative_path(root: Path, target_path: Path) -> str:
    """Format path relative to case root using POSIX forward slashes."""
    try:
        rel = target_path.resolve().relative_to(root.resolve())
        return str(rel).replace("\\", "/")
    except (ValueError, RuntimeError):
        return str(target_path).replace("\\", "/")


def split_table_row(line: str) -> list[str]:
    """Parse Markdown table pipe cells cleanly."""
    stripped = line.strip()
    if not (stripped.startswith("|") and stripped.endswith("|")):
        return []
    return [cell.strip() for cell in stripped[1:-1].split("|")]


def parse_workitems(
    root: Path,
    issues: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], list[tuple[str, str]]]:
    """Parse workitems.md table rows and track referenced Evidence IDs."""
    path = root / "workitems.md"
    records: dict[str, dict[str, Any]] = {}
    references: list[tuple[str, str]] = []
    if not path.is_file():
        issue(issues, "error", "workitems.missing", "workitems.md is missing", "workitems.md")
        return records, references

    for line_number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        cells = split_table_row(line)
        if len(cells) < 8 or not WORKITEM_ID_EXACT.match(cells[0]):
            continue
        workitem_id = cells[0]
        status = cells[5].lower()
        if status not in WORKITEM_STATUSES:
            issue(
                issues,
                "error",
                "workitem.status",
                "unsupported work item status: " + status,
                f"workitems.md:{line_number}",
            )
        evidence_ids = ids_in(cells[6], EVIDENCE_ID)
        records[workitem_id] = {"status": status, "evidence_ids": evidence_ids}
        references.extend((evidence_id, f"workitems.md:{line_number}") for evidence_id in evidence_ids)

    if not records:
        issue(issues, "warning", "workitems.empty", "no work item rows were found", "workitems.md")
    return records, references


def parse_timeline(
    root: Path,
    issues: list[dict[str, Any]],
) -> tuple[int, list[tuple[str, str]]]:
    """Parse timeline.md events and record Evidence identifier references."""
    path = root / "timeline.md"
    references: list[tuple[str, str]] = []
    events = 0
    if not path.is_file():
        issue(issues, "error", "timeline.missing", "timeline.md is missing", "timeline.md")
        return events, references

    text = path.read_text(encoding="utf-8-sig")
    tokens = MD_PARSER.parse(text)
    lines = text.splitlines(keepends=True)

    for i, t in enumerate(tokens):
        if t.type == "heading_open" and t.tag == "h2":
            if i + 1 < len(tokens):
                heading_content = tokens[i + 1].content
                if "|" in heading_content:
                    events += 1
                    line_no = (t.map[0] + 1) if t.map else 1
                    start_line = t.map[0] if t.map else 0
                    end_line = len(lines)
                    for j in range(i + 2, len(tokens)):
                        tj = tokens[j]
                        if tj.type == "heading_open" and tj.tag in ("h1", "h2"):
                            if tj.map:
                                end_line = tj.map[0]
                            break
                    body = "".join(lines[start_line:end_line])
                    evidence_ids = ids_in(field_value(body, "evidence_ids"), EVIDENCE_ID)
                    references.extend((evidence_id, f"timeline.md:{line_no}") for evidence_id in evidence_ids)

    if events == 0:
        issue(issues, "warning", "timeline.empty", "no append-only timeline events were found", "timeline.md")
    return events, references


def parse_scope(
    root: Path,
    issues: list[dict[str, Any]],
    strict: bool,
) -> dict[str, Any]:
    """Parse and validate scope.md authorization, network, and signoff readiness."""
    path = root / "scope.md"
    result: dict[str, Any] = {"auth_status": "", "network_mode": "", "ready_for_act": "", "assets": []}
    if not path.is_file():
        issue(issues, "error", "scope.missing", "scope.md is missing", "scope.md")
        return result

    text = path.read_text(encoding="utf-8-sig")
    auth = section_text(text, "auth")
    scope_section = section_text(text, "in_scope")
    network = section_text(text, "network_profile")
    signoff = section_text(text, "signoff")
    result["auth_status"] = field_value(auth, "status").lower()
    result["network_mode"] = field_value(network, "mode").lower()
    result["ready_for_act"] = field_value(signoff, "ready_for_act").lower()

    result["assets"] = extract_scope_assets(scope_section)

    if not result["auth_status"]:
        issue(issues, "error", "scope.auth_missing", "auth.status is missing", "scope.md")
    elif result["auth_status"] not in {"pending", "granted", "denied", "unknown"}:
        issue(issues, "error", "scope.auth_invalid", "unsupported auth.status: " + result["auth_status"], "scope.md")

    if not result["network_mode"]:
        issue(issues, "error", "scope.network_missing", "network_profile.mode is missing", "scope.md")
    elif result["network_mode"] not in NETWORK_MODES:
        issue(issues, "error", "scope.network_invalid", "unsupported network mode: " + result["network_mode"], "scope.md")

    if not result["ready_for_act"]:
        issue(issues, "error", "scope.ready_missing", "signoff.ready_for_act is missing", "scope.md")
    elif result["ready_for_act"] not in {"true", "false"}:
        issue(issues, "error", "scope.ready_invalid", "ready_for_act must be true or false", "scope.md")

    if result["network_mode"] != "offline" and not result["assets"]:
        issue(issues, "error", "scope.assets_missing", "in_scope.assets is empty for a network case", "scope.md")

    if result["auth_status"] != "granted" or result["ready_for_act"] != "true":
        message = "scope is not ready for target ACT"
        if strict and result["network_mode"] != "offline":
            issue(issues, "error", "scope.not_ready", message, "scope.md")
        else:
            issue(issues, "warning", "scope.not_ready", message, "scope.md")
    return result


def report_sections(text: str, heading_pattern: re.Pattern[str]) -> list[tuple[str, str]]:
    """Extract heading-delimited sections from report markdown documents using MarkdownIt."""
    tokens = MD_PARSER.parse(text)
    sections: list[tuple[str, str]] = []
    lines = text.splitlines(keepends=True)

    for i, t in enumerate(tokens):
        if t.type == "heading_open" and t.tag == "h3":
            if i + 1 < len(tokens):
                heading_text = tokens[i + 1].content.strip()
                m = heading_pattern.search(f"### {heading_text}")
                if m:
                    section_id = m.group(1)
                    start_line = t.map[0] if t.map else 0
                    end_line = len(lines)
                    for j in range(i + 2, len(tokens)):
                        tj = tokens[j]
                        if tj.type == "heading_open" and tj.tag in ("h1", "h2", "h3"):
                            if tj.map:
                                end_line = tj.map[0]
                            break
                    body = "".join(lines[start_line:end_line])
                    sections.append((section_id, body))
    return sections


def parse_reports(
    root: Path,
    issues: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[tuple[str, str]]]:
    """Parse report/*.md documents for findings and attack/callflow/solve paths."""
    finding_records: list[dict[str, Any]] = []
    path_records: list[dict[str, Any]] = []
    references: list[tuple[str, str]] = []
    report_root = root / "report"
    report_files = sorted(report_root.rglob("*.md")) if report_root.is_dir() else []
    if not report_files:
        issue(issues, "warning", "report.missing", "no Markdown report was found", "report")
        return finding_records, path_records, references

    for report_path in report_files:
        text = report_path.read_text(encoding="utf-8-sig")
        rel_p = relative_path(root, report_path)
        for finding_id, body in report_sections(text, FINDING_HEADING):
            status = field_value(body, "status").lower()
            confidence = field_value(body, "confidence").lower()
            evidence_ids = ids_in(field_value(body, "evidence_ids"), EVIDENCE_ID)
            required = ("severity", "evidence_ids", "confidence", "location", "status")
            for field in required:
                if not field_value(body, field):
                    issue(issues, "error", "finding.field_missing", f"{finding_id} is missing {field}", rel_p)
            if status not in {"candidate", "validated", "false_positive", "accepted_risk", "superseded"}:
                issue(issues, "error", "finding.status", f"{finding_id} has unsupported status", rel_p)
            if status == "validated" and confidence == "low":
                issue(issues, "error", "finding.confidence", f"{finding_id} is validated with low confidence", rel_p)
            if not evidence_ids:
                issue(issues, "error", "finding.evidence_missing", f"{finding_id} has no evidence_ids", rel_p)
            references.extend((evidence_id, rel_p) for evidence_id in evidence_ids)
            finding_records.append({"id": finding_id, "status": status, "evidence_ids": evidence_ids, "path": rel_p})

        for path_id, body in report_sections(text, PATH_HEADING):
            path_type = field_value(body, "path_type").lower()
            evidence_ids = ids_in(body, EVIDENCE_ID)
            if path_type not in PATH_TYPES:
                issue(issues, "error", "path.type", f"{path_id} has unsupported path_type", rel_p)
            if not evidence_ids:
                issue(issues, "error", "path.evidence_missing", f"{path_id} has no evidence reference", rel_p)
            references.extend((evidence_id, rel_p) for evidence_id in evidence_ids)
            path_records.append({"id": path_id, "path_type": path_type, "evidence_ids": evidence_ids, "path": rel_p})
    return finding_records, path_records, references


def normalize_hash(value: str) -> str:
    """Normalize and validate SHA-256 hex string."""
    normalized = value.strip().lower()
    if normalized.startswith("sha256:"):
        normalized = normalized[7:]
    if re.fullmatch(r"[0-9a-f]{64}", normalized):
        return normalized
    return ""


def is_within(root: Path, target: Path) -> bool:
    """Check if target path is safely contained within root directory."""
    try:
        resolved_root = root.resolve()
        resolved_target = target.resolve()
        resolved_target.relative_to(resolved_root)
        return True
    except (ValueError, RuntimeError):
        return False


def sha256_file(path: Path) -> str:
    """Calculate SHA-256 hexadecimal hash of file."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_artifact(
    root: Path,
    artifact_path: str,
    expected_hash: str,
    issues: list[dict[str, Any]],
    display_path: str,
) -> None:
    """Verify physical artifact presence and cryptographic SHA-256 hash match."""
    if not artifact_path:
        issue(issues, "warning", "artifact.path_missing", "content_hash is recorded without artifact_path", display_path)
        return
    candidate = Path(artifact_path)
    if not candidate.is_absolute():
        candidate = root / candidate
    candidate = candidate.resolve()
    if not is_within(root, candidate):
        issue(issues, "warning", "artifact.outside_case", "artifact_path points outside the case root", display_path)
        return
    if not candidate.is_file():
        issue(issues, "error", "artifact.missing", "artifact_path does not exist", display_path)
        return
    digest = sha256_file(candidate)
    if digest != expected_hash:
        issue(issues, "error", "artifact.hash_mismatch", "artifact SHA-256 does not match content_hash", display_path)


def parse_evidence(
    root: Path,
    workitems: dict[str, Any],
    issues: list[dict[str, Any]],
    verify_hashes: bool,
) -> tuple[dict[str, Any], list[tuple[str, str]]]:
    """Parse evidence/E-*.md records, checking schemas, headings, and optional hashes."""
    evidence_root = root / "evidence"
    records: dict[str, Any] = {}
    references: list[tuple[str, str]] = []
    if not evidence_root.is_dir():
        issue(issues, "error", "evidence.dir_missing", "evidence directory is missing", "evidence")
        return records, references

    evidence_files = sorted(path for path in evidence_root.glob("E-*.md") if path.name != "INDEX.md")
    if not evidence_files:
        issue(issues, "warning", "evidence.empty", "no Evidence records were found", "evidence")

    for path in evidence_files:
        evidence_id = path.stem
        rel_p = relative_path(root, path)
        text = path.read_text(encoding="utf-8-sig")
        heading = EVIDENCE_HEADING.search(text)
        if not heading:
            issue(issues, "error", "evidence.heading_missing", "Evidence record has no matching heading", rel_p)
        elif heading.group(1) != evidence_id:
            issue(issues, "error", "evidence.heading_mismatch", "Evidence heading does not match its filename", rel_p)

        severity = field_value(text, "severity").lower()
        status = field_value(text, "status").lower()
        if status.startswith("superseded by"):
            status = "superseded"
        repro_command = field_value(text, "repro_command")
        notes = field_value(text, "notes").lower()
        linked_workitems = ids_in(field_value(text, "linked_workitem"), WORKITEM_ID)
        content_hash_value = field_value(text, "content_hash")
        artifact_path = field_value(text, "artifact_path")
        if severity not in SEVERITIES:
            issue(issues, "error", "evidence.severity", "unsupported severity: " + severity, rel_p)
        if status not in EVIDENCE_STATUSES:
            issue(issues, "error", "evidence.status", "unsupported status: " + status, rel_p)
        offline_note = any(marker in notes for marker in ("offline", "离线", "not applicable"))
        if not repro_command or (repro_command.lower() in {"n/a", "n/a_re"} and not offline_note):
            issue(
                issues,
                "error",
                "evidence.repro_missing",
                "Evidence requires a reproducible command or documented offline limitation",
                rel_p,
            )
        expected_hash = normalize_hash(content_hash_value) if content_hash_value.lower() != "n/a" else ""
        if content_hash_value.lower() != "n/a" and not expected_hash:
            issue(issues, "error", "evidence.hash_invalid", "content_hash must be SHA-256", rel_p)
        if verify_hashes and expected_hash:
            verify_artifact(root, artifact_path, expected_hash, issues, rel_p)
        for workitem_id in linked_workitems:
            if workitem_id not in workitems:
                issue(issues, "error", "evidence.workitem_missing", "linked work item does not exist: " + workitem_id, rel_p)
        records[evidence_id] = {"severity": severity, "status": status, "artifact_path": artifact_path}

    return records, references


def build_traceability(
    evidence_ids: list[str] | dict[str, Any] | set[str],
    references: list[tuple[str, str]],
) -> dict[str, dict[str, int]]:
    """Build cross-document traceability matrix for all defined Evidence records."""
    sorted_ids = sorted(evidence_ids)
    graph: dict[str, dict[str, int]] = {eid: {"workitems": 0, "timeline": 0, "reports": 0} for eid in sorted_ids}
    for evidence_id, source in references:
        if evidence_id not in graph:
            continue
        if source.startswith("workitems.md:"):
            graph[evidence_id]["workitems"] += 1
        elif source.startswith("timeline.md:"):
            graph[evidence_id]["timeline"] += 1
        else:
            graph[evidence_id]["reports"] += 1
    return graph


def review_case(
    case_root: Path | str,
    strict: bool = False,
    verify_hashes: bool = False,
) -> dict[str, Any]:
    """Execute complete case consistency and integrity audit across all 37 validation checks."""
    root = Path(case_root).expanduser().resolve()
    issues: list[dict[str, Any]] = []
    if not root.is_dir():
        issue(issues, "error", "case.missing", "case root does not exist", str(root))
        return {
            "status": "FAIL",
            "case_root": str(root),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "summary": {
                "errors": 1,
                "warnings": 0,
                "evidence": 0,
                "workitems": 0,
                "timeline_events": 0,
                "findings": 0,
                "paths": 0,
            },
            "issues": issues,
            "traceability": {},
        }

    workitems, workitem_refs = parse_workitems(root, issues)
    timeline_events, timeline_refs = parse_timeline(root, issues)
    scope = parse_scope(root, issues, strict)
    evidence, evidence_refs = parse_evidence(root, workitems, issues, verify_hashes)
    findings, paths, report_refs = parse_reports(root, issues)
    references = workitem_refs + timeline_refs + evidence_refs + report_refs

    for evidence_id, source in references:
        if evidence_id not in evidence:
            issue(
                issues,
                "error",
                "reference.unknown_evidence",
                "reference points to missing Evidence: " + evidence_id,
                source,
            )

    traceability = build_traceability(evidence, references)
    for evidence_id, links in traceability.items():
        if not any(links.values()):
            issue(
                issues,
                "warning",
                "evidence.unlinked",
                "Evidence is not referenced by a work item, timeline, or report",
                f"evidence/{evidence_id}.md",
            )

    errors = sum(1 for item in issues if item["level"] == "error")
    warnings = sum(1 for item in issues if item["level"] == "warning")
    status = "FAIL" if errors or (strict and warnings) else "WARN" if warnings else "PASS"
    return {
        "status": status,
        "case_root": str(root),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": scope,
        "summary": {
            "errors": errors,
            "warnings": warnings,
            "evidence": len(evidence),
            "workitems": len(workitems),
            "timeline_events": timeline_events,
            "findings": len(findings),
            "paths": len(paths),
        },
        "issues": issues,
        "traceability": traceability,
    }


def render_markdown(report: dict[str, Any]) -> str:
    """Render human-readable Markdown summary table from a CaseReviewReport."""
    summary = report["summary"]
    lines = [
        "# Case review",
        "",
        "- status: " + report["status"],
        "- case_root: " + report["case_root"],
        "- generated_at: " + report["generated_at"],
        "",
        "## Summary",
        "",
        "| Metric | Value |",
        "|---|---:|",
    ]
    for key in ("errors", "warnings", "evidence", "workitems", "timeline_events", "findings", "paths"):
        lines.append(f"| {key} | {summary[key]} |")

    lines.extend(["", "## Checks", "", "| Level | Code | Location | Detail |", "|---|---|---|---|"])
    if report["issues"]:
        for item in report["issues"]:
            location = item["path"].replace("|", "\\|")
            detail = item["message"].replace("|", "\\|")
            lines.append(f"| {item['level']} | {item['code']} | {location} | {detail} |")
    else:
        lines.append("| pass | none | n/a | No review issues found |")

    lines.extend(["", "## Traceability", "", "| Evidence | Work items | Timeline | Reports |", "|---|---:|---:|---:|"])
    if report["traceability"]:
        for evidence_id in sorted(report["traceability"]):
            links = report["traceability"][evidence_id]
            lines.append(
                f"| {evidence_id} | {links['workitems']} | {links['timeline']} | {links['reports']} |"
            )
    else:
        lines.append("| n/a | 0 | 0 | 0 |")
    return "\n".join(lines) + "\n"


def case_review(
    input_data: dict[str, Any] | str | Path,
    *,
    strict: bool = False,
    verify_hashes: bool = False,
) -> dict[str, Any]:
    """Execute case review and attach rendered Markdown string."""
    if isinstance(input_data, dict):
        case_root = input_data.get("case_root") or input_data.get("caseRoot") or ""
        strict = bool(input_data.get("strict", strict))
        verify_hashes = bool(input_data.get("verify_hashes", input_data.get("verifyHashes", verify_hashes)))
    else:
        case_root = str(input_data)

    report = review_case(case_root, strict=strict, verify_hashes=verify_hashes)
    return {**report, "markdown": render_markdown(report)}


# -----------------------------------------------------------------------------
# Evidence Consolidation Implementation
# -----------------------------------------------------------------------------


def mark_superseded(content: str, finding_id: str) -> str:
    """Mark an evidence markdown document as superseded by the given finding ID.

    1. If '- status: ...' exists, replace with '- status: superseded by <finding_id>'
    2. Else if '---' frontmatter delimiter exists, prepend status line to it
    3. Otherwise, append status line to the end.
    """
    clean = content[1:] if content.startswith("\ufeff") else content
    status_re = re.compile(r"^-\s*status:\s*.*$", re.MULTILINE)
    if status_re.search(clean):
        return status_re.sub(f"- status: superseded by {finding_id}", clean)

    fm_re = re.compile(r"^---\s*$", re.MULTILINE)
    if fm_re.search(clean):
        return fm_re.sub(f"---\n- status: superseded by {finding_id}", clean, count=1)

    return clean.rstrip() + f"\n- status: superseded by {finding_id}\n"


def build_finding_block(
    finding_id: str,
    title: str,
    severity: str,
    status: str,
    confidence: str,
    location: str,
    evidence_ids: list[str],
    description: str,
    consolidated_at: str,
) -> str:
    """Build formatted Markdown finding block to append to the case report."""
    ev_str = ", ".join(evidence_ids)
    return (
        f"### {finding_id}\n"
        f"- title: {title}\n"
        f"- severity: {severity}\n"
        f"- status: {status}\n"
        f"- confidence: {confidence}\n"
        f"- location: {location}\n"
        f"- evidence_ids: {ev_str}\n"
        f"- consolidated_at: {consolidated_at}\n\n"
        f"{description}\n"
    )


def update_report_content(existing_content: str | None, block: str) -> str:
    """Generate updated report markdown content containing the new finding block."""
    if existing_content is not None:
        clean = existing_content[1:] if existing_content.startswith("\ufeff") else existing_content
        content = clean
        if "## Findings" not in content:
            content = content.rstrip() + "\n\n## Findings\n"
        return content.rstrip() + "\n\n" + block
    return f"# Case Report\n\n## Findings\n\n{block}"


def consolidate_evidence(
    input: dict[str, Any] | None = None,
    case_root_override: str | None = None,
    *,
    input_data: dict[str, Any] | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Consolidate evidence items into a finding, updating evidence and report files.

    Report-only / preview by default; set input['write'] = True to persist changes.
    """
    data = input if input is not None else (input_data if input_data is not None else kwargs)
    raw_case_root = (
        data.get("case_root")
        or data.get("caseRoot")
        or case_root_override
    )
    if not raw_case_root or not str(raw_case_root).strip():
        raise ValueError("consolidate_evidence: 'case_root' is required.")

    case_root_path = Path(str(raw_case_root).strip()).expanduser().resolve()
    if not case_root_path.is_dir():
        raise FileNotFoundError(f"consolidate_evidence: case_root directory '{case_root_path}' does not exist.")

    raw_evidence_ids = data.get("evidence_ids") or data.get("evidenceIds")
    if not raw_evidence_ids:
        raise ValueError("Error: no Evidence IDs provided")

    if isinstance(raw_evidence_ids, list):
        ids = [str(i).strip() for i in raw_evidence_ids if str(i).strip()]
    else:
        ids = [i.strip() for i in str(raw_evidence_ids).split(",") if i.strip()]

    if not ids:
        raise ValueError("Error: no Evidence IDs provided")

    finding_id = str(data.get("finding_id") or data.get("findingId") or "").strip()
    if not finding_id:
        raise ValueError("consolidate_evidence: 'finding_id' is required.")

    title = str(data.get("title") or "").strip()
    if not title:
        raise ValueError("consolidate_evidence: 'title' is required.")

    description = str(data.get("description") or "").strip()
    if not description:
        raise ValueError("consolidate_evidence: 'description' is required.")

    severity = str(data.get("severity") or "medium").strip()
    status = str(data.get("status") or "validated").strip()
    confidence = str(data.get("confidence") or "medium").strip()
    location = str(data.get("location") or "see evidence_ids").strip()
    is_write = bool(data.get("write"))

    evidence_dir = case_root_path / "evidence"
    for eid in ids:
        f = evidence_dir / f"{eid}.md"
        if not f.is_file():
            raise FileNotFoundError(f"Error: {f} not found")

    modified_evidence: list[dict[str, Any]] = []
    for eid in ids:
        f = evidence_dir / f"{eid}.md"
        content = f.read_text(encoding="utf-8")
        updated = mark_superseded(content, finding_id)
        modified_evidence.append({
            "path": f,
            "id": eid,
            "oldContent": content,
            "newContent": updated,
        })

    report_dir = case_root_path / "report"
    report_file = report_dir / "report.md"
    now_utc = datetime.now(timezone.utc)
    ts = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

    block = build_finding_block(
        finding_id=finding_id,
        title=title,
        severity=severity,
        status=status,
        confidence=confidence,
        location=location,
        evidence_ids=ids,
        description=description,
        consolidated_at=ts,
    )

    existing_report = report_file.read_text(encoding="utf-8") if report_file.is_file() else None
    new_report_content = update_report_content(existing_report, block)

    if is_write:
        for item in modified_evidence:
            item["path"].write_text(item["newContent"], encoding="utf-8")

        report_dir.mkdir(parents=True, exist_ok=True)
        report_file.write_text(new_report_content, encoding="utf-8")

    rel_report_path = str(report_file.relative_to(case_root_path)).replace("\\", "/")
    modified_paths = [
        str(m["path"].relative_to(case_root_path)).replace("\\", "/")
        for m in modified_evidence
    ] + [rel_report_path]

    messages = [
        *[f"Marked {eid} as superseded" for eid in ids],
        f"Successfully consolidated {len(ids)} evidence items into {finding_id}",
    ]

    return {
        "success": True,
        "finding_id": finding_id,
        "consolidated_count": len(ids),
        "evidence_ids": ids,
        "report_path": rel_report_path,
        "modified_files": modified_paths,
        "finding_block": block,
        "write": is_write,
        "messages": messages,
    }


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal case' command family."""
    subcommand = ctx.subcommand or "review"
    if subcommand in ("help", "-h", "--help"):
        if ctx.is_json:
            return ctx.result({"commands": ["review"]}, code=ExitCodes.SUCCESS)
        print(
            "Usage: arsenal case review [options] [path]\n\n"
            "Commands:\n"
            "  review    Review case scope and Evidence graph integrity\n\n"
            "Options:\n"
            "  --case-root <path>      Path to case workspace root directory\n"
            "  --strict                Treat warnings as a failed review\n"
            "  --verify-hashes         Verify SHA-256 content_hash values against artifact_path\n"
            "  --format <fmt>          Output format (markdown, json)\n"
            "  --json                  Output in structured JSON envelope\n"
        )
        return ExitCodes.SUCCESS

    if subcommand != "review":
        candidate_path = Path(subcommand).expanduser()
        if candidate_path.is_dir() or (ctx.repo_root / subcommand).is_dir():
            case_root_arg = subcommand
        else:
            return ctx.fail(
                f"Unrecognized case subcommand: '{subcommand}'. Available: review",
                code=ExitCodes.CLI_USAGE_ERROR,
            )
    else:
        case_root_arg = (
            ctx.values.get("case-root")
            or ctx.values.get("case_root")
            or ctx.values.get("caseRoot")
            or (ctx.positionals[0] if ctx.positionals else None)
            or ctx.repo_root
        )

    strict = bool(ctx.values.get("strict"))
    verify_hashes = bool(ctx.values.get("verify_hashes") or ctx.values.get("verify-hashes"))
    format_type = str(ctx.values.get("format") or ("json" if ctx.is_json else "markdown")).lower()

    report = review_case(case_root_arg, strict=strict, verify_hashes=verify_hashes)
    exit_code = ExitCodes.CHECK_FAILURE if report["status"] == "FAIL" else ExitCodes.SUCCESS

    if ctx.is_json or format_type == "json":
        error_messages = [
            f"[{i['code']}] {i['path']}: {i['message']}"
            for i in report["issues"]
            if i["level"] == "error"
        ]
        warning_messages = [
            f"[{i['code']}] {i['path']}: {i['message']}"
            for i in report["issues"]
            if i["level"] == "warning"
        ]
        cmd_str = " ".join(ctx.raw_args) if ctx.raw_args else "arsenal case review"
        envelope = create_json_envelope(
            command=cmd_str,
            exit_code=exit_code,
            mode="check",
            data=report,
            warnings=warning_messages,
            errors=error_messages,
        )
        emit_json(envelope)
        return exit_code

    print(render_markdown(report), end="")
    return exit_code


# TypeScript parity exports
reviewCase = review_case
caseReview = case_review
consolidateEvidence = consolidate_evidence
markSuperseded = mark_superseded
buildFindingBlock = build_finding_block
updateReportContent = update_report_content
renderMarkdown = render_markdown

__all__ = [
    "review_case",
    "case_review",
    "consolidate_evidence",
    "mark_superseded",
    "build_finding_block",
    "update_report_content",
    "render_markdown",
    "handle",
    "reviewCase",
    "caseReview",
    "consolidateEvidence",
    "markSuperseded",
    "buildFindingBlock",
    "updateReportContent",
    "renderMarkdown",
]
