"""Coverage baselines, coverage map, accepted gaps, and the per-domain coverage engine.

Implements contracts/coverage-baseline.md and data-model.md §§7-11.
Uses canonical JSON Schema definitions from arsenal.schemas.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any

from arsenal.corpus.routing import compute_routing_coverage, load_routing_table
from arsenal.schemas import schema, validate


def baseline_path(domain: str, repo_root: Path) -> Path:
    """Return path to domain baseline json file."""
    return repo_root / f"presets/baselines/{domain}.json"


def coverage_map_path(repo_root: Path) -> Path:
    """Return path to coverage-map.json."""
    return repo_root / "presets/baselines/coverage-map.json"


def accepted_gaps_path(repo_root: Path) -> Path:
    """Return path to accepted-gaps.json."""
    return repo_root / "presets/baselines/accepted-gaps.json"


def load_baseline(domain: str, repo_root: Path) -> tuple[dict[str, Any] | None, list[str]]:
    """Load and validate baseline definition for given domain against COVERAGE_BASELINE_SCHEMA."""
    path = baseline_path(domain, repo_root)
    if not path.is_file():
        return None, [f"Missing baseline '{path}'"]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return None, [f"Baseline '{path}' is not valid JSON: {e}"]

    schema_errors = validate("COVERAGE_BASELINE_SCHEMA", data)
    if schema_errors:
        return None, [f"[coverage-baseline] {path} {e}" for e in schema_errors]

    errors: list[str] = []
    if data.get("domain") != domain:
        errors.append(f"Baseline '{path}' declares domain '{data.get('domain')}', expected '{domain}'")

    caps = data.get("capabilities", [])
    ids = [c["id"] for c in caps if "id" in c]
    if len(ids) != len(set(ids)):
        errors.append(f"Baseline '{path}' contains duplicate capability ids")

    sorted_ids = sorted(ids)
    if sorted_ids != ids:
        errors.append(f"[coverage-baseline] {path} capabilities[] is not sorted ascending by id (IN-B2)")

    return data, errors


def load_coverage_map(repo_root: Path) -> dict[str, Any]:
    """Load coverage-map.json or default empty mapping."""
    path = coverage_map_path(repo_root)
    if not path.is_file():
        return {"schemaVersion": "1.0", "entries": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"schemaVersion": "1.0", "entries": []}


def load_accepted_gaps(repo_root: Path) -> dict[str, Any]:
    """Load accepted-gaps.json or default empty entries."""
    path = accepted_gaps_path(repo_root)
    if not path.is_file():
        return {"schemaVersion": "1.0", "entries": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"schemaVersion": "1.0", "entries": []}


def build_proposal_index(tree_dir: Path) -> dict[str, list[str]]:
    """Index capability IDs mentioned in playbook bodies."""
    index: dict[str, list[str]] = {}
    if not tree_dir.is_dir():
        return index

    token_re = re.compile(r"\b(?:WSTG-[A-Z]+-\d+|MASTG-TEST-\d+|MASVS-[A-Z]+-\d+|T\d{4}(?:\.\d{3})?)\b")
    for d in sorted(tree_dir.iterdir()):
        if not d.is_dir():
            continue
        skill_file = d / "SKILL.md"
        if not skill_file.is_file():
            continue
        content = skill_file.read_text(encoding="utf-8", errors="replace")
        for match in token_re.finditer(content):
            token = match.group(0)
            index.setdefault(token, []).append(d.name)

    for k in index:
        index[k] = sorted(set(index[k]))

    return index


def build_coverage_report(
    domain: str,
    repo_root: Path,
    tree_dir: Path,
) -> dict[str, Any]:
    """Build a comprehensive coverage report for domain."""
    baseline_data, baseline_errors = load_baseline(domain, repo_root)
    cov_map = load_coverage_map(repo_root)
    gaps_file = load_accepted_gaps(repo_root)
    proposals = build_proposal_index(tree_dir)

    routing_table = load_routing_table(domain, repo_root)
    routing_cov = compute_routing_coverage(routing_table, tree_dir) if routing_table else {}

    if not baseline_data:
        return {
            "domain": domain,
            "errors": baseline_errors,
            "totals": {"capabilities": 0, "covered": 0, "uncovered": 0, "accepted_gaps": 0},
            "capabilities": [],
            "routing": routing_cov,
        }

    # Index reviewed entries for domain
    reviewed_entries: dict[str, dict[str, Any]] = {}
    for entry in cov_map.get("entries", []):
        if entry.get("domain") == domain:
            reviewed_entries[entry.get("capability_id", "")] = entry

    # Index gaps for domain
    gaps_by_cap: dict[str, dict[str, Any]] = {}
    for gap in gaps_file.get("entries", []):
        if gap.get("domain") == domain:
            gaps_by_cap[gap.get("capability_id", "")] = gap

    records: list[dict[str, Any]] = []
    covered_count = 0
    gaps_count = 0
    uncovered_count = 0

    for cap in baseline_data.get("capabilities", []):
        cap_id = cap.get("id", "")
        reviewed = reviewed_entries.get(cap_id)
        gap = gaps_by_cap.get(cap_id)

        covered_by: list[dict[str, str]] = []
        status = "uncovered"

        if reviewed:
            for sk in reviewed.get("skills", []):
                sk_id = sk.get("id", "")
                evidence = sk.get("evidence", {})
                covered_by.append({
                    "id": sk_id,
                    "locator": evidence.get("locator", ""),
                    "note": evidence.get("note", ""),
                })
            if covered_by:
                status = "covered"
                covered_count += 1
        elif gap:
            status = "accepted-gap"
            gaps_count += 1
        else:
            uncovered_count += 1

        records.append({
            "id": cap_id,
            "title": cap.get("title", ""),
            "category": cap.get("category", ""),
            "status": status,
            "covered_by": covered_by,
            "match": "reviewed" if reviewed else None,
            "gap_ref": gap.get("scope") if gap else None,
            "proposals": proposals.get(cap_id, []),
        })

    totals = {
        "capabilities": len(records),
        "covered": covered_count,
        "uncovered": uncovered_count,
        "accepted_gaps": gaps_count,
    }

    return {
        "domain": domain,
        "baseline": {
            "standard": baseline_data.get("standard", {}).get("name", ""),
            "revision": baseline_data.get("standard", {}).get("revision", ""),
            "version": baseline_data.get("standard", {}).get("version"),
            "extracted_from_sha256": baseline_data.get("extracted_from", {}).get("sha256", ""),
        },
        "totals": totals,
        "capabilities": records,
        "routing": routing_cov,
    }
