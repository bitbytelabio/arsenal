"""The single routing engine for the Arsenal repository.

Implements contracts/routing-table.md §5, §4, §6.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any, Final
from arsenal.schemas import schema, validate

DOMAINS: Final[tuple[str, ...]] = ("re", "webapp", "mobile", "red")

ROUTER_TOKEN_BUDGET: Final[int] = 500
ROUTER_COMBINED_TOKEN_BUDGET: Final[int] = 2000

ROUTER_FRAMING: Final[dict[str, dict[str, str]]] = {
    "re": {
        "title": "Arsenal Reverse Engineering Router",
        "guidance": (
            "Use for binary analysis, decompilation (IDA Pro, Ghidra, radare2, Binary Ninja), "
            "disassembly, protocol reverse engineering, patch differential analysis, and format "
            "string / buffer overflow exploit engineering."
        ),
        "exampleQuery": "ida decompilation",
        "exampleLeaf": "re-ida-reverse",
    },
    "webapp": {
        "title": "Arsenal Web Application Security Router",
        "guidance": (
            "Use for authorized web application penetration testing, REST/GraphQL API assessment, "
            "SQL injection, SSRF, IDOR, path traversal, and JavaScript reverse engineering."
        ),
        "exampleQuery": "sql injection differential",
        "exampleLeaf": "webapp-exploiting-sql-injection-vulnerabilities",
    },
    "mobile": {
        "title": "Arsenal Mobile Application Security Router",
        "guidance": (
            "Use for Android and iOS mobile application reverse engineering, APK unpacking, "
            "smali modification, IPA analysis, Frida hooks, and certificate pinning bypasses."
        ),
        "exampleQuery": "frida hook android",
        "exampleLeaf": "re-apk-reverse",
    },
    "red": {
        "title": "Arsenal Red Team & Active Directory Router",
        "guidance": (
            "Use for authorized red team operations, Active Directory attacks, Kerberoasting, "
            "Linux/Windows privilege escalation, EDR bypass analysis, and network assessments."
        ),
        "exampleQuery": "kerberoasting active directory",
        "exampleLeaf": "red-windows-ad",
    },
}


def routing_table_path(domain: str, repo_root: Path) -> Path:
    """Return path to routing.json for given domain."""
    return repo_root / f"presets/{domain}/routing.json"


def is_skill_domain(value: Any) -> bool:
    """Check if value is one of the four skill domains."""
    return isinstance(value, str) and value in DOMAINS


def load_routing_table(domain: str, repo_root: Path) -> dict[str, Any] | None:
    """Load and parse routing.json for given domain, or None if missing/invalid."""
    path = routing_table_path(domain, repo_root)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_routing_tables(repo_root: Path) -> dict[str, dict[str, Any] | None]:
    """Load all 4 domain routing tables."""
    return {domain: load_routing_table(domain, repo_root) for domain in DOMAINS}


def safe_regex(pattern: str) -> re.Pattern[str] | None:
    """Compile regex safely ignoring case."""
    try:
        return re.compile(pattern, re.IGNORECASE)
    except Exception:
        return None


def evaluate_table(table: dict[str, Any], hint: str) -> dict[str, Any] | None:
    """Evaluate one table against a hint, returning winning evaluation or None."""
    best: dict[str, Any] | None = None
    best_index = float("inf")

    priority: list[str] = table.get("priority", [])
    routes: dict[str, Any] = table.get("routes", {})

    for index, route_id in enumerate(priority):
        route = routes.get(route_id)
        if not route:
            continue

        matched: list[str] = []
        score = 0

        must_pat = route.get("must", "")
        must_re = safe_regex(must_pat)
        if must_re and must_re.search(hint):
            score += 1
            matched.append(must_pat)
        elif not route.get("mustAll"):
            continue

        must_all = route.get("mustAll", [])
        if must_all:
            disqualified = False
            for term in must_all:
                term_re = safe_regex(term)
                if not term_re or not term_re.search(hint):
                    disqualified = True
                    break
                score += 1
                matched.append(term)
            if disqualified:
                continue

        exclude = route.get("exclude")
        if exclude:
            exclude_re = safe_regex(exclude)
            if exclude_re and exclude_re.search(hint):
                continue

        if score <= 0:
            continue

        if best is None or score > best["score"] or (score == best["score"] and index < best_index):
            best = {"route": route, "score": score, "matched": matched}
            best_index = index

    return best


def apply_fallback(domain: str, table: dict[str, Any]) -> dict[str, Any] | None:
    """Apply fallback route if configured in meta."""
    meta = table.get("meta", {})
    fallback_id = meta.get("fallbackId")
    if not fallback_id:
        return None
    route = table.get("routes", {}).get(fallback_id)
    if not route:
        return None
    return {
        "domain": domain,
        "route_id": route["id"],
        "category": route["category"],
        "skill": route["leaf"],
        "score": 0,
        "matched": [],
        "fallback": True,
    }


def route_hint(
    hint: str,
    domain: str | None,
    tables: dict[str, dict[str, Any] | None],
) -> dict[str, Any]:
    """Route a hint text to the winning skill route."""
    order = [domain] if domain else list(DOMAINS)

    best: dict[str, Any] | None = None
    for d in order:
        table = tables.get(d)
        if not table:
            continue
        evaluation = evaluate_table(table, hint)
        if evaluation:
            route = evaluation["route"]
            match = {
                "domain": d,
                "route_id": route["id"],
                "category": route["category"],
                "skill": route["leaf"],
                "score": evaluation["score"],
                "matched": evaluation["matched"],
                "fallback": False,
            }
            if best is None or match["score"] > best["score"]:
                best = match
            continue

        fallback = apply_fallback(d, table)
        if fallback and best is None:
            best = fallback

    if not best:
        return {"domain": domain, "route_id": None, "note": "NO_ROUTE_MATCH"}

    return best


def ordered_categories(table: dict[str, Any]) -> list[dict[str, str]]:
    """Order declared categories by first route's priority index, then name ascending."""
    priority: list[str] = table.get("priority", [])
    routes: dict[str, Any] = table.get("routes", {})
    index_of = {route_id: i for i, route_id in enumerate(priority)}

    rows: list[dict[str, Any]] = []
    for category in table.get("categories", []):
        first_id: str = ""
        first_index = float("inf")
        first_leaf = ""
        for r_id in priority:
            r = routes.get(r_id)
            if r and r.get("category") == category:
                idx = index_of.get(r_id, float("inf"))
                if idx < first_index:
                    first_index = idx
                    first_id = r_id
                    first_leaf = r.get("leaf", "")
        rows.append({
            "category": category,
            "routeId": first_id,
            "leaf": first_leaf,
            "index": first_index,
        })

    rows.sort(key=lambda r: (r["index"], r["category"]))
    return [{"category": r["category"], "routeId": r["routeId"], "leaf": r["leaf"]} for r in rows]


def render_router_body(table: dict[str, Any]) -> str:
    """Render a router SKILL.md document from a routing table."""
    domain = table["meta"]["domain"]
    framing = ROUTER_FRAMING[domain]
    description = table["meta"]["description"]

    cat_rows = ordered_categories(table)
    category_lines = "\n".join(
        f"- `{row['category']}` → `{row['routeId']}` ({row['leaf']})" for row in cat_rows
    )

    return f"""---
name: arsenal-{domain}-router
description: "{description}"
domain: {domain}
hide: false
license: MIT
---
# {framing['title']}

## Role & Guidance
{framing['guidance']}

## On-Demand Playbook Retrieval
Leaf playbooks are hidden from the base prompt. Use runtime tools:
- `skill_search(query: "{framing['exampleQuery']}", domain: "{domain}")`
- `skill_route(hint: "{framing['exampleQuery']}", domain: "{domain}")`
- `skill_load(name: "{framing['exampleLeaf']}")`

## Declared Categories
{category_lines}
"""


def split_router_body(document: str) -> str:
    """Split router document and return body after frontmatter."""
    match = re.match(r"^---\r?\n[\s\S]*?\r?\n---\r?\n?", document)
    return document[match.end() :] if match else document


def count_router_category_lines(document: str) -> int:
    """Count number of category lines in a generated router body."""
    body = split_router_body(document)
    pattern = re.compile(r"^- `[^`]+` → `[^`]+` \(.+\)$")
    return sum(1 for line in body.split("\n") if pattern.match(line.strip()))


def estimate_router_tokens(body: str) -> int:
    """Estimate token count: floor(body_bytes / 4)."""
    return len(body.encode("utf-8")) // 4


def compute_routing_coverage(table: dict[str, Any], tree_dir: Path | None = None) -> dict[str, Any]:
    """Compute category coverage and route target resolution for one table."""
    declared = list(table.get("categories", []))
    with_routes = set()
    missing_targets: list[str] = []

    routes = table.get("routes", {})
    for route_id, route in routes.items():
        cat = route.get("category")
        if cat and cat in declared:
            with_routes.add(cat)
        if tree_dir and route.get("leaf"):
            leaf_file = tree_dir / route["leaf"] / "SKILL.md"
            if not leaf_file.is_file():
                missing_targets.append(f"{route_id} -> {route['leaf']}")

    routed = [c for c in declared if c in with_routes]
    unrouted = [c for c in declared if c not in with_routes]
    return {
        "declared_categories": declared,
        "categories_with_routes": routed,
        "unrouted_categories": unrouted,
        "routes": len(routes),
        "routes_missing_targets": sorted(missing_targets),
    }


def evaluate_routing_invariants(
    tables: dict[str, dict[str, Any] | None],
    tree_dir: Path | None = None,
) -> list[dict[str, str]]:
    """Evaluate RT-1..RT-4 invariants over the four tables."""
    violations: list[dict[str, str]] = []

    for domain in DOMAINS:
        table = tables.get(domain)
        if not table:
            continue

        declared = set(table.get("categories", []))
        covered = set()
        priority: list[str] = table.get("priority", [])
        routes: dict[str, Any] = table.get("routes", {})

        for route_id, route in routes.items():
            if not route:
                continue

            # RT-3: route_id in priority
            if route_id not in priority:
                violations.append({
                    "invariant": "RT-3",
                    "domain": domain,
                    "subject": route_id,
                    "message": f"route '{route_id}' is missing from priority[] in presets/{domain}/routing.json",
                    "remediation": "add the route id to priority[] exactly once",
                })

            cat = route.get("category")
            if not cat or cat not in declared:
                violations.append({
                    "invariant": "RT-3",
                    "domain": domain,
                    "subject": route_id,
                    "message": f"route '{route_id}' category '{cat or ''}' is not declared in presets/{domain}/routing.json",
                    "remediation": "declare the category in categories[] or correct the route's category",
                })
            else:
                covered.add(cat)

            # RT-2: leaf exists in shipped tree
            leaf = route.get("leaf")
            if tree_dir and leaf:
                leaf_file = tree_dir / leaf / "SKILL.md"
                if not leaf_file.is_file():
                    violations.append({
                        "invariant": "RT-2",
                        "domain": domain,
                        "subject": f"{route_id} -> {leaf}",
                        "message": f"route '{route_id}' -> '{leaf}' not found in {tree_dir}",
                        "remediation": "point the route at a shipped playbook or ship the missing playbook",
                    })

            # RT-4: cross-domain target declares a reason
            if leaf and not leaf.startswith(f"{domain}-"):
                cross_domain = route.get("crossDomain", {})
                reason = cross_domain.get("reason", "").strip() if isinstance(cross_domain, dict) else ""
                if not reason:
                    violations.append({
                        "invariant": "RT-4",
                        "domain": domain,
                        "subject": f"{route_id} -> {leaf}",
                        "message": f"route '{route_id}' -> '{leaf}' is outside domain '{domain}' and requires crossDomain.reason",
                        "remediation": "add crossDomain: { reason: <rationale> } to the route",
                    })

        # RT-1: every declared category has >= 1 route
        for category in table.get("categories", []):
            if category not in covered:
                violations.append({
                    "invariant": "RT-1",
                    "domain": domain,
                    "subject": category,
                    "message": f"domain '{domain}' category '{category}' has no route",
                    "remediation": f"add a route with category '{category}' targeting a shipped playbook",
                })

        # RT-3: priority duplicate check and existence check
        seen = set()
        for r_id in priority:
            if r_id in seen:
                violations.append({
                    "invariant": "RT-3",
                    "domain": domain,
                    "subject": r_id,
                    "message": f"priority[] lists route id '{r_id}' more than once",
                    "remediation": "list each route id exactly once",
                })
            seen.add(r_id)
            if r_id not in routes:
                violations.append({
                    "invariant": "RT-3",
                    "domain": domain,
                    "subject": r_id,
                    "message": f"priority[] route id '{r_id}' does not exist in routes{{}}",
                    "remediation": "remove the stale id or add the route",
                })

    return violations


def validate_routing_table_schema(data: Any) -> tuple[bool, list[str]]:
    """Validate a routing table against canonical ROUTING_TABLE_SCHEMA via arsenal.schemas."""
    errors = validate("ROUTING_TABLE_SCHEMA", data)
    return len(errors) == 0, errors
