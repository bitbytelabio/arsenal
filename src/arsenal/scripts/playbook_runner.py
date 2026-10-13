"""Corpus playbook runner for centralized assessment playbooks.

Executes playbooks resolved from the authoritative playbook catalog
with bounded stdout/stderr output, execution timeouts, isolated uv environment
support, and unified Arsenal JSON envelope formatting.
"""

from __future__ import annotations

import hashlib
import importlib.resources as pkg_resources
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes
from arsenal.storage import truncate_tail_to_byte_budget

# Known playbooks requiring dedicated isolated uv environment bundles
ISOLATED_ENV_PLAYBOOKS: dict[str, str] = {
    "red-defending-llms-with-guardrails/agent": "llm_guard",
    "red-defending-llms-with-guardrails": "llm_guard",
}

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
    try:
        res = pkg_resources.files("arsenal.scripts").joinpath("environments", env_name)
        if res.joinpath("pyproject.toml").is_file():
            return Path(str(res))
    except Exception:
        pass

    raise FileNotFoundError(f"Isolated environment bundle '{env_name}' not found in package resources.")


def resolve_resource_path(resource_path: str) -> Path:
    """Resolve a catalog resource_path from importlib package resources."""
    try:
        res = pkg_resources.files("arsenal.scripts").joinpath(resource_path)
        if res.is_file():
            return Path(str(res))
    except Exception:
        pass

    raise FileNotFoundError(f"Catalog resource '{resource_path}' not found in package resources.")


def sanitize_child_env() -> dict[str, str]:
    """Build a sanitized environment for managed child processes."""
    allowed_keys = {
        "PATH",
        "HOME",
        "USER",
        "LANG",
        "LC_ALL",
        "TERM",
        "PYTHONPATH",
        "SYSTEMROOT",
        "TMPDIR",
        "TMP",
        "TEMP",
        "ARSENAL_SCOPE_FILE",
    }
    clean_env = {k: v for k, v in os.environ.items() if k in allowed_keys}
    clean_env["PYTHONIOENCODING"] = "utf-8"
    clean_env["PYTHONUTF8"] = "1"
    return clean_env


def _run_with_timeout(
    cmd: list[str],
    argv: list[str],
    env: dict[str, str],
    timeout_s: float,
) -> tuple[int, bytes, bytes]:
    """Execute command in a new process group with hard deadline termination."""
    full_cmd = [*cmd, *argv]
    is_posix = os.name == "posix"
    proc = subprocess.Popen(
        full_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        start_new_session=is_posix,
    )
    try:
        stdout_bytes, stderr_bytes = proc.communicate(timeout=timeout_s)
        return proc.returncode, stdout_bytes, stderr_bytes
    except subprocess.TimeoutExpired:
        if is_posix:
            try:
                pgid = os.getpgid(proc.pid)
                os.killpg(pgid, signal.SIGTERM)
            except Exception:
                pass
        proc.kill()
        stdout_bytes, stderr_bytes = proc.communicate()
        return -1, stdout_bytes, stderr_bytes + b"\n[Execution timed out]"


def _clean_str(b: bytes) -> str:
    """Decode bytes cleanly without replacement characters."""
    try:
        text = b.decode("utf-8")
    except UnicodeDecodeError:
        text = b.decode("utf-8", errors="replace")
    return text.replace("\ufffd", "")


def execute_catalog_entry(ctx: Context, entry: dict[str, Any]) -> int:
    """Execute an admitted catalog entry under its declared execution boundary."""
    canonical_id = entry.get("canonical_id", "")
    mode = entry.get("execution_mode", "managed_subprocess")
    interface = entry.get("interface", {})
    deps = entry.get("dependencies", {})
    timeout_ms = interface.get("timeout_ms", 30000)
    timeout_s = max(1.0, timeout_ms / 1000.0)
    stdout_limit = interface.get("stdout_limit", 1048576)
    stderr_limit = interface.get("stderr_limit", 1048576)

    argv = list(ctx.positionals) + list(ctx.remainder)
    child_env = sanitize_child_env()

    # T015: Catalog-declared dependency readiness before dispatch
    declared_imports = deps.get("imports") or []
    missing_imports = []
    for mod_name in declared_imports:
        try:
            __import__(mod_name)
        except ImportError:
            missing_imports.append(mod_name)

    if missing_imports:
        profile = deps.get("profile")
        prep_cmd = f"uv sync --extra {profile}" if profile else f"uv add {missing_imports[0]}"
        return ctx.fail(
            f"Missing required dependency '{missing_imports[0]}' for endpoint '{canonical_id}'.\n"
            f"Preparation command: {prep_cmd} (no dependency installation during dispatch)",
            code=ExitCodes.ENVIRONMENT_UNAVAILABLE,
        )

    # 1. Shared Process Execution (approved_shared only)
    if mode == "shared":
        ref = entry.get("implementation_ref", {})
        mod_path = ref.get("module_path")
        fn_name = ref.get("callable", "handle")
        if not mod_path:
            return ctx.fail(
                f"Catalog entry '{canonical_id}' lacks module_path in implementation_ref.",
                code=ExitCodes.CHECK_FAILURE,
            )
        try:
            import importlib
            mod = importlib.import_module(mod_path)
            fn = getattr(mod, fn_name)
            return fn(ctx)
        except SystemExit as sys_exit:
            code = sys_exit.code if isinstance(sys_exit.code, int) else ExitCodes.CHECK_FAILURE
            return ctx.fail(f"Handler exited with status {code}", code=code)
        except KeyboardInterrupt:
            return ctx.fail("Handler interrupted", code=ExitCodes.CHECK_FAILURE)
        except Exception as exc:
            return ctx.fail(f"Handler execution failed: {exc}", code=ExitCodes.CHECK_FAILURE)

    # 2. Locked Environment Execution (T032: exactly one locked/offline attempt, no retry)
    elif mode == "locked_environment":
        uv_cmd = shutil.which("uv")
        if not uv_cmd:
            return ctx.fail(
                f"Playbook '{canonical_id}' requires isolated environment bundle via uv.\n"
                "uv executable not found on $PATH. Install uv from https://astral.sh/uv",
                code=ExitCodes.ENVIRONMENT_UNAVAILABLE,
            )

        env_name = deps.get("environment_dir") or "llm_guard"
        try:
            env_dir = resolve_isolated_env_dir(env_name, ctx.repo_root)
        except FileNotFoundError as fnf:
            return ctx.fail(str(fnf), code=ExitCodes.ENVIRONMENT_UNAVAILABLE)

        pyproject_file = env_dir / "pyproject.toml"
        lock_file = env_dir / "uv.lock"
        if not pyproject_file.is_file() or not lock_file.is_file():
            prep_cmd = f"uv sync --locked --project {env_dir}"
            return ctx.fail(
                f"Isolated environment '{env_name}' requires pyproject.toml and uv.lock.\n"
                f"Run '{prep_cmd}' to prepare.",
                code=ExitCodes.ENVIRONMENT_UNAVAILABLE,
            )

        expected_lock_hash = deps.get("lock_hash")
        if expected_lock_hash:
            act_hash = hashlib.sha256(lock_file.read_bytes()).hexdigest()
            if act_hash != expected_lock_hash:
                prep_cmd = f"uv sync --locked --project {env_dir}"
                return ctx.fail(
                    f"Lockfile hash mismatch for isolated environment '{env_name}'.\n"
                    f"Expected: {expected_lock_hash}, got: {act_hash}.\n"
                    f"Run '{prep_cmd}' to synchronize.",
                    code=ExitCodes.ENVIRONMENT_UNAVAILABLE,
                )

        ref = entry.get("implementation_ref", {})
        res_path = ref.get("resource_path")
        if not res_path:
            return ctx.fail(
                f"Catalog entry '{canonical_id}' lacks resource_path in implementation_ref.",
                code=ExitCodes.CHECK_FAILURE,
            )
        try:
            script_file = resolve_resource_path(res_path)
        except FileNotFoundError as fnf:
            return ctx.fail(str(fnf), code=ExitCodes.ENVIRONMENT_UNAVAILABLE)

        cmd = [
            uv_cmd,
            "run",
            "--locked",
            "--offline",
            "--project",
            str(env_dir),
            "python",
            str(script_file),
        ]
        returncode, stdout_bytes, stderr_bytes = _run_with_timeout(cmd, argv, child_env, timeout_s)

        # Single locked/offline attempt; NO online retry per Decision 4 & T032!
        if returncode != 0:
            prep_cmd = f"uv sync --locked --project {env_dir}"
            return ctx.fail(
                f"Locked environment execution failed for '{canonical_id}' with exit status {returncode}.\n"
                f"Preparation command: {prep_cmd}",
                code=ExitCodes.ENVIRONMENT_UNAVAILABLE,
            )

    # 3. Managed Subprocess Execution (Default)
    elif mode == "managed_subprocess":
        ref = entry.get("implementation_ref", {})
        res_path = ref.get("resource_path")
        if not res_path:
            return ctx.fail(
                f"Catalog entry '{canonical_id}' lacks resource_path in implementation_ref.",
                code=ExitCodes.CHECK_FAILURE,
            )
        try:
            script_file = resolve_resource_path(res_path)
        except FileNotFoundError as fnf:
            return ctx.fail(str(fnf), code=ExitCodes.ENVIRONMENT_UNAVAILABLE)

        cmd = [sys.executable, str(script_file)]
        returncode, stdout_bytes, stderr_bytes = _run_with_timeout(cmd, argv, child_env, timeout_s)

    # 4. External Tool Boundary (T033)
    elif mode == "external_tool":
        allowed_tools = deps.get("tools") or entry.get("side_effects", {}).get("allowed_tools") or []
        ref = entry.get("implementation_ref", {})
        tool_id = ref.get("tool_id") or canonical_id.split("/")[-1]

        if allowed_tools and tool_id not in allowed_tools:
            return ctx.fail(
                f"Tool '{tool_id}' is not in allowed_tools for '{canonical_id}'.",
                code=ExitCodes.MUTATION_REFUSED,
            )

        tool_path = shutil.which(tool_id)
        if not tool_path:
            return ctx.fail(
                f"Required external tool '{tool_id}' not found on PATH for '{canonical_id}'.",
                code=ExitCodes.ENVIRONMENT_UNAVAILABLE,
            )

        # Probe capability/version
        probe_proc = subprocess.run([tool_path, "--version"], capture_output=True, text=True)
        if probe_proc.returncode != 0:
            return ctx.fail(
                f"External tool '{tool_id}' capability probe failed for '{canonical_id}'.",
                code=ExitCodes.ENVIRONMENT_UNAVAILABLE,
            )

        cmd = [tool_path]
        returncode, stdout_bytes, stderr_bytes = _run_with_timeout(cmd, argv, child_env, timeout_s)

    else:
        return ctx.fail(
            f"Unsupported execution mode '{mode}' for catalog entry '{canonical_id}'.",
            code=ExitCodes.CHECK_FAILURE,
        )

    # Bound and sanitize stdout and stderr
    raw_stdout_str = _clean_str(stdout_bytes)
    raw_stderr_str = _clean_str(stderr_bytes)
    bounded_stdout = truncate_tail_to_byte_budget(raw_stdout_str, stdout_limit)
    bounded_stderr = truncate_tail_to_byte_budget(raw_stderr_str, stderr_limit)

    # Evidence receipt emission per T031
    controls = entry.get("controls", {})
    side_effects = entry.get("side_effects", {})
    ev_policy = controls.get("evidence", "none")
    ev_write = side_effects.get("evidence_write", "none")
    if ev_policy in ("execution_receipt", "artifact_receipt_required") or ev_write == "required":
        from arsenal.storage import LedgerActor
        from arsenal.scripts.playbook_catalog import catalog_sha256
        evidence_dir = Path.cwd() / "evidence"
        if ctx.repo_root:
            evidence_dir = ctx.repo_root / "evidence"

        redacted_argv = [
            arg if not any(s in arg.lower() for s in ("token", "bearer", "cookie", "key", "password", "secret")) else "[REDACTED]"
            for arg in argv
        ]
        receipt_data = {
            "canonical_id": canonical_id,
            "aliases": entry.get("aliases", []),
            "catalog_sha256": catalog_sha256(),
            "admission_record_id": entry.get("admission_record_id"),
            "source_sha256": entry.get("source_sha256"),
            "execution_mode": mode,
            "exit_code": returncode,
            "arguments": redacted_argv,
            "target_bindings": entry.get("side_effects", {}).get("target_binding", []),
            "gate_decisions": {"status": "allow", "boundary": mode},
            "stdout_sha256": hashlib.sha256(bounded_stdout.encode("utf-8")).hexdigest(),
            "stderr_sha256": hashlib.sha256(bounded_stderr.encode("utf-8")).hexdigest(),
            "capture_gaps": [],
            "timeout_ms": timeout_ms,
            "cleanup_state": "cleaned",
        }
        try:
            actor = LedgerActor(evidence_dir)
            actor.append_event(
                engagement_id=str(ctx.values.get("engagement_id") or "ENG-DEFAULT"),
                event_key=f"playbook:{canonical_id}:{int(time.time() * 1000)}",
                kind="execution_receipt",
                session_id=str(ctx.values.get("session_id") or "session-playbook-runtime"),
                actor=str(ctx.values.get("actor") or "arsenal-runner"),
                data=receipt_data,
            )
            actor.close()
        except Exception as exc:
            if ev_write == "required" or ev_policy == "artifact_receipt_required":
                return ctx.fail(f"Evidence commit failed for required sink: {exc}", code=ExitCodes.ENVIRONMENT_UNAVAILABLE)

    # Result handling per T014
    if ctx.is_json:
        if bounded_stderr:
            print(bounded_stderr, file=sys.stderr)

        if returncode == 0:
            try:
                data = json.loads(bounded_stdout)
            except Exception:
                data = {"stdout": bounded_stdout}
            return ctx.result(data, code=ExitCodes.SUCCESS)
        else:
            exit_code = ExitCodes.CLI_USAGE_ERROR if returncode == 2 else ExitCodes.CHECK_FAILURE
            return ctx.fail(
                bounded_stderr or f"Subprocess exited with status {returncode}",
                code=exit_code,
            )

    # Human / plain-text mode
    if bounded_stdout:
        print(bounded_stdout, end="")
    if bounded_stderr:
        print(bounded_stderr, end="", file=sys.stderr)

    return returncode if returncode != -1 else ExitCodes.CHECK_FAILURE
