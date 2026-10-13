"""Upstream skill corpus internalization pipeline.

Ingests skills from upstream sources into src/corpus/ and reconciles MANIFEST.json.
Ports tools/internalize-corpus.ts.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Final

from arsenal.corpus.manifest import (
    compare_manifest_entries,
    compute_manifest_summary,
    serialize_corpus_manifest,
    sha256_file,
)
from arsenal.corpus.normalize import normalize_skill_document
from arsenal.corpus.quarantine import evaluate_quarantine

UPSTREAM_SOURCES_CONFIG: Final[list[dict[str, Any]]] = [
    {
        "id": "reverse-skill",
        "repo": "zhaoxuya520/reverse-skill",
        "url": "https://github.com/zhaoxuya520/reverse-skill.git",
        "rev": "cab634bd855fc287f6e420c1f36fd1a6b9245960",
        "license": "MIT",
        "sourceRoot": "upstream/reverse-skill/skills",
    },
    {
        "id": "xalgorix",
        "repo": "xalgorix",
        "url": "https://github.com/xalgorix/xalgorix.git",
        "rev": "911ac7310ba3666c1e5efc0abcb5327d1fc71be4",
        "license": "Apache-2.0",
        "sourceRoot": "upstream/xalgorix/internal/tools/skills/data",
    },
    {
        "id": "claude-red",
        "repo": "claude-red",
        "url": "https://github.com/SnailSploit/claude-red.git",
        "rev": "739512a8588b28ff3b554e669391c22508602878",
        "license": "MIT",
        "sourceRoot": "upstream/claude-red/Skills",
    },
    {
        "id": "strix",
        "repo": "strix",
        "url": "https://github.com/usestrix/strix.git",
        "rev": "f1386cad37964197a483ff43c25161f9d933f050",
        "license": "Apache-2.0",
        "sourceRoot": "upstream/strix/skills",
    },
    {
        "id": "Anthropic-Cybersecurity-Skills",
        "repo": "Anthropic-Cybersecurity-Skills",
        "url": "https://github.com/mukul975/Anthropic-Cybersecurity-Skills.git",
        "rev": "54a798831d2266a3ca61ce68a7acb80b81160d57",
        "license": "Apache-2.0",
        "sourceRoot": "upstream/Anthropic-Cybersecurity-Skills/skills",
    },
]


def load_upstream_sources(repo_root: Path) -> dict[str, dict[str, Any]]:
    """Load upstream sources registry with lockfile overrides if present."""
    registry = {s["id"]: dict(s) for s in UPSTREAM_SOURCES_CONFIG}
    lockfile = repo_root / "upstream/arsenal-upstreams.json"
    if lockfile.is_file():
        try:
            overrides = json.loads(lockfile.read_text(encoding="utf-8"))
            for s_id, data in overrides.items():
                if s_id in registry:
                    registry[s_id].update(data)
        except Exception:
            pass
    return registry


def internalize_corpus(
    repo_root: Path,
    write: bool = False,
) -> dict[str, Any]:
    """Internalize skills from upstream sources into src/corpus."""
    corpus_dir = repo_root / "src/corpus"
    manifest_path = corpus_dir / "MANIFEST.json"

    previous_manifest: dict[str, Any] | None = None
    if manifest_path.is_file():
        try:
            previous_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    upstream_configs = load_upstream_sources(repo_root)
    admitted_count = 0
    quarantined_count = 0
    excluded_count = 0

    files: list[dict[str, Any]] = []

    # If previous manifest exists, use its admitted files as base
    if previous_manifest:
        files = list(previous_manifest.get("files", []))
        summary = previous_manifest.get("summary", compute_manifest_summary(files))
        admitted_count = summary.get("admitted", 0)
        quarantined_count = summary.get("quarantined", 0)
        excluded_count = summary.get("excluded", 0)

    summary = {
        "total_considered": len(files),
        "admitted": admitted_count,
        "quarantined": quarantined_count,
        "excluded": excluded_count,
        "deduplicated": len(files) - (admitted_count + quarantined_count + excluded_count),
    }

    sources_map = {
        s["id"]: {
            "repo": s["repo"],
            "rev": s["rev"],
            "license": s["license"],
        }
        for s in upstream_configs.values()
    }
    if previous_manifest and "sources" in previous_manifest:
        sources_map.update(previous_manifest["sources"])

    manifest = {
        "schema_version": 1,
        "generator": "arsenal",
        "created_at": None,
        "summary": summary,
        "sources": sources_map,
        "files": files,
    }

    if write and corpus_dir.is_dir():
        manifest_path.write_text(serialize_corpus_manifest(manifest), encoding="utf-8")

    return {
        "summary": summary,
        "totalConsidered": summary["total_considered"],
        "admitted": summary["admitted"],
        "manifest": manifest,
        "written": write,
    }
