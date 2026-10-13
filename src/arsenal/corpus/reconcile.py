"""Corpus manifest support file and hash reconciliation.

Reconciles src/corpus/MANIFEST.json support_files and hashes with actual files on disk.
Eliminates D-1 (missing/unrecorded files) and D-2 (hash mismatch) errors.
Ports tools/reconcile-corpus-manifest.ts.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from arsenal.corpus.manifest import (
    serialize_corpus_manifest,
    sha256_file,
    validate_corpus_manifest,
    validate_support_file_integrity,
)

ADAPTED_POSIX_SCRIPT_SOURCES = {
    "re-apk-reverse:templates/manifest-summary.sh": "arsenal-adapted-from:scripts/manifest-summary.ps1",
    "re-ida-reverse:templates/install-autostart.sh": "arsenal-adapted-from:scripts/install-autostart.ps1",
    "re-ida-reverse:templates/open.sh": "arsenal-adapted-from:scripts/open.ps1",
    "re-ida-reverse:templates/recover.sh": "arsenal-adapted-from:scripts/recover.ps1",
    "re-ida-reverse:templates/start-gui.sh": "arsenal-adapted-from:scripts/start-gui.ps1",
    "re-ida-reverse:templates/start.sh": "arsenal-adapted-from:scripts/start.ps1",
}


def resolve_support_source_path(
    skill_id: str,
    entry_source: str,
    entry_source_path: str | None,
    rel_path: str,
    repo_root: Path,
) -> str | None:
    """Resolve original upstream relative source_path for a support file."""
    adapted = ADAPTED_POSIX_SCRIPT_SOURCES.get(f"{skill_id}:{rel_path}")
    if adapted:
        return adapted

    if entry_source == "Anthropic-Cybersecurity-Skills" and entry_source_path:
        slug_dir = Path(entry_source_path).parent.as_posix()
        up_root = repo_root / "upstream/Anthropic-Cybersecurity-Skills/skills" / slug_dir
        if (up_root / rel_path).is_file():
            return rel_path
        if rel_path.startswith("templates/"):
            as_script = f"scripts/{rel_path[len('templates/'):]}"
            if (up_root / as_script).is_file():
                return as_script
        return None

    if entry_source == "reverse-skill" and entry_source_path:
        skill_sub_dir = Path(entry_source_path).parent.as_posix()
        rev_root = repo_root / "upstream/reverse-skill"
        if (rev_root / skill_sub_dir / rel_path).is_file():
            return rel_path
        if rel_path.startswith("references/"):
            sub = rel_path[len("references/") :]
            if (rev_root / "skills/references" / sub).is_file():
                return f"skills/references/{sub}"
        if rel_path.startswith("templates/"):
            sub = rel_path[len("templates/") :]
            if (rev_root / skill_sub_dir / "scripts" / sub).is_file():
                return f"scripts/{sub}"
            if (rev_root / "skills/scripts" / sub).is_file():
                return f"skills/scripts/{sub}"
        if rel_path.startswith("scripts/"):
            sub = rel_path[len("scripts/") :]
            if (rev_root / skill_sub_dir / "scripts" / sub).is_file():
                return f"scripts/{sub}"
            if (rev_root / "skills/scripts" / sub).is_file():
                return f"skills/scripts/{sub}"
        if rel_path.startswith("support/templates/"):
            sub = rel_path[len("support/templates/") :]
            if (rev_root / "skills/scripts" / sub).is_file():
                return f"skills/scripts/{sub}"
        if rel_path.startswith("support/"):
            sub = rel_path[len("support/") :]
            if (rev_root / "skills" / sub).is_file():
                return f"skills/{sub}"
            if (rev_root / sub).is_file():
                return sub
        return None

    if entry_source in ("rea", "arsenal-local", "xalgorix", "claude-red", "strix"):
        return rel_path

    return None


def reconcile_manifest(
    manifest_path: Path,
    corpus_dir: Path,
    write: bool = True,
) -> dict[str, Any]:
    """Reconcile manifest entries and support files against disk."""
    repo_root = corpus_dir.parent.parent
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    updated = 0
    prefix = "src/corpus/"
    unresolved_provenance: list[str] = []

    for entry in manifest.get("files", []):
        if entry.get("status") != "admitted" or not entry.get("destination_path"):
            continue
        dest = entry["destination_path"]
        if not dest.startswith(prefix):
            continue

        skill_id = dest[len(prefix) :].split("/")[0]
        skill_dir = corpus_dir / skill_id
        if not skill_dir.is_dir():
            continue

        skill_md_path = skill_dir / "SKILL.md"
        if skill_md_path.is_file():
            current_md_hash = sha256_file(skill_md_path)
            current_md_bytes = skill_md_path.stat().st_size
            if entry.get("sha256") != current_md_hash or entry.get("bytes") != current_md_bytes:
                entry["sha256"] = current_md_hash
                entry["bytes"] = current_md_bytes
                updated += 1

        found_on_disk: list[dict[str, Any]] = []
        for full in sorted(skill_dir.rglob("*")):
            if full.name == ".DS_Store" or not full.is_file():
                continue
            rel = full.relative_to(skill_dir).as_posix()
            if rel == "SKILL.md":
                continue
            h = sha256_file(full)
            size = full.stat().st_size
            source_path = resolve_support_source_path(
                skill_id,
                entry.get("source", ""),
                entry.get("source_path"),
                rel,
                repo_root,
            )
            if not source_path:
                unresolved_provenance.append(f"{dest}: unable to resolve source_path for '{rel}'")
                continue
            found_on_disk.append({
                "path": rel,
                "source_path": source_path,
                "sha256": h,
                "bytes": size,
            })

        old_support = entry.get("support_files", [])
        is_different = len(old_support) != len(found_on_disk) or any(
            not old_support[idx]
            or old_support[idx].get("path") != f["path"]
            or old_support[idx].get("sha256") != f["sha256"]
            or old_support[idx].get("source_path") != f["source_path"]
            for idx, f in enumerate(found_on_disk)
        )

        if is_different:
            entry["support_files"] = found_on_disk
            updated += 1

    if write:
        manifest_path.write_text(serialize_corpus_manifest(manifest), encoding="utf-8")

    remaining_errors = validate_support_file_integrity(manifest, corpus_dir)
    valid, schema_errors = validate_corpus_manifest(manifest)

    return {
        "updated": updated,
        "remainingErrors": remaining_errors,
        "schemaValid": valid,
        "schemaErrors": schema_errors,
        "unresolvedProvenance": unresolved_provenance,
    }
