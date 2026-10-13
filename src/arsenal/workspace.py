"""Workspace management: scaffolding, context inspection, and drift detection."""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes, VERSION
from arsenal.storage import (
    safe_mkdir,
    safe_write_file,
    sha256_file,
    sha256_string,
)


def find_workspace_root(start_dir: Path | str | None = None) -> Path:
    """Climb upward from start directory to find an engagement root marked by .omp."""
    curr = Path(start_dir).resolve() if start_dir else Path.cwd().resolve()
    while True:
        if (curr / ".omp" / "arsenal").is_dir() or (curr / ".omp").is_dir():
            return curr
        parent = curr.parent
        if parent == curr:
            break
        curr = parent
    return Path(start_dir).resolve() if start_dir else Path.cwd().resolve()


def detect_drift(
    target_dir: Path | str,
    manifest_files: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compare managed files against reference manifest checksums."""
    t_dir = Path(target_dir).resolve()
    missing: list[str] = []
    modified: list[str] = []

    for item in manifest_files:
        rel_path = item["path"]
        expected_hash = item["sha256"].lower()
        full_path = t_dir / rel_path

        if not full_path.is_file():
            missing.append(rel_path)
        else:
            cur_hash = sha256_file(full_path)
            if cur_hash != expected_hash:
                modified.append(rel_path)

    clean = len(missing) == 0 and len(modified) == 0
    return {
        "clean": clean,
        "missingFiles": missing,
        "modifiedFiles": modified,
        "extraFiles": [],
    }


def inspect_context_layers(start_dir: Path | str) -> dict[str, Any]:
    """Climb filesystem to discover and audit nested .omp context layers."""
    layers: list[dict[str, Any]] = []
    errors: list[str] = []
    curr = Path(start_dir).resolve()

    while True:
        omp_dir = curr / ".omp"
        if omp_dir.is_dir():
            agents_file = omp_dir / "AGENTS.md"
            rules_file = omp_dir / "RULES.md"
            has_agents = agents_file.is_file()
            has_rules = rules_file.is_file()

            imports: list[str] = []
            broken_imports: list[str] = []

            for f in (agents_file, rules_file):
                if f.is_file():
                    content = f.read_text(encoding="utf-8")
                    matches = re.findall(r"@path\s+([^\s\n\r]+)", content)
                    for rel in matches:
                        imports.append(rel)
                        target = (curr / rel).resolve()
                        if not target.exists():
                            broken_imports.append(rel)
                            errors.append(f"Broken import in '{f}': target '{target}' does not exist.")

            layers.append({
                "path": str(curr),
                "hasAgents": has_agents,
                "hasRules": has_rules,
                "hasOmpDir": True,
                "suppressesAncestor": False,
                "imports": imports,
                "brokenImports": broken_imports,
            })

        parent = curr.parent
        if parent == curr:
            break
        curr = parent

    # Context suppression detection: nearer .omp without AGENTS.md hiding ancestor AGENTS.md
    for i, nearer in enumerate(layers):
        if nearer["hasOmpDir"] and not nearer["hasAgents"]:
            for ancestor in layers[i + 1 :]:
                if ancestor["hasAgents"]:
                    nearer["suppressesAncestor"] = True
                    errors.append(
                        f"Context suppression detected: Nearer layer '{nearer['path']}' has .omp without AGENTS.md, "
                        f"hiding ancestor context from '{ancestor['path']}'."
                    )
                    break

    clean = len(errors) == 0
    suppression_detected = any(layer["suppressesAncestor"] for layer in layers)

    return {
        "layers": layers,
        "clean": clean,
        "suppressionDetected": suppression_detected,
        "errors": errors,
    }


def handle_context(ctx: Context) -> int:
    """CLI handler for 'arsenal context'."""
    inspection = inspect_context_layers(ctx.repo_root)
    if not inspection["clean"]:
        if not ctx.is_json:
            print("[arsenal context] Layer inspection failed:")
            for err in inspection["errors"]:
                print(f"  - {err}", file=sys.stderr)
        return ctx.result(
            inspection,
            code=ExitCodes.CHECK_FAILURE,
            errors=inspection["errors"],
        )

    if not ctx.is_json:
        print(f"[arsenal context] Clean: {len(inspection['layers'])} context layers inspected.")
        for layer in inspection["layers"]:
            print(f"  Layer: {layer['path']} (agents: {layer['hasAgents']}, rules: {layer['hasRules']})")

    return ctx.result(inspection, code=ExitCodes.SUCCESS)


def handle_init(ctx: Context) -> int:
    """CLI handler for 'arsenal init'."""
    is_check = bool(ctx.values.get("check"))
    is_write = bool(ctx.values.get("write"))
    is_force = bool(ctx.values.get("force"))

    if ctx.subcommand and ctx.subcommand != "check":
        target_dir = Path(ctx.subcommand).resolve()
    elif ctx.positionals:
        target_dir = Path(ctx.positionals[0]).resolve()
    else:
        target_dir = ctx.repo_root.resolve()

    preset_raw = ctx.values.get("preset")
    preset = str(preset_raw).lower() if preset_raw else None
    name_raw = ctx.values.get("name")
    engagement_name = str(name_raw) if name_raw else target_dir.name

    omp_dir = target_dir / ".omp"
    evidence_dir = target_dir / "evidence"
    manifest_path = omp_dir / "manifest.json"

    # Check mode: audit existing scaffolding against manifest
    if is_check:
        if not manifest_path.is_file():
            msg = f"No manifest found at '{manifest_path}'. Engagement not initialized."
            return ctx.fail(msg, code=ExitCodes.CHECK_FAILURE)

        try:
            manifest_doc = json.loads(manifest_path.read_text(encoding="utf-8"))
            drift = detect_drift(target_dir, manifest_doc.get("files", []))
            if not drift["clean"]:
                error_list: list[str] = []
                if drift["missingFiles"]:
                    error_list.append(f"Missing files: {', '.join(drift['missingFiles'])}")
                if drift["modifiedFiles"]:
                    error_list.append(f"Modified files: {', '.join(drift['modifiedFiles'])}")

                if not ctx.is_json:
                    print("[check failed] Engagement context drift detected:", file=sys.stderr)
                    for err in error_list:
                        print(f" - {err}", file=sys.stderr)

                return ctx.result(
                    {"clean": False, "drift": drift},
                    code=ExitCodes.CHECK_FAILURE,
                    errors=error_list,
                )

            if not ctx.is_json:
                print(f"[check passed] Scaffolding at '{target_dir}' is clean and unmodified.")
            return ctx.result({"clean": True, "targetDir": str(target_dir)}, code=ExitCodes.SUCCESS)
        except Exception as e:
            return ctx.fail(f"Error reading manifest: {e}", code=ExitCodes.CHECK_FAILURE)

    # Scaffolding mode: requires --preset
    if not preset or preset not in ("re", "webapp", "mobile", "red"):
        return ctx.fail(
            "Missing or invalid required flag: --preset <re|webapp|mobile|red>",
            code=ExitCodes.CLI_USAGE_ERROR,
        )

    engagement_id = f"ENG-2026-{re.sub(r'[^A-Z0-9-]', '-', engagement_name.upper())}"
    now = datetime.now(timezone.utc).isoformat()

    charter_content = f"""# Security Engagement Charter: {engagement_name}
Engagement ID: {engagement_id}
Domain: {preset}
Created: {now}

## Rules of Engagement
1. All actions must remain within authorized scope defined in .omp/scope.json.
2. Direct observations require cryptographic evidence capture.
3. Exploitation actions strictly require granted authorization.
"""
    charter_sha256 = sha256_string(charter_content)

    engagement_content = json.dumps(
        {
            "schema_version": 1,
            "engagement_id": engagement_id,
            "name": engagement_name,
            "domain": preset,
            "created_at": now,
            "auth": {
                "status": "incomplete",
                "basis": None,
                "reference": None,
                "ready_for_act": False,
            },
            "status": "prepared",
        },
        indent=2,
    )

    scope_content = json.dumps(
        {
            "schema_version": 1,
            "engagement_id": engagement_id,
            "name": engagement_name,
            "created_at": now,
            "domain": preset,
            "auth": {
                "status": "incomplete",
                "basis": None,
                "reference": None,
                "ready_for_act": False,
            },
            "in_scope": [],
            "out_of_scope": [],
            "disallowed_actions": ["dos", "unauthorized_data_destruction"],
            "window": {
                "start": now,
                "end": datetime.fromtimestamp(datetime.now().timestamp() + 86400 * 7, tz=timezone.utc).isoformat(),
                "timezone": "UTC",
            },
            "environment_id": "env-local-1",
            "charter_path": ".omp/charter.md",
            "charter_sha256": charter_sha256,
            "budget_usd": None,
        },
        indent=2,
    )

    environment_content = json.dumps(
        {
            "schema_version": 1,
            "id": "env-local-1",
            "kind": "local",
            "name": "Default Local Environment",
            "address": "127.0.0.1",
            "access_method": "direct",
            "working_root": str(target_dir),
            "proxy_url": None,
            "ca_path": None,
            "browser_trust_path": None,
            "tool_index_path": None,
            "path_overrides": None,
            "observed_at": now,
        },
        indent=2,
    )

    evidence_gitignore_content = """# Ignore raw evidence artifacts & SQLite coordination databases
raw/
*.txt
*.bin
*.sqlite
*.sqlite-wal
*.sqlite-shm
"""

    planned_files: list[dict[str, str]] = [
        {"relPath": ".omp/engagement.json", "content": engagement_content},
        {"relPath": ".omp/scope.json", "content": scope_content},
        {"relPath": ".omp/environment.json", "content": environment_content},
        {"relPath": ".omp/charter.md", "content": charter_content},
        {"relPath": "evidence/.gitignore", "content": evidence_gitignore_content},
    ]

    manifest_files = [
        {
            "path": f["relPath"],
            "sha256": sha256_string(f["content"]),
            "bytes": len(f["content"].encode("utf-8")),
        }
        for f in planned_files
    ]

    manifest_content = json.dumps(
        {
            "schema_version": 1,
            "generator": f"arsenal-init-v{VERSION}",
            "created_at": now,
            "preset": preset,
            "engagement_id": engagement_id,
            "files": manifest_files,
        },
        indent=2,
    )

    planned_files.append({"relPath": ".omp/manifest.json", "content": manifest_content})

    file_results: list[dict[str, str]] = []
    refused = False

    for item in planned_files:
        full_path = target_dir / item["relPath"]
        res = safe_write_file(full_path, item["content"], write=is_write, force=is_force)
        if res["action"] == "refused":
            refused = True
        file_results.append({"path": item["relPath"], "action": res["action"]})

    if refused:
        msg = "Files exist with conflicting content. Specify --force to overwrite with backup."
        return ctx.result(
            {"files": file_results},
            code=ExitCodes.MUTATION_REFUSED,
            errors=[msg],
        )

    if is_write:
        safe_mkdir(evidence_dir / "raw", 0o700)

    if not ctx.is_json:
        print(f"[arsenal init] Scaffolding for '{engagement_name}' ({preset}) [mode: {ctx.mode}]:")
        for f in file_results:
            print(f" - {f['path']}: {f['action']}")
        if not is_write:
            print("\nNote: Dry-run preview mode. Add --write to persist files to disk.")

    return ctx.result(
        {
            "engagement_id": engagement_id,
            "preset": preset,
            "targetDir": str(target_dir),
            "files": file_results,
        },
        code=ExitCodes.SUCCESS,
    )
