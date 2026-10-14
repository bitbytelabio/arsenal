"""Arsenal plugin build orchestration.

Ports src/cli/build.ts: copies skills, merges local presets tier, generates
Tier-1 routers, catalog index, routing tables, and builds native OMP TS extensions.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Any

from arsenal.common import Context, ExitCodes, VERSION
from arsenal.corpus.catalog import generate_routers, generate_skill_index
from arsenal.corpus.frontmatter import parse_skill_frontmatter
from arsenal.corpus.manifest import sha256_file
from arsenal.corpus.routing import DOMAINS

def get_local_override_reason(fm: dict[str, Any] | None) -> str | None:
    """Extract explicit local override reason from frontmatter."""
    if not fm:
        return None

    # 1. metadata.override
    meta = fm.get("metadata")
    if isinstance(meta, dict):
        ov = meta.get("override")
        if isinstance(ov, str) and ov.strip():
            return ov.strip()

    # 2. override.reason
    ov_obj = fm.get("override")
    if isinstance(ov_obj, dict):
        r = ov_obj.get("reason")
        if isinstance(r, str) and r.strip():
            return r.strip()

    # 3. override: True with reason
    if fm.get("override") is True and isinstance(fm.get("reason"), str) and str(fm.get("reason")).strip():
        return str(fm.get("reason")).strip()

    # 4. override scalar string
    if isinstance(fm.get("override"), str) and str(fm.get("override")).strip():
        return str(fm.get("override")).strip()

    # 5. override_reason
    if isinstance(fm.get("override_reason"), str) and str(fm.get("override_reason")).strip():
        return str(fm.get("override_reason")).strip()

    # 6. reason
    if isinstance(fm.get("reason"), str) and str(fm.get("reason")).strip():
        return str(fm.get("reason")).strip()

    return None


def copy_skill_directory(src_dir: Path, dest_dir: Path) -> None:
    """Copy a skill directory preserving file bytes and deterministic order."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    for ent in sorted(src_dir.iterdir(), key=lambda p: p.name):
        if ent.name == ".DS_Store":
            continue
        dest_path = dest_dir / ent.name
        if ent.is_dir():
            copy_skill_directory(ent, dest_path)
        elif ent.is_file():
            try:
                data = ent.read_bytes()
                if dest_path.exists():
                    dest_path.unlink()
                dest_path.write_bytes(data)
                dest_path.chmod(0o644)
            except OSError:
                pass

def collect_artifacts(base_dir: Path) -> dict[str, str]:
    """Recursively collect relative artifact paths and their SHA-256 hashes."""
    result: dict[str, str] = {}
    if not base_dir.is_dir():
        return result

    for p in sorted(base_dir.rglob("*"), key=lambda p: str(p)):
        if p.name == ".DS_Store" or not p.is_file():
            continue
        rel = p.relative_to(base_dir).as_posix()
        result[rel] = sha256_file(p)

    return result


def create_canonical_mcp_catalog() -> dict[str, Any]:
    """Create canonical MCP server catalog for .mcp.json."""
    return {
        "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
        "mcpServers": {
            "ida-pro": {
                "type": "stdio",
                "command": "uvx",
                "args": ["ida-pro-mcp"],
            },
            "ghidra": {
                "type": "stdio",
                "command": "uv",
                "args": ["run", "-m", "ghidra_mcp"],
            },
            "jshook": {
                "type": "stdio",
                "command": "node",
                "args": ["jshookmcp.js"],
            },
            "burp-ultra": {
                "type": "sse",
                "url": "${BURP_MCP_URL:-http://127.0.0.1:9876/}",
                "headers": {"Authorization": "Bearer ${BURP_MCP_TOKEN}"},
            },
            "playwright": {
                "type": "stdio",
                "command": "bunx",
                "args": ["@playwright/mcp@latest"],
            },
            "rea": {
                "type": "stdio",
                "command": "bunx",
                "args": ["rea-agents@6.4.0", "mcp"],
            },
        },
    }


def execute_build(
    target_dir: Path,
    corpus_dir: Path,
    presets_dir: Path,
    corpus_entries: list[str],
    preset_entries: list[str],
    preset_filter: str | None = None,
) -> tuple[int, int]:
    """Execute plugin compilation into target directory."""
    out_skills_dir = target_dir / "skills"
    out_catalog_dir = target_dir / "catalog"
    out_catalog_file = out_catalog_dir / "skills.index.jsonl"

    out_skills_dir.mkdir(parents=True, exist_ok=True)
    written_skills: set[str] = set()

    # 1. Copy admitted skills from src/corpus in sorted order
    for name in corpus_entries:
        if preset_filter and not name.startswith(preset_filter):
            continue
        src_skill = corpus_dir / name
        dest_skill = out_skills_dir / name
        copy_skill_directory(src_skill, dest_skill)
        written_skills.add(name)

    # 2. Merge local presets tier after corpus copy
    for name in preset_entries:
        if preset_filter and not name.startswith(preset_filter):
            continue
        src_skill = presets_dir / name
        dest_skill = out_skills_dir / name
        if dest_skill.exists():
            shutil.rmtree(dest_skill, ignore_errors=True)
        copy_skill_directory(src_skill, dest_skill)
        written_skills.add(name)

    # 3. Generate Tier 1 routers
    repo_root = corpus_dir.parent.parent
    source_plugin = repo_root / "plugin"
    if not source_plugin.is_dir():
        source_plugin = Path(__file__).resolve().parents[2] / "plugin"
    for component in ("agents", "rules", "commands", "context"):
        source = source_plugin / component
        destination = target_dir / component
        if source.is_dir() and source.resolve() != destination.resolve():
            shutil.copytree(source, destination, dirs_exist_ok=True, symlinks=True)
    if any((repo_root / f"presets/{domain}/routing.json").is_file() for domain in DOMAINS):
        generate_routers(out_skills_dir, repo_root)

    # 3b. Ship verbatim copies of routing tables
    routing_out_dir = out_catalog_dir / "routing"
    routing_out_dir.mkdir(parents=True, exist_ok=True)
    for domain in DOMAINS:
        src_routing = repo_root / f"presets/{domain}/routing.json"
        if src_routing.is_file():
            shutil.copy2(src_routing, routing_out_dir / f"{domain}.json")

    # 4. Generate catalog index
    catalog = generate_skill_index(out_skills_dir, out_catalog_file)

    # 5. Write metadata files
    package_json = {
        "name": "arsenal",
        "version": VERSION,
        "description": "Arsenal Security Engagement Harness Plugin",
        "type": "module",
        "omp": {
            "extensions": [
                "./dist/extensions/bounding.js",
                "./dist/extensions/budget.js",
                "./dist/extensions/routing.js",
            ],
            "skills": ["./skills"],
        },
        "pi": {
            "extensions": [
                "./dist/extensions/bounding.js",
                "./dist/extensions/budget.js",
                "./dist/extensions/routing.js",
            ],
            "skills": ["./skills"],
        },
    }
    (target_dir / "package.json").write_text(json.dumps(package_json, indent=2) + "\n", encoding="utf-8")

    plugin_json = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "name": "arsenal",
        "version": VERSION,
        "description": "Arsenal Security Engagement Harness Plugin for Oh My Pi",
        "author": {"name": "arsenal"},
        "license": "MIT",
        "capabilities": {
            "roles": [
                "master",
                "arsenal-reverse",
                "arsenal-web",
                "arsenal-mobile",
                "arsenal-redteam",
                "arsenal-verifier",
            ],
            "routers": [
                "arsenal-re-router",
                "arsenal-webapp-router",
                "arsenal-mobile-router",
                "arsenal-red-router",
            ],
            "extensions": ["bounding", "budget", "routing"],
            "tools": ["skill_search", "skill_list", "skill_load", "skill_asset_load", "skill_route"],
        },
    }
    (target_dir / "plugin.json").write_text(json.dumps(plugin_json, indent=2) + "\n", encoding="utf-8")


    source_mcp = source_plugin / ".mcp.json"
    target_mcp = target_dir / ".mcp.json"
    if source_mcp.is_file():
        if source_mcp.resolve() != target_mcp.resolve():
            target_mcp.write_bytes(source_mcp.read_bytes())
    else:
        mcp_catalog = create_canonical_mcp_catalog()
        target_mcp.write_text(json.dumps(mcp_catalog, indent=2) + "\n", encoding="utf-8")

    # Bun is needed only to compile the native in-process OMP extensions.
    ext_entrypoints = [
        source_plugin / "extensions/bounding.ts",
        source_plugin / "extensions/budget.ts",
        source_plugin / "extensions/routing.ts",
    ]
    existing_exts = [str(p) for p in ext_entrypoints if p.is_file()]
    if existing_exts:
        out_extensions_dir = target_dir / "dist/extensions"
        out_extensions_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                "bun", "build", *existing_exts,
                "--outdir", str(out_extensions_dir),
                "--target", "bun", "--format", "esm",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    else:
        bundled = source_plugin / "dist/extensions"
        required = ("bounding.js", "budget.js", "routing.js")
        if all((bundled / name).is_file() for name in required):
            out_extensions_dir = target_dir / "dist/extensions"
            out_extensions_dir.mkdir(parents=True, exist_ok=True)
            for name in required:
                shutil.copyfile(bundled / name, out_extensions_dir / name)

    return len(written_skills), len(catalog)


def handle(ctx: Context) -> int:
    """Master build entrypoint: arsenal build [--write] [--force] [--check-determinism]."""
    is_write = ctx.mode == "write"
    is_force = bool(ctx.values.get("force"))
    is_check_determinism = bool(ctx.values.get("check-determinism") or ctx.values.get("checkDeterminism"))
    preset = str(ctx.values.get("preset")) if ctx.values.get("preset") else None

    repo_root = ctx.repo_root
    corpus_dir = repo_root / "src/corpus"
    presets_dir = repo_root / "presets/skills"

    out_dir_val = ctx.values.get("out") or ctx.values.get("dir")
    out_dir = Path(str(out_dir_val)) if out_dir_val else (repo_root / "plugin")

    if not corpus_dir.is_dir():
        msg = f"Corpus directory '{corpus_dir}' missing."
        return ctx.result({}, code=ExitCodes.ENVIRONMENT_UNAVAILABLE, errors=[msg])

    corpus_entries = sorted([
        d.name
        for d in corpus_dir.iterdir()
        if d.is_dir() and (d / "SKILL.md").is_file()
    ])

    preset_entries = (
        sorted([
            d.name
            for d in presets_dir.iterdir()
            if d.is_dir() and (d / "SKILL.md").is_file()
        ])
        if presets_dir.is_dir()
        else []
    )

    # Collision checks
    corpus_set = set(corpus_entries)
    collision_errors: list[str] = []
    for name in preset_entries:
        if preset and not name.startswith(preset):
            continue
        if name in corpus_set:
            local_skill_file = presets_dir / name / "SKILL.md"
            content = local_skill_file.read_text(encoding="utf-8")
            fm = parse_skill_frontmatter(content)
            reason = get_local_override_reason(fm)
            if not reason:
                collision_errors.append(
                    f"Duplicate skill identifier '{name}' present in both 'src/corpus' and 'presets/skills' "
                    "without an explicit override reason in local frontmatter."
                )

    if collision_errors:
        return ctx.result({}, code=ExitCodes.CHECK_FAILURE, errors=collision_errors)

    # Handle --check-determinism
    if is_check_determinism:
        tmp_base = repo_root / "tmp"
        tmp_base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="arsenal-build-det1-", dir=tmp_base) as tmp1, tempfile.TemporaryDirectory(
            prefix="arsenal-build-det2-", dir=tmp_base
        ) as tmp2:
            t1 = Path(tmp1)
            t2 = Path(tmp2)
            execute_build(t1, corpus_dir, presets_dir, corpus_entries, preset_entries, preset)
            execute_build(t2, corpus_dir, presets_dir, corpus_entries, preset_entries, preset)

            artifacts1 = collect_artifacts(t1)
            artifacts2 = collect_artifacts(t2)

            discrepancies: list[str] = []
            for rel_path, h1 in artifacts1.items():
                if rel_path not in artifacts2:
                    discrepancies.append(f"Missing in second build: {rel_path}")
                elif h1 != artifacts2[rel_path]:
                    discrepancies.append(f"Hash mismatch for {rel_path}: run 1 ({h1}) vs run 2 ({artifacts2[rel_path]})")

            for rel_path in artifacts2:
                if rel_path not in artifacts1:
                    discrepancies.append(f"Missing in first build: {rel_path}")

            if discrepancies:
                return ctx.result(
                    {
                        "deterministic": False,
                        "totalArtifacts": len(artifacts1),
                        "discrepancies": discrepancies,
                    },
                    code=ExitCodes.CHECK_FAILURE,
                    errors=discrepancies,
                )

            return ctx.result(
                {
                    "deterministic": True,
                    "totalArtifacts": len(artifacts1),
                    "discrepancies": [],
                },
                code=ExitCodes.SUCCESS,
            )

    # Preview mode
    if not is_write:
        matching_corpus = [name for name in corpus_entries if not preset or name.startswith(preset)]
        matching_presets = [name for name in preset_entries if not preset or name.startswith(preset)]
        distinct_leaves = set(matching_corpus + matching_presets)
        planned = len(distinct_leaves) + 4  # 4 routers
        return ctx.result(
            {
                "targetDir": str(out_dir),
                "plannedSkills": planned,
                "preset": preset or "all",
            },
            code=ExitCodes.SUCCESS,
        )

    # Write mode
    out_skills_dir = out_dir / "skills"
    if is_force and out_skills_dir.exists():
        shutil.rmtree(out_skills_dir, ignore_errors=True)

    copied, catalog_len = execute_build(
        out_dir,
        corpus_dir,
        presets_dir,
        corpus_entries,
        preset_entries,
        preset,
    )

    return ctx.result(
        {
            "targetDir": str(out_dir),
            "skillsCopied": copied,
            "totalCatalog": catalog_len,
        },
        code=ExitCodes.SUCCESS,
    )
