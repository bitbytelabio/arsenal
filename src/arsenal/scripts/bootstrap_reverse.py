"""Reverse engineering environment bootstrapper - Port of bootstrap-reverse.sh / .ps1.

Inspects, verifies, and installs reverse-engineering tools and MCP services.
Safety & authorization discipline:
- Without explicit '--write' authorization (check/preview mode): checks tool availability
  and reports missing prerequisites with MUTATION_REFUSED / CHECK_FAILURE.
- With explicit '--write' authorization: executes real platform package manager commands
  (brew, apt, pip) and MCP host registrations, then re-verifies installation.
- Services (--start-services): launches real background services when --write is authorized.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes

KNOWN_CAPABILITIES: dict[str, dict[str, Any]] = {
    "jadx": {
        "commands": ["jadx", "jadx-gui"],
        "description": "DEX to Java decompiler",
        "brew_pkg": "jadx",
        "apt_pkg": "jadx",
        "pip_pkg": None,
    },
    "apktool": {
        "commands": ["apktool"],
        "description": "Android APK resource and smali decompiler",
        "brew_pkg": "apktool",
        "apt_pkg": "apktool",
        "pip_pkg": None,
    },
    "r2": {
        "commands": ["r2", "radare2", "rabin2"],
        "description": "Radare2 reverse engineering framework",
        "brew_pkg": "radare2",
        "apt_pkg": "radare2",
        "pip_pkg": None,
    },
    "frida": {
        "commands": ["frida", "frida-ps", "frida-ls-devices"],
        "description": "Dynamic instrumentation toolkit",
        "brew_pkg": None,
        "apt_pkg": None,
        "pip_pkg": "frida-tools",
    },
    "ghidra": {
        "commands": ["ghidra", "ghidraRun"],
        "description": "Software reverse engineering suite",
        "brew_cask": "ghidra",
        "apt_pkg": "ghidra",
        "pip_pkg": None,
    },
    "ida": {
        "commands": ["ida", "ida64", "idaq", "idaq64"],
        "description": "Hex-Rays IDA Pro disassembler",
        "commercial": True,
    },
    "gdb": {
        "commands": ["gdb"],
        "description": "GNU Debugger",
        "brew_pkg": "gdb",
        "apt_pkg": "gdb",
        "pip_pkg": None,
    },
    "checksec": {
        "commands": ["checksec"],
        "description": "ELF / PE security mitigation checker",
        "brew_pkg": "checksec",
        "apt_pkg": "checksec",
        "pip_pkg": None,
    },
    "volatility3": {
        "commands": ["vol", "volatility", "volatility3"],
        "description": "Memory forensics framework",
        "pip_pkg": "volatility3",
    },
    "tshark": {
        "commands": ["tshark", "wireshark"],
        "description": "Network protocol analyzer CLI",
        "brew_pkg": "wireshark",
        "apt_pkg": "tshark",
        "pip_pkg": None,
    },
    "binwalk": {
        "commands": ["binwalk"],
        "description": "Firmware analysis and extraction tool",
        "brew_pkg": "binwalk",
        "apt_pkg": "binwalk",
        "pip_pkg": None,
    },
    "androguard": {
        "commands": ["androguard"],
        "python_module": "androguard",
        "description": "Python Android APK reverse engineering library",
        "pip_pkg": "androguard",
    },
}


def check_capability(name: str) -> dict[str, Any]:
    """Inspect availability of a named capability."""
    meta = KNOWN_CAPABILITIES.get(name)
    if not meta:
        cmd_path = shutil.which(name)
        return {
            "name": name,
            "available": bool(cmd_path),
            "path": cmd_path or "",
            "description": "Custom binary",
            "commercial": False,
        }

    found_path = None
    for cmd in meta.get("commands", []):
        p = shutil.which(cmd)
        if p:
            found_path = p
            break

    py_mod = meta.get("python_module")
    py_available = False
    if py_mod and not found_path:
        try:
            __import__(py_mod)
            py_available = True
        except ImportError:
            pass

    available = bool(found_path) or py_available

    return {
        "name": name,
        "available": available,
        "path": found_path or ("python-module" if py_available else ""),
        "description": meta.get("description", ""),
        "commercial": meta.get("commercial", False),
    }


def list_capabilities() -> list[dict[str, Any]]:
    """List status of all known capabilities."""
    return [check_capability(name) for name in sorted(KNOWN_CAPABILITIES.keys())]


    pip_pkg = meta.get("pip_pkg")
    if pip_pkg:
        uv = shutil.which("uv")
        if uv:
            # Prefer uv tool install for standalone CLI capabilities
            if meta.get("commands"):
                try:
                    subprocess.run([uv, "tool", "install", pip_pkg], check=True)
                    return {"capability": name, "installed_via": "uv_tool", "package": pip_pkg}
                except subprocess.CalledProcessError:
                    pass
            subprocess.run([uv, "pip", "install", pip_pkg], check=True)
            return {"capability": name, "installed_via": "uv_pip", "package": pip_pkg}

        cmd = [sys.executable, "-m", "pip", "install", "--user", pip_pkg]
        subprocess.run(cmd, check=True)
        return {"capability": name, "installed_via": "pip_user", "package": pip_pkg}

    is_macos = sys.platform == "darwin"
    is_linux = sys.platform.startswith("linux")

    if is_macos:
        brew = shutil.which("brew")
        if not brew:
            raise RuntimeError("Homebrew ('brew') is required to install packages on macOS.")

        cask_pkg = meta.get("brew_cask")
        if cask_pkg:
            subprocess.run([brew, "install", "--cask", cask_pkg], check=True)
            return {"capability": name, "installed_via": "brew_cask", "package": cask_pkg}

        brew_pkg = meta.get("brew_pkg")
        if brew_pkg:
            subprocess.run([brew, "install", brew_pkg], check=True)
            return {"capability": name, "installed_via": "brew", "package": brew_pkg}

    elif is_linux:
        apt = shutil.which("apt-get") or shutil.which("apt")
        if not apt:
            raise RuntimeError("APT ('apt-get') is required to install packages on Linux.")

        apt_pkg = meta.get("apt_pkg")
        if apt_pkg:
            subprocess.run([apt, "install", "-y", apt_pkg], check=True)
            return {"capability": name, "installed_via": "apt", "package": apt_pkg}

    raise RuntimeError(f"No package manager rule defined to install capability '{name}' on {sys.platform}.")


def start_capability_services(capabilities: list[str]) -> list[dict[str, Any]]:
    """Start background services for requested capabilities."""
    results = []
    for cap in capabilities:
        if cap in ("ida", "ida_mcp"):
            from arsenal.scripts.ida_tools import start_ida_mcp
            res = start_ida_mcp(13337)
            results.append({"capability": cap, "service": "ida_mcp", "result": res})
        else:
            results.append({"capability": cap, "service": "none_needed", "status": "active"})
    return results


def register_mcp_hosts(host_target: str, tools_dir: Path | None = None) -> dict[str, Any]:
    """Register reverse-engineering MCP servers into user host configurations."""
    registered = []
    if host_target in ("claude", "both"):
        claude_cfg = Path.home() / ".claude" / "mcp.json"
        claude_cfg.parent.mkdir(parents=True, exist_ok=True)
        current = {}
        if claude_cfg.is_file():
            try:
                current = json.loads(claude_cfg.read_text(encoding="utf-8"))
            except Exception:
                current = {}
        mcp_servers = current.get("mcpServers", {})
        mcp_servers["ida_pro"] = {"command": sys.executable, "args": ["-m", "ida_pro_mcp"]}
        current["mcpServers"] = mcp_servers
        claude_cfg.write_text(json.dumps(current, indent=2), encoding="utf-8")
        registered.append("claude")

    return {"registered_hosts": registered, "target": host_target}


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal scripts bootstrap-reverse'."""
    parser = argparse.ArgumentParser(
        prog="arsenal scripts bootstrap-reverse",
        description="Verify and install reverse engineering capabilities",
    )
    parser.add_argument("capabilities", nargs="*", help="Capability names to inspect or install")
    parser.add_argument("--list", "-l", action="store_true", help="List all known capabilities")
    parser.add_argument("--start-services", action="store_true", help="Start background MCP services")
    parser.add_argument("--skip-refresh", action="store_true", help="Skip tool index refresh")
    parser.add_argument(
        "--mcp-host",
        choices=["none", "claude", "codex", "both"],
        default="none",
        help="Target MCP host configuration",
    )
    parser.add_argument("--write", action="store_true", help="Explicit authorization to execute package installations")

    argv = list(ctx.positionals)
    if ctx.remainder:
        argv.extend(ctx.remainder)

    try:
        args, _ = parser.parse_known_args(argv)

        # 1. Listing mode
        if args.list or not args.capabilities:
            caps = list_capabilities()
            if not ctx.is_json:
                print("REVERSE ENGINEERING CAPABILITIES:")
                for c in caps:
                    status = "[AVAILABLE]" if c["available"] else "[MISSING]  "
                    print(f"  {status} {c['name']:<14} - {c['description']}")
            return ctx.result({"capabilities": caps}, code=ExitCodes.SUCCESS)

        # 2. Inspect requested capabilities
        inspections = [check_capability(name) for name in args.capabilities]
        missing = [c for c in inspections if not c["available"]]

        is_write_authorized = args.write or (ctx.mode == "write")

        # 3. Guard against un-authorized mutation
        if missing and not is_write_authorized:
            missing_names = [m["name"] for m in missing]
            err_msg = (
                f"Missing required capabilities: {', '.join(missing_names)}. "
                f"System package installation refused because explicit '--write' flag was omitted."
            )
            return ctx.fail(err_msg, code=ExitCodes.MUTATION_REFUSED)

        # 4. Perform actual installation when authorized
        installed_ops = []
        if missing and is_write_authorized:
            for m in missing:
                op = install_capability(m["name"])
                installed_ops.append(op)

            # Re-check after installation
            post_checks = [check_capability(name) for name in args.capabilities]
            still_missing = [c["name"] for c in post_checks if not c["available"]]
            if still_missing:
                return ctx.fail(
                    f"Installation attempted but capabilities remain missing: {', '.join(still_missing)}",
                    code=ExitCodes.ENVIRONMENT_UNAVAILABLE,
                )

        # 5. Service starts
        service_ops = []
        if args.start_services:
            if not is_write_authorized:
                return ctx.fail(
                    "Service start requested but explicit '--write' flag was omitted.",
                    code=ExitCodes.MUTATION_REFUSED,
                )
            service_ops = start_capability_services(args.capabilities)

        # 6. MCP registration
        mcp_ops = {}
        if args.mcp_host != "none":
            if not is_write_authorized:
                return ctx.fail(
                    f"MCP registration for '{args.mcp_host}' requested but explicit '--write' was omitted.",
                    code=ExitCodes.MUTATION_REFUSED,
                )
            mcp_ops = register_mcp_hosts(args.mcp_host)

        res_data = {
            "capabilities": args.capabilities,
            "installed": installed_ops,
            "services": service_ops,
            "mcp": mcp_ops,
        }

        if not ctx.is_json:
            print("CAPABILITY BOOTSTRAP COMPLETE:")
            for name in args.capabilities:
                print(f"  [OK] {name}")
            if service_ops:
                print("  Services started.")

        return ctx.result(res_data, code=ExitCodes.SUCCESS)

    except RuntimeError as rerr:
        return ctx.fail(str(rerr), code=ExitCodes.ENVIRONMENT_UNAVAILABLE)
    except Exception as exc:
        return ctx.fail(str(exc), code=ExitCodes.CLI_USAGE_ERROR)
