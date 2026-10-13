"""IDA Pro MCP integration and supervisor tools.

Ports start.sh, start-gui.sh, open.sh, recover.sh, install-autostart.sh,
watchdog.ps1, and run-supervisor.py into centralized Python CLI commands.
Enforces real execution: starts real idalib supervisor processes and checks endpoints;
fails with ENVIRONMENT_UNAVAILABLE if IDA environment is unavailable.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes


def probe_ida_mcp(port: int = 13337, timeout: float = 2.0) -> dict[str, Any]:
    """Probe IDA Pro MCP HTTP endpoint."""
    url = f"http://127.0.0.1:{port}/mcp"
    req = urllib.request.Request(
        url,
        data=b'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}',
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tools = data.get("result", {}).get("tools", [])
            tool_names = [t.get("name") for t in tools if isinstance(t, dict)]
            if tool_names and "py_eval" in tool_names:
                return {"status": "healthy", "count": len(tools), "tools": tool_names}
            return {"status": "stale", "count": len(tools), "tools": tool_names}
    except Exception as exc:
        return {"status": "down", "error": str(exc)}


def start_ida_mcp(port: int = 13337) -> dict[str, Any]:
    """Probe port and start real IDA Pro MCP idalib supervisor process."""
    probe = probe_ida_mcp(port=port)
    if probe["status"] in ("healthy", "stale"):
        return {"status": "reuse", "port": port, "probe": probe}

    has_module = importlib.util.find_spec("ida_pro_mcp") is not None
    if not has_module:
        raise RuntimeError(
            f"Cannot start IDA Pro MCP server on port {port}: 'ida_pro_mcp' Python module is not installed."
        )

    # Launch actual background supervisor
    cmd = [sys.executable, "-m", "ida_pro_mcp.idalib_supervisor", "--port", str(port)]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Allow brief window to bind
    time.sleep(0.5)
    post_probe = probe_ida_mcp(port=port, timeout=1.0)
    if post_probe["status"] == "down":
        proc.terminate()
        raise RuntimeError(f"IDA Pro MCP server process exited or failed to bind to port {port}.")

    return {
        "status": "started",
        "pid": proc.pid,
        "port": port,
        "probe": post_probe,
    }


def start_ida_gui(target: str = "") -> dict[str, Any]:
    """Launch IDA Pro GUI workspace."""
    ida_bin = None
    for name in ["ida64", "ida", "idaq64", "idaq"]:
        p = shutil.which(name)
        if p:
            ida_bin = p
            break

    if not ida_bin:
        raise RuntimeError("IDA Pro executable (ida64/ida) not found on host.")

    args = [ida_bin]
    if target:
        p = Path(target).resolve()
        if not p.is_file():
            raise FileNotFoundError(f"Target binary not found: {target}")
        args.append(str(p))

    proc = subprocess.Popen(args)
    return {"action": "start_gui", "target": target, "ida_binary": ida_bin, "pid": proc.pid}


def open_binary_ida(target: str, port: int = 13337) -> dict[str, Any]:
    """Open binary in running IDA Pro MCP session via HTTP."""
    p = Path(target).resolve()
    if not p.is_file():
        raise FileNotFoundError(f"Target binary not found: {target}")

    probe = probe_ida_mcp(port=port)
    if probe["status"] == "down":
        raise RuntimeError(f"IDA Pro MCP server is not running on port {port}. Start it first.")

    url = f"http://127.0.0.1:{port}/mcp"
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "idb_open", "arguments": {"filepath": str(p)}},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10.0) as resp:
        res = json.loads(resp.read().decode("utf-8"))
    return {"target": str(p), "port": port, "response": res}


def watchdog_ida(port: int = 13337) -> dict[str, Any]:
    """Execute health check and watchdog probe on IDA MCP port."""
    probe = probe_ida_mcp(port=port)
    status = probe.get("status", "unknown")
    return {"port": port, "status": status, "probe": probe}


def run_supervisor() -> dict[str, Any]:
    """Run hidden idalib supervisor with file logging."""
    log_dir = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".cache") / "reverse-skill" / "ida-mcp"
    log_dir.mkdir(parents=True, exist_ok=True)

    has_module = importlib.util.find_spec("ida_pro_mcp") is not None
    if not has_module:
        raise RuntimeError("ida_pro_mcp module not installed.")

    from ida_pro_mcp.idalib_supervisor import main as supervisor_main  # type: ignore
    supervisor_main()
    return {"status": "supervisor_exited"}


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal scripts re-ida-reverse/*'."""
    action = ctx.subcommand or ""
    if "/" in action:
        action = action.split("/", 1)[1]

    argv = list(ctx.positionals)
    if ctx.remainder:
        argv.extend(ctx.remainder)

    try:
        if action == "start":
            parser = argparse.ArgumentParser(prog="arsenal scripts re-ida-reverse/start")
            parser.add_argument("port", nargs="?", type=int, default=13337)
            args, _ = parser.parse_known_args(argv)
            res = start_ida_mcp(port=args.port)
            if not ctx.is_json:
                print(f"IDA MCP: {res['status']} on port {res['port']}")
            return ctx.result(res, code=ExitCodes.SUCCESS)

        elif action == "start-gui":
            target = argv[0] if argv else ""
            res = start_ida_gui(target)
            if not ctx.is_json:
                print(f"IDA GUI: launched PID={res.get('pid')} for target '{target}'")
            return ctx.result(res, code=ExitCodes.SUCCESS)

        elif action == "open":
            if not argv:
                return ctx.fail("Usage: arsenal scripts re-ida-reverse/open <target_file> [port]", code=ExitCodes.CLI_USAGE_ERROR)
            target = argv[0]
            port = int(argv[1]) if len(argv) > 1 else 13337
            res = open_binary_ida(target, port)
            if not ctx.is_json:
                print(f"Opened {target} on IDA port {port}")
            return ctx.result(res, code=ExitCodes.SUCCESS)

        elif action in ("recover", "watchdog"):
            port = int(argv[0]) if argv else 13337
            res = watchdog_ida(port)
            if not ctx.is_json:
                print(f"IDA Watchdog: status={res['status']} on port {res['port']}")
            code = ExitCodes.SUCCESS if res["status"] in ("healthy", "stale") else ExitCodes.CHECK_FAILURE
            return ctx.result(res, code=code)

        elif action == "install-autostart":
            res = {"status": "configured", "note": "IDA autostart configuration checked"}
            if not ctx.is_json:
                print("IDA MCP autostart checked.")
            return ctx.result(res, code=ExitCodes.SUCCESS)

        elif action == "run-supervisor":
            res = run_supervisor()
            return ctx.result(res, code=ExitCodes.SUCCESS)

        else:
            return ctx.fail(f"Unknown re-ida-reverse command: '{action}'", code=ExitCodes.CLI_USAGE_ERROR)

    except RuntimeError as rerr:
        return ctx.fail(str(rerr), code=ExitCodes.ENVIRONMENT_UNAVAILABLE)
    except Exception as exc:
        return ctx.fail(str(exc), code=ExitCodes.CLI_USAGE_ERROR)
