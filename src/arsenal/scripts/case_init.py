"""Case initializer - Port of case-init.sh and case-init.ps1.

Scaffolds a structured engagement workspace under work/<case-name>/
with evidence, notes, report directories, and baseline authorization/scope metadata.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes


def sanitize_slug(text: str, max_length: int = 40) -> str:
    """Create a URL-safe directory slug from free text."""
    slug = text.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    if not slug:
        slug = "case"
    return slug[:max_length]


def validate_case_name(name: str) -> bool:
    """Validate case name directory constraints."""
    if not name or len(name) > 80:
        return False
    if not name[0].isalnum():
        return False
    if re.search(r'[/\\:*?"<>|]', name):
        return False
    if any(ord(c) < 32 for c in name):
        return False
    if name[-1] in ". ":
        return False
    return True


def run_case_init(
    hint: str = "",
    case_name: str = "",
    project_root: Path | None = None,
    preset: str = "",
    sample: str = "",
    target_url: str = "",
    network_profile: str = "",
    auth_status: str = "",
    auth_granted: bool = False,
    auth_basis: str = "unknown",
    evidence_of_auth: str = "",
    in_scope_assets: list[str] | None = None,
) -> dict[str, Any]:
    """Execute case initialization logic."""
    root = (project_root or Path.cwd()).resolve()
    assets = list(in_scope_assets or [])

    # Process preset
    preset_lower = preset.lower() if preset else ""
    if preset_lower in ("offline-sample", "own-sample", "local-sample"):
        auth_granted = True
        auth_status = "granted"
        auth_basis = "own_system"
        network_profile = network_profile or "offline"
        evidence_of_auth = evidence_of_auth or "preset:offline-sample (owner-operated local file)"
        if sample and sample not in assets:
            assets.append(sample)
    elif preset_lower in ("ctf-public", "ctf"):
        auth_granted = True
        auth_status = "granted"
        auth_basis = "ctf_public"
        network_profile = network_profile or "authorized_target_only"
        evidence_of_auth = evidence_of_auth or "preset:ctf-public"
    elif preset_lower in ("own-system", "lab-only"):
        auth_granted = True
        auth_status = "granted"
        auth_basis = "own_system"
        network_profile = network_profile or "lab_only"
        evidence_of_auth = evidence_of_auth or "preset:own-system/lab"
    elif preset_lower:
        raise ValueError(f"Invalid --preset '{preset}'. Allowed: offline-sample, ctf-public, own-system")

    # Generate or validate case name
    now = datetime.now(timezone.utc).astimezone()
    if not case_name:
        slug = sanitize_slug(hint)
        timestamp_prefix = now.strftime("%Y%m%d-%H%M%S")
        case_name = f"{timestamp_prefix}-{slug}"

    if not validate_case_name(case_name):
        raise ValueError(
            f"Invalid --case-name '{case_name}'. Must be 1-80 characters, start with alphanumeric, "
            "and contain no path separators, wildcard characters, or trailing dots/spaces."
        )

    # Validate / normalize network profile
    net_profile = (network_profile or "").lower()
    profile_aliases = {
        "lab": "lab_only",
        "authorized": "authorized_target_only",
        "auth": "authorized_target_only",
        "offline_only": "offline",
    }
    net_profile = profile_aliases.get(net_profile, net_profile)
    valid_profiles = {"offline", "lab_only", "authorized_target_only", "unrestricted_lab"}

    if not net_profile:
        if auth_granted or auth_status == "granted":
            if (target_url or assets) and not sample:
                net_profile = "authorized_target_only"
            else:
                net_profile = "offline"
        else:
            net_profile = "offline"

    if net_profile not in valid_profiles:
        raise ValueError(
            f"Invalid --network-profile '{network_profile}'. Allowed: "
            + ", ".join(sorted(valid_profiles))
        )

    # Resolve authorization status
    final_auth_status = "granted" if auth_granted else (auth_status.lower() if auth_status else "pending")
    if final_auth_status not in ("pending", "granted", "denied", "unknown"):
        final_auth_status = "pending"

    final_evidence_auth = evidence_of_auth
    if not final_evidence_auth:
        if auth_granted or final_auth_status == "granted":
            final_evidence_auth = "cli-flag auth_granted or auth_status=granted"
        else:
            final_evidence_auth = "PENDING_VERIFICATION"

    # Assemble assets
    if target_url and target_url not in assets:
        assets.append(target_url)
    if sample and sample not in assets:
        assets.append(sample)
    if not assets and hint:
        url_match = re.search(r"https?://[^\s/]+", hint)
        if url_match:
            assets.append(url_match.group(0))

    # Create directory tree
    case_root = root / "work" / case_name
    evidence_dir = case_root / "evidence"
    notes_dir = case_root / "notes"
    report_dir = case_root / "report"

    for d in (evidence_dir, notes_dir, report_dir):
        d.mkdir(parents=True, exist_ok=True)

    # 1. case.json
    case_meta = {
        "case_id": case_name,
        "name": case_name,
        "hint": hint,
        "created_at": now.isoformat(),
        "network_profile": net_profile,
        "authorization": {
            "status": final_auth_status,
            "basis": auth_basis,
            "evidence": final_evidence_auth,
        },
        "in_scope_assets": assets,
    }
    (case_root / "case.json").write_text(json.dumps(case_meta, indent=2), encoding="utf-8")

    # 2. scope.json
    scope_meta = {
        "scope_version": 1,
        "case_id": case_name,
        "network_mode": net_profile,
        "assets": [{"target": a, "type": "url" if a.startswith("http") else "artifact"} for a in assets],
        "created_at": now.isoformat(),
    }
    (case_root / "scope.json").write_text(json.dumps(scope_meta, indent=2), encoding="utf-8")

    # 3. notes/timeline.md
    timeline_content = f"""# Engagement Timeline: {case_name}

- {now.strftime("%Y-%m-%d %H:%M:%S")} UTC: Case initialized. Hint: "{hint or 'none'}".
"""
    (notes_dir / "timeline.md").write_text(timeline_content, encoding="utf-8")

    # 4. report/findings.md
    findings_content = f"""# Findings Report: {case_name}

- **Created**: {now.strftime("%Y-%m-%d %H:%M:%S")}
- **Scope**: {net_profile}
- **Status**: Active

## Summary
No findings recorded yet.
"""
    (report_dir / "findings.md").write_text(findings_content, encoding="utf-8")

    # 5. Route hint if provided
    route_info = None
    if hint:
        try:
            from arsenal.scripts.master_route import evaluate_master_route
            route_info = evaluate_master_route(hint=hint, project_root=root, out_dir=notes_dir)
        except Exception:
            pass

    return {
        "case_name": case_name,
        "case_root": str(case_root),
        "network_profile": net_profile,
        "auth_status": final_auth_status,
        "assets": assets,
        "route": route_info,
    }


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal scripts case-init'."""
    parser = argparse.ArgumentParser(prog="arsenal scripts case-init", description="Initialize case workspace")
    parser.add_argument("--hint", "-Hint", default="", help="Task or engagement hint")
    parser.add_argument("--case-name", "-CaseName", default="", help="Explicit directory name for case")
    parser.add_argument("--project-root", "-ProjectRoot", default="", help="Project root directory")
    parser.add_argument("--preset", "-Preset", default="", help="Preset: offline-sample | ctf-public | own-system")
    parser.add_argument("--sample", "--offline-sample", "-Sample", default="", help="Local sample file path")
    parser.add_argument("--target-url", "-TargetUrl", default="", help="Target URL")
    parser.add_argument("--network-profile", "-NetworkProfile", default="", help="Network profile")
    parser.add_argument("--auth-status", "-AuthStatus", default="", help="Authorization status")
    parser.add_argument("--auth-granted", "-AuthGranted", action="store_true", help="Mark authorization as granted")
    parser.add_argument("--auth-basis", "-AuthBasis", default="unknown", help="Authorization basis")
    parser.add_argument("--evidence-of-auth", "-EvidenceOfAuth", default="", help="Evidence of authorization string")
    parser.add_argument("--in-scope-asset", "-InScopeAssets", action="append", default=[], help="Asset in scope")

    argv = list(ctx.positionals)
    if ctx.remainder:
        argv.extend(ctx.remainder)

    try:
        args, unknown = parser.parse_known_args(argv)
        # If positional text given without --hint, use first unknown as hint
        hint = args.hint
        if not hint and unknown and not unknown[0].startswith("-"):
            hint = unknown[0]

        root = Path(args.project_root).resolve() if args.project_root else ctx.repo_root

        result = run_case_init(
            hint=hint,
            case_name=args.case_name,
            project_root=root,
            preset=args.preset,
            sample=args.sample,
            target_url=args.target_url,
            network_profile=args.network_profile,
            auth_status=args.auth_status,
            auth_granted=args.auth_granted,
            auth_basis=args.auth_basis,
            evidence_of_auth=args.evidence_of_auth,
            in_scope_assets=args.in_scope_asset,
        )

        if not ctx.is_json:
            print(f"CASE INITIALIZED: {result['case_name']}")
            print(f"  Location: {result['case_root']}")
            print(f"  Network:  {result['network_profile']}")
            print(f"  Auth:     {result['auth_status']}")
            if result.get("assets"):
                print(f"  Assets:   {', '.join(result['assets'])}")
        return ctx.result(result, code=ExitCodes.SUCCESS)
    except Exception as exc:
        return ctx.fail(str(exc), code=ExitCodes.CLI_USAGE_ERROR)
