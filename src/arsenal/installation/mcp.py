"""Arsenal MCP bridge lifecycle management handler.

Implements scoped operator and project MCP tool bridge installation,
listing, enabling, disabling, and real verification.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any

from arsenal.common import Context, ExitCodes
from arsenal.installation.fs_safe import safe_write_file
from arsenal.installation.mcp_core import (
    CANONICAL_MCP_BRIDGES,
    DEFAULT_MCP_SCHEMA,
    build_canonical_server_entry,
    evaluate_server_state,
    load_dotenv_without_override,
    merge_mcp_config_with_defaults,
    parse_and_validate_mcp_config,
    probe_live_server,
    sanitize_url,
)


def handle_mcp(ctx: Context) -> int:
    """Entry point for arsenal mcp command family."""
    sub = (ctx.subcommand or "list").lower()

    raw_scope = ctx.values.get("scope")
    scope = (str(raw_scope) if raw_scope else "profile").lower()
    if scope not in ("profile", "project"):
        err = f"Invalid scope '{raw_scope}'. Scope must be either 'profile' or 'project'."
        return ctx.result(data={}, code=ExitCodes.CLI_USAGE_ERROR, errors=[err])

    target_mcp_path = (
        ctx.profile_dir / "mcp.json"
        if scope == "profile"
        else ctx.repo_root / ".omp" / "mcp.json"
    )

    if sub == "install":
        return _handle_mcp_install(ctx, scope, target_mcp_path)
    if sub == "list":
        return _handle_mcp_list(ctx, scope, target_mcp_path)
    if sub in ("enable", "disable"):
        return _handle_mcp_toggle(ctx, sub, scope, target_mcp_path)
    if sub == "verify":
        return _handle_mcp_verify(ctx, scope, target_mcp_path)

    return ctx.fail(f"Unrecognized mcp subcommand: '{sub}'", code=ExitCodes.CLI_USAGE_ERROR)


def _handle_mcp_install(ctx: Context, scope: str, target_mcp_path: Path) -> int:
    is_write = bool(ctx.values.get("write")) and not bool(ctx.values.get("check")) and ctx.mode != "check"
    server_name = ctx.values.get("server")
    if server_name:
        server_str = str(server_name)
        if server_str not in CANONICAL_MCP_BRIDGES:
            err = f"Unknown tool bridge '{server_str}'. Available: {', '.join(CANONICAL_MCP_BRIDGES.keys())}"
            return ctx.result(data={}, code=ExitCodes.CLI_USAGE_ERROR, errors=[err])
        servers_to_install = [server_str]
    else:
        servers_to_install = list(CANONICAL_MCP_BRIDGES.keys())

    existing_config: dict[str, Any] | None = None
    if target_mcp_path.is_file():
        ok, parsed, err = parse_and_validate_mcp_config(target_mcp_path.read_text(encoding="utf-8"))
        if not ok:
            err_msg = f"CONFIG_INVALID: MCP configuration at '{target_mcp_path}' is malformed or corrupt: {err}"
            return ctx.result(
                data={"scope": scope, "path": str(target_mcp_path)},
                code=ExitCodes.MUTATION_REFUSED,
                errors=[err_msg],
            )
        existing_config = parsed

    new_config = merge_mcp_config_with_defaults(existing_config, servers_to_install)
    new_content = json.dumps(new_config, indent=2)

    safe_res = safe_write_file(
        target_mcp_path,
        new_content,
        write=is_write,
        force=bool(ctx.values.get("force")),
        allow_update=True,
        mode=0o600,
    )

    if safe_res.action == "refused":
        err_msg = f"Mutation refused: target file '{target_mcp_path}' has conflicts and could not be updated."
        return ctx.result(
            data={"scope": scope, "path": str(target_mcp_path)},
            code=ExitCodes.MUTATION_REFUSED,
            errors=[err_msg],
        )

    if not ctx.is_json:
        print(f"[arsenal mcp install] Materialized {len(servers_to_install)} bridges in {scope} [mode: {ctx.mode}]:")
        for s in servers_to_install:
            was_existing = existing_config and s in (existing_config.get("mcpServers") or {})
            curr_entry = (new_config.get("mcpServers") or {}).get(s, {})
            if was_existing:
                state_lbl = "enabled: true" if curr_entry.get("enabled") is True else ("enabled: false" if curr_entry.get("enabled") is False else "default")
                print(f" - {s}: preserved existing config ({state_lbl})")
            else:
                print(f" - {s}: added canonical default (enabled: false)")

    return ctx.result(
        data={
            "installed": servers_to_install,
            "scope": scope,
            "path": str(target_mcp_path),
            "action": safe_res.action,
        },
        code=ExitCodes.SUCCESS,
    )


def _handle_mcp_list(ctx: Context, scope: str, target_mcp_path: Path) -> int:
    target_config: dict[str, Any] = {"mcpServers": {}}
    if target_mcp_path.is_file():
        ok, parsed, err = parse_and_validate_mcp_config(target_mcp_path.read_text(encoding="utf-8"))
        if not ok:
            err_msg = f"CONFIG_INVALID: MCP configuration at '{target_mcp_path}' is malformed or corrupt: {err}"
            return ctx.result(
                data={"scope": scope, "path": str(target_mcp_path)},
                code=ExitCodes.CHECK_FAILURE,
                errors=[err_msg],
            )
        target_config = parsed or {}

    profile_config: dict[str, Any] | None = None
    if scope == "project":
        prof_path = ctx.profile_dir / "mcp.json"
        if prof_path.is_file():
            try:
                ok, parsed_prof, _ = parse_and_validate_mcp_config(prof_path.read_text(encoding="utf-8"))
                if ok:
                    profile_config = parsed_prof
            except Exception:
                pass

    all_ids = sorted(list(set(list(CANONICAL_MCP_BRIDGES.keys()) + list((target_config.get("mcpServers") or {}).keys()))))
    bridge_states: list[dict[str, Any]] = []

    for b_id in all_ids:
        tgt_entry = (target_config.get("mcpServers") or {}).get(b_id, {})
        canonical_def = CANONICAL_MCP_BRIDGES.get(b_id, {})
        b_type = tgt_entry.get("type") or canonical_def.get("type") or "custom"

        evaluation = evaluate_server_state(
            server_id=b_id,
            scope=scope,
            target_config=target_config,
            profile_config=profile_config,
        )

        item: dict[str, Any] = {
            "id": b_id,
            "type": b_type,
            "effectiveState": evaluation.effective_state,
            "originLayer": evaluation.origin_layer,
        }
        if evaluation.reason:
            item["reason"] = evaluation.reason
        bridge_states.append(item)

    if not ctx.is_json:
        print("=" * 80)
        print(f"             EFFECTIVE MCP TOOL BRIDGE MATRIX ({scope.upper()})")
        print(f" Target: {target_mcp_path}")
        print(f" Note: Scoped configuration inspection for {scope}; not entire OMP discovery.")
        print("=" * 80)
        for b in bridge_states:
            tag = b["effectiveState"].upper().ljust(8)
            rsn = f" -> {b['reason']}" if "reason" in b else ""
            print(f" [{tag}] {b['id'].ljust(14)} ({b['type']}) [Layer: {b['originLayer']}]{rsn}")
        print("=" * 80)

    return ctx.result(
        data={
            "scope": scope,
            "path": str(target_mcp_path),
            "bridges": bridge_states,
        },
        code=ExitCodes.SUCCESS,
    )


def _handle_mcp_toggle(ctx: Context, sub: str, scope: str, target_mcp_path: Path) -> int:
    bridge_name = ctx.positionals[0] if ctx.positionals else (str(ctx.values["server"]) if ctx.values.get("server") else None)
    if not bridge_name:
        err = f"Bridge name is required for mcp {sub}"
        return ctx.result(data={}, code=ExitCodes.CLI_USAGE_ERROR, errors=[err])

    existing_config: dict[str, Any] | None = None
    if target_mcp_path.is_file():
        ok, parsed, err = parse_and_validate_mcp_config(target_mcp_path.read_text(encoding="utf-8"))
        if not ok:
            err_msg = f"CONFIG_INVALID: Target MCP configuration at '{target_mcp_path}' is malformed or corrupt: {err}"
            return ctx.result(
                data={"scope": scope, "path": str(target_mcp_path)},
                code=ExitCodes.MUTATION_REFUSED,
                errors=[err_msg],
            )
        existing_config = parsed

    is_known = bridge_name in CANONICAL_MCP_BRIDGES or (existing_config and bridge_name in (existing_config.get("mcpServers") or {}))
    if not is_known:
        err = f"Unknown tool bridge '{bridge_name}'. Available canonical: {', '.join(CANONICAL_MCP_BRIDGES.keys())}"
        return ctx.result(data={}, code=ExitCodes.CLI_USAGE_ERROR, errors=[err])

    enabled = (sub == "enable")
    is_check = bool(ctx.values.get("check")) or ctx.mode == "check"

    if is_check:
        if not ctx.is_json:
            print(f"[mcp {sub} check] Check mode: '{bridge_name}' would be set to enabled: {enabled} ({scope}: {target_mcp_path})")
        return ctx.result(
            data={
                "bridge": bridge_name,
                "enabled": enabled,
                "scope": scope,
                "path": str(target_mcp_path),
                "action": "check",
            },
            code=ExitCodes.SUCCESS,
        )

    cfg: dict[str, Any] = dict(existing_config) if existing_config else {"$schema": DEFAULT_MCP_SCHEMA, "mcpServers": {}}
    if "$schema" not in cfg:
        cfg["$schema"] = DEFAULT_MCP_SCHEMA
    if "mcpServers" not in cfg or not isinstance(cfg["mcpServers"], dict):
        cfg["mcpServers"] = {}

    mcp_servers = cfg["mcpServers"]
    current_entry = mcp_servers.get(bridge_name)
    if not current_entry:
        defn = CANONICAL_MCP_BRIDGES[bridge_name]
        current_entry = build_canonical_server_entry(defn, enabled=enabled)
    else:
        current_entry = dict(current_entry)
        current_entry["enabled"] = enabled

    mcp_servers[bridge_name] = current_entry

    # Synchronize allow/deny lists
    if enabled:
        if "disabledServers" in cfg and isinstance(cfg["disabledServers"], list):
            cfg["disabledServers"] = [s for s in cfg["disabledServers"] if s != bridge_name]
        if "denied" in cfg and isinstance(cfg["denied"], list):
            cfg["denied"] = [s for s in cfg["denied"] if s != bridge_name]
        if "enabledServers" in cfg and isinstance(cfg["enabledServers"], list):
            if bridge_name not in cfg["enabledServers"]:
                cfg["enabledServers"].append(bridge_name)
        if "allowed" in cfg and isinstance(cfg["allowed"], list):
            if bridge_name not in cfg["allowed"]:
                cfg["allowed"].append(bridge_name)
    else:
        if "enabledServers" in cfg and isinstance(cfg["enabledServers"], list):
            cfg["enabledServers"] = [s for s in cfg["enabledServers"] if s != bridge_name]
        if "allowed" in cfg and isinstance(cfg["allowed"], list):
            cfg["allowed"] = [s for s in cfg["allowed"] if s != bridge_name]
        if "disabledServers" in cfg and isinstance(cfg["disabledServers"], list):
            if bridge_name not in cfg["disabledServers"]:
                cfg["disabledServers"].append(bridge_name)
        if "denied" in cfg and isinstance(cfg["denied"], list):
            if bridge_name not in cfg["denied"]:
                cfg["denied"].append(bridge_name)

    safe_write_file(
        target_mcp_path,
        json.dumps(cfg, indent=2),
        write=True,
        force=True,
        allow_update=True,
        mode=0o600,
    )

    if not ctx.is_json:
        print(f"[mcp {sub}] Successfully set '{bridge_name}' to enabled: {enabled} ({scope}: {target_mcp_path})")

    return ctx.result(
        data={
            "bridge": bridge_name,
            "enabled": enabled,
            "scope": scope,
            "path": str(target_mcp_path),
            "updatedPaths": [str(target_mcp_path)],
        },
        code=ExitCodes.SUCCESS,
    )


def _handle_mcp_verify(ctx: Context, scope: str, target_mcp_path: Path) -> int:
    is_live = bool(ctx.values.get("live"))
    errors: list[str] = []

    if is_live:
        load_dotenv_without_override([ctx.profile_dir / ".env", ctx.repo_root / ".env"])
    # Git tracking check: project .omp/mcp.json must NEVER be tracked by git
    if scope == "project":
        try:
            proc = subprocess.run(
                ["git", "ls-files", ".omp/mcp.json"],
                cwd=str(ctx.repo_root),
                capture_output=True,
                text=True,
                check=False,
            )
            if proc.stdout.strip():
                errors.append("SECURITY COMPROMISED: .omp/mcp.json is tracked by git. It MUST be ignored.")
        except Exception:
            pass

    if not target_mcp_path.is_file():
        errors.append(f"Missing MCP configuration at '{target_mcp_path}'.")
    else:
        ok, parsed, err = parse_and_validate_mcp_config(target_mcp_path.read_text(encoding="utf-8"))
        if not ok:
            errors.append(f"CONFIG_INVALID: MCP configuration at '{target_mcp_path}' is malformed or corrupt: {err}")
        else:
            cfg = parsed or {}
            profile_config: dict[str, Any] | None = None
            if scope == "project":
                prof_path = ctx.profile_dir / "mcp.json"
                if prof_path.is_file():
                    try:
                        ok_prof, prof_cfg, _ = parse_and_validate_mcp_config(prof_path.read_text(encoding="utf-8"))
                        if ok_prof:
                            profile_config = prof_cfg
                    except Exception:
                        pass

            for s_id, s_entry in (cfg.get("mcpServers") or {}).items():
                eval_res = evaluate_server_state(
                    server_id=s_id,
                    scope=scope,
                    target_config=cfg,
                    profile_config=profile_config,
                )

                if eval_res.effective_state == "enabled":
                    defn = CANONICAL_MCP_BRIDGES.get(s_id, {})
                    binary_prereq = defn.get("binaryPrereq")
                    if binary_prereq and not shutil.which(binary_prereq):
                        errors.append(f"PREREQUISITE_MISSING: '{s_id}' requires binary '{binary_prereq}' in PATH.")

                    runner = defn.get("runner")
                    if runner == "uv" and not shutil.which("uv"):
                        errors.append(f"RUNNER_MISSING: '{s_id}' requires runner 'uv' in PATH. Install via curl -LsSf https://astral.sh/uv/install.sh")

                    if is_live:
                        live_ok, live_err = probe_live_server(s_id, s_entry)
                        if not live_ok:
                            raw_target = s_entry.get("url") or s_entry.get("command") or "endpoint"
                            target_url = sanitize_url(str(raw_target))
                            errors.append(f"ENDPOINT_UNREACHABLE: Live probe failed for '{s_id}' at {target_url}: {live_err}")
    clean = len(errors) == 0
    exit_code = ExitCodes.SUCCESS if clean else ExitCodes.CHECK_FAILURE

    if not ctx.is_json:
        if clean:
            print(f"[mcp verify passed] All MCP configuration rules and protection checks satisfied ({scope}: {target_mcp_path}).")
        else:
            print(f"[mcp verify failed] Errors ({scope}: {target_mcp_path}):", file=sys.stderr)
            for e in errors:
                print(f" - {e}", file=sys.stderr)

    return ctx.result(
        data={
            "clean": clean,
            "live": is_live,
            "scope": scope,
            "path": str(target_mcp_path),
        },
        code=exit_code,
        errors=errors if not clean else None,
    )
