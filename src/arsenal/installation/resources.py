"""Resource and template resolution for Arsenal installer.

Supports development workspace trees, installed Python wheels, and custom overrides.
"""

from __future__ import annotations

import importlib.resources as pkg_resources
from pathlib import Path


def resolve_plugin_dir(repo_root: Path | None = None) -> Path | None:
    """Resolve directory containing plugin resources (agents, rules, manifests, etc.)."""
    if repo_root is not None:
        candidate = repo_root / "plugin"
        if candidate.is_dir():
            return candidate

    # Check installed package resources
    try:
        bundled = pkg_resources.files("arsenal").joinpath("resources/plugin")
        bundled_path = Path(str(bundled))
        if bundled_path.is_dir():
            return bundled_path
    except Exception:
        pass

    # Fallback to local source tree relative to this file
    local_source = Path(__file__).resolve().parent.parent.parent.parent / "plugin"
    if local_source.is_dir():
        return local_source

    return None


def get_install_data_dir() -> Path:
    """Resolve directory containing template files (AGENTS.md, RULES.md, config.yml, models.yml)."""
    # 1. Check relative to current module: src/arsenal/install_data
    local_data = Path(__file__).resolve().parent.parent / "install_data"
    if local_data.is_dir():
        return local_data

    # 2. Check package resources
    try:
        bundled = pkg_resources.files("arsenal").joinpath("install_data")
        bundled_path = Path(str(bundled))
        if bundled_path.is_dir():
            return bundled_path
    except Exception:
        pass

    return local_data


def get_template_text(filename: str) -> str:
    """Read a template file by name from install_data."""
    path = get_install_data_dir() / filename
    if path.is_file():
        return path.read_text(encoding="utf-8")
    raise FileNotFoundError(f"Template '{filename}' not found in {get_install_data_dir()}")
