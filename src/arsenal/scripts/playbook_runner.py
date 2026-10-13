"""Corpus playbook runner for centralized assessment playbooks.

Resolves and executes centralized playbooks from arsenal.scripts.playbooks/<skill_name>/
with unified argument handling, output forwarding, dependency guidance, and error boundaries.
Supports isolated environment execution for dependency-conflicted playbooks (e.g. LLM Guard).
"""

from __future__ import annotations

import importlib.resources as pkg_resources
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes

# Known playbooks requiring dedicated isolated uv environment bundles
ISOLATED_ENV_PLAYBOOKS: dict[str, str] = {
    "red-defending-llms-with-guardrails/agent": "llm_guard",
    "red-defending-llms-with-guardrails": "llm_guard",
}

# Comprehensive mapping of third-party AST root modules -> (PyPI package, extras group)
MODULE_DEPENDENCIES: dict[str, tuple[str, str]] = {
    "scapy": ("scapy", "network"),
    "pyshark": ("pyshark", "network"),
    "dns": ("dnspython", "network"),
    "nmap": ("python-nmap", "network"),
    "boto3": ("boto3", "cloud"),
    "botocore": ("botocore", "cloud"),
    "msal": ("msal", "cloud"),
    "docker": ("docker", "cloud"),
    "shodan": ("shodan", "intel"),
    "censys": ("censys", "intel"),
    "pymisp": ("pymisp", "intel"),
    "stix2": ("stix2", "intel"),
    "taxii2client": ("taxii2-client", "intel"),
    "attackcti": ("attackcti", "intel"),
    "tldextract": ("tldextract", "intel"),
    "pefile": ("pefile", "forensics"),
    "yara": ("yara-python", "forensics"),
    "evtx": ("python-evtx", "forensics"),
    "Evtx": ("python-evtx", "forensics"),
    "dissect": ("dissect", "forensics"),
    "r2pipe": ("r2pipe", "re"),
    "impacket": ("impacket", "ad"),
    "ldap3": ("ldap3", "ad"),
    "bleak": ("bleak", "wireless"),
    "transformers": ("transformers", "ai"),
    "torch": ("torch", "ai"),
    "spacy": ("spacy", "ai"),
    "librosa": ("librosa", "ai"),
    "pandas": ("pandas", "analysis"),
    "numpy": ("numpy", "analysis"),
    "jinja2": ("jinja2", "analysis"),
    "sklearn": ("scikit-learn", "analysis"),
    "networkx": ("networkx", "analysis"),
    "joblib": ("joblib", "analysis"),
    "Levenshtein": ("Levenshtein", "analysis"),
    "cryptography": ("cryptography", "crypto"),
    "OpenSSL": ("pyOpenSSL", "crypto"),
    "pkcs11": ("python-pkcs11", "crypto"),
    "cbor2": ("cbor2", "crypto"),
    "gvm": ("python-gvm", "vuln"),
    "requests": ("requests", "vuln"),
    "urllib3": ("urllib3", "vuln"),
    "lxml": ("lxml", "vuln"),
    "PIL": ("Pillow", "vuln"),
    "psutil": ("psutil", "vuln"),
    "watchdog": ("watchdog", "vuln"),
    "androguard": ("androguard", "mobile"),
}


def resolve_isolated_env_dir(env_name: str, repo_root: Path | None = None) -> Path:
    """Find bundled isolated environment directory containing pyproject.toml and uv.lock."""
    candidates = []

    here = Path(__file__).resolve().parent
    candidates.append(here / "environments" / env_name)

    if repo_root:
        candidates.append(repo_root / "src" / "arsenal" / "scripts" / "environments" / env_name)

    candidates.append(Path.cwd() / "src" / "arsenal" / "scripts" / "environments" / env_name)

    for c in candidates:
        if (c / "pyproject.toml").is_file():
            return c.resolve()

    try:
        res = pkg_resources.files("arsenal.scripts").joinpath("environments", env_name)
        if res.joinpath("pyproject.toml").is_file():
            return Path(str(res))
    except Exception:
        pass

    raise FileNotFoundError(f"Isolated environment bundle '{env_name}' not found.")


def resolve_playbook_path(skill_name: str, script_name: str, repo_root: Path | None = None) -> Path:
    """Find the playbook file in the centralized arsenal.scripts.playbooks package."""
    candidates = []

    here = Path(__file__).resolve().parent
    candidates.append(here / "playbooks" / skill_name / f"{script_name}.py")

    if repo_root:
        candidates.append(repo_root / "src" / "arsenal" / "scripts" / "playbooks" / skill_name / f"{script_name}.py")

    candidates.append(Path.cwd() / "src" / "arsenal" / "scripts" / "playbooks" / skill_name / f"{script_name}.py")

    for c in candidates:
        if c.is_file():
            return c.resolve()

    try:
        res = pkg_resources.files("arsenal.scripts").joinpath("playbooks", skill_name, f"{script_name}.py")
        if res.is_file():
            return Path(str(res))
    except Exception:
        pass

    raise FileNotFoundError(
        f"Playbook '{script_name}' not found for skill '{skill_name}' in arsenal.scripts.playbooks."
    )


def run_playbook(
    skill_name: str,
    script_name: str,
    argv: list[str],
    repo_root: Path | None = None,
) -> int:
    """Execute a centralized playbook, routing to isolated uv environments when required."""
    script_file = resolve_playbook_path(skill_name, script_name, repo_root)

    # Check if playbook requires an isolated uv environment bundle
    playbook_key = f"{skill_name}/{script_name}"
    env_name = ISOLATED_ENV_PLAYBOOKS.get(playbook_key) or ISOLATED_ENV_PLAYBOOKS.get(skill_name)

    if env_name:
        uv_cmd = shutil.which("uv")
        if not uv_cmd:
            print(
                f"[!] Playbook '{playbook_key}' requires isolated environment bundle '{env_name}' via uv.\n"
                f"uv executable not found on $PATH. Install uv from https://astral.sh/uv",
                file=sys.stderr,
            )
            return ExitCodes.ENVIRONMENT_UNAVAILABLE

        env_dir = resolve_isolated_env_dir(env_name, repo_root)

        # First attempt execution using --locked and --offline
        cmd_isolated = [
            uv_cmd,
            "run",
            "--locked",
            "--offline",
            "--project",
            str(env_dir),
            "python",
            str(script_file),
            *argv,
        ]
        proc = subprocess.run(cmd_isolated, capture_output=True, text=True)

        # If offline run failed because dependencies are not synced into venv, provide clear instructions
        if proc.returncode != 0 and "not found" in proc.stderr.lower():
            # Try without --offline if user has network, or instruct sync
            cmd_online = [
                uv_cmd,
                "run",
                "--locked",
                "--project",
                str(env_dir),
                "python",
                str(script_file),
                *argv,
            ]
            proc = subprocess.run(cmd_online, capture_output=True, text=True)

        if proc.stdout:
            print(proc.stdout, end="")
        if proc.stderr:
            print(proc.stderr, end="", file=sys.stderr)
            if proc.returncode != 0:
                print(
                    f"\n[arsenal environment notice] If dependencies are missing in '{env_name}', sync with:\n"
                    f"  uv sync --locked --project {env_dir}\n",
                    file=sys.stderr,
                )
        return proc.returncode

    # Standard direct execution for playbooks within primary environment
    cmd = [sys.executable, str(script_file), *argv]
    proc = subprocess.run(cmd, capture_output=True, text=True)

    if proc.stdout:
        print(proc.stdout, end="")
    if proc.stderr:
        print(proc.stderr, end="", file=sys.stderr)
        match = re.search(r"ModuleNotFoundError: No module named ['\"]([^'\"]+)['\"]", proc.stderr)
        if match:
            missing_mod = match.group(1).split(".")[0]
            dep_info = MODULE_DEPENDENCIES.get(missing_mod)
            if dep_info:
                pkg_name, extra_group = dep_info
                guidance = (
                    f"\n[arsenal playbook notice] Playbook '{skill_name}/{script_name}' requires optional dependency '{pkg_name}'.\n"
                    f"To install, run: uv pip install {pkg_name} (or install extra: uv tool install . --extra {extra_group})\n"
                )
            else:
                guidance = (
                    f"\n[arsenal playbook notice] Playbook '{skill_name}/{script_name}' requires external module '{missing_mod}'.\n"
                    f"To install, run: uv pip install {missing_mod}\n"
                )
            print(guidance, file=sys.stderr)

    return proc.returncode


def handle_playbook(ctx: Context, skill_name: str, script_name: str) -> int:
    """Dispatch execution to a centralized playbook."""
    argv = list(ctx.positionals)
    if ctx.remainder:
        argv.extend(ctx.remainder)

    try:
        code = run_playbook(
            skill_name=skill_name,
            script_name=script_name,
            argv=argv,
            repo_root=ctx.repo_root,
        )
        return code
    except FileNotFoundError as err:
        return ctx.fail(str(err), code=ExitCodes.ENVIRONMENT_UNAVAILABLE)
    except Exception as exc:
        return ctx.fail(f"Playbook execution failed: {exc}", code=ExitCodes.CHECK_FAILURE)
