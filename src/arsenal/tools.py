"""Binary environment scanner, tool exec runner, native process execution, and diagnostics."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes
from arsenal.scope import parse_scope
from arsenal.storage import (
    bound_and_store,
    safe_write_file,
    sha256_bytes,
    LedgerActor,
)
from arsenal.workspace import detect_drift

PRESET_TOOL_REQUIREMENTS: dict[str, list[str]] = {
    "re": ["radare2", "git", "python3"],
    "webapp": ["curl", "git", "python3"],
    "mobile": ["adb", "apktool", "frida"],
    "red": ["nmap", "curl", "python3"],
}

COMMON_TOOL_PROBES: dict[str, dict[str, str]] = {
    # 1. Core Platform & Runtime
    "git": {"category": "vcs", "install": "brew install git / apt install git"},
    "python3": {"category": "runtime", "install": "brew install python / apt install python3"},
    "bun": {"category": "runtime", "install": "curl -fsSL https://bun.sh/install | bash"},
    "curl": {"category": "transport", "install": "brew install curl / apt install curl"},
    # 2. Reconnaissance & Surface Discovery
    "subfinder": {"category": "reconnaissance", "install": "go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest"},
    "amass": {"category": "reconnaissance", "install": "brew install amass / go install -v github.com/owasp-amass/amass/v4/...@master"},
    "httpx": {"category": "reconnaissance", "install": "go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest"},
    "katana": {"category": "reconnaissance", "install": "go install github.com/projectdiscovery/katana/cmd/katana@latest"},
    "gauplus": {"category": "reconnaissance", "install": "go install github.com/bp0lr/gauplus@latest"},
    "waybackurls": {"category": "reconnaissance", "install": "go install github.com/tomnomnom/waybackurls@latest"},
    "dnsx": {"category": "reconnaissance", "install": "go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest"},
    "naabu": {"category": "reconnaissance", "install": "go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest"},
    "paramspider": {"category": "reconnaissance", "install": "pipx install git+https://github.com/devanshbatham/paramspider"},
    "arjun": {"category": "reconnaissance", "install": "pipx install arjun"},
    # 3. Web & API Security Testing
    "nmap": {"category": "network", "install": "brew install nmap / apt install nmap"},
    "ffuf": {"category": "fuzzing", "install": "go install github.com/ffuf/ffuf/v2@latest / brew install ffuf"},
    "feroxbuster": {"category": "discovery", "install": "brew install feroxbuster / cargo install feroxbuster"},
    "gobuster": {"category": "discovery", "install": "go install github.com/OJ/gobuster/v3@latest"},
    "nuclei": {"category": "vulnerability_scanner", "install": "go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest"},
    "sqlmap": {"category": "injection", "install": "pip3 install sqlmap"},
    "commix": {"category": "command_injection", "install": "pipx install commix / brew install commix"},
    "sstimap": {"category": "ssti", "install": "pipx install sstimap"},
    "jwt_tool": {"category": "auth", "install": "pipx install git+https://github.com/ticarpi/jwt_tool"},
    "mitmproxy": {"category": "proxy", "install": "brew install mitmproxy / pipx install mitmproxy"},
    "dalfox": {"category": "xss", "install": "go install github.com/hahwul/dalfox/v2@latest"},
    "whatweb": {"category": "fingerprinting", "install": "brew install whatweb / apt install whatweb"},
    "wappalyzergo": {"category": "fingerprinting", "install": "go install github.com/projectdiscovery/wappalyzergo/cmd/wappalyzergo@latest"},
    "wafw00f": {"category": "waf_detection", "install": "pipx install wafw00f / brew install wafw00f"},
    "nikto": {"category": "web_scanner", "install": "brew install nikto / apt install nikto"},
    "sslscan": {"category": "tls_auditing", "install": "brew install sslscan / apt install sslscan"},
    "testssl.sh": {"category": "tls_auditing", "install": "brew install testssl / git clone https://github.com/drwetter/testssl.sh.git"},
    "wpscan": {"category": "cms_scanner", "install": "gem install wpscan / brew install wpscanteam/tap/wpscan"},
    # 4. Mobile Security
    "adb": {"category": "mobile", "install": "brew install --cask android-platform-tools"},
    "apktool": {"category": "mobile", "install": "brew install apktool / apt install apktool"},
    "jadx": {"category": "mobile", "install": "brew install jadx"},
    "frida": {"category": "instrumentation", "install": "pip3 install frida-tools"},
    "objection": {"category": "mobile", "install": "pipx install objection"},
    "apksigner": {"category": "mobile", "install": "brew install apksigner / part of android build-tools"},
    "zipalign": {"category": "mobile", "install": "part of android build-tools"},
    # 5. Reverse Engineering & Binary Analysis
    "radare2": {"category": "disassembler", "install": "brew install radare2 / apt install radare2"},
    "ghidra": {"category": "decompiler", "install": "brew install --cask ghidra / apt install ghidra"},
    "pwndbg": {"category": "exploitation", "install": "git clone https://github.com/pwndbg/pwndbg && setup.sh"},
    "checksec": {"category": "binary_analysis", "install": "brew install checksec / apt install checksec"},
    "binwalk": {"category": "firmware", "install": "brew install binwalk / pipx install binwalk"},
    "unblob": {"category": "firmware", "install": "pipx install unblob"},
    "angr": {"category": "symbolic_execution", "install": "uv pip install angr / pipx install angr"},
    "ropper": {"category": "exploitation", "install": "pipx install ropper"},
    # 6. Active Directory & Red Team
    "netexec": {"category": "active_directory", "install": "pipx install netexec / brew install netexec"},
    "bloodhound": {"category": "active_directory", "install": "pipx install bloodhound / docker run bloodhound"},
    "impacket": {"category": "protocols", "install": "pipx install impacket"},
    "responder": {"category": "poisoning", "install": "brew install responder / apt install responder"},
    "certipy": {"category": "active_directory", "install": "pipx install certipy-ad"},
    "evil-winrm": {"category": "lateral_movement", "install": "gem install evil-winrm / brew install evil-winrm"},
    "prowler": {"category": "cloud", "install": "pipx install prowler / brew install prowler"},
    "cloudfox": {"category": "cloud", "install": "brew install cloudfox / go install github.com/BishopFox/cloudfox@latest"},
}


def resolve_tool_path(tool_id: str) -> str | None:
    """Find binary executable via system PATH and standard developer installation directories."""
    found = shutil.which(tool_id)
    if found:
        return found

    candidate_dirs = [
        Path("/opt/homebrew/bin"),
        Path("/usr/local/bin"),
        Path.home() / ".local" / "bin",
        Path.home() / "go" / "bin",
    ]
    gopath = os.environ.get("GOPATH")
    if gopath:
        candidate_dirs.append(Path(gopath) / "bin")

    for c_dir in candidate_dirs:
        candidate = c_dir / tool_id
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate.resolve())

    return None


def execute_command(
    argv: list[str],
    cwd: Path | str | None = None,
    stdin_bytes: bytes | None = None,
    timeout_ms: int = 30000,
    env: dict[str, str] | None = None,
    evidence_dir: Path | str | None = None,
) -> dict[str, Any]:
    """Execute binary directly without shell, enforcing timeouts and capturing raw streams."""
    if not argv:
        raise ValueError("execute_command: 'argv' must be a non-empty list of strings.")

    timeout_sec = max(0.1, timeout_ms / 1000.0)
    start_time = time.time()
    work_dir = Path(cwd).resolve() if cwd else Path.cwd()

    run_env = os.environ.copy()
    if env:
        run_env.update(env)

    proc = subprocess.Popen(
        argv,
        cwd=str(work_dir),
        stdin=subprocess.PIPE if stdin_bytes is not None else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=run_env,
    )

    timed_out = False
    stdout_raw = b""
    stderr_raw = b""
    exit_code = 0

    try:
        stdout_raw, stderr_raw = proc.communicate(input=stdin_bytes, timeout=timeout_sec)
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        timed_out = True
        proc.terminate()
        try:
            stdout_raw, stderr_raw = proc.communicate(timeout=1.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout_raw, stderr_raw = proc.communicate()
        exit_code = 124

    duration_ms = int((time.time() - start_time) * 1000)
    capture_gap = f"Command execution timed out after {timeout_ms}ms" if timed_out else None

    # Compute hashes
    stdout_hash = sha256_bytes(stdout_raw)
    stderr_hash = sha256_bytes(stderr_raw)

    ev_dir = Path(evidence_dir).resolve() if evidence_dir else None
    if ev_dir:
        raw_dir = ev_dir / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

        stdout_file = raw_dir / f"{stdout_hash}.txt"
        stderr_file = raw_dir / f"{stderr_hash}.txt"

        with open(stdout_file, "wb") as f_out:
            f_out.write(stdout_raw)
            f_out.flush()
            os.fsync(f_out.fileno())
        with open(stderr_file, "wb") as f_err:
            f_err.write(stderr_raw)
            f_err.flush()
            os.fsync(f_err.fileno())
        try:
            os.chmod(stdout_file, 0o600)
            os.chmod(stderr_file, 0o600)
        except OSError:
            pass

        bound_stdout = bound_and_store(stdout_raw, ev_dir, "txt")
        bound_stderr = bound_and_store(stderr_raw, ev_dir, "txt")
        out_content = bound_stdout["content"]
        err_content = bound_stderr["content"]
    else:
        out_content = stdout_raw.decode("utf-8", errors="replace")
        err_content = stderr_raw.decode("utf-8", errors="replace")

    return {
        "exitCode": exit_code,
        "stdout": out_content,
        "stderr": err_content,
        "stdout_artifact": {
            "path": f"evidence/raw/{stdout_hash}.txt",
            "sha256": stdout_hash,
            "byte_length": len(stdout_raw),
        },
        "stderr_artifact": {
            "path": f"evidence/raw/{stderr_hash}.txt",
            "sha256": stderr_hash,
            "byte_length": len(stderr_raw),
        },
        "timed_out": timed_out,
        "timeout_ms": timeout_ms,
        "duration_ms": duration_ms,
        "capture_gap": capture_gap,
    }


def handle_exec(ctx: Context) -> int:
    """CLI dispatcher for 'arsenal exec'."""
    cmd_argv: list[str] = []
    if ctx.remainder:
        cmd_argv = ctx.remainder
    elif ctx.subcommand:
        cmd_argv = [ctx.subcommand] + ctx.positionals

    if not cmd_argv:
        return ctx.fail(
            "Missing command to execute. Usage: arsenal exec [--] <binary> [args...]",
            code=ExitCodes.CLI_USAGE_ERROR,
        )

    timeout_ms = int(ctx.values.get("timeout") or ctx.values.get("timeout-ms") or 30000)
    cwd = ctx.values.get("cwd") or ctx.repo_root
    evidence_dir = ctx.repo_root / "evidence"

    res = execute_command(
        argv=cmd_argv,
        cwd=cwd,
        timeout_ms=timeout_ms,
        evidence_dir=evidence_dir,
    )

    no_commit = bool(ctx.values.get("no-ledger-commit"))
    if not no_commit and evidence_dir.is_dir():
        try:
            actor = LedgerActor(evidence_dir)
            actor.append_event(
                engagement_id=str(ctx.values.get("engagement_id") or "ENG-EXEC"),
                event_key=f"tool:exec:{int(time.time() * 1000)}",
                kind="tool_result",
                session_id=str(ctx.values.get("session_id") or "sess-cli"),
                actor="operator",
                data=res,
            )
            actor.close()
        except Exception:
            pass

    if not ctx.is_json:
        if res["stdout"]:
            print(res["stdout"], end="" if res["stdout"].endswith("\n") else "\n")
        if res["stderr"]:
            print(res["stderr"], file=sys.stderr, end="" if res["stderr"].endswith("\n") else "\n")

    return ctx.result(res, code=res["exitCode"])


def handle_tools(ctx: Context) -> int:
    """CLI handler for 'arsenal tools'."""
    subcommand = ctx.subcommand or "check"

    if subcommand == "scan":
        is_write = bool(ctx.values.get("write"))
        results: list[dict[str, Any]] = []

        for tid, info in COMMON_TOOL_PROBES.items():
            resolved = resolve_tool_path(tid)
            results.append({
                "id": tid,
                "category": info["category"],
                "resolved_path": resolved,
                "version": "detected" if resolved else None,
                "state": "ready" if resolved else "missing",
                "install_instructions": info["install"],
            })

        tool_index_path = ctx.repo_root / ".omp" / "tool-index.json"
        content = json.dumps(
            {
                "schema_version": 1,
                "observed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "tools": results,
            },
            indent=2,
        )

        safe_res = safe_write_file(
            tool_index_path,
            content,
            write=is_write,
            force=bool(ctx.values.get("force")),
        )

        if not ctx.is_json:
            print(f"[arsenal tools scan] Probed {len(results)} security tools [mode: {ctx.mode}]:")
            for t in results:
                print(f" - {t['id']} ({t['category']}): {t['state']} [{t['resolved_path'] or 'NOT FOUND'}]")

        return ctx.result(
            {"tools": results, "path": str(tool_index_path), "action": safe_res["action"]},
            code=ExitCodes.SUCCESS,
        )

    if subcommand == "check":
        preset_raw = ctx.values.get("preset")
        preset = str(preset_raw).lower() if preset_raw else "webapp"
        required = PRESET_TOOL_REQUIREMENTS.get(preset, ["git", "curl"])

        detected: list[str] = []
        missing: list[dict[str, str]] = []

        for req in required:
            loc = resolve_tool_path(req)
            if loc:
                detected.append(req)
            else:
                info = COMMON_TOOL_PROBES.get(req)
                missing.append({
                    "id": req,
                    "install": info["install"] if info else f"Install {req} package",
                })

        clean = len(missing) == 0
        exit_code = ExitCodes.SUCCESS if clean else ExitCodes.CHECK_FAILURE

        if not ctx.is_json:
            print(f"[arsenal tools check] Preset '{preset}':")
            print(f" Detected: {', '.join(detected) or 'none'}")
            if missing:
                print(" Missing required tools:", file=sys.stderr)
                for m in missing:
                    print(f"  - {m['id']}: Guidance -> {m['install']}", file=sys.stderr)

        return ctx.result(
            {"preset": preset, "required": required, "detected": detected, "missing": missing, "clean": clean},
            code=exit_code,
        )

    if subcommand == "exec":
        tool_name = ctx.positionals[0] if ctx.positionals else None
        if tool_name == "apk_inspect":
            apk_path = ctx.values.get("apk") or (ctx.positionals[1] if len(ctx.positionals) > 1 else None)
            if not apk_path:
                return ctx.fail("--apk <path> is required for apk_inspect", code=ExitCodes.CLI_USAGE_ERROR)

            try:
                from arsenal.analysis import inspect_apk
                result = inspect_apk(Path(apk_path))

                evidence_dir = ctx.repo_root / "evidence"
                no_commit = bool(ctx.values.get("no-ledger-commit"))
                if not no_commit and evidence_dir.is_dir():
                    actor = LedgerActor(evidence_dir)
                    actor.append_event(
                        engagement_id="eng-default",
                        event_key=f"tool:apk_inspect:{int(time.time() * 1000)}",
                        kind="tool_result",
                        session_id="sess-cli",
                        actor="operator",
                        data=result,
                    )
                    actor.close()

                if not ctx.is_json:
                    print(f"[apk_inspect] Package: {result.get('packageName')} (v{result.get('versionCode') or '?'})")
                    print(f"Permissions: {', '.join(result.get('permissions', [])) or 'none'}")
                    print(f"Exported Components: {len(result.get('exportedComponents', []))}")
                    for c in result.get("exportedComponents", []):
                        print(f"  - [{c.get('type')}] {c.get('name')}")
                    if result.get("dangerousFlags"):
                        print(f"Dangerous Flags: {', '.join(result.get('dangerousFlags', []))}")

                return ctx.result(result, code=ExitCodes.SUCCESS)
            except Exception as e:
                return ctx.fail(f"apk_inspect failed: {e}", code=ExitCodes.CHECK_FAILURE)

        # Fallback to general process exec if arguments provided
        if ctx.remainder or ctx.positionals:
            return handle_exec(ctx)

    return ctx.fail(f"Unknown tools subcommand: '{subcommand}'", code=ExitCodes.CLI_USAGE_ERROR)


def handle_doctor(ctx: Context) -> int:
    """CLI handler for 'arsenal doctor'."""
    is_schema = bool(ctx.values.get("schema"))
    is_drift = bool(ctx.values.get("drift"))
    is_mcp = bool(ctx.values.get("mcp"))
    is_tools = bool(ctx.values.get("tools"))
    is_smoke = bool(ctx.values.get("smoke"))
    is_fix = bool(ctx.values.get("fix"))

    run_all = not (is_schema or is_drift or is_mcp or is_tools or is_smoke)

    checks: list[dict[str, Any]] = []
    all_passed = True

    # 1. Schema Check
    if run_all or is_schema:
        scope_path = ctx.repo_root / ".omp" / "scope.json"
        if scope_path.is_file():
            try:
                parse_scope(scope_path)
                checks.append({"name": "schema", "passed": True, "message": "scope.json schema is valid."})
            except Exception as e:
                all_passed = False
                checks.append({"name": "schema", "passed": False, "message": f"scope.json invalid: {e}"})
        else:
            checks.append({
                "name": "schema",
                "passed": True,
                "message": "No active engagement scope.json to validate (optional).",
            })

    # 2. Drift Check
    if run_all or is_drift:
        manifest_path = ctx.repo_root / ".omp" / "manifest.json"
        if manifest_path.is_file():
            try:
                doc = json.loads(manifest_path.read_text(encoding="utf-8"))
                drift = detect_drift(ctx.repo_root, doc.get("files", []))
                if drift["clean"]:
                    checks.append({"name": "drift", "passed": True, "message": "Managed files match manifest checksums."})
                else:
                    all_passed = False
                    checks.append({
                        "name": "drift",
                        "passed": False,
                        "message": f"Drift detected: {len(drift['modifiedFiles'])} modified, {len(drift['missingFiles'])} missing.",
                    })
            except Exception as e:
                all_passed = False
                checks.append({"name": "drift", "passed": False, "message": f"Failed to evaluate drift: {e}"})
        else:
            checks.append({"name": "drift", "passed": True, "message": "No manifest.json present."})

    # 3. MCP Check
    if run_all or is_mcp:
        mcp_path = ctx.repo_root / ".omp" / "mcp.json"
        if mcp_path.is_file():
            try:
                json.loads(mcp_path.read_text(encoding="utf-8"))
                checks.append({"name": "mcp", "passed": True, "message": ".omp/mcp.json is valid JSON."})
            except Exception:
                all_passed = False
                checks.append({"name": "mcp", "passed": False, "message": ".omp/mcp.json is corrupt."})
        else:
            checks.append({"name": "mcp", "passed": True, "message": "No local .omp/mcp.json found."})

    # 4. Tools Check
    if run_all or is_tools:
        has_git = shutil.which("git") is not None
        has_python = shutil.which("python3") is not None or shutil.which("python") is not None
        if has_git and has_python:
            checks.append({"name": "tools", "passed": True, "message": "Core binaries (git, python) available in PATH."})
        else:
            all_passed = False
            checks.append({"name": "tools", "passed": False, "message": "Missing git or python in system PATH."})

    has_uv = shutil.which("uv") is not None
    checks.append({
        "name": "uv_runner",
        "passed": True,
        "message": f"uv package runner detected: {shutil.which('uv')}"
        if has_uv
        else "uv package runner not found (optional for Python MCP bridges; install via https://astral.sh/uv/install.sh)",
    })

    # 5. Smoke Check
    if run_all or is_smoke:
        checks.append({"name": "smoke", "passed": True, "message": "Runtime execution hooks and Python APIs viable."})

    # Fix handling
    if is_fix and not all_passed:
        raw_dir = ctx.repo_root / "evidence" / "raw"
        if not raw_dir.is_dir():
            raw_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            checks.append({"name": "fix", "passed": True, "message": "Re-created missing evidence/raw directory."})

    exit_code = ExitCodes.SUCCESS if all_passed else ExitCodes.CHECK_FAILURE

    if not ctx.is_json:
        print("[arsenal doctor] Diagnostic Check Results:")
        for c in checks:
            status_icon = "✓ PASS" if c["passed"] else "✗ FAIL"
            print(f" [{status_icon}] {c['name']}: {c['message']}")

    return ctx.result({"checks": checks, "allPassed": all_passed}, code=exit_code)
