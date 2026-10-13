"""Build metadata and resources from the repository's explicit sources of truth."""
from __future__ import annotations

import json
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface
from hatchling.metadata.plugin.interface import MetadataHookInterface


class MetadataHook(MetadataHookInterface):
    def update(self, metadata: dict[str, object]) -> None:
        package = json.loads((Path(self.root) / "package.json").read_text(encoding="utf-8"))
        metadata["version"] = package["version"]


class BuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict[str, object]) -> None:
        if self.target_name != "wheel":
            return
        root = Path(self.root)
        # Explicit allowlist: no environment files, evidence, upstream checkouts, or tmp.
        resources = {
            "package.json": "arsenal/resources/package.json",
            "src/corpus": "arsenal/resources/corpus",
            "presets": "arsenal/resources/presets",
            "LICENSE": "arsenal/resources/LICENSE",
        }
        for relative in (
            "agents", "rules", "commands", "context", "catalog", "dist", "skills",
            "package.json", "plugin.json", ".mcp.json",
        ):
            source = root / "plugin" / relative
            if source.exists():
                resources[f"plugin/{relative}"] = f"arsenal/resources/plugin/{relative}"
        if (root / "uv.lock").exists():
            resources["uv.lock"] = "arsenal/resources/uv.lock"
        build_data["force_include"] = {
            str(root / source): destination for source, destination in resources.items()
        }
