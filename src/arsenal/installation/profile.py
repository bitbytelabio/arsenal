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
from arsenal.installation.ida_detector import detect_ida_installation
from arsenal.installation.markdown_editor import merge_agents_markdown, merge_rules_markdown
from arsenal.installation.mcp_core import (
    create_canonical_mcp_catalog,
    merge_mcp_config_with_defaults,
    parse_and_validate_mcp_config,
)
from arsenal.installation.resources import get_template_text, resolve_plugin_dir
from arsenal.installation.specialist_parity import (
    FORBIDDEN_VENDOR_SEGMENTS,
    evaluate_specialist_parity,
)
from arsenal.installation.yaml_editor import merge_yaml_preserving_comments

SPECIALIST_FILES = (
    "sec-re.md",
    "sec-webapp.md",
    "sec-mobile.md",
    "sec-red.md",
    "sec-verifier.md",
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

    # Preflight check: malformed or corrupt profile mcp.json fails without writes
    profile_mcp_file = profile_dir / "mcp.json"
    if profile_mcp_file.is_file():
        mcp_raw = profile_mcp_file.read_text(encoding="utf-8")
        ok, _, err = parse_and_validate_mcp_config(mcp_raw)
        if not ok:
            error_msg = f"CONFIG_INVALID: Operator profile mcp.json at '{profile_mcp_file}' is malformed or corrupt: {err}"
            return ctx.result(
                data={"profileDir": str(profile_dir)},
                code=ExitCodes.MUTATION_REFUSED,
                errors=[error_msg],
            )

    has_existing_yaml = (profile_dir / "config.yaml").is_file()
    config_rel_path = "config.yaml" if has_existing_yaml else "config.yml"

    detected_ida = detect_ida_installation()
    ida_section = ""
    if detected_ida.found and detected_ida.install_dir and detected_ida.python:
        ida_section = (
            "ida:\n"
            "  enabled: true\n"
            f'  python: "{detected_ida.python}"\n'
            f'  installDir: "{detected_ida.install_dir}"\n'
            "  maxOpen: 4\n"
            "  idleCloseSec: 900\n"
        )

    base_config = get_template_text("config.yml")
    config_template = f"{ida_section}{base_config}"
    agents_template = get_template_text("AGENTS.md")
    rules_template = get_template_text("RULES.md")
    models_template = get_template_text("models.yml")
    mcp_template = json.dumps(create_canonical_mcp_catalog(), indent=2)

    templates: list[dict[str, str]] = [
        {"relPath": "AGENTS.md", "content": agents_template},
        {"relPath": "RULES.md", "content": rules_template},
        {"relPath": config_rel_path, "content": config_template},
    ]

    if not has_existing_yaml:
        templates.append({"relPath": "models.yml", "content": models_template})

    templates.append({"relPath": "mcp.json", "content": mcp_template})

    # Prefer operator repository assets, then fill missing managed components
    # from the packaged native OMP plugin resources.
    plugin_dir = resolve_plugin_dir(ctx.repo_root)
    fallback_plugin_dir = resolve_plugin_dir(None)
    source_dirs = [p for p in (plugin_dir, fallback_plugin_dir) if p is not None]
    seen_specialists: set[str] = set()
    seen_rules: set[str] = set()
    for current_plugin_dir in source_dirs:
        plugin_agents_dir = current_plugin_dir / "agents"
        for sf in SPECIALIST_FILES:
            src_path = plugin_agents_dir / sf
            if sf not in seen_specialists and src_path.is_file():
                templates.append({
                    "relPath": f"agents/{sf}",
                    "content": src_path.read_text(encoding="utf-8"),
                })
                seen_specialists.add(sf)

        plugin_rules_dir = current_plugin_dir / "rules"
        if plugin_rules_dir.is_dir():
            for rf in plugin_rules_dir.iterdir():
                if rf.suffix == ".md" and rf.is_file() and rf.name not in seen_rules:
                    templates.append({
                        "relPath": f"rules/{rf.name}",
                        "content": rf.read_text(encoding="utf-8"),
                    })
                    seen_rules.add(rf.name)
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
            elif rel.endswith(".yml") or rel.endswith(".yaml"):
                existing = full_path.read_text(encoding="utf-8")
                content_to_write = merge_yaml_preserving_comments(existing, t["content"])
            elif rel.endswith("mcp.json"):
                try:
                    existing_json = json.loads(full_path.read_text(encoding="utf-8"))
                    merged = merge_mcp_config_with_defaults(existing_json)
                    content_to_write = json.dumps(merged, indent=2)
                except Exception:
                    pass

        is_premerged = (
            rel in ("AGENTS.md", "RULES.md")
            or rel.startswith("rules/")
            or rel.endswith(".yml")
            or rel.endswith(".yaml")
            or rel.endswith("mcp.json")
        )

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

    has_config = (profile_dir / "config.yaml").is_file() or (profile_dir / "config.yml").is_file()

    def _has_roles(p: Path) -> bool:
        if not p.is_file():
            return False
        c = p.read_text(encoding="utf-8")
        return "modelRoles:" in c or "roles:" in c

    has_models = (
        (profile_dir / "models.yml").is_file()
        or _has_roles(profile_dir / "config.yaml")
        or _has_roles(profile_dir / "config.yml")
    )

    if not (profile_dir / "AGENTS.md").is_file():
        missing.append("AGENTS.md")
    if not (profile_dir / "RULES.md").is_file():
        missing.append("RULES.md")
    if not has_config:
        missing.append("config.yaml (or config.yml)")
    if not has_models:
        missing.append("models.yml (or roles in config.yaml)")
    if not (profile_dir / "mcp.json").is_file():
        missing.append("mcp.json")

    for sf in SPECIALIST_FILES:
        in_agents = (profile_dir / "agents" / sf).is_file()
        in_agent_agents = (profile_dir / "agent/agents" / sf).is_file()
        if not in_agents and not in_agent_agents:
            missing.append(f"agents/{sf}")

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
        plugin_dir = resolve_plugin_dir(ctx.repo_root)
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

        agents_specialists = sorted(list(set(re.findall(r"\bsec-[a-z0-9-]+\b", agents_content))))
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
    plugin_dir = resolve_plugin_dir(ctx.repo_root)
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
