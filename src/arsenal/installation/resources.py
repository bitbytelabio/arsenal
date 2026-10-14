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


def resolve_installed_plugin_dir(
    repo_root: Path | None = None,
    profile_dir: Path | None = None,
) -> Path | None:
    """Discover an installed Arsenal plugin root in precedence order:

    1. repo_root / "plugins" / "node_modules" / "arsenal"
    2. repo_root / ".omp" / "plugins" / "node_modules" / "arsenal"
    3. profile_dir.parent / "plugins" / "node_modules" / "arsenal" (if profile_dir supplied)
    4. profile_dir / "plugins" / "node_modules" / "arsenal" (if profile_dir supplied)
    5. Path.home() / ".omp" / "plugins" / "node_modules" / "arsenal"
    6. repo_root / "plugin" (if repo_root supplied)
    7. Packaged plugin resources
    8. Local source tree fallback
    """
    candidates: list[Path] = []
    if repo_root is not None:
        candidates.append(repo_root / "plugins" / "node_modules" / "arsenal")
        candidates.append(repo_root / ".omp" / "plugins" / "node_modules" / "arsenal")
    if profile_dir is not None:
        candidates.append(profile_dir.parent / "plugins" / "node_modules" / "arsenal")
        candidates.append(profile_dir / "plugins" / "node_modules" / "arsenal")
    candidates.append(Path.home() / ".omp" / "plugins" / "node_modules" / "arsenal")
    if repo_root is not None:
        candidates.append(repo_root / "plugin")

    for candidate in candidates:
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
    """Resolve directory containing profile templates (AGENTS.md and RULES.md)."""
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
