"""Centralized Arsenal operational scripts dispatcher.

Exposes 'arsenal scripts <canonical-id> [args...]' CLI entrypoint.
Preserves behaviors, flags, and arguments while routing to centralized Python modules.
All endpoints are resolved via the authoritative playbook catalog with preflight verification.
"""

from __future__ import annotations

import sys
from typing import Any, Callable

from arsenal.common import Context, ExitCodes
from arsenal.scripts.receipts import list_receipts

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
    from arsenal.scripts.burp_bridge import handle as handle_burp
    from arsenal.scripts.playbook_catalog import handle_verify, handle_refresh

    _register("case-init", handle_case_init, "Initialize case directory and metadata")
    _register("append-evidence", handle_append_evidence, "Append Evidence item under work/<case>/evidence/")
    _register("master-route", handle_master_route, "Skill router analyzer and scope evaluator")
    _register("bootstrap-reverse", handle_bootstrap, "Reverse engineering tool bootstrap and capability verification")

    # Catalog parity & management
    _register("catalog/verify", handle_verify, "Verify catalog parity against disk, receipts, and resources")
    _register("catalog/refresh", handle_refresh, "Regenerate in-package playbook catalog with --write")

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
    """List all registered scripts from the catalog per contracts/catalog-contract.md."""
    from arsenal.scripts.playbook_catalog import list_entries

    raw_entries = list_entries()

    items = []
    for e in raw_entries:
        cid = e["canonical_id"]
        domain = e.get("domain", "core")
        entry_type = "core" if domain == "core" else "playbook"

        # Side effects representation
        side_effects_vec = e.get("side_effects", {})
        side_effects_list = [
            f"{k}:{v}" for k, v in side_effects_vec.items()
            if isinstance(v, str) and v != "none"
        ]

        item = {
            "id": cid,
            "description": e.get("description", ""),
            "type": entry_type,
            "domain": domain,
            "executionMode": e.get("execution_mode", "managed_subprocess"),
            "admissionStatus": e.get("admission_status", "unclassified"),
            "sideEffects": side_effects_list,
            "dependencyProfile": e.get("dependencies", {}).get("profile"),
            "aliases": e.get("aliases", []),
            "provenance": {
                "receiptIds": e.get("provenance", {}).get("receipt_ids", []),
            },
        }
        items.append(item)

    # Filter by domain if requested
    domain_filter = ctx.values.get("domain")
    if domain_filter:
        items = [it for it in items if it["domain"].lower() == domain_filter.lower()]

    if not ctx.is_json:
        # Usability-oriented plain-text output (T022)
        by_domain: dict[str, list[dict[str, Any]]] = {}
        for it in items:
            dom = it["domain"]
            by_domain.setdefault(dom, []).append(it)

        show_all = bool(ctx.values.get("all") or domain_filter)
        print(f"ARSENAL SCRIPTS INVENTORY ({len(items)} endpoints):")
        for dom, dom_items in sorted(by_domain.items()):
            print(f"\n  [{dom.upper()}] ({len(dom_items)} endpoints)")
            if show_all:
                for it in dom_items:
                    print(f"    {it['id']:<42} - {it['description']}")
            else:
                for it in dom_items[:5]:
                    print(f"    {it['id']:<42} - {it['description']}")
                if len(dom_items) > 5:
                    print(f"    ... and {len(dom_items) - 5} more. Run with --all or --domain {dom} to see all.")

        if not show_all and len(items) > 20:
            print("\n  Use 'arsenal scripts list --all' or '--json' to view all endpoints.")

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

    script_id = ctx.subcommand or ""
    # Support 'arsenal scripts --list' or 'arsenal scripts list'
    if not script_id or script_id == "list" or ctx.values.get("list"):
        return handle_list(ctx)

    if script_id == "receipts":
        return handle_receipts(ctx)

    if script_id == "catalog/verify":
        from arsenal.scripts.playbook_catalog import handle_verify
        return handle_verify(ctx)

    if script_id == "catalog/refresh":
        from arsenal.scripts.playbook_catalog import handle_refresh
        return handle_refresh(ctx)
    _init_registry()

    from arsenal.scripts import playbook_boundaries, playbook_catalog, playbook_runner

    try:
        entry = playbook_catalog.resolve(script_id)
    except playbook_catalog.CatalogResolutionError as err:
        return ctx.fail(str(err), code=ExitCodes.CLI_USAGE_ERROR)
    except KeyError:
        return ctx.fail(
            f"Unknown script identifier: '{script_id}'. Run 'arsenal scripts list' to see available commands.",
            code=ExitCodes.CLI_USAGE_ERROR,
        )

    # Core handler dispatch
    if entry.get("domain") == "core":
        canonical_id = entry["canonical_id"]
        if canonical_id in SCRIPT_HANDLERS:
            _, handler_fn, _ = SCRIPT_HANDLERS[canonical_id]
            return handler_fn(ctx)
        # Fallback to shared handler execution
        return playbook_runner.execute_catalog_entry(ctx, entry)

    # Playbook dispatch with Preflight boundary check
    raw_args = list(ctx.positionals) + list(ctx.remainder)
    write_approved = bool(ctx.values.get("write"))
    decision = playbook_boundaries.evaluate_preflight(
        entry,
        raw_args=raw_args,
        workspace_root=ctx.repo_root,
        write_gate_approved=write_approved,
    )

    if not decision.is_allowed():
        return ctx.fail(decision.message, code=decision.exit_code())

    return playbook_runner.execute_catalog_entry(ctx, entry)
