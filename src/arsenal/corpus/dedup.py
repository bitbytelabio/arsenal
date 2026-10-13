"""Tier A and Tier B deduplication mechanics.

Implements data-model.md §6, research.md R4, and Task T009.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Final

DEFAULT_ALIASES_PATH: Final[str] = "presets/skills/dedup-aliases.json"

DECLARED_SOURCE_PRIORITIES: Final[dict[str, int]] = {
    "reverse-skill": 50,
    "revskill": 50,
    "claude-red": 40,
    "claudered": 40,
    "xalgorix": 30,
    "Anthropic-Cybersecurity-Skills": 20,
    "anthropic": 20,
    "strix": 10,
}


def get_source_priority(source: str) -> int:
    """Resolve numeric priority for a given source name."""
    return DECLARED_SOURCE_PRIORITIES.get(source, DECLARED_SOURCE_PRIORITIES.get(source.lower(), 0))


def normalize_candidate(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a candidate dictionary."""
    identifier = raw.get("identifier") or raw.get("name") or ""
    domain = raw.get("domain", "")
    slug = raw.get("slug", "")

    if (not domain or not slug) and identifier:
        dash_index = identifier.find("-")
        if dash_index > 0:
            domain = domain or identifier[:dash_index]
            slug = slug or identifier[dash_index + 1 :]

    return {
        "identifier": identifier,
        "domain": domain,
        "slug": slug,
        "bytes": raw.get("bytes") or raw.get("bodyBytes") or 0,
        "source": raw.get("source", ""),
        "source_path": raw.get("source_path") or raw.get("sourcePath") or raw.get("path") or "",
    }


def compare_dedup_candidates(a: dict[str, Any], b: dict[str, Any]) -> int:
    """Pure deterministic comparator for Tier A candidate selection.

    Negative if a ranks before b (a wins), positive if b ranks before a.
    """
    # 1. Body bytes descending (larger wins)
    if a["bytes"] != b["bytes"]:
        return b["bytes"] - a["bytes"]

    # 2. Source priority descending (higher wins)
    prio_a = get_source_priority(a["source"])
    prio_b = get_source_priority(b["source"])
    if prio_a != prio_b:
        return prio_b - prio_a

    # 3. source_path ascending (lexicographical asc wins)
    if a["source_path"] != b["source_path"]:
        return -1 if a["source_path"] < b["source_path"] else 1

    # 4. Tie breaker: identifier ascending
    if a["identifier"] != b["identifier"]:
        return -1 if a["identifier"] < b["identifier"] else 1

    return 0


def sort_dedup_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sort candidates deterministically by Tier A priority."""
    import functools

    return sorted(candidates, key=functools.cmp_to_key(compare_dedup_candidates))


def resolve_tier_a_winner(candidates: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    """Resolve Tier A winner, losers, and rationale."""
    if not candidates:
        raise ValueError("Cannot resolve Tier A winner from an empty candidate list")

    sorted_c = sort_dedup_candidates(candidates)
    winner = sorted_c[0]
    losers = sorted_c[1:]

    if not losers:
        return winner, [], "unique technique"

    runner_up = losers[0]
    if winner["bytes"] != runner_up["bytes"]:
        rationale = f"body bytes ({winner['bytes']} > {runner_up['bytes']})"
    elif get_source_priority(winner["source"]) != get_source_priority(runner_up["source"]):
        rationale = f"source priority ({winner['source']} > {runner_up['source']})"
    elif winner["source_path"] != runner_up["source_path"]:
        rationale = f"source_path lexicographic ({winner['source_path']} < {runner_up['source_path']})"
    else:
        rationale = f"deterministic tie-breaker ({winner['identifier']} <= {runner_up['identifier']})"

    return winner, losers, rationale


def detect_tier_a_collision_groups(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Detect Tier A collision groups keyed on <domain>-<capability-slug>."""
    groups_by_key: dict[str, list[dict[str, Any]]] = {}

    for raw in candidates:
        cand = normalize_candidate(raw)
        key = f"{cand['domain']}-{cand['slug']}" if cand["domain"] and cand["slug"] else cand["identifier"]
        groups_by_key.setdefault(key, []).append(cand)

    result: list[dict[str, Any]] = []
    for key in sorted(groups_by_key.keys()):
        group_cands = groups_by_key[key]
        if len(group_cands) < 2:
            continue
        winner, _, rationale = resolve_tier_a_winner(group_cands)
        sorted_cands = sort_dedup_candidates(group_cands)

        result.append({
            "key": key,
            "tier": "A",
            "members": [c["source_path"] or c["identifier"] for c in sorted_cands],
            "winner": winner["source_path"] or winner["identifier"],
            "rationale": rationale,
            "applied": True,
        })

    return result


def load_tier_b_aliases(aliases_file: Path) -> dict[str, Any]:
    """Load aliases definition file."""
    if not aliases_file.is_file():
        return {}
    try:
        return json.loads(aliases_file.read_text(encoding="utf-8"))
    except Exception:
        return {}


def detect_tier_b_groups(
    catalog_names: set[str],
    aliases_data: dict[str, Any],
) -> list[dict[str, Any]]:
    """Detect Tier B operator-reviewed groups from aliases configuration."""
    aliases = aliases_data.get("aliases", {})
    groups: list[dict[str, Any]] = []

    for key in sorted(aliases.keys()):
        val = aliases[key]
        members: list[str] = []
        winner: str | None = None
        rationale = "operator-reviewed technique alias"
        applied = False

        if isinstance(val, list):
            members = [str(m) for m in val]
        elif isinstance(val, dict):
            members = [str(m) for m in val.get("members", [])]
            winner = val.get("winner")
            rationale = val.get("rationale", rationale)
            applied = bool(val.get("applied", False))
        elif isinstance(val, str):
            members = [val]

        matching_members = [m for m in members if m in catalog_names]
        if len(matching_members) >= 2 or (matching_members and applied):
            groups.append({
                "key": key,
                "tier": "B",
                "members": sorted(matching_members),
                **({"winner": winner} if winner else {}),
                "rationale": rationale,
                "applied": applied,
            })

    return groups


def format_dedup_summary(groups: list[dict[str, Any]]) -> str:
    """Format human-readable summary of deduplication groups."""
    lines: list[str] = [f"Total collision groups: {len(groups)}"]
    for g in groups:
        lines.append(f" - [{g['tier']}] {g['key']}: {len(g['members'])} candidates -> winner: {g.get('winner', 'none')} ({g['rationale']})")
    return "\n".join(lines)
