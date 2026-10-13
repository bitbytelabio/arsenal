"""Deterministic in-package catalog for Arsenal scripts and playbooks.

Resolves script endpoints exclusively from catalog_data/playbook_catalog.json
loaded via importlib.resources (no repository or current-directory fallback).
Provides exact-ID resolution, deterministic listing, and parity verification.
"""

from __future__ import annotations

import hashlib
import importlib.resources as pkg_resources
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from arsenal import schemas
from arsenal.common import Context, ExitCodes

# Canonical ID grammar: alphanumeric, hyphens, underscores separated by single forward slashes
CANONICAL_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+(/[a-zA-Z0-9_-]+)*$")


class CatalogResolutionError(ValueError):
    """Raised when an ID is malformed, ambiguous, or contains traversal sequences."""
    pass


@lru_cache(maxsize=1)
def load_catalog_data() -> tuple[dict[str, Any], str]:
    """Load catalog from package resources without filesystem fallbacks."""
    resource = pkg_resources.files("arsenal.scripts").joinpath("catalog_data", "playbook_catalog.json")
    content = resource.read_text(encoding="utf-8")
    raw_bytes = content.encode("utf-8")
    cat_sha256 = hashlib.sha256(raw_bytes).hexdigest()

    data = json.loads(content)
    validation_errors = schemas.validate(schemas.PLAYBOOK_CATALOG_SCHEMA, data)
    if validation_errors:
        raise ValueError(f"Playbook catalog schema validation failed: {'; '.join(validation_errors)}")

    return data, cat_sha256


def catalog_sha256() -> str:
    """Return the SHA-256 digest of the catalog document."""
    _, digest = load_catalog_data()
    return digest


def list_entries() -> list[dict[str, Any]]:
    """Return all catalog entries sorted deterministically by canonical_id."""
    data, _ = load_catalog_data()
    entries = data.get("entries", [])
    return sorted(entries, key=lambda e: e["canonical_id"])


def build_indexes() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Build canonical_id and alias lookup indexes, rejecting duplicates or collisions."""
    entries = list_entries()
    canonical_index: dict[str, dict[str, Any]] = {}
    alias_index: dict[str, dict[str, Any]] = {}

    for entry in entries:
        cid = entry["canonical_id"]
        if cid in canonical_index:
            raise ValueError(f"Duplicate canonical_id in catalog: '{cid}'")
        canonical_index[cid] = entry

        for alias in entry.get("aliases", []):
            if alias in canonical_index:
                raise ValueError(f"Alias '{alias}' collides with canonical_id '{alias}'")
            if alias in alias_index:
                raise ValueError(f"Ambiguous alias '{alias}' registered to multiple entries")
            alias_index[alias] = entry

    return canonical_index, alias_index


def resolve(script_id: str) -> dict[str, Any]:
    """Resolve a script ID or alias to a catalog descriptor.

    MUST reject:
    - Empty components (e.g. '', 'a//b', '/a', 'a/')
    - Absolute paths (starting with '/')
    - Traversal sequences ('..')
    - Separators outside the canonical grammar
    - Unknown IDs

    Returns the catalog entry descriptor (NEVER a filesystem path).
    """
    if not script_id or not isinstance(script_id, str):
        raise CatalogResolutionError("Script identifier must be a non-empty string.")

    if ".." in script_id:
        raise CatalogResolutionError(f"Directory traversal sequences ('..') are forbidden: '{script_id}'")

    if script_id.startswith("/") or script_id.endswith("/") or "//" in script_id:
        raise CatalogResolutionError(f"Malformed path components in script identifier: '{script_id}'")

    if not CANONICAL_ID_PATTERN.match(script_id):
        raise CatalogResolutionError(
            f"Script identifier '{script_id}' does not match canonical ID grammar."
        )

    canonical_index, alias_index = build_indexes()

    if script_id in canonical_index:
        return canonical_index[script_id]

    if script_id in alias_index:
        return alias_index[script_id]

    raise KeyError(f"Unknown script identifier: '{script_id}'")


def verify_parity(repo_root: Path | None = None) -> dict[str, Any]:
    """Execute the parity oracle comparing disk, catalog, receipts, and resources."""
    root = repo_root or Path.cwd()
    problems: list[str] = []

    # 1. Load catalog data
    try:
        data, cat_digest = load_catalog_data()
        entries = data.get("entries", [])
    except Exception as exc:
        return {
            "ok": False,
            "playbookEntries": 0,
            "coreEntries": 0,
            "historicalReceipts": 0,
            "problems": [f"Failed to load/validate catalog: {exc}"],
        }

    # 2. Check catalog duplicate IDs or aliases
    cids: set[str] = set()
    aliases: set[str] = set()
    playbook_entries: list[dict[str, Any]] = []
    core_entries: list[dict[str, Any]] = []

    for e in entries:
        cid = e.get("canonical_id", "")
        if cid in cids:
            problems.append(f"Duplicate canonical_id in catalog: '{cid}'")
        cids.add(cid)

        if e.get("domain") == "core":
            core_entries.append(e)
        else:
            playbook_entries.append(e)

        for a in e.get("aliases", []):
            if a in cids or a in aliases:
                problems.append(f"Duplicate/shadowing alias in catalog: '{a}'")
            aliases.add(a)
    # 2b. Check SCRIPT_HANDLERS registry vs catalog per T021
    from arsenal.scripts import SCRIPT_HANDLERS, _init_registry
    _init_registry()
    core_cids = {e["canonical_id"] for e in core_entries}
    playbook_cids = {e["canonical_id"] for e in playbook_entries}

    registered_core_cids = {v[0] for v in SCRIPT_HANDLERS.values() if not v[0].startswith("catalog/")}
    for reg_id in registered_core_cids:
        if reg_id not in core_cids:
            problems.append(f"Registered core handler '{reg_id}' has no catalog entry")

    for p_id in playbook_cids:
        if p_id in core_cids or p_id in registered_core_cids:
            problems.append(f"Playbook entry '{p_id}' shadows core handler '{p_id}'")


    # 3. Check receipts from receipts.py
    from arsenal.scripts.receipts import SCRIPT_RECEIPTS

    receipts_count = len(SCRIPT_RECEIPTS)
    receipt_by_migrated: dict[str, dict[str, Any]] = {}
    receipt_by_cid: dict[str, dict[str, Any]] = {}

    for r in SCRIPT_RECEIPTS:
        mp = r.get("migrated_path")
        rcid = r.get("canonical_id")
        if mp:
            receipt_by_migrated[mp] = r
        if rcid:
            receipt_by_cid[rcid] = r

        # Parity check: absorbed receipts must not be in catalog
        if r.get("status") == "absorbed":
            if rcid in cids:
                problems.append(f"Absorbed receipt '{rcid}' must not be dispatchable in catalog.")

    # 4. Check executable files on disk vs catalog
    playbooks_dir = root / "src" / "arsenal" / "scripts" / "playbooks"
    disk_playbooks: set[str] = set()
    if playbooks_dir.is_dir():
        for dom in ("red", "webapp", "mobile", "re", "shared"):
            dom_dir = playbooks_dir / dom
            if dom_dir.is_dir():
                for fpath in dom_dir.glob("*.py"):
                    if fpath.name != "__init__.py":
                        disk_playbooks.add(f"playbooks/{dom}/{fpath.name}")

    catalog_resource_paths = {
        e.get("implementation_ref", {}).get("resource_path")
        for e in playbook_entries
        if "resource_path" in e.get("implementation_ref", {})
    }
    for dp in disk_playbooks:
        if dp not in catalog_resource_paths:
            problems.append(f"Orphan playbook file on disk not in catalog: '{dp}'")
    # Check for missing implementations (in catalog but not on disk/resource)
    for e in entries:
        ref = e.get("implementation_ref", {})
        if "resource_path" in ref:
            res_path = ref["resource_path"]
            # Check via package resources
            try:
                pkg_res = pkg_resources.files("arsenal.scripts").joinpath(res_path)
                if not pkg_res.is_file():
                    problems.append(f"Catalog resource_path cannot be resolved: '{res_path}' for '{e['canonical_id']}'")
            except Exception:
                problems.append(f"Catalog resource_path cannot be resolved: '{res_path}' for '{e['canonical_id']}'")

            # Check source hash matches disk
            full_disk = root / "src" / "arsenal" / "scripts" / res_path
            if full_disk.is_file():
                actual_hash = hashlib.sha256(full_disk.read_bytes()).hexdigest()
                if actual_hash != e.get("source_sha256"):
                    problems.append(
                        f"Stale source_sha256 for '{e['canonical_id']}': expected {e.get('source_sha256')}, got {actual_hash}"
                    )
        elif "module_path" in ref:
            # Core module check
            mod_path = ref["module_path"]
            fn_name = ref.get("callable", "handle")
            try:
                import importlib
                mod = importlib.import_module(mod_path)
                if not hasattr(mod, fn_name):
                    problems.append(f"Core module '{mod_path}' missing callable '{fn_name}' for '{e['canonical_id']}'")
            except Exception as exc:
                problems.append(f"Failed to import core module '{mod_path}' for '{e['canonical_id']}': {exc}")
            mod_file = root / "src" / "arsenal" / "scripts" / f"{mod_path.split('.')[-1]}.py"
            if mod_file.is_file():
                actual_hash = hashlib.sha256(mod_file.read_bytes()).hexdigest()
                if actual_hash != e.get("source_sha256"):
                    problems.append(
                        f"Stale source_sha256 for '{e['canonical_id']}': expected {e.get('source_sha256')}, got {actual_hash}"
                    )

    ok = len(problems) == 0
    return {
        "ok": ok,
        "playbookEntries": len(playbook_entries),
        "coreEntries": len(core_entries),
        "historicalReceipts": receipts_count,
        "problems": problems,
    }


def handle_verify(ctx: Context) -> int:
    """Read-only catalog parity verification handler for 'arsenal scripts catalog/verify'."""
    result = verify_parity()
    if not ctx.is_json:
        if result["ok"]:
            print("CATALOG PARITY VERIFICATION: PASS")
            print(f"  Playbook endpoints:    {result['playbookEntries']} (expected 209)")
            print(f"  Core entries:          {result['coreEntries']} (expected 22)")
            print(f"  Historical receipts:   {result['historicalReceipts']} (expected 257)")
        else:
            print("CATALOG PARITY VERIFICATION: FAIL")
            for p in result["problems"]:
                print(f"  - {p}")

    code = ExitCodes.SUCCESS if result["ok"] else ExitCodes.CHECK_FAILURE
    return ctx.result(result, code=code)


def handle_refresh(ctx: Context) -> int:
    """Catalog refresh handler for 'arsenal scripts catalog/refresh --write'."""
    write_flag = ctx.values.get("write") or "--write" in ctx.remainder or "--write" in ctx.positionals
    if not write_flag:
        return ctx.fail(
            "Catalog refresh requires explicit '--write' flag to modify catalog data.",
            code=ExitCodes.CLI_USAGE_ERROR,
        )

    from arsenal.scripts.playbook_catalog_inventory import generate_playbook_entries
    playbook_entries = generate_playbook_entries()

    # Build full document
    # Keep core entries if already present or build them
    from arsenal.scripts import SCRIPT_HANDLERS, _init_registry
    _init_registry()

    root = Path.cwd()
    core_entries: list[dict[str, Any]] = []
    from arsenal.scripts.receipts import SCRIPT_RECEIPTS
    receipt_by_cid = {r.get("canonical_id"): r for r in SCRIPT_RECEIPTS}

    seen_core: set[str] = set()
    for key, (canonical_id, handler_fn, desc) in sorted(SCRIPT_HANDLERS.items()):
        if canonical_id in seen_core or canonical_id.startswith("catalog/"):
            continue
        seen_core.add(canonical_id)

        # Find module and aliases
        mod_name = handler_fn.__module__
        aliases = [k for k, v in SCRIPT_HANDLERS.items() if v[0] == canonical_id and k != canonical_id]

        # Calculate file sha256
        mod_file = root / "src" / "arsenal" / "scripts" / f"{mod_name.split('.')[-1]}.py"
        src_hash = hashlib.sha256(mod_file.read_bytes()).hexdigest() if mod_file.is_file() else "0" * 64

        receipt = receipt_by_cid.get(canonical_id, {})
        core_entry: dict[str, Any] = {
            "schema_version": 1,
            "canonical_id": canonical_id,
            "aliases": sorted(aliases),
            "domain": "core",
            "target_kind": "tool",
            "description": desc,
            "implementation_ref": {
                "module_path": mod_name,
                "callable": handler_fn.__name__,
            },
            "source_sha256": src_hash,
            "execution_mode": "shared",
            "admission_status": "approved_shared",
            "isolation_reason": [],
            "side_effects": {
                "network": "none",
                "credentials": "none",
                "target_mutation": "none",
                "filesystem": "write" if canonical_id in ("case-init", "append-evidence", "re-diagram-generator/render-diagram") else "none",
                "external_process": "allowlisted" if canonical_id.startswith("re-") else "none",
                "evidence_write": "central_only" if canonical_id in ("case-init", "append-evidence") else "none",
            },
            "controls": {
                "scope": "not_applicable",
                "authorization": "not_applicable",
                "proxy": "none",
                "write": "optional" if canonical_id in ("case-init", "append-evidence") else "forbidden",
                "verification": "none",
                "evidence": "none",
            },
            "dependencies": {
                "profile": None,
                "imports": [],
                "tools": [],
                "lock_hash": None,
                "project_path": None,
                "environment_dir": None,
            },
            "interface": {
                "argument_schema": None,
                "output_format": "json",
                "exit_mapping": None,
                "timeout_ms": 30000,
                "stdout_limit": 1048576,
                "stderr_limit": 1048576,
            },
            "provenance": {
                "original_path": receipt.get("original_path"),
                "migrated_path": receipt.get("migrated_path"),
                "receipt_ids": [receipt.get("canonical_id")] if receipt.get("canonical_id") else [canonical_id],
                "status": receipt.get("status", "migrated"),
                "license": receipt.get("license", "Apache-2.0"),
                "shared_implementation_id": None,
            },
            "admission_record_id": f"adm-core-{canonical_id.replace('/', '-')}",
        }
        core_entries.append(core_entry)

    all_entries = sorted(playbook_entries + core_entries, key=lambda e: e["canonical_id"])

    catalog_doc = {
        "schema_version": 1,
        "catalog_sha256": None,
        "generated_at": "2026-10-13T00:00:00Z",
        "entries": all_entries,
    }

    # Format JSON
    content = json.dumps(catalog_doc, indent=2) + "\n"
    # Compute sha256
    doc_sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
    catalog_doc["catalog_sha256"] = doc_sha
    final_content = json.dumps(catalog_doc, indent=2) + "\n"

    target_path = root / "src" / "arsenal" / "scripts" / "catalog_data" / "playbook_catalog.json"
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(final_content, encoding="utf-8")

    # Clear cache
    load_catalog_data.cache_clear()

    return ctx.result(
        {"refreshed": True, "totalEntries": len(all_entries), "path": str(target_path)},
        code=ExitCodes.SUCCESS,
    )
