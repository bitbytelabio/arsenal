"""Catalog indexing, searching, listing, and loading for Arsenal skills.

Ports tools/generate-skill-index.ts and discovery methods from plugin/extensions/routing.ts.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from arsenal.corpus.frontmatter import parse_skill_frontmatter
from arsenal.corpus.routing import DOMAINS, load_routing_table, render_router_body


def sha256_file(path: Path) -> str:
    """Compute sha256 hash of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def sha256_string(s: str) -> str:
    """Compute sha256 hash of a string."""
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def generate_skill_index(skills_dir: Path, out_catalog_file: Path | None = None) -> list[dict[str, Any]]:
    """Generate deterministic catalog index skills.index.jsonl from skills directory."""
    if not skills_dir.is_dir():
        raise FileNotFoundError(f"Skills directory '{skills_dir}' not found.")

    entries: list[dict[str, Any]] = []

    for d in skills_dir.iterdir():
        if not d.is_dir():
            continue
        s_file = d / "SKILL.md"
        if not s_file.is_file():
            continue

        raw = s_file.read_text(encoding="utf-8")
        h = sha256_file(s_file)
        fm = parse_skill_frontmatter(raw) or {}

        entries.append({
            "name": d.name,
            "domain": str(fm.get("domain", "re")),
            "category": str(fm.get("category", "general")),
            "description": str(fm.get("description", "")),
            "sha256": h,
            "bytes": len(raw.encode("utf-8")),
        })

    entries.sort(key=lambda e: e["name"])

    if out_catalog_file:
        out_catalog_file.parent.mkdir(parents=True, exist_ok=True)
        jsonl_content = "".join(json.dumps(e) + "\n" for e in entries)
        out_catalog_file.write_text(jsonl_content, encoding="utf-8")

    return entries


def generate_routers(out_skills_dir: Path, repo_root: Path) -> list[str]:
    """Generate the four Tier-1 domain routers from presets/<domain>/routing.json."""
    written: list[str] = []
    for domain in DOMAINS:
        table = load_routing_table(domain, repo_root)
        if not table:
            raise FileNotFoundError(
                f"Missing routing table 'presets/{domain}/routing.json'; cannot generate arsenal-{domain}-router."
            )
        router_dir = out_skills_dir / f"arsenal-{domain}-router"
        router_dir.mkdir(parents=True, exist_ok=True)
        router_body = render_router_body(table)
        (router_dir / "SKILL.md").write_text(router_body, encoding="utf-8")
        written.append(domain)
    return written


def load_catalog_from_file(catalog_path: Path) -> list[dict[str, Any]]:
    """Load items from skills.index.jsonl."""
    if not catalog_path.is_file():
        return []
    lines = catalog_path.read_text(encoding="utf-8").splitlines()
    items: list[dict[str, Any]] = []
    for l in lines:
        if l.strip():
            try:
                items.append(json.loads(l))
            except Exception:
                pass
    return items


def search_catalog(
    catalog: list[dict[str, Any]],
    query: str,
    domain: str | None = None,
    category: str | None = None,
    requested_limit: int = 10,
) -> dict[str, Any]:
    """Search catalog items scoring by name, category, and description match."""
    limit = min(max(1, requested_limit), 25)
    query_tokens = [w for w in query.lower().split() if w]

    scored: list[tuple[dict[str, Any], int]] = []
    for item in catalog:
        if domain and item.get("domain") != domain:
            continue
        if category and item.get("category") != category:
            continue

        score = 0
        name_l = item.get("name", "").lower()
        desc_l = item.get("description", "").lower()
        cat_l = item.get("category", "").lower()

        for token in query_tokens:
            if token in name_l:
                score += 3
            if token in desc_l:
                score += 1
            if token in cat_l:
                score += 2

        if score > 0:
            scored.append((item, score))

    scored.sort(key=lambda s: (-s[1], s[0].get("name", "")))

    total_matches = len(scored)
    if total_matches == 0:
        return {
            "total_matches": 0,
            "returned": 0,
            "limit": limit,
            "results": [],
            "note": (
                "NO_RELEVANT_GUIDANCE: Task requirements do not match existing playbooks. "
                "Do NOT force-fit unrelated guidance. Follow Anti-Force-Fitting Protocol: "
                "conduct external methodology research and propose a new playbook."
            ),
        }

    results = [
        {
            "name": s[0].get("name", ""),
            "domain": s[0].get("domain", ""),
            "category": s[0].get("category", ""),
            "description": s[0].get("description", ""),
            "sha256": s[0].get("sha256", ""),
        }
        for s in scored[:limit]
    ]

    return {
        "total_matches": total_matches,
        "returned": len(results),
        "limit": limit,
        "results": results,
    }


def list_catalog(
    catalog: list[dict[str, Any]],
    domain: str | None = None,
    category: str | None = None,
    offset: int = 0,
    requested_limit: int = 20,
) -> dict[str, Any]:
    """List catalog playbooks scoped by domain or category."""
    limit = min(max(1, requested_limit), 50)
    filtered = [
        item
        for item in catalog
        if (not domain or item.get("domain") == domain)
        and (not category or item.get("category") == category)
    ]

    page = [
        {
            "name": i.get("name", ""),
            "domain": i.get("domain", ""),
            "category": i.get("category", ""),
            "description": i.get("description", ""),
            "sha256": i.get("sha256", ""),
        }
        for i in filtered[offset : offset + limit]
    ]

    return {
        "total": len(filtered),
        "offset": offset,
        "limit": limit,
        "skills": page,
    }


def load_skill(
    name: str,
    skills_dir: Path,
    catalog: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Load markdown body of a skill, verifying integrity against catalog hash."""
    skill_path = skills_dir / name / "SKILL.md"
    if not skill_path.is_file():
        return {"error": "SKILL_NOT_FOUND", "name": name}

    raw = skill_path.read_text(encoding="utf-8")
    computed_hash = sha256_string(raw)

    if catalog:
        entry = next((c for c in catalog if c.get("name") == name), None)
        if entry and entry.get("sha256") != computed_hash:
            return {
                "error": "INTEGRITY_VERIFICATION_FAILED",
                "name": name,
                "expected_hash": entry.get("sha256"),
                "actual_hash": computed_hash,
            }

    return {
        "name": name,
        "content": raw,
        "sha256": computed_hash,
    }


def load_asset(
    skill_name: str,
    asset_path: str,
    skills_dir: Path,
) -> dict[str, Any]:
    """Retrieve an auxiliary support asset from a skill directory."""
    skill_dir = skills_dir / skill_name
    if not skill_dir.is_dir():
        raise FileNotFoundError(f"Skill '{skill_name}' not found")

    clean_subpath = asset_path.lstrip("./")
    target_path = (skill_dir / clean_subpath).resolve()
    if not str(target_path).startswith(str(skill_dir.resolve())):
        raise PermissionError(f"Path traversal denied: '{asset_path}' escapes skill directory")
    if not target_path.is_file():
        raise FileNotFoundError(f"Asset '{clean_subpath}' not found in skill '{skill_name}'")

    raw_bytes = target_path.read_bytes()
    size_bytes = len(raw_bytes)
    # Bounded read (max 512KB)
    max_bytes = 512 * 1024
    truncated = size_bytes > max_bytes
    slice_bytes = raw_bytes[:max_bytes] if truncated else raw_bytes
    content = slice_bytes.decode("utf-8", errors="replace")

    return {
        "skill": skill_name,
        "assetPath": clean_subpath,
        "resolvedUri": f"skill://{skill_name}/{clean_subpath}",
        "content": content,
        "sizeBytes": size_bytes,
        "truncated": truncated,
    }
