"""Master router - Port of master-route.sh and master-route.ps1.

Evaluates an engagement hint against skill routing keywords to recommend
the primary reverse-engineering or security skill and secondary candidates.
"""

from __future__ import annotations

import argparse
import datetime
import importlib.resources as pkg_resources
import json
from pathlib import Path
import re
import sys
from typing import Any

from arsenal.common import Context, ExitCodes


def resolve_routing_config(custom_path: str | Path | None = None, repo_root: Path | None = None) -> dict[str, Any]:
    """Resolve routing.json from custom path, workspace presets, or package resources."""
    if custom_path:
        p = Path(custom_path).resolve()
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8-sig"))

    # Try local repo presets
    if repo_root:
        for candidate in [
            repo_root / "presets" / "re" / "routing.json",
            repo_root / "presets" / "routing.json",
            repo_root / "src" / "corpus" / "re-reverse-engineering" / "config" / "routing.json",
        ]:
            if candidate.is_file():
                return json.loads(candidate.read_text(encoding="utf-8-sig"))

    # Try package resources
    try:
        res = pkg_resources.files("arsenal").joinpath("resources/presets/re/routing.json")
        if res.is_file():
            return json.loads(res.read_text(encoding="utf-8"))
    except Exception:
        pass

    # Fallback default routes table if config missing
    return {
        "meta": {"fallbackId": "R0"},
        "priority": ["R0"],
        "routes": {
            "R0": {
                "label": "Reverse Engineering",
                "skill": "skill://re-reverse-engineering/SKILL.md",
                "keywords": [],
            }
        },
    }


def evaluate_master_route(
    hint: str,
    project_root: Path | None = None,
    out_dir: Path | None = None,
    config_path: str | None = None,
) -> dict[str, Any]:
    """Score and determine primary skill route for given hint text."""
    root = (project_root or Path.cwd()).resolve()
    config = resolve_routing_config(config_path, root)

    routes = config.get("routes", {})
    priority = config.get("priority", [])
    fallback_id = config.get("meta", {}).get("fallbackId", "R0")

    text = (hint or "").lower()
    scores: dict[str, int] = {}
    selected_order: list[str] = []

    def matches(pattern: str) -> bool:
        return bool(re.search(pattern, text, flags=re.IGNORECASE))

    for route_id, route_data in routes.items():
        for rule in route_data.get("keywords", []):
            must = rule.get("must")
            hit = bool(must and matches(must))

            must_all = rule.get("mustAll") or []
            if isinstance(must_all, str):
                must_all = [must_all]
            if hit and any(not matches(p) for p in must_all):
                hit = False

            exclude = rule.get("exclude")
            if hit and exclude and matches(exclude):
                hit = False

            if hit:
                scores[route_id] = scores.get(route_id, 0) + 1
                if route_id not in selected_order:
                    selected_order.append(route_id)

    primary_id = None
    max_score = -1
    for r_id in priority:
        s = scores.get(r_id)
        if s is not None and s > max_score:
            primary_id = r_id
            max_score = s

    if primary_id is None:
        primary_id = fallback_id
        confidence = "low"
    else:
        confidence = "high" if len(selected_order) == 1 else "medium"

    primary_route = routes.get(primary_id, {})
    primary_skill = primary_route.get("skill", "skill://re-reverse-engineering/SKILL.md")
    if not primary_skill.startswith("skill://"):
        primary_skill = f"skill://{primary_skill}"

    secondary = [
        routes[r]["skill"] if routes[r]["skill"].startswith("skill://") else f"skill://{routes[r]['skill']}"
        for r in selected_order
        if r != primary_id and r in routes
    ]

    result: dict[str, Any] = {
        "hint": hint,
        "primary_id": primary_id,
        "primary_label": primary_route.get("label", "General Security"),
        "primary_skill": primary_skill,
        "confidence": confidence,
        "score": max_score if max_score > 0 else 0,
        "secondary_skills": secondary,
    }

    if out_dir:
        out_path = Path(out_dir).resolve()
        out_path.mkdir(parents=True, exist_ok=True)
        route_file = out_path / "route-scope.md"
        now_iso = datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat()
        md_content = f"""# Master Route Scope

- created: {now_iso}
- hint: {hint}
- primary: {primary_id}
- primary_label: {result['primary_label']}
- primary_skill: {primary_skill}
- confidence: {confidence}

## Secondary Skills
"""
        for s in secondary:
            md_content += f"- {s}\n"
        route_file.write_text(md_content, encoding="utf-8")
        result["route_file"] = str(route_file)

    return result


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal scripts master-route'."""
    parser = argparse.ArgumentParser(
        prog="arsenal scripts master-route", description="Evaluate skill routing from engagement hint"
    )
    parser.add_argument("--hint", "-Hint", default="", help="Engagement or task hint text")
    parser.add_argument("--out-dir", "-OutDir", default="", help="Directory to save route-scope.md")
    parser.add_argument("--project-root", "-ProjectRoot", default="", help="Project root directory")
    parser.add_argument("--config", "-Config", default="", help="Path to routing.json")

    argv = list(ctx.positionals)
    if ctx.remainder:
        argv.extend(ctx.remainder)

    try:
        args, unknown = parser.parse_known_args(argv)
        hint = args.hint
        if not hint and unknown and not unknown[0].startswith("-"):
            hint = " ".join(unknown)

        root = Path(args.project_root).resolve() if args.project_root else ctx.repo_root
        out_dir = Path(args.out_dir).resolve() if args.out_dir else None

        result = evaluate_master_route(
            hint=hint,
            project_root=root,
            out_dir=out_dir,
            config_path=args.config or None,
        )

        if not ctx.is_json:
            print("MASTER ROUTE:")
            print(f"  Primary:    {result['primary_label']} ({result['primary_id']})")
            print(f"  Skill URI:  {result['primary_skill']}")
            print(f"  Confidence: {result['confidence']}")
            if result.get("secondary_skills"):
                print("  Secondary:")
                for s in result["secondary_skills"]:
                    print(f"    - {s}")
            if result.get("route_file"):
                print(f"  Saved:      {result['route_file']}")

        return ctx.result(result, code=ExitCodes.SUCCESS)
    except Exception as exc:
        return ctx.fail(str(exc), code=ExitCodes.CLI_USAGE_ERROR)
