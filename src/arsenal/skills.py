"""Arsenal skills and vendor CLI handlers.

Implements all skills and vendor subcommands with full behavioral parity:
route, search, list, load, asset-load, build-routers, build-index, check, normalize,
rename, dedup, scripts-audit, coverage, update, new, internalize, reconcile,
migrate-uris, sync-upstreams, and vendor check/sync.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes
from arsenal.corpus.catalog import (
    generate_routers,
    generate_skill_index,
    list_catalog,
    load_asset,
    load_catalog_from_file,
    load_skill,
    search_catalog,
)
from arsenal.corpus.coverage import build_coverage_report
from arsenal.corpus.dedup import (
    detect_tier_a_collision_groups,
    detect_tier_b_groups,
    format_dedup_summary,
    load_tier_b_aliases,
)
from arsenal.corpus.frontmatter import (
    parse_skill_document,
    parse_skill_frontmatter,
    serialize_skill_document,
)
from arsenal.corpus.internalize import internalize_corpus
from arsenal.corpus.language import detect_language_violations_in_file
from arsenal.corpus.naming import (
    derive_skill_id,
    FORBIDDEN_VENDOR_SEGMENTS,
    is_valid_skill_domain,
    is_valid_skill_id,
)
from arsenal.corpus.normalize import (
    get_declared_domain_categories,
    normalize_corpus,
)
from arsenal.corpus.quarantine import evaluate_quarantine
from arsenal.corpus.reconcile import reconcile_manifest
from arsenal.corpus.references import (
    audit_citations,
    migrate_skill_content,
    plan_corpus_reference_materialization,
    resolve_skill_uri,
)
from arsenal.corpus.routing import (
    DOMAINS,
    load_routing_tables,
    route_hint,
)
from arsenal.corpus.sync import sync_upstreams


def resolve_corpus_dir(ctx: Context) -> Path:
    """Resolve corpus directory from explicit repo, workspace, or package resources."""
    explicit_repo = ctx.values.get("repo")
    if explicit_repo:
        repo_path = Path(str(explicit_repo))
        if (repo_path / "src/corpus").is_dir():
            return repo_path / "src/corpus"
        if repo_path.is_dir() and (repo_path / "MANIFEST.json").is_file():
            return repo_path

    if (ctx.repo_root / "src/corpus").is_dir():
        return ctx.repo_root / "src/corpus"

    # Installed package resources fallback
    try:
        import importlib.resources

        res_path = Path(str(importlib.resources.files("arsenal").joinpath("resources/corpus")))
        if res_path.is_dir():
            return res_path
    except Exception:
        pass

    return ctx.repo_root / "src/corpus"


def resolve_skills_dir(ctx: Context, repo_root: Path) -> Path:
    """Resolve active skills directory (e.g. plugin/skills or src/corpus)."""
    dir_val = ctx.values.get("dir")
    if dir_val:
        return Path(str(dir_val))
    plugin_skills = repo_root / "plugin/skills"
    if plugin_skills.is_dir():
        return plugin_skills
    return resolve_corpus_dir(ctx)


def handle_vendor(ctx: Context) -> int:
    """Handle 'vendor' family commands (vendor check, vendor sync)."""
    subcommand = ctx.subcommand or "check"
    corpus_dir = resolve_corpus_dir(ctx)

    if subcommand == "check":
        if not corpus_dir.is_dir():
            msg = f"Corpus directory '{corpus_dir}' does not exist."
            return ctx.result({}, code=ExitCodes.CHECK_FAILURE, errors=[msg])

        errors: list[str] = []
        validated_count = 0

        for entry in sorted(corpus_dir.iterdir()):
            if not entry.is_dir():
                continue
            skill_file = entry / "SKILL.md"
            if not skill_file.is_file():
                errors.append(f"Missing SKILL.md in '{entry.name}'.")
                continue

            content = skill_file.read_text(encoding="utf-8", errors="replace")
            q = evaluate_quarantine(entry.name, content=content)
            if not q.get("allowed"):
                errors.append(f"Quarantined component in corpus: '{entry.name}': {q.get('reason')}")

            fm = parse_skill_frontmatter(content)
            if not fm:
                errors.append(f"Malformed frontmatter in '{entry.name}'.")
                continue

            name = fm.get("name")
            if not name or name != entry.name:
                errors.append(f"Name mismatch in '{entry.name}': declared '{name}'.")
            elif not is_valid_skill_id(str(name)):
                errors.append(f"Name in '{entry.name}' does not match standard grammar or contains forbidden tokens.")

            desc = fm.get("description")
            if not desc or len(str(desc)) < 40:
                errors.append(f"Description in '{entry.name}' is invalid or < 40 chars.")

            if not fm.get("license"):
                errors.append(f"Missing license declaration in '{entry.name}'.")

            metadata = fm.get("metadata")
            if not isinstance(metadata, dict) or not metadata.get("manifest_entry"):
                errors.append(f"Missing provenance (manifest_entry) in '{entry.name}'.")

            validated_count += 1

        clean = len(errors) == 0
        code = ExitCodes.SUCCESS if clean else ExitCodes.CHECK_FAILURE
        return ctx.result({"totalValidated": validated_count, "clean": clean}, code=code, errors=errors)

    if subcommand == "sync":
        is_write = ctx.mode == "write"
        manifest_path = corpus_dir / "MANIFEST.json"
        if not manifest_path.is_file():
            msg = f"Manifest '{manifest_path}' missing. Run normalization first."
            return ctx.result({}, code=ExitCodes.ENVIRONMENT_UNAVAILABLE, errors=[msg])

        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            summary = manifest.get("summary", {})
        except Exception as e:
            return ctx.result({}, code=ExitCodes.CHECK_FAILURE, errors=[f"Failed to read manifest: {e}"])

        return ctx.result({"summary": summary, "synced": is_write}, code=ExitCodes.SUCCESS)

    return ctx.fail(f"Unknown vendor subcommand: '{subcommand}'")


def handle_skills(ctx: Context) -> int:
    """Handle 'skills' family commands."""
    subcommand = ctx.subcommand or "check"
    repo_root = ctx.repo_root
    corpus_dir = resolve_corpus_dir(ctx)
    skills_dir = resolve_skills_dir(ctx, repo_root)
    manifest_path = corpus_dir / "MANIFEST.json"
    is_write = ctx.mode == "write"

    # 1. build-routers (exact syntax: arsenal skills build-routers --dir <out_dir> --repo <repo> [--write] [--json])
    if subcommand == "build-routers":
        out_dir_val = ctx.values.get("dir")
        if not out_dir_val:
            return ctx.fail("Missing required flag: --dir <output skills directory>")
        out_skills_dir = Path(str(out_dir_val))

        authoring_repo_val = ctx.values.get("repo")
        authoring_repo = Path(str(authoring_repo_val)) if authoring_repo_val else repo_root

        if not is_write:
            return ctx.result({"planned": list(DOMAINS), "target": str(out_skills_dir)}, code=ExitCodes.SUCCESS)

        try:
            written = generate_routers(out_skills_dir, authoring_repo)
            return ctx.result({"written": written, "count": len(written)}, code=ExitCodes.SUCCESS)
        except Exception as e:
            return ctx.result({}, code=ExitCodes.ENVIRONMENT_UNAVAILABLE, errors=[str(e)])

    # 2. build-index (exact syntax: arsenal skills build-index --dir <out_dir> --out <catalog_jsonl> [--write] [--json])
    if subcommand == "build-index":
        out_dir_val = ctx.values.get("dir") or str(skills_dir)
        target_skills_dir = Path(str(out_dir_val))

        out_jsonl_val = ctx.values.get("out")
        out_catalog_file = Path(str(out_jsonl_val)) if out_jsonl_val else (target_skills_dir.parent / "catalog/skills.index.jsonl")

        if not target_skills_dir.is_dir():
            return ctx.result({}, code=ExitCodes.ENVIRONMENT_UNAVAILABLE, errors=[f"Directory '{target_skills_dir}' not found."])

        records = generate_skill_index(target_skills_dir, out_catalog_file if is_write else None)
        return ctx.result({"count": len(records), "records": records}, code=ExitCodes.SUCCESS)

    # 3. route (--hint <text> [--domain <dom>])
    if subcommand == "route":
        hint_raw = str(ctx.values.get("hint") or (ctx.positionals[0] if ctx.positionals else "")).strip()
        if not hint_raw:
            return ctx.fail("Missing required flag: --hint <keywords>")

        domain_val = ctx.values.get("domain")
        domain_str = str(domain_val) if domain_val and is_valid_skill_domain(str(domain_val)) else None

        tables = load_routing_tables(repo_root)
        result = route_hint(hint_raw, domain_str, tables)
        code = ExitCodes.SUCCESS if result.get("route_id") else ExitCodes.CHECK_FAILURE
        return ctx.result(result, code=code)

    # 4. search (--query <q> [--domain <dom>] [--category <cat>] [--limit <N>])
    if subcommand == "search":
        query = str(ctx.values.get("query") or (ctx.positionals[0] if ctx.positionals else "")).strip()
        if not query:
            return ctx.fail("Missing required flag: --query <search terms>")

        catalog_file = repo_root / "plugin/catalog/skills.index.jsonl"
        catalog = load_catalog_from_file(catalog_file) if catalog_file.is_file() else generate_skill_index(skills_dir, None)

        domain = str(ctx.values["domain"]) if ctx.values.get("domain") else None
        category = str(ctx.values["category"]) if ctx.values.get("category") else None
        limit = int(ctx.values.get("limit", 10))

        search_res = search_catalog(catalog, query, domain, category, limit)
        return ctx.result(search_res, code=ExitCodes.SUCCESS)

    # 5. list ([--domain <dom>] [--category <cat>] [--offset <N>] [--limit <N>])
    if subcommand == "list":
        catalog_file = repo_root / "plugin/catalog/skills.index.jsonl"
        catalog = load_catalog_from_file(catalog_file) if catalog_file.is_file() else generate_skill_index(skills_dir, None)

        domain = str(ctx.values["domain"]) if ctx.values.get("domain") else None
        category = str(ctx.values["category"]) if ctx.values.get("category") else None
        offset = int(ctx.values.get("offset", 0))
        limit = int(ctx.values.get("limit", 20))

        list_res = list_catalog(catalog, domain, category, offset, limit)
        return ctx.result(list_res, code=ExitCodes.SUCCESS)

    # 6. load (--name <id> [--asset-path <path>])
    if subcommand == "load":
        name = str(ctx.values.get("name") or (ctx.positionals[0] if ctx.positionals else "")).strip()
        if not name:
            return ctx.fail("Missing required flag: --name <skill-id>")

        asset_path = ctx.values.get("asset-path") or ctx.values.get("asset_path")
        if asset_path:
            try:
                asset_res = load_asset(name, str(asset_path), skills_dir)
                return ctx.result(asset_res, code=ExitCodes.SUCCESS)
            except Exception as e:
                return ctx.result({}, code=ExitCodes.CHECK_FAILURE, errors=[str(e)])

        load_res = load_skill(name, skills_dir)
        code = ExitCodes.SUCCESS if "content" in load_res else ExitCodes.CHECK_FAILURE
        return ctx.result(load_res, code=code)

    # 7. asset-load / read-asset (--uri <skill://...>)
    if subcommand in ("asset-load", "read-asset"):
        raw_uri = str(ctx.values.get("uri") or (ctx.positionals[0] if ctx.positionals else "")).strip()
        if not raw_uri:
            return ctx.fail("Error: --uri <skill://...> is required")

        res = resolve_skill_uri(raw_uri, corpus_dir)
        if not res.get("exists") or not res.get("resolvedPath"):
            return ctx.result({"uri": raw_uri, "error": res.get("error")}, code=ExitCodes.CHECK_FAILURE, errors=[str(res.get("error"))])

        p = Path(res["resolvedPath"])
        raw_bytes = p.read_bytes()
        max_bytes = 512 * 1024
        truncated = len(raw_bytes) > max_bytes
        slice_bytes = raw_bytes[:max_bytes] if truncated else raw_bytes
        content = slice_bytes.decode("utf-8", errors="replace")

        output = {
            "uri": raw_uri,
            "path": res["resolvedPath"],
            "content": content,
            "sizeBytes": len(raw_bytes),
            "truncated": truncated,
        }
        return ctx.result(output, code=ExitCodes.SUCCESS)

    # 8. index
    if subcommand == "index":
        if not skills_dir.is_dir():
            return ctx.result({}, code=ExitCodes.ENVIRONMENT_UNAVAILABLE, errors=[f"Skills directory '{skills_dir}' not found."])
        records = generate_skill_index(skills_dir, None)
        return ctx.result({"count": len(records), "entries": records}, code=ExitCodes.SUCCESS)

    # 9. check
    if subcommand == "check":
        target_dir = skills_dir if skills_dir.is_dir() else corpus_dir
        errors: list[str] = []
        check_lang = bool(ctx.values.get("language"))

        validated_count = 0
        if target_dir.is_dir():
            for d in sorted(target_dir.iterdir()):
                if not d.is_dir():
                    continue
                skill_file = d / "SKILL.md"
                if not skill_file.is_file():
                    continue

                content = skill_file.read_text(encoding="utf-8", errors="replace")
                fm = parse_skill_frontmatter(content)
                if not fm:
                    errors.append(f"[{d.name}] Invalid frontmatter")
                    continue

                name = fm.get("name")
                if not name or name != d.name:
                    errors.append(f"[{d.name}] Name mismatch: {name}")

                if check_lang:
                    violations = detect_language_violations_in_file(skill_file)
                    for v in violations:
                        errors.append(f"[{d.name}:{v['line']}] {v['type']}: {v['match']}")

                validated_count += 1

        clean = len(errors) == 0
        code = ExitCodes.SUCCESS if clean else ExitCodes.CHECK_FAILURE
        return ctx.result({"totalValidated": validated_count, "clean": clean}, code=code, errors=errors)

    # 10. normalize
    if subcommand == "normalize":
        domain_f = str(ctx.values["domain"]) if ctx.values.get("domain") else None
        res = normalize_corpus(repo_root, write=is_write, domain_filter=domain_f)
        code = ExitCodes.SUCCESS if len(res.get("errors", [])) == 0 else ExitCodes.CHECK_FAILURE
        return ctx.result(res, code=code, errors=res.get("errors"))

    # 11. rename (--map <file>)
    if subcommand == "rename":
        map_file_val = ctx.values.get("map")
        if not map_file_val:
            msg = "Missing required flag: --map <file>. Specify rename map JSON file."
            return ctx.result({}, code=ExitCodes.CLI_USAGE_ERROR, errors=[msg])

        map_file = Path(str(map_file_val))
        if not map_file.is_file():
            msg = f"Missing or non-existent rename map file: '{map_file}'."
            return ctx.result({}, code=ExitCodes.CLI_USAGE_ERROR, errors=[msg])

        try:
            raw_map = json.loads(map_file.read_text(encoding="utf-8"))
        except Exception as e:
            return ctx.result({}, code=ExitCodes.CLI_USAGE_ERROR, errors=[f"Invalid map JSON: {e}"])

        rename_pairs = [(k, v) for k, v in raw_map.items() if k != v]

        if not is_write:
            return ctx.result(
                {"plannedRenames": len(rename_pairs), "pairs": rename_pairs[:20]},
                code=ExitCodes.SUCCESS,
            )

        # Apply renames across src/corpus
        for old_id, new_id in rename_pairs:
            old_dir = corpus_dir / old_id
            new_dir = corpus_dir / new_id
            if old_dir.is_dir() and not new_dir.exists():
                old_dir.rename(new_dir)

        # Update routing tables
        routing_files = [
            repo_root / "presets/re/routing.json",
            repo_root / "presets/webapp/routing.json",
            repo_root / "presets/mobile/routing.json",
            repo_root / "presets/red/routing.json",
        ]
        for rf in routing_files:
            if not rf.is_file():
                continue
            r_text = rf.read_text(encoding="utf-8")
            for old_id, new_id in rename_pairs:
                r_text = r_text.replace(f'"{old_id}"', f'"{new_id}"')
            rf.write_text(r_text, encoding="utf-8")

        # Update benchmark if present
        bench_file = repo_root / "tests/routing-benchmark.json"
        if bench_file.is_file():
            b_text = bench_file.read_text(encoding="utf-8")
            for old_id, new_id in rename_pairs:
                b_text = b_text.replace(f'"{old_id}"', f'"{new_id}"')
            bench_file.write_text(b_text, encoding="utf-8")

        return ctx.result({"appliedRenames": len(rename_pairs)}, code=ExitCodes.SUCCESS)

    # 12. dedup ([--apply-tier-a] [--apply-alias <key>])
    if subcommand == "dedup":
        manifest_data: dict[str, Any] | None = None
        if manifest_path.is_file():
            try:
                manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        candidate_inputs = [
            {
                "identifier": Path(f.get("destination_path") or f.get("path", "")).parent.name,
                "source": f.get("source", ""),
                "bytes": f.get("bytes", 0),
                "source_path": f.get("source_path") or f.get("path", ""),
            }
            for f in manifest_data.get("files", [])
            if f.get("status") in ("admitted", "deduplicated")
        ] if manifest_data else []

        tier_a_groups = (
            [g for g in manifest_data.get("dedup_groups", []) if g.get("tier") == "A"]
            if manifest_data and manifest_data.get("dedup_groups")
            else detect_tier_a_collision_groups(candidate_inputs)
        )

        aliases_file = repo_root / "presets/skills/dedup-aliases.json"
        aliases_data = load_tier_b_aliases(aliases_file)
        skill_names = {d.name for d in corpus_dir.iterdir() if d.is_dir()} if corpus_dir.is_dir() else set()
        tier_b_groups = detect_tier_b_groups(skill_names, aliases_data)
        all_groups = tier_a_groups + tier_b_groups
        summary = format_dedup_summary(all_groups)

        apply_tier_a = bool(ctx.values.get("apply-tier-a") or ctx.values.get("applyTierA"))
        if apply_tier_a and is_write and manifest_data and manifest_path.is_file():
            from arsenal.corpus.manifest import serialize_corpus_manifest
            manifest_data["dedup_groups"] = all_groups
            manifest_path.write_text(serialize_corpus_manifest(manifest_data), encoding="utf-8")

        return ctx.result(
            {
                "summary": summary,
                "tierAGroupsCount": len(tier_a_groups),
                "tierBGroupsCount": len(tier_b_groups),
                "tierAGroups": tier_a_groups[:30],
                "tierBGroups": tier_b_groups,
            },
            code=ExitCodes.SUCCESS,
        )

    # 13. scripts-audit ([--fix] [--write] [--domain <dom>] [--skill <id>])
    if subcommand == "scripts-audit":
        is_fix = bool(ctx.values.get("fix"))
        if is_fix and not is_write:
            msg = "skills scripts-audit --fix requires --write when invoked; refusing to mutate."
            return ctx.result({"requiredFlag": "--write"}, code=ExitCodes.MUTATION_REFUSED, errors=[msg])

        materialized_files = 0
        if is_fix:
            fix_res = plan_corpus_reference_materialization(repo_root, preview=False)
            materialized_files = fix_res.get("totalSupportFilesMaterialized", 0)

        domain_filter = str(ctx.values["domain"]) if ctx.values.get("domain") else None
        skill_filter = str(ctx.values.get("skill") or ctx.values.get("target") or "") or None

        if not corpus_dir.is_dir():
            msg = f"Corpus directory '{corpus_dir}' does not exist."
            return ctx.result({}, code=ExitCodes.CLI_USAGE_ERROR, errors=[msg])

        all_dirs = sorted([d.name for d in corpus_dir.iterdir() if d.is_dir() and (d / "SKILL.md").is_file()])
        skill_ids_to_scan = None
        if skill_filter:
            skill_ids_to_scan = [id for id in all_dirs if id == skill_filter]
            if not skill_ids_to_scan:
                return ctx.result({}, code=ExitCodes.CLI_USAGE_ERROR, errors=[f"Specified skill '{skill_filter}' does not exist in corpus."])
        elif domain_filter:
            skill_ids_to_scan = [id for id in all_dirs if id.startswith(f"{domain_filter}-")]
            if not skill_ids_to_scan:
                return ctx.result({}, code=ExitCodes.CLI_USAGE_ERROR, errors=[f"Specified domain '{domain_filter}' does not match any skills in corpus."])

        corpus_audit = audit_citations(corpus_dir, skill_ids_to_scan)
        diagnostics = corpus_audit.get("dangling", [])
        scanned = corpus_audit.get("playbooks_scanned", 0)

        clean = len(diagnostics) == 0
        exit_code = ExitCodes.SUCCESS if clean else ExitCodes.CHECK_FAILURE

        return ctx.result(
            {
                "totalSkillsConsidered": scanned,
                "totalSupportFilesMaterialized": materialized_files,
                "totalDanglingReferences": len(diagnostics),
                "categoryCounts": corpus_audit.get("category_counts", {}),
                "clean": clean,
                "danglingDiagnostics": diagnostics[:100],
                **({"fixed": True} if is_fix else {}),
            },
            code=exit_code,
            errors=[f"[{d['skill']}] Dangling: {d['raw']} in {d.get('file', 'SKILL.md')}:{d.get('line', 1)} -> {d.get('reason')}" for d in diagnostics],
        )

    # 14. coverage
    if subcommand == "coverage":
        domain_val = ctx.values.get("domain")
        if not domain_val or not is_valid_skill_domain(str(domain_val)):
            return ctx.fail(f"Missing or unknown --domain. Expected one of: {', '.join(DOMAINS)}.")

        report = build_coverage_report(str(domain_val), repo_root, skills_dir)
        return ctx.result(report, code=ExitCodes.SUCCESS)

    # 15. update (--target <id> [--from <file>])
    if subcommand == "update":
        target = ctx.values.get("target")
        if not target:
            msg = "Missing required flag: --target <id>"
            return ctx.result({}, code=ExitCodes.CLI_USAGE_ERROR, errors=[msg])

        target_id = str(target)
        from_file = ctx.values.get("from")

        presets_skill_path = repo_root / f"presets/skills/{target_id}/SKILL.md"
        corpus_skill_path = repo_root / f"src/corpus/{target_id}/SKILL.md"

        target_file_path = (
            presets_skill_path
            if presets_skill_path.is_file()
            else (corpus_skill_path if corpus_skill_path.is_file() else presets_skill_path)
        )

        candidate_content = ""
        if from_file and Path(str(from_file)).is_file():
            candidate_content = Path(str(from_file)).read_text(encoding="utf-8")
        elif target_file_path.is_file():
            candidate_content = target_file_path.read_text(encoding="utf-8")
        else:
            msg = f"Target skill '{target_id}' not found. Use 'arsenal skills new' to create a new skill."
            return ctx.result({}, code=ExitCodes.CLI_USAGE_ERROR, errors=[msg])

        parsed = parse_skill_document(candidate_content)
        if not parsed:
            msg = "Candidate content has invalid frontmatter structure."
            return ctx.result({}, code=ExitCodes.CHECK_FAILURE, errors=[msg])

        if not is_write:
            return ctx.result(
                {
                    "target": target_id,
                    "targetFilePath": str(target_file_path),
                    "description": parsed["data"].get("description"),
                },
                code=ExitCodes.SUCCESS,
            )

        target_file_path.parent.mkdir(parents=True, exist_ok=True)
        target_file_path.write_text(candidate_content, encoding="utf-8")
        return ctx.result(
            {
                "target": target_id,
                "targetFilePath": str(target_file_path),
                "written": True,
            },
            code=ExitCodes.SUCCESS,
        )

    # 16. new
    if subcommand == "new":
        domain_val = ctx.values.get("domain")
        slug_val = ctx.values.get("slug")
        if not domain_val or not slug_val:
            return ctx.fail("Usage: arsenal skills new --domain <re|webapp|mobile|red> --slug <name>")

        domain_str = str(domain_val)
        if not is_valid_skill_domain(domain_str):
            return ctx.fail(f"Invalid domain '{domain_str}'. Must be one of: {', '.join(DOMAINS)}")

        slug = str(slug_val).strip()
        if any(segment in slug.lower().split("-") or slug.lower().startswith(f"{segment}-") for segment in FORBIDDEN_VENDOR_SEGMENTS):
            return ctx.fail("Skill slug contains a forbidden vendor token.")
        canonical_id = derive_skill_id(domain_str, slug)
        target_base = repo_root / "presets/skills" if (repo_root / "presets/skills").is_dir() else corpus_dir
        target_dir = target_base / canonical_id
        if target_dir.exists():
            return ctx.fail(f"Skill '{canonical_id}' already exists at {target_dir}")

        if not is_write:
            return ctx.result({"id": canonical_id, "path": str(target_dir), "mode": "preview"}, code=ExitCodes.SUCCESS)

        target_dir.mkdir(parents=True, exist_ok=True)
        categories = get_declared_domain_categories(domain_str, repo_root)
        initial_fm = {
            "name": canonical_id,
            "description": f"Security analysis methodology for {canonical_id}.",
            "domain": domain_str,
            "category": categories[0] if categories else "general",
            "hide": True,
            "license": "MIT",
            "metadata": {"manifest_entry": f"presets/skills/{canonical_id}/SKILL.md"},
        }
        body = f"# {canonical_id}\n\n## Overview\nMethodology details.\n"
        doc = serialize_skill_document(initial_fm, body)
        (target_dir / "SKILL.md").write_text(doc, encoding="utf-8")

        return ctx.result({"id": canonical_id, "path": str(target_dir)}, code=ExitCodes.SUCCESS)

    # 17. internalize
    if subcommand == "internalize":
        res = internalize_corpus(repo_root, write=is_write)
        return ctx.result(res, code=ExitCodes.SUCCESS)

    # 18. reconcile
    if subcommand == "reconcile":
        if not manifest_path.is_file():
            return ctx.result({}, code=ExitCodes.ENVIRONMENT_UNAVAILABLE, errors=[f"MANIFEST.json missing at {manifest_path}"])
        res = reconcile_manifest(manifest_path, corpus_dir, write=is_write)
        code = ExitCodes.SUCCESS if len(res.get("remainingErrors", [])) == 0 else ExitCodes.CHECK_FAILURE
        return ctx.result(res, code=code)

    # 19. migrate-uris
    if subcommand == "migrate-uris":
        count = 0
        migrated_skills = 0
        if corpus_dir.is_dir():
            for d in sorted(corpus_dir.iterdir()):
                if not d.is_dir():
                    continue
                s_file = d / "SKILL.md"
                if not s_file.is_file():
                    continue
                content = s_file.read_text(encoding="utf-8")
                updated, n = migrate_skill_content(d.name, content)
                if n > 0:
                    count += n
                    migrated_skills += 1
                    if is_write:
                        s_file.write_text(updated, encoding="utf-8")
        return ctx.result({"migratedSkills": migrated_skills, "citationsUpdated": count}, code=ExitCodes.SUCCESS)

    # 20. sync-upstreams
    if subcommand == "sync-upstreams":
        results = sync_upstreams(repo_root, write=is_write)
        all_ready = all(r.get("status") in ("ready", "updated") for r in results)
        code = ExitCodes.SUCCESS if all_ready else ExitCodes.CHECK_FAILURE
        return ctx.result({"sources": results}, code=code)

    return ctx.fail(f"Unknown skills subcommand: '{subcommand}'")


def handle(ctx: Context) -> int:
    """Master entrypoint dispatched from arsenal CLI."""
    if ctx.family == "vendor":
        return handle_vendor(ctx)
    if ctx.family == "skills":
        return handle_skills(ctx)
    return ctx.fail(f"Unknown command family for skills engine: '{ctx.family}'")
