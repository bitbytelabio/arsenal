"""Centralized Arsenal operational scripts dispatcher.

Exposes 'arsenal scripts <canonical-id> [args...]' CLI entrypoint.
Preserves behaviors, flags, and arguments while routing to centralized Python modules.
"""

from __future__ import annotations

import json
import sys
from typing import Any, Callable

from arsenal.common import Context, ExitCodes
from arsenal.scripts.receipts import SCRIPT_RECEIPTS, list_receipts

# Canonical ID to handler mapping
SCRIPT_HANDLERS: dict[str, tuple[str, Callable[[Context], int], str]] = {}


def _register(canonical_id: str, handler_fn: Callable[[Context], int], description: str, *aliases: str) -> None:
    entry = (canonical_id, handler_fn, description)
    SCRIPT_HANDLERS[canonical_id] = entry
    for alias in aliases:
        SCRIPT_HANDLERS[alias] = entry


# Lazy registration to avoid unnecessary imports
def _init_registry() -> None:
    if SCRIPT_HANDLERS:
        return

    from arsenal.scripts.case_init import handle as handle_case_init
    from arsenal.scripts.append_evidence import handle as handle_append_evidence
    from arsenal.scripts.master_route import handle as handle_master_route
    from arsenal.scripts.bootstrap_reverse import handle as handle_bootstrap
    from arsenal.scripts.apk_tools import handle as handle_apk
    from arsenal.scripts.radare2_recon import handle as handle_r2
    from arsenal.scripts.diagram import handle as handle_diagram
    from arsenal.scripts.ida_tools import handle as handle_ida
    from arsenal.scripts.gdpr import handle as handle_gdpr
    from arsenal.scripts.ad_honeytokens import handle as handle_ad

    _register("case-init", handle_case_init, "Initialize case directory and metadata")
    _register("append-evidence", handle_append_evidence, "Append Evidence item under work/<case>/evidence/")
    _register("master-route", handle_master_route, "Skill router analyzer and scope evaluator")
    _register("bootstrap-reverse", handle_bootstrap, "Reverse engineering tool bootstrap and capability verification")
    from arsenal.scripts.burp_bridge import handle as handle_burp

    # APK tools
    _register("re-apk-reverse/decode", handle_apk, "APK unpacking with jadx and apktool", "apk-decode")
    _register("re-apk-reverse/manifest-summary", handle_apk, "AndroidManifest.xml summary inspection", "manifest-summary")
    _register("re-apk-reverse/rebuild-sign-install", handle_apk, "APK repackaging, signing, and installation", "rebuild-sign-install")
    _register("re-apk-reverse/frida-run", handle_apk, "Frida dynamic instrumentation launcher", "frida-run")

    # Radare2
    _register("re-radare2/recon", handle_r2, "Radare2 / rabin2 rapid binary reconnaissance", "recon")

    # Diagram
    _register("re-diagram-generator/render-diagram", handle_diagram, "Multi-format diagram renderer", "render-diagram")

    # IDA Pro
    _register("re-ida-reverse/start", handle_ida, "IDA Pro MCP HTTP server starter/probe")
    _register("re-ida-reverse/start-gui", handle_ida, "IDA Pro GUI workspace launcher")
    _register("re-ida-reverse/open", handle_ida, "Open binary in IDA Pro via HTTP API")
    _register("re-ida-reverse/recover", handle_ida, "Recover or reconnect IDA Pro session")
    _register("re-ida-reverse/install-autostart", handle_ida, "Install IDA Pro MCP autostart configuration")
    _register("re-ida-reverse/watchdog", handle_ida, "IDA Pro MCP health and keepalive watchdog", "ida-watchdog")
    _register("re-ida-reverse/run-supervisor", handle_ida, "IDA Pro MCP idalib supervisor launcher")

    # GDPR
    _register("gdpr/article30-parser", handle_gdpr, "GDPR Article 30 RoPA parser", "article30-parser")
    _register("gdpr/article30-validator", handle_gdpr, "GDPR Article 30 RoPA validator", "article30-validator")
    _register("gdpr/generate-ropa-report", handle_gdpr, "GDPR Article 30 RoPA report generator", "generate-ropa-report")

    # Active Directory
    _register("ad-honeytokens/deploy", handle_ad, "Active Directory honeytoken deployer", "deploy-honeytokens")

    # Burp Suite Bridge
    _register("burp-mcp-bridge", handle_burp, "Burp Suite MCP stdio bridge", "webapp-pentest-tools/mcp-bridge")


def handle_list(ctx: Context) -> int:
    """List all registered scripts."""
    _init_registry()
    items = []
    seen = set()
    for key, (canonical, _, desc) in sorted(SCRIPT_HANDLERS.items()):
        if canonical not in seen:
            seen.add(canonical)
            items.append({"id": canonical, "description": desc})

    if not ctx.is_json:
        print("REGISTERED ARSENAL SCRIPTS:")
        for it in items:
            print(f"  {it['id']:<38} - {it['description']}")
    return ctx.result({"scripts": items}, code=ExitCodes.SUCCESS)


def handle_receipts(ctx: Context) -> int:
    """Print migration receipts ledger."""
    receipts = list_receipts()
    if not ctx.is_json:
        print(f"ARSENAL MIGRATION RECEIPTS ({len(receipts)} scripts accounted for):")
        for r in receipts[:20]:
            print(f"  [{r['status'].upper():<9}] {r['canonical_id']:<35} <- {r['original_path']}")
        if len(receipts) > 20:
            print(f"  ... and {len(receipts) - 20} more. Run with --json for complete ledger.")
    return ctx.result({"receipts": receipts, "total": len(receipts)}, code=ExitCodes.SUCCESS)


def handle(ctx: Context) -> int:
    """Primary entrypoint for 'arsenal scripts' command family."""
    _init_registry()

    script_id = ctx.subcommand or ""
    # Support 'arsenal scripts --list' or 'arsenal scripts list'
    if not script_id or script_id == "list" or ctx.values.get("list"):
        return handle_list(ctx)

    if script_id == "receipts":
        return handle_receipts(ctx)

    # Check direct registered handlers
    if script_id in SCRIPT_HANDLERS:
        canonical_id, handler_fn, _ = SCRIPT_HANDLERS[script_id]
        return handler_fn(ctx)

    # Check playbooks: <skill>/agent or <skill>/process
    if "/" in script_id:
        skill_name, target = script_id.split("/", 1)
        if target in ("agent", "process"):
            from arsenal.scripts.playbook_runner import handle_playbook
            return handle_playbook(ctx, skill_name, target)

    # Check bare skill name
    if script_id.startswith(("red-", "webapp-", "mobile-", "re-")):
        from arsenal.scripts.playbook_runner import handle_playbook
        # Try agent first, then process
        try:
            return handle_playbook(ctx, script_id, "agent")
        except FileNotFoundError:
            try:
                return handle_playbook(ctx, script_id, "process")
            except FileNotFoundError:
                pass

    return ctx.fail(
        f"Unknown script identifier: '{script_id}'. Run 'arsenal scripts list' to see available commands.",
        code=ExitCodes.CLI_USAGE_ERROR,
    )
