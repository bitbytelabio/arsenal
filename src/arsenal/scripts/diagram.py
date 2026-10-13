"""Diagram renderer - Port of render_diagram.py.

Renders Mermaid, Graphviz DOT, PlantUML, or SVG diagram source to an output image.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes

MERMAID_EXTS = {".mmd", ".mermaid"}
GRAPHVIZ_EXTS = {".dot", ".gv"}
PLANTUML_EXTS = {".puml", ".plantuml"}
SVG_EXTS = {".svg"}


def infer_diagram_kind(path: Path) -> str:
    """Infer diagram format from file extension or initial contents."""
    ext = path.suffix.lower()
    if ext in MERMAID_EXTS:
        return "mermaid"
    if ext in GRAPHVIZ_EXTS:
        return "graphviz"
    if ext in PLANTUML_EXTS:
        return "plantuml"
    if ext in SVG_EXTS:
        return "svg"

    try:
        text = path.read_text(encoding="utf-8", errors="replace").lstrip()
        if text.startswith("@startuml"):
            return "plantuml"
        if text.startswith("digraph") or text.startswith("graph"):
            return "graphviz"
        if text.startswith("<svg"):
            return "svg"
    except Exception:
        pass
    return "mermaid"


def render_diagram(src_path: str | Path, out_path: str | Path | None = None, fmt: str = "png") -> dict[str, Any]:
    """Render diagram source to output file."""
    src = Path(src_path).resolve()
    if not src.is_file():
        raise FileNotFoundError(f"Diagram source not found: {src}")

    kind = infer_diagram_kind(src)
    out = Path(out_path).resolve() if out_path else src.with_suffix(f".{fmt}")

    rendered = False
    renderer_used = "none"

    if kind == "mermaid":
        mmdc = shutil.which("mmdc")
        if mmdc:
            subprocess.run([mmdc, "-i", str(src), "-o", str(out)], check=True)
            rendered = True
            renderer_used = "mmdc"
        else:
            raise RuntimeError(
                "Mermaid CLI (mmdc) not found on $PATH. Install with: npm install -g @mermaid-js/mermaid-cli"
            )

    elif kind == "graphviz":
        dot = shutil.which("dot")
        if dot:
            subprocess.run([dot, f"-T{fmt}", str(src), "-o", str(out)], check=True)
            rendered = True
            renderer_used = "dot"
        else:
            raise RuntimeError("Graphviz dot executable not found on $PATH. Install with: apt install graphviz | brew install graphviz")

    elif kind == "plantuml":
        puml = shutil.which("plantuml")
        if puml:
            subprocess.run([puml, f"-t{fmt}", str(src)], check=True)
            rendered = True
            renderer_used = "plantuml"
        else:
            raise RuntimeError("PlantUML not found on $PATH. Install plantuml or java -jar plantuml.jar")

    elif kind == "svg":
        if fmt == "svg":
            shutil.copyfile(src, out)
            rendered = True
            renderer_used = "copy"
        else:
            rsvg = shutil.which("rsvg-convert")
            if rsvg:
                subprocess.run([rsvg, "-f", fmt, str(src), "-o", str(out)], check=True)
                rendered = True
                renderer_used = "rsvg-convert"
            else:
                shutil.copyfile(src, out)
                rendered = True
                renderer_used = "copy"

    return {
        "source": str(src),
        "output": str(out),
        "kind": kind,
        "format": fmt,
        "rendered": rendered,
        "renderer": renderer_used,
    }


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal scripts re-diagram-generator/render-diagram'."""
    parser = argparse.ArgumentParser(
        prog="arsenal scripts re-diagram-generator/render-diagram",
        description="Render diagram source to output file",
    )
    parser.add_argument("source", help="Diagram source file (Mermaid, DOT, PlantUML, SVG)")
    parser.add_argument("--out", "-o", default="", help="Output image file path")
    parser.add_argument("--format", "-f", default="png", help="Output format (png, svg, pdf)")

    argv = list(ctx.positionals)
    if ctx.remainder:
        argv.extend(ctx.remainder)

    try:
        args, _ = parser.parse_known_args(argv)
        res = render_diagram(src_path=args.source, out_path=args.out or None, fmt=args.format)
        if not ctx.is_json:
            print(f"DIAGRAM RENDERED: {res['output']}")
            print(f"  Type:     {res['kind']}")
            print(f"  Renderer: {res['renderer']}")
        return ctx.result(res, code=ExitCodes.SUCCESS)
    except Exception as exc:
        return ctx.fail(str(exc), code=ExitCodes.CLI_USAGE_ERROR)
