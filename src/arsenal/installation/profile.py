"""Arsenal profile handler.

Implements profile install and verify commands, non-destructive merging,
and strict profile integrity and parity verification.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys

from arsenal.common import Context, ExitCodes
from arsenal.installation.fs_safe import safe_write_file
from arsenal.installation.markdown_editor import merge_agents_markdown, merge_rules_markdown
from arsenal.installation.resources import (
    get_template_text,
    resolve_installed_plugin_dir,
    resolve_plugin_dir,
)
from arsenal.installation.specialist_parity import (
    FORBIDDEN_VENDOR_SEGMENTS,
    evaluate_specialist_parity,
)

SPECIALIST_FILES = (
    "arsenal-reverse.md",
    "arsenal-web.md",
    "arsenal-mobile.md",
    "arsenal-redteam.md",
    "arsenal-verifier.md",
)

REQUIRED_MARKERS = (
    "# Arsenal Master Orchestrator",
    "## Specialist Roster",
    "## Delegation Rules",
    "## Independent Verification",
    "## Evidence Discipline",
    "## Skill Discovery",
    "## Scope and Authorization",
)


def handle_profile(ctx: Context) -> int:
    """Entry point for arsenal profile command family."""
    sub = (ctx.subcommand or "verify").lower()
    if sub == "install":
        return handle_profile_install(ctx)
    if sub == "verify":
        return handle_profile_verify(ctx)
    return ctx.fail(f"Unrecognized profile subcommand: '{sub}'", code=ExitCodes.CLI_USAGE_ERROR)


def handle_profile_install(ctx: Context) -> int:
    """Install or update Arsenal profile templates in the target directory."""
    profile_dir = ctx.profile_dir
    is_write = bool(ctx.values.get("write")) and not bool(ctx.values.get("check")) and ctx.mode != "check"
    is_force = bool(ctx.values.get("force"))

    agents_template = get_template_text("AGENTS.md")
    rules_template = get_template_text("RULES.md")

    templates: list[dict[str, str]] = [
        {"relPath": "AGENTS.md", "content": agents_template},
        {"relPath": "RULES.md", "content": rules_template},
    ]

    actions: list[dict[str, str]] = []
    refused = False

    for t in templates:
        rel = t["relPath"]
        full_path = profile_dir / rel
        content_to_write = t["content"]

        if full_path.is_file():
            if rel == "AGENTS.md":
                existing = full_path.read_text(encoding="utf-8")
                content_to_write = merge_agents_markdown(existing, t["content"])
            elif rel == "RULES.md":
                existing = full_path.read_text(encoding="utf-8")
                content_to_write = merge_rules_markdown(existing, t["content"])

        is_premerged = rel in ("AGENTS.md", "RULES.md")

        res = safe_write_file(
            full_path,
            content_to_write,
            write=is_write,
            force=is_force,
            allow_update=is_premerged,
        )
        if res.action == "refused":
            refused = True
        actions.append({"path": rel, "action": res.action})
    if refused:
        msg = "Unmanaged profile files conflict with templates. Specify --force to overwrite with backup."
        return ctx.result(
            data={"actions": actions},
            code=ExitCodes.MUTATION_REFUSED,
            errors=[msg],
        )

    if not ctx.is_json:
        print(f"[profile install] Profile setup at '{profile_dir}' [mode: {ctx.mode}]:")
        for a in actions:
            print(f" - {a['path']}: {a['action']}")

    return ctx.result(
        data={"profileDir": str(profile_dir), "actions": actions},
        code=ExitCodes.SUCCESS,
    )


def handle_profile_verify(ctx: Context) -> int:
    """Verify profile layout, template sections, includes, vendor tokens, and specialist roster."""
    profile_dir = ctx.profile_dir
    missing: list[str] = []
    shadows: list[str] = []
    errors: list[str] = []

    if not (profile_dir / "AGENTS.md").is_file():
        missing.append("AGENTS.md")
    if not (profile_dir / "RULES.md").is_file():
        missing.append("RULES.md")

    # Undocumented shadow collisions
    agent_dir = profile_dir / "agents"
    if (agent_dir / "master.md").is_file():
        shadows.append("master.md")

    if missing:
        errors.append(f"Missing required profile files: {', '.join(missing)}")
    if shadows:
        errors.append(f"Undocumented agent shadow collisions in agents/: {', '.join(shadows)}")

    agents_path = profile_dir / "AGENTS.md"
    if agents_path.is_file():
        agents_content = agents_path.read_text(encoding="utf-8")

        # 1. Required section markers
        for marker in REQUIRED_MARKERS:
            if marker not in agents_content:
                errors.append(f'Missing required marker in AGENTS.md: "{marker}"')

        # 2. Include integrity
        include_matches = re.finditer(r"@path\s+(\S+)", agents_content)
        for m in include_matches:
            inc_path_str = m.group(1)
            inc_path = Path(inc_path_str)
            resolved = (profile_dir / inc_path).resolve()
            is_inside = False
            try:
                resolved.relative_to(profile_dir.resolve())
                is_inside = not inc_path.is_absolute()
            except ValueError:
                is_inside = False

            if not is_inside or not resolved.is_file():
                errors.append(f'Dangling include in AGENTS.md: "{inc_path_str}"')

        # 3. Escaped backticks check
        escaped_count = len(re.findall(r"\\`", agents_content))
        if escaped_count > 0:
            errors.append(f"Escaped backticks found in AGENTS.md: {escaped_count} occurrence(s)")

        # 4. Specialist set equality
        plugin_dir = resolve_installed_plugin_dir(ctx.repo_root, ctx.profile_dir) or resolve_plugin_dir(ctx.repo_root)
        plugin_specialists: list[str] = []
        if plugin_dir and (plugin_dir / "plugin.json").is_file():
            try:
                p_json = json.loads((plugin_dir / "plugin.json").read_text(encoding="utf-8"))
                roles = p_json.get("capabilities", {}).get("roles", [])
                plugin_specialists = sorted([r for r in roles if r != "master"])
            except Exception:
                errors.append("Failed to parse plugin/plugin.json")

        master_spawns: list[str] = []
        if plugin_dir and (plugin_dir / "agents/master.md").is_file():
            try:
                m_text = (plugin_dir / "agents/master.md").read_text(encoding="utf-8")
                fm_m = re.search(r"^---\r?\n([\s\S]*?)\r?\n---", m_text)
                if fm_m:
                    import yaml

                    fm = yaml.safe_load(fm_m.group(1))
                    if isinstance(fm, dict) and isinstance(fm.get("spawns"), list):
                        master_spawns = sorted(list(fm["spawns"]))
            except Exception:
                errors.append("Failed to parse frontmatter from master.md")

        agents_specialists = sorted(list(set(re.findall(r"\b(arsenal-(?:reverse|web|mobile|redteam|verifier))\b", agents_content))))
        if plugin_specialists:
            p_joined = ",".join(plugin_specialists)
            m_joined = ",".join(master_spawns)
            a_joined = ",".join(agents_specialists)
            if a_joined != p_joined or a_joined != m_joined:
                errors.append(
                    f"Specialist set mismatch against plugin capabilities / master spawns: AGENTS.md has [{', '.join(agents_specialists)}], plugin.json has [{', '.join(plugin_specialists)}], master.md spawns has [{', '.join(master_spawns)}]"
                )

        # 5. Vendor tokens check
        for vendor in FORBIDDEN_VENDOR_SEGMENTS:
            if re.search(rf"\b{re.escape(vendor)}\b", agents_content, re.IGNORECASE):
                errors.append(f'Forbidden vendor token "{vendor}" found in AGENTS.md')

        # 6. Specialist definitions parity
        for v in evaluate_specialist_parity(ctx.repo_root):
            errors.append(f"[{v.invariant}] {v.domain or '-'} {v.subject}: {v.message}")

    # Check RULES.md
    rules_path = profile_dir / "RULES.md"
    if rules_path.is_file():
        rules_content = rules_path.read_text(encoding="utf-8")
        escaped_rules_count = len(re.findall(r"\\`", rules_content))
        if escaped_rules_count > 0:
            errors.append(f"Escaped backticks found in RULES.md: {escaped_rules_count} occurrence(s)")
        for vendor in FORBIDDEN_VENDOR_SEGMENTS:
            if re.search(rf"\b{re.escape(vendor)}\b", rules_content, re.IGNORECASE):
                errors.append(f'Forbidden vendor token "{vendor}" found in RULES.md')

    # Check master.md
    plugin_dir = resolve_installed_plugin_dir(ctx.repo_root, ctx.profile_dir) or resolve_plugin_dir(ctx.repo_root)
    if plugin_dir and (plugin_dir / "agents/master.md").is_file():
        master_content = (plugin_dir / "agents/master.md").read_text(encoding="utf-8")
        escaped_master_count = len(re.findall(r"\\`", master_content))
        if escaped_master_count > 0:
            errors.append(f"Escaped backticks found in master.md: {escaped_master_count} occurrence(s)")
        for vendor in FORBIDDEN_VENDOR_SEGMENTS:
            if re.search(rf"\b{re.escape(vendor)}\b", master_content, re.IGNORECASE):
                errors.append(f'Forbidden vendor token "{vendor}" found in master.md')

    clean = len(errors) == 0
    exit_code = ExitCodes.SUCCESS if clean else ExitCodes.CHECK_FAILURE

    if not ctx.is_json:
        if clean:
            print(f"[profile verify passed] Profile at '{profile_dir}' is valid.")
        else:
            print("[profile verify failed] Errors:")
            for e in errors:
                print(f" - {e}", file=sys.stderr)

    return ctx.result(
        data={
            "profileDir": str(profile_dir),
            "missing": missing,
            "shadows": shadows,
            "clean": clean,
            "errors": errors,
        },
        code=exit_code,
        errors=errors if not clean else None,
    )
