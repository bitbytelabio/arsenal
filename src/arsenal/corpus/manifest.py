"""CorpusManifest models, validation, serialization, and merge helpers.

Implements data-model.md §§2-3, contracts/skill-lifecycle.md §4, and Task T007.
Uses canonical JSON Schema definitions from arsenal.schemas.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Final

from arsenal.schemas import schema, validate

LOCAL_SOURCE_ID: Final[str] = "arsenal-local"

DEFAULT_LOCAL_SOURCE_DESCRIPTOR: Final[dict[str, Any]] = {
    "repo": "presets/skills",
    "rev": None,
    "license": "Apache-2.0",
}


def get_corpus_manifest_schema() -> dict[str, Any]:
    """Retrieve canonical CORPUS_MANIFEST_SCHEMA document."""
    return schema("CORPUS_MANIFEST_SCHEMA")  # type: ignore[return-value]


def sha256_file(path: Path) -> str:
    """Compute sha256 hash of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def compute_manifest_summary(files: list[dict[str, Any]]) -> dict[str, int]:
    """Recompute the summary dictionary based on the files array."""
    summary = {
        "total_considered": len(files),
        "admitted": 0,
        "quarantined": 0,
        "excluded": 0,
        "deduplicated": 0,
    }
    for f in files:
        status = f.get("status")
        if status in summary:
            summary[status] += 1
    return summary


def validate_corpus_manifest(data: Any) -> tuple[bool, list[str]]:
    """Validate a CorpusManifest against canonical schema and domain invariants."""
    schema_errors = validate("CORPUS_MANIFEST_SCHEMA", data)
    if schema_errors:
        return False, schema_errors

    errors: list[str] = []
    files: list[dict[str, Any]] = data.get("files", [])
    summary: dict[str, Any] = data.get("summary", {})
    sources: dict[str, Any] = data.get("sources", {})

    counts = {"admitted": 0, "quarantined": 0, "excluded": 0, "deduplicated": 0}
    admitted_destinations = set()

    for i, entry in enumerate(files):
        status = entry.get("status")
        if status in counts:
            counts[status] += 1
        else:
            errors.append(f"files[{i}]: unrecognized status '{status}'")

        if status == "admitted" and entry.get("destination_path"):
            admitted_destinations.add(entry["destination_path"])

        source = entry.get("source")
        source_desc = sources.get(source)
        if not source_desc:
            errors.append(f"files[{i}]: referenced source '{source}' not defined in sources")
        elif source == LOCAL_SOURCE_ID:
            if entry.get("source_rev") is not None:
                errors.append(f"files[{i}]: arsenal-local entry must have source_rev: null")
        else:
            if entry.get("source_rev") != source_desc.get("rev"):
                errors.append(
                    f"files[{i}]: source_rev '{entry.get('source_rev')}' does not match sources['{source}'].rev '{source_desc.get('rev')}'"
                )

    total_considered = len(files)
    if summary.get("total_considered") != total_considered:
        errors.append(
            f"summary.total_considered ({summary.get('total_considered')}) does not match files.length ({total_considered})"
        )

    for cat in ("admitted", "quarantined", "excluded", "deduplicated"):
        if summary.get(cat) != counts[cat]:
            errors.append(f"summary.{cat} ({summary.get(cat)}) does not match counted files ({counts[cat]})")

    sum_categories = sum(counts.values())
    if sum_categories != total_considered:
        errors.append(f"Sum of status categories ({sum_categories}) != total_considered ({total_considered})")

    # IN-7: Every superseded_by resolves to an admitted destination_path
    for i, entry in enumerate(files):
        if entry.get("status") == "deduplicated" and entry.get("superseded_by"):
            if entry["superseded_by"] not in admitted_destinations:
                errors.append(
                    f"files[{i}]: superseded_by '{entry['superseded_by']}' does not resolve to an admitted destination_path (IN-7)"
                )

    return len(errors) == 0, errors


def compare_manifest_entries(a: dict[str, Any], b: dict[str, Any]) -> int:
    """Deterministic comparator: path ascending, then source ascending."""
    p_a = a.get("path", "")
    p_b = b.get("path", "")
    if p_a != p_b:
        return -1 if p_a < p_b else 1
    s_a = a.get("source", "")
    s_b = b.get("source", "")
    if s_a != s_b:
        return -1 if s_a < s_b else 1
    return 0


def serialize_manifest_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Format a single ManifestEntry with deterministic key order."""
    ordered: dict[str, Any] = {
        "path": entry["path"],
        "source": entry["source"],
        "source_rev": entry.get("source_rev"),
        "license": entry["license"],
        "status": entry["status"],
    }
    for field in (
        "reason",
        "destination_path",
        "sha256",
        "bytes",
        "superseded_by",
        "source_path",
        "source_sha256",
    ):
        if field in entry:
            ordered[field] = entry[field]

    if "support_files" in entry and entry["support_files"]:
        sorted_sf = sorted(entry["support_files"], key=lambda sf: sf.get("path", ""))
        ordered["support_files"] = [
            {
                "path": sf["path"],
                "source_path": sf["source_path"],
                "sha256": sf["sha256"],
                "bytes": sf["bytes"],
            }
            for sf in sorted_sf
        ]

    return ordered


def serialize_corpus_manifest(manifest: dict[str, Any]) -> str:
    """Serialize CorpusManifest with deterministic sorting and fixed key order."""
    sources = manifest.get("sources", {})
    sorted_sources = {
        k: {
            "repo": sources[k]["repo"],
            "rev": sources[k]["rev"],
            "license": sources[k]["license"],
        }
        for k in sorted(sources.keys())
    }

    files = manifest.get("files", [])
    sorted_files = sorted(files, key=lambda f: (f.get("path", ""), f.get("source", "")))
    serialized_files = [serialize_manifest_entry(f) for f in sorted_files]

    summary = manifest.get("summary", compute_manifest_summary(files))

    ordered_manifest: dict[str, Any] = {
        "schema_version": manifest.get("schema_version", 1),
        "generator": manifest.get("generator", "arsenal"),
        "created_at": None,
        "summary": {
            "total_considered": summary["total_considered"],
            "admitted": summary["admitted"],
            "quarantined": summary["quarantined"],
            "excluded": summary["excluded"],
            "deduplicated": summary["deduplicated"],
        },
        "sources": sorted_sources,
        "files": serialized_files,
    }

    if "dedup_groups" in manifest and manifest["dedup_groups"]:
        sorted_groups = sorted(manifest["dedup_groups"], key=lambda g: g.get("key", ""))
        ordered_manifest["dedup_groups"] = [
            {
                "key": g["key"],
                "tier": g["tier"],
                "members": sorted(g.get("members", [])),
                **({"winner": g["winner"]} if "winner" in g else {}),
                "rationale": g["rationale"],
                "applied": g["applied"],
            }
            for g in sorted_groups
        ]

    return json.dumps(ordered_manifest, indent=2) + "\n"


def validate_support_file_integrity(manifest: dict[str, Any], corpus_dir: Path) -> list[str]:
    """Validate support file integrity (D-1/D-2)."""
    errors: list[str] = []
    prefix = "src/corpus/"

    for entry in manifest.get("files", []):
        if entry.get("status") != "admitted" or not entry.get("destination_path"):
            continue
        dest = entry["destination_path"]
        if not dest.startswith(prefix):
            continue

        skill_subdir = dest[len(prefix) :].split("/")[0]
        skill_dir = corpus_dir / skill_subdir

        recorded = set()
        for rec in entry.get("support_files", []):
            rec_path = rec["path"]
            recorded.add(rec_path)
            abs_path = (skill_dir / rec_path).resolve()
            if not str(abs_path).startswith(str(skill_dir.resolve())) or not abs_path.is_file():
                errors.append(f"[D-1] {dest}: record '{rec_path}' has no shipped file")
                continue
            actual_hash = sha256_file(abs_path)
            if rec.get("sha256") != actual_hash:
                errors.append(f"[D-2] {dest}: record '{rec_path}' hash mismatch")

        if skill_dir.is_dir():
            for f in skill_dir.rglob("*"):
                if f.name == ".DS_Store" or f.is_dir():
                    continue
                rel_path = f.relative_to(skill_dir).as_posix()
                if rel_path == "SKILL.md":
                    continue
                if rel_path not in recorded:
                    errors.append(f"[D-1] {dest}: shipped file '{rel_path}' has no manifest record")

    return errors


def read_corpus_manifest(file_path: Path) -> dict[str, Any]:
    """Read a CorpusManifest from a file and run strict validation."""
    content = file_path.read_text(encoding="utf-8")
    raw = json.loads(content)
    valid, errors = validate_corpus_manifest(raw)
    if not valid:
        raise ValueError(
            f"Corpus manifest at '{file_path}' failed validation:\n  " + "\n  ".join(errors)
        )
    return raw


def merge_corpus_manifest(
    upstream: dict[str, Any],
    previous: dict[str, Any] | None = None,
    active_source_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Merge rebuilt upstream manifest entries with preserved entries."""
    active_set = active_source_ids or {
        s for s in upstream.get("sources", {}).keys() if s != LOCAL_SOURCE_ID
    }

    preserved_entries: list[dict[str, Any]] = []
    preserved_sources: dict[str, Any] = {}

    if previous:
        for file in previous.get("files", []):
            src = file.get("source")
            if src == LOCAL_SOURCE_ID or src not in active_set:
                entry_copy = dict(file)
                if "support_files" in file:
                    entry_copy["support_files"] = [dict(sf) for sf in file["support_files"]]
                preserved_entries.append(entry_copy)

        for src_key, src_desc in previous.get("sources", {}).items():
            if src_key == LOCAL_SOURCE_ID or src_key not in active_set:
                preserved_sources[src_key] = dict(src_desc)

    merged_sources = {**upstream.get("sources", {}), **preserved_sources}

    has_local = any(f.get("source") == LOCAL_SOURCE_ID for f in preserved_entries)
    if has_local and LOCAL_SOURCE_ID not in merged_sources:
        merged_sources[LOCAL_SOURCE_ID] = dict(DEFAULT_LOCAL_SOURCE_DESCRIPTOR)

    upstream_files = [
        f
        for f in upstream.get("files", [])
        if f.get("source") != LOCAL_SOURCE_ID and f.get("source") in active_set
    ]

    merged_files = sorted(
        upstream_files + preserved_entries,
        key=lambda f: (f.get("path", ""), f.get("source", "")),
    )

    summary = compute_manifest_summary(merged_files)

    result = {
        "schema_version": 1,
        "generator": upstream.get("generator", "arsenal"),
        "created_at": None,
        "summary": summary,
        "sources": merged_sources,
        "files": merged_files,
    }
    if "dedup_groups" in upstream:
        result["dedup_groups"] = upstream["dedup_groups"]

    return result
