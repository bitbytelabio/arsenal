"""Radare2 rapid reconnaissance - Port of recon.sh.

Runs rabin2 and r2 commands to extract binary information, sections,
imports, exports, strings, and function analysis.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes


def run_recon(
    target_path: str | Path,
    strings_limit: int = 40,
    imports_limit: int = 80,
    run_analysis: bool = False,
) -> dict[str, Any]:
    """Execute rabin2/r2 reconnaissance on binary target."""
    target = Path(target_path).resolve()
    if not target.is_file():
        raise FileNotFoundError(f"Target binary not found: {target}")

    rabin2 = shutil.which("rabin2")
    if not rabin2:
        raise RuntimeError("rabin2 binary not found. Install radare2.")

    def run_cmd(args: list[str]) -> str:
        proc = subprocess.run(args, capture_output=True, text=True)
        return proc.stdout

    # Info
    info_out = run_cmd([rabin2, "-I", "--", str(target)])

    # Sections
    sections_out = run_cmd([rabin2, "-S", "--", str(target)])

    # Imports
    imports_full = run_cmd([rabin2, "-i", "--", str(target)])
    imports_lines = imports_full.splitlines()[:imports_limit]
    imports_out = "\n".join(imports_lines)

    # Exports
    exports_out = run_cmd([rabin2, "-E", "--", str(target)])

    # Strings
    strings_full = run_cmd([rabin2, "-zz", "--", str(target)])
    strings_lines = strings_full.splitlines()[:strings_limit]
    strings_out = "\n".join(strings_lines)

    analysis_out = ""
    if run_analysis:
        r2 = shutil.which("r2")
        if r2:
            proc = subprocess.run(
                [r2, "-A", "-q", "-c", "s entry0;afl;iz;ii;q", "--", str(target)],
                capture_output=True,
                text=True,
            )
            analysis_out = proc.stdout

    return {
        "target": str(target),
        "info": info_out,
        "sections": sections_out,
        "imports": imports_out,
        "exports": exports_out,
        "strings": strings_out,
        "analysis": analysis_out if run_analysis else None,
    }


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal scripts re-radare2/recon'."""
    parser = argparse.ArgumentParser(
        prog="arsenal scripts re-radare2/recon",
        description="Radare2 binary reconnaissance",
    )
    parser.add_argument("target", help="Target binary file")
    parser.add_argument("--strings-limit", type=int, default=40, help="Maximum strings to return")
    parser.add_argument("--imports-limit", type=int, default=80, help="Maximum imports to return")
    parser.add_argument("--analyze", action="store_true", help="Run function and entrypoint analysis")

    argv = list(ctx.positionals)
    if ctx.remainder:
        argv.extend(ctx.remainder)

    try:
        args, _ = parser.parse_known_args(argv)
        res = run_recon(
            target_path=args.target,
            strings_limit=args.strings_limit,
            imports_limit=args.imports_limit,
            run_analysis=args.analyze,
        )

        if not ctx.is_json:
            print(f"=== Target: {res['target']} ===")
            print("\n=== Basic Information ===")
            print(res["info"].strip())
            print("\n=== Sections ===")
            print(res["sections"].strip())
            print("\n=== Imports ===")
            print(res["imports"].strip())
            print("\n=== Exports ===")
            print(res["exports"].strip())
            print("\n=== Strings ===")
            print(res["strings"].strip())
            if res.get("analysis"):
                print("\n=== Functions & Analysis ===")
                print(res["analysis"].strip())

        return ctx.result(res, code=ExitCodes.SUCCESS)
    except Exception as exc:
        return ctx.fail(str(exc), code=ExitCodes.CLI_USAGE_ERROR)
