"""Active Directory Honeytoken deployment orchestrator.

Python controller for Deploy-ADHoneytokens.ps1. Deploys deception-based honeytokens including:
fake privileged accounts, decoy SPNs for Kerberoasting detection, and deceptive SACLs.
Enforces real execution boundaries: live deployment requires Windows Active Directory environment;
offline / non-Windows environments return ENVIRONMENT_UNAVAILABLE without fake execution.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import string
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes


def generate_random_password(length: int = 32) -> str:
    """Generate cryptographically secure decoy password."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*()-_=+"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def plan_honeytokens(
    domain: str = "corp.local",
    ou: str = "OU=Service Accounts,DC=corp,DC=local",
    fake_admin_prefix: str = "svc-ad-sync",
    spn_service: str = "MSSQLSvc",
    count: int = 1,
) -> dict[str, Any]:
    """Generate deployment plan for Active Directory honeytokens."""
    tokens = []
    for i in range(1, count + 1):
        username = f"{fake_admin_prefix}{i:02d}"
        spn = f"{spn_service}/sql-cluster-{i:02d}.{domain}:1433"
        tokens.append({
            "type": "honeyroast_spn",
            "account_name": username,
            "display_name": f"Service Account {username}",
            "target_ou": ou,
            "spn": spn,
            "admin_count": 1,
            "decoy_password": generate_random_password(24),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    return {
        "domain": domain,
        "target_ou": ou,
        "token_count": len(tokens),
        "tokens": tokens,
        "mode": "plan",
    }


def resolve_native_payload_path() -> Path:
    """Locate Deploy-ADHoneytokens.ps1 native asset."""
    candidates = [
        Path(__file__).resolve().parent / "assets" / "Deploy-ADHoneytokens.ps1",
        Path.cwd() / "src" / "arsenal" / "scripts" / "assets" / "Deploy-ADHoneytokens.ps1",
    ]
    for c in candidates:
        if c.is_file():
            return c.resolve()
    raise FileNotFoundError("Native payload 'Deploy-ADHoneytokens.ps1' asset not found.")


def deploy_honeytokens_native(
    domain: str,
    ou: str,
    fake_admin_prefix: str,
    spn_service: str,
    count: int,
) -> tuple[int, dict[str, Any]]:
    """Execute native PowerShell deployment on Windows."""
    if sys.platform != "win32":
        return ExitCodes.ENVIRONMENT_UNAVAILABLE, {
            "error": f"Active Directory honeytoken live deployment requires a Windows host with ActiveDirectory PowerShell module; unavailable on {sys.platform}."
        }

    ps = shutil.which("powershell.exe") or shutil.which("powershell")
    if not ps:
        return ExitCodes.ENVIRONMENT_UNAVAILABLE, {"error": "PowerShell executable not found on Windows host."}

    payload_path = resolve_native_payload_path()
    cmd = [
        ps,
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(payload_path),
        "-Domain",
        domain,
        "-OU",
        ou,
        "-FakeAdminPrefix",
        fake_admin_prefix,
        "-HoneyroastSPN",
        f"{spn_service}/cluster.{domain}:1433",
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode, {
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "returncode": proc.returncode,
    }


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal scripts ad-honeytokens/deploy'."""
    parser = argparse.ArgumentParser(
        prog="arsenal scripts ad-honeytokens/deploy",
        description="Deploy deception-based Active Directory honeytokens",
    )
    parser.add_argument("--domain", "-Domain", default="corp.local", help="Target Active Directory domain")
    parser.add_argument("--ou", "-OU", default="OU=Service Accounts,DC=corp,DC=local", help="Target OU for honeytokens")
    parser.add_argument("--prefix", default="svc-ad-sync", help="Account name prefix")
    parser.add_argument("--spn-service", default="MSSQLSvc", help="Decoy SPN service type")
    parser.add_argument("--count", type=int, default=1, help="Number of honeytokens to deploy")
    parser.add_argument("--deploy", action="store_true", help="Execute deployment (requires Windows AD environment)")

    argv = list(ctx.positionals)
    if ctx.remainder:
        argv.extend(ctx.remainder)

    try:
        args, _ = parser.parse_known_args(argv)

        # Handle deploy action
        if args.deploy or ctx.mode == "write":
            if sys.platform != "win32":
                err_msg = (
                    f"Active Directory honeytoken live deployment requires a Windows Active Directory host "
                    f"with ActiveDirectory module; unavailable on {sys.platform}."
                )
                return ctx.fail(err_msg, code=ExitCodes.ENVIRONMENT_UNAVAILABLE)

            code, res = deploy_honeytokens_native(
                domain=args.domain,
                ou=args.ou,
                fake_admin_prefix=args.prefix,
                spn_service=args.spn_service,
                count=args.count,
            )
            return ctx.result(res, code=code)

        # Plan / preview mode (default)
        plan = plan_honeytokens(
            domain=args.domain,
            ou=args.ou,
            fake_admin_prefix=args.prefix,
            spn_service=args.spn_service,
            count=args.count,
        )

        if not ctx.is_json:
            print("AD HONEYTOKEN PLAN [PREVIEW]:")
            print(f"  Domain: {plan['domain']}")
            print(f"  Target OU: {plan['target_ou']}")
            print(f"  Tokens: {plan['token_count']}")
            for t in plan["tokens"]:
                print(f"    - {t['account_name']} (SPN: {t['spn']})")

        return ctx.result(plan, code=ExitCodes.SUCCESS)
    except Exception as exc:
        return ctx.fail(str(exc), code=ExitCodes.CLI_USAGE_ERROR)
