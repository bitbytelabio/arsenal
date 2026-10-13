"""IDA Pro & idalib Auto-Detection Engine.

Discovers local IDA Pro installations and idalib Python environments
to configure OMP native IDA integration.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import sys
from dataclasses import dataclass


@dataclass
class DetectedIdaConfig:
    found: bool
    install_dir: str | None = None
    python: str | None = None
    has_idalib: bool = False
    version: str | None = None


def detect_ida_installation(custom_base_dir: str | None = None) -> DetectedIdaConfig:
    """Scan workstation for IDA Pro 9+ installations and compatible idalib Python environments."""
    home_dir = Path.home()
    platform = sys.platform
    candidate_dirs: list[str] = []

    # 1. Explicit environment overrides
    if "IDA_DIR" in os.environ:
        candidate_dirs.append(os.environ["IDA_DIR"])
    if "IDA_INSTALL_DIR" in os.environ:
        candidate_dirs.append(os.environ["IDA_INSTALL_DIR"])
    if custom_base_dir:
        candidate_dirs.append(custom_base_dir)

    # 2. Platform-specific candidate discovery
    if platform == "darwin":
        app_roots = [Path("/Applications"), home_dir / "Applications"]
        for root in app_roots:
            if root.is_dir():
                try:
                    entries = [e.name for e in root.iterdir()]
                    ida_apps = sorted(
                        [e for e in entries if re.search(r"IDA.*\.app$", e, re.IGNORECASE)],
                        reverse=True,
                    )
                    for app in ida_apps:
                        candidate_dirs.append(str(root / app / "Contents/MacOS"))

                    ida_dirs = [e for e in entries if re.match(r"^IDA", e, re.IGNORECASE) and not e.endswith(".app")]
                    for d in ida_dirs:
                        candidate_dirs.append(str(root / d / "ida64.app/Contents/MacOS"))
                        candidate_dirs.append(str(root / d / "Contents/MacOS"))
                except OSError:
                    pass

    elif platform.startswith("linux"):
        linux_roots = [Path("/opt"), home_dir, home_dir / ".idapro"]
        for root in linux_roots:
            if root.is_dir():
                try:
                    entries = [e.name for e in root.iterdir()]
                    ida_dirs = sorted(
                        [e for e in entries if re.search(r"ida.*9", e, re.IGNORECASE) or re.match(r"^ida", e, re.IGNORECASE)],
                        reverse=True,
                    )
                    for d in ida_dirs:
                        candidate_dirs.append(str(root / d))
                except OSError:
                    pass

    elif platform == "win32":
        prog_files = [os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")]
        for pf in prog_files:
            if pf and Path(pf).is_dir():
                try:
                    entries = [e.name for e in Path(pf).iterdir()]
                    ida_dirs = sorted([e for e in entries if re.match(r"^IDA", e, re.IGNORECASE)], reverse=True)
                    for d in ida_dirs:
                        candidate_dirs.append(str(Path(pf) / d))
                except OSError:
                    pass

    # 3. Resolve first directory with valid idalib or ida binary
    resolved_install_dir: str | None = None
    has_idalib = False
    detected_version: str | None = None

    dylib_name = (
        "libidalib.dylib"
        if platform == "darwin"
        else ("idalib.dll" if platform == "win32" else "libidalib.so")
    )

    for d in candidate_dirs:
        dir_path = Path(d)
        if not dir_path.is_dir():
            continue

        has_lib = (dir_path / dylib_name).is_file()
        has_binary = (
            (dir_path / "ida").is_file()
            or (dir_path / "ida64").is_file()
            or (dir_path / "ida.exe").is_file()
            or (dir_path / "ida64.exe").is_file()
        )

        if has_lib or has_binary:
            resolved_install_dir = str(dir_path)
            has_idalib = has_lib

            ver_match = re.search(r"9\.\d+", d)
            if ver_match:
                detected_version = ver_match.group(0)
            break

    if not resolved_install_dir:
        return DetectedIdaConfig(found=False, has_idalib=False)

    # 4. Locate compatible Python environment
    candidate_pythons: list[str] = []
    if "IDA_PYTHON" in os.environ:
        candidate_pythons.append(os.environ["IDA_PYTHON"])

    candidate_pythons.extend([
        str(home_dir / ".idapro/venv/bin/python"),
        str(home_dir / ".idapro/venv/bin/python3"),
        str(home_dir / ".idapro/venv/Scripts/python.exe"),
        str(Path(resolved_install_dir) / "venv/bin/python"),
        str(Path(resolved_install_dir) / "venv/bin/python3"),
        str(Path(resolved_install_dir) / "python/bin/python"),
    ])

    resolved_python: str | None = None
    for py in candidate_pythons:
        if Path(py).is_file():
            resolved_python = py
            break

    if not resolved_python:
        sys_py = shutil.which("python3") or shutil.which("python")
        if sys_py:
            resolved_python = sys_py

    return DetectedIdaConfig(
        found=True,
        install_dir=resolved_install_dir,
        python=resolved_python,
        has_idalib=has_idalib,
        version=detected_version,
    )
