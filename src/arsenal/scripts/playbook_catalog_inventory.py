"""Inventory generation for Arsenal playbook catalog.

Computes executable endpoints from src/arsenal/scripts/playbooks/<domain>/*.py.
Derives conservative entries with managed_subprocess execution mode and unclassified admission.
Preserves locked_environment for ISOLATED_ENV_PLAYBOOKS.
Consolidates the six byte-identical duplicate pairs into shared implementations under playbooks/shared/.
Computes source_sha256 from disk bytes and maps provenance from receipts.py.
"""

from __future__ import annotations

import ast
import hashlib
from pathlib import Path
from typing import Any

from arsenal.scripts.playbook_runner import ISOLATED_ENV_PLAYBOOKS, MODULE_DEPENDENCIES
from arsenal.scripts.receipts import SCRIPT_RECEIPTS

SHARED_CONSOLIDATED_PAIRS: dict[str, tuple[str, str]] = {
    "red-detecting-ai-model-prompt-injection-attacks/agent": (
        "shared/prompt_injection",
        "playbooks/shared/prompt_injection.py",
    ),
    "webapp-detecting-ai-model-prompt-injection-attacks/agent": (
        "shared/prompt_injection",
        "playbooks/shared/prompt_injection.py",
    ),
    "red-implementing-attack-surface-management/agent": (
        "shared/attack_surface_management",
        "playbooks/shared/attack_surface_management.py",
    ),
    "webapp-implementing-attack-surface-management/agent": (
        "shared/attack_surface_management",
        "playbooks/shared/attack_surface_management.py",
    ),
    "red-implementing-llm-guardrails-for-security/agent": (
        "shared/llm_guardrails",
        "playbooks/shared/llm_guardrails.py",
    ),
    "webapp-implementing-llm-guardrails-for-security/agent": (
        "shared/llm_guardrails",
        "playbooks/shared/llm_guardrails.py",
    ),
    "red-implementing-vulnerability-remediation-sla/process": (
        "shared/vulnerability_remediation_sla",
        "playbooks/shared/vulnerability_remediation_sla.py",
    ),
    "webapp-implementing-vulnerability-remediation-sla/process": (
        "shared/vulnerability_remediation_sla",
        "playbooks/shared/vulnerability_remediation_sla.py",
    ),
    "red-performing-phishing-simulation-with-gophish/process": (
        "shared/phishing_simulation_gophish",
        "playbooks/shared/phishing_simulation_gophish.py",
    ),
    "webapp-performing-phishing-simulation-with-gophish/process": (
        "shared/phishing_simulation_gophish",
        "playbooks/shared/phishing_simulation_gophish.py",
    ),
    "re-validating-backup-integrity-for-recovery/agent": (
        "shared/backup_integrity",
        "playbooks/shared/backup_integrity.py",
    ),
    "webapp-validating-backup-integrity-for-recovery/agent": (
        "shared/backup_integrity",
        "playbooks/shared/backup_integrity.py",
    ),
}


def compute_file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scan_playbook_ast(path: Path) -> dict[str, Any]:
    """Lightweight AST analysis of a playbook file to discover imports and side-effect hints."""
    try:
        content = path.read_text(encoding="utf-8")
        tree = ast.parse(content, filename=str(path))
    except Exception:
        content = ""
        tree = ast.Module(body=[], type_ignores=[])

    imported_modules: set[str] = set()
    has_network = False
    has_fs_write = False
    has_subprocess = False

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for name in node.names:
                root_pkg = name.name.split(".")[0]
                imported_modules.add(root_pkg)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root_pkg = node.module.split(".")[0]
                imported_modules.add(root_pkg)
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id == "open":
                if len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                    if any(m in str(node.args[1].value) for m in ("w", "a", "x")):
                        has_fs_write = True
            elif isinstance(node.func, ast.Attribute) and node.func.attr in ("Popen", "run", "call", "check_call", "check_output"):
                has_subprocess = True

    net_pkgs = {"socket", "urllib", "requests", "http", "scapy", "pyshark", "dns", "boto3", "shodan", "censys"}
    if imported_modules.intersection(net_pkgs) or "http" in content or "requests." in content or "socket." in content:
        has_network = True

    if "subprocess." in content or "subprocess" in imported_modules:
        has_subprocess = True

    if ".write(" in content or "open(" in content:
        has_fs_write = True

    detected_profiles: set[str] = set()
    for mod in imported_modules:
        if mod in MODULE_DEPENDENCIES:
            _, profile = MODULE_DEPENDENCIES[mod]
            detected_profiles.add(profile)

    return {
        "imports": sorted(imported_modules),
        "has_network": has_network,
        "has_fs_write": has_fs_write,
        "has_subprocess": has_subprocess,
        "profiles": sorted(detected_profiles),
    }


def generate_playbook_entries(repo_root: Path | None = None) -> list[dict[str, Any]]:
    """Scan all playbooks in domain directories and shared implementations to generate catalog entries."""
    root = repo_root or Path.cwd()
    playbooks_dir = root / "src" / "arsenal" / "scripts" / "playbooks"

    receipt_by_cid = {
        r.get("canonical_id"): r
        for r in SCRIPT_RECEIPTS
        if r.get("canonical_id")
    }

    # Group receipts by hash
    receipt_by_hash: dict[str, list[dict[str, Any]]] = {}
    for r in SCRIPT_RECEIPTS:
        h = r.get("sha256")
        if h:
            receipt_by_hash.setdefault(h, []).append(r)

    entries: list[dict[str, Any]] = []
    seen_aliases: set[str] = set()

    # 1. Generate unshared playbooks present in domain directories
    domains = ["red", "webapp", "mobile", "re"]
    for domain in domains:
        dom_dir = playbooks_dir / domain
        if not dom_dir.is_dir():
            continue

        for file_path in sorted(dom_dir.glob("*.py")):
            if file_path.name == "__init__.py":
                continue

            source_hash = compute_file_sha256(file_path)
            matching_receipts = receipt_by_hash.get(source_hash, [])
            # Filter receipts matching this domain and not consolidated
            dom_receipts = [
                r for r in matching_receipts
                if r["canonical_id"].startswith(f"{domain}-") and r["canonical_id"] not in SHARED_CONSOLIDATED_PAIRS
            ]
            if not dom_receipts:
                dom_receipts = [
                    r for r in matching_receipts
                    if r["canonical_id"] not in SHARED_CONSOLIDATED_PAIRS
                ]

            if not dom_receipts:
                raise ValueError(f"Playbook file has no matching receipt: {file_path}")

            receipt = dom_receipts[0]
            canonical_id = receipt["canonical_id"]
            target_name = receipt.get("filename", "agent.py").replace(".py", "")

            ast_info = scan_playbook_ast(file_path)
            is_isolated = canonical_id in ISOLATED_ENV_PLAYBOOKS
            execution_mode = "locked_environment" if is_isolated else "managed_subprocess"
            isolation_reason = (
                ["Isolated uv environment required for dependency conflict"]
                if is_isolated
                else ["Retained legacy subprocess isolation"]
            )

            env_dir = ISOLATED_ENV_PLAYBOOKS.get(canonical_id) if is_isolated else None
            lock_hash = None
            if env_dir:
                lock_path = root / "src" / "arsenal" / "scripts" / "environments" / env_dir / "uv.lock"
                if lock_path.is_file():
                    lock_hash = compute_file_sha256(lock_path)

            net_mode = "active" if ast_info["has_network"] else "none"
            fs_mode = "write" if ast_info["has_fs_write"] else "read"
            ext_proc = "allowlisted" if ast_info["has_subprocess"] else "none"

            proxy_policy = "none"
            if net_mode != "none":
                if domain == "webapp":
                    proxy_policy = "burp_required"
                elif domain in ("re", "mobile"):
                    proxy_policy = "mitmproxy_runtime_required"

            bare_name = canonical_id.split("/")[0]
            alias_list = [bare_name] if bare_name not in seen_aliases and bare_name != canonical_id else []
            seen_aliases.update(alias_list)

            entry = {
                "schema_version": 1,
                "canonical_id": canonical_id,
                "aliases": alias_list,
                "domain": domain,
                "target_kind": target_name,
                "description": receipt.get("description") or f"Playbook {target_name} for {canonical_id}",
                "implementation_ref": {
                    "resource_path": f"playbooks/{domain}/{file_path.name}",
                },
                "source_sha256": source_hash,
                "execution_mode": execution_mode,
                "admission_status": "unclassified",
                "isolation_reason": isolation_reason,
                "side_effects": {
                    "network": net_mode,
                    "credentials": "read" if any(w in file_path.name for w in ("token", "cred", "auth")) else "none",
                    "target_mutation": "local" if (fs_mode == "write" or ext_proc != "none") else "none",
                    "filesystem": fs_mode,
                    "external_process": ext_proc,
                    "evidence_write": "none",
                },
                "controls": {
                    "scope": "required" if net_mode != "none" or fs_mode == "write" else "not_applicable",
                    "authorization": "host_required" if net_mode != "none" or fs_mode == "write" else "not_applicable",
                    "proxy": proxy_policy,
                    "write": "forbidden",
                    "verification": "none",
                    "evidence": "none",
                },
                "dependencies": {
                    "profile": ast_info["profiles"][0] if ast_info["profiles"] else None,
                    "imports": ast_info["imports"],
                    "tools": [],
                    "lock_hash": lock_hash,
                    "project_path": None,
                    "environment_dir": env_dir,
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
                    "receipt_ids": [receipt.get("canonical_id")],
                    "status": receipt.get("status", "migrated"),
                    "license": receipt.get("license"),
                    "shared_implementation_id": None,
                },
                "admission_record_id": None,
            }
            entries.append(entry)

    # 2. Generate entries for the 6 consolidated pairs (12 canonical endpoints)
    for canonical_id, (shared_id, res_path) in sorted(SHARED_CONSOLIDATED_PAIRS.items()):
        shared_file = root / "src" / "arsenal" / "scripts" / res_path
        if not shared_file.is_file():
            raise FileNotFoundError(f"Shared implementation file missing: {shared_file}")

        receipt = receipt_by_cid.get(canonical_id)
        if not receipt:
            raise ValueError(f"Receipt missing for consolidated endpoint: {canonical_id}")

        source_hash = compute_file_sha256(shared_file)
        skill_name, target_name = canonical_id.split("/")
        domain = skill_name.split("-")[0]
        if domain not in ("red", "re", "webapp", "mobile"):
            domain = "core"

        ast_info = scan_playbook_ast(shared_file)
        net_mode = "active" if ast_info["has_network"] else "none"
        fs_mode = "write" if ast_info["has_fs_write"] else "read"
        ext_proc = "allowlisted" if ast_info["has_subprocess"] else "none"

        proxy_policy = "none"
        if net_mode != "none":
            if domain == "webapp":
                proxy_policy = "burp_required"
            elif domain in ("re", "mobile"):
                proxy_policy = "mitmproxy_runtime_required"

        bare_name = canonical_id.split("/")[0]
        alias_list = [bare_name] if bare_name not in seen_aliases and bare_name != canonical_id else []
        seen_aliases.update(alias_list)

        entry = {
            "schema_version": 1,
            "canonical_id": canonical_id,
            "aliases": alias_list,
            "domain": domain,
            "target_kind": target_name,
            "description": receipt.get("description") or f"Playbook {target_name} for {skill_name}",
            "implementation_ref": {
                "resource_path": res_path,
            },
            "source_sha256": source_hash,
            "execution_mode": "managed_subprocess",
            "admission_status": "unclassified",
            "isolation_reason": ["Retained legacy subprocess isolation"],
            "side_effects": {
                "network": net_mode,
                "credentials": "none",
                "target_mutation": "local" if (fs_mode == "write" or ext_proc != "none") else "none",
                "filesystem": fs_mode,
                "external_process": ext_proc,
                "evidence_write": "none",
            },
            "controls": {
                "scope": "required" if net_mode != "none" or fs_mode == "write" else "not_applicable",
                "authorization": "host_required" if net_mode != "none" or fs_mode == "write" else "not_applicable",
                "proxy": proxy_policy,
                "write": "forbidden",
                "verification": "none",
                "evidence": "none",
            },
            "dependencies": {
                "profile": ast_info["profiles"][0] if ast_info["profiles"] else None,
                "imports": ast_info["imports"],
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
                "receipt_ids": [receipt.get("canonical_id")],
                "status": receipt.get("status", "migrated"),
                "license": receipt.get("license"),
                "shared_implementation_id": shared_id,
            },
            "admission_record_id": None,
        }
        entries.append(entry)

    assert len(entries) == 210, f"Expected exactly 210 playbook entries, got {len(entries)}"
    return sorted(entries, key=lambda e: e["canonical_id"])
