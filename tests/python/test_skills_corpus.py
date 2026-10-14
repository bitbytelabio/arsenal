"""Consumer acceptance test suite for Arsenal skill engine and corpus authoring.

Ports behavioral oracles and consumer invariants from:
- tests/us10-skill-standard.test.ts (naming, frontmatter, descriptions, catalog completeness)
- tests/us11-skill-update.test.ts (preview-by-default, update, new, rename, dedup)
- tests/corpus-durability.test.ts (manifest durability, support file integrity D-1/D-2)
- tests/reference-audit-recursive.test.ts (recursive reference extraction, URI resolution, scripts-audit)
- tests/us12-domain-coverage.test.ts (RT-1..RT-4 routing coverage, router token budgets, coverage reports)
"""

import json
from pathlib import Path
import tempfile

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
from arsenal.corpus.coverage import build_coverage_report, load_baseline, load_coverage_map
from arsenal.corpus.dedup import (
    apply_tier_b_aliases,
    detect_tier_a_collision_groups,
    detect_tier_b_groups,
    resolve_tier_a_winner,
)
from arsenal.corpus.frontmatter import (
    bound_description,
    normalize_description,
    parse_skill_document,
    parse_skill_frontmatter,
    serialize_skill_document,
    serialize_skill_frontmatter,
    split_frontmatter,
    validate_canonical_skill_frontmatter,
)
from arsenal.corpus.language import (
    detect_language_violations_in_file,
    detect_language_violations_in_line,
    detect_language_violations_in_text,
    has_language_residue,
    is_english_only,
)
from arsenal.corpus.manifest import (
    compute_manifest_summary,
    merge_corpus_manifest,
    read_corpus_manifest,
    serialize_corpus_manifest,
    validate_corpus_manifest,
    validate_support_file_integrity,
)
from arsenal.corpus.naming import (
    DOMAINS,
    MAX_SKILL_ID_LENGTH,
    ROUTER_ID_PATTERN,
    SKILL_ID_PATTERN,
    apply_declared_abbreviations,
    contains_forbidden_vendor_token,
    derive_skill_id,
    derive_skill_slug,
    is_router_skill_id,
    is_valid_skill_domain,
    is_valid_skill_id,
    parse_skill_id,
    remove_forbidden_vendor_segments,
    validate_skill_id,
)
from arsenal.corpus.normalize import (
    get_declared_domain_categories,
    normalize_corpus,
    normalize_skill_category,
    normalize_skill_document,
)
from arsenal.corpus.quarantine import evaluate_quarantine
from arsenal.corpus.reconcile import reconcile_manifest
from arsenal.corpus.references import (
    audit_citations,
    migrate_skill_content,
    parse_skill_uri,
    plan_corpus_reference_materialization,
    resolve_skill_uri,
)
from arsenal.corpus.routing import (
    ROUTER_COMBINED_TOKEN_BUDGET,
    ROUTER_TOKEN_BUDGET,
    compute_routing_coverage,
    count_router_category_lines,
    estimate_router_tokens,
    evaluate_routing_invariants,
    evaluate_table,
    load_routing_tables,
    render_router_body,
    route_hint,
)
from arsenal.corpus.sync import sync_upstreams
from arsenal import build
from arsenal import skills


# ==============================================================================
# 1. US10: Skill Standard & Corpus Invariants
# ==============================================================================

def test_us10_identifier_grammar_and_vendor_isolation() -> None:
    # Standard identifier grammar
    assert is_valid_skill_id("re-apk-reverse")
    assert is_valid_skill_id("webapp-sql-injection")
    assert is_valid_skill_id("mobile-frida-hook")
    assert is_valid_skill_id("red-active-directory")
    assert is_router_skill_id("arsenal-re-router")
    assert is_valid_skill_id("arsenal-re-router")

    # Invalidation on grammar
    assert not is_valid_skill_id("re-" + "a" * 65)  # exceeds 64 chars
    assert not is_valid_skill_id("invalid-prefix-skill")
    assert not is_valid_skill_id("re-UPPERCASE-IDENTIFIER")

    # Vendor token isolation
    vendor_ids = [
        "re-anthropic-analysis",
        "red-claude-red-kerberoasting",
        "webapp-xalgorix-injection",
        "mobile-strix-scanner",
        "re-revskill-technique",
    ]
    for vid in vendor_ids:
        assert contains_forbidden_vendor_token(vid), f"Failed to detect vendor token in {vid}"
        assert not is_valid_skill_id(vid)

    # Word-boundary safe pruning
    long_tech = "exploiting-insecure-data-storage-in-mobile-applications-and-backends"
    derived = derive_skill_slug(long_tech, "mobile")
    assert len(f"mobile-{derived}") <= MAX_SKILL_ID_LENGTH
    # Must never truncate mid-word
    assert not derived.endswith("mobi")
    assert not derived.endswith("-")


def test_us10_frontmatter_schema_and_description_fidelity() -> None:
    doc = """---
name: webapp-ssrf-probe
description: >
  Probe internal microservices using server-side request forgery (SSRF)
  to uncover unauthenticated metadata endpoints and sensitive keys.
domain: webapp
category: injection
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/webapp-ssrf-probe/SKILL.md
---
# SSRF Probe Methodology

Complete operational playbook prose.
"""
    parsed = parse_skill_document(doc)
    assert parsed is not None
    data = parsed["data"]

    # Descriptions must join folded lines without embedded newlines
    assert "\n" not in data["description"]
    assert len(data["description"]) >= 40
    assert len(data["description"]) <= 300

    # Must validate cleanly against draft 2020-12 schema
    valid, errors = validate_canonical_skill_frontmatter(data)
    assert valid, errors

    # Forbidden upstream metadata must fail validation
    data_with_upstream = dict(data)
    data_with_upstream["metadata"] = {"manifest_entry": "test", "upstream": "xalgorix"}
    valid_up, errors_up = validate_canonical_skill_frontmatter(data_with_upstream)
    assert not valid_up

    # Bounded description sentence boundary trimming
    sentence_desc = "First sentence of description. Second sentence is also valid. Third sentence gets trimmed away completely because it exceeds limit."
    b = bound_description(sentence_desc, 65)
    assert b == "First sentence of description. Second sentence is also valid."


def test_us10_language_residue_detection() -> None:
    assert has_language_residue("Tiếng Việt có dấu: không, được, người, phải, cần, thực")
    assert has_language_residue("Japanese / CJK residue: ソフトウェア")
    assert is_english_only("Clean English technical prose with numbers 123 and symbols -> =>.")

    # Skips code fences
    sample_md = """
Normal clean prose.

```python
# Payload or mock test vector containing unicode
vector = "こんにちは"
```

End of clean prose.
"""
    violations = detect_language_violations_in_text(sample_md)
    assert len(violations) == 0


# ==============================================================================
# 2. US11: Skill Content Update & Operator Authoring Lifecycle
# ==============================================================================

def test_us11_update_preview_and_write_safety() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_root = Path(tmpdir)
        corpus_dir = repo_root / "src/corpus"
        corpus_dir.mkdir(parents=True)

        target = "re-ida-reverse"
        target_dir = corpus_dir / target
        target_dir.mkdir()
        target_file = target_dir / "SKILL.md"

        original_content = """---
name: re-ida-reverse
description: Original IDA Pro reverse engineering methodology guidance.
domain: re
category: decompilation
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-ida-reverse/SKILL.md
---
# Original Body
"""
        target_file.write_text(original_content, encoding="utf-8")

        # 1. Preview mode (no mutation)
        ctx_preview = Context(
            family="skills",
            subcommand="update",
            positionals=[],
            values={"target": target},
            repo_root=repo_root,
            profile_dir=repo_root,
            mode="preview",
            is_json=True,
        )
        code = skills.handle(ctx_preview)
        assert code == ExitCodes.SUCCESS
        assert target_file.read_text(encoding="utf-8") == original_content

        # 2. Write mode with update candidate
        candidate_file = repo_root / "candidate.md"
        updated_content = original_content + "\n<!-- updated marker -->\n"
        candidate_file.write_text(updated_content, encoding="utf-8")

        ctx_write = Context(
            family="skills",
            subcommand="update",
            positionals=[],
            values={"target": target, "from": str(candidate_file)},
            repo_root=repo_root,
            profile_dir=repo_root,
            mode="write",
            is_json=True,
        )
        code = skills.handle(ctx_write)
        assert code == ExitCodes.SUCCESS
        assert target_file.read_text(encoding="utf-8") == updated_content


def test_us11_new_skill_scaffolding() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_root = Path(tmpdir)
        corpus_dir = repo_root / "src/corpus"
        corpus_dir.mkdir(parents=True)

        ctx_new = Context(
            family="skills",
            subcommand="new",
            positionals=[],
            values={"domain": "webapp", "slug": "idor-authz-audit"},
            repo_root=repo_root,
            profile_dir=repo_root,
            mode="write",
            is_json=True,
        )
        code = skills.handle(ctx_new)
        assert code == ExitCodes.SUCCESS

        created_file = corpus_dir / "webapp-idor-authz-audit/SKILL.md"
        assert created_file.is_file()
        fm = parse_skill_frontmatter(created_file.read_text(encoding="utf-8"))
        assert fm is not None
        assert fm["name"] == "webapp-idor-authz-audit"
        assert fm["domain"] == "webapp"


def test_us11_rename_operation() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_root = Path(tmpdir)
        corpus_dir = repo_root / "src/corpus"
        corpus_dir.mkdir(parents=True)
        presets_dir = repo_root / "presets/webapp"
        presets_dir.mkdir(parents=True)

        old_dir = corpus_dir / "webapp-old-slug"
        old_dir.mkdir()
        (old_dir / "SKILL.md").write_text("# Old\n", encoding="utf-8")

        routing_json = presets_dir / "routing.json"
        routing_json.write_text(
            json.dumps({"priority": ["r1"], "routes": {"r1": {"leaf": "webapp-old-slug"}}}),
            encoding="utf-8",
        )

        map_file = repo_root / "rename-map.json"
        map_file.write_text(json.dumps({"webapp-old-slug": "webapp-new-slug"}), encoding="utf-8")

        # Write rename
        ctx_rename = Context(
            family="skills",
            subcommand="rename",
            positionals=[],
            values={"map": str(map_file)},
            repo_root=repo_root,
            profile_dir=repo_root,
            mode="write",
            is_json=True,
        )
        code = skills.handle(ctx_rename)
        assert code == ExitCodes.SUCCESS

        assert not old_dir.exists()
        assert (corpus_dir / "webapp-new-slug").is_dir()
        # Routing table updated
        assert "webapp-new-slug" in routing_json.read_text(encoding="utf-8")


# ==============================================================================
# 3. Corpus Durability & Manifest Invariants
# ==============================================================================

def test_manifest_validation_invariants() -> None:
    manifest_data = {
        "schema_version": 1,
        "generator": "arsenal",
        "created_at": None,
        "summary": {
            "total_considered": 2,
            "admitted": 1,
            "quarantined": 0,
            "excluded": 0,
            "deduplicated": 1,
        },
        "sources": {
            "arsenal-local": {"repo": "presets/skills", "rev": None, "license": "Apache-2.0"},
            "reverse-skill": {"repo": "zhaoxuya520/reverse-skill", "rev": "cab634bd855fc287f6e420c1f36fd1a6b9245960", "license": "MIT"},
        },
        "files": [
            {
                "path": "skills/re-apk/SKILL.md",
                "source": "arsenal-local",
                "source_rev": None,
                "license": "Apache-2.0",
                "status": "admitted",
                "destination_path": "src/corpus/re-apk/SKILL.md",
                "sha256": "0" * 64,
                "bytes": 200,
            },
            {
                "path": "skills/dup/SKILL.md",
                "source": "reverse-skill",
                "source_rev": "cab634bd855fc287f6e420c1f36fd1a6b9245960",
                "license": "MIT",
                "status": "deduplicated",
                "superseded_by": "src/corpus/re-apk/SKILL.md",
                "reason": "Tier A duplicate",
            },
        ],
    }

    valid, errors = validate_corpus_manifest(manifest_data)
    assert valid, errors

    # IN-7: superseded_by must resolve to admitted entry
    tampered_manifest = json.loads(json.dumps(manifest_data))
    tampered_manifest["files"][1]["superseded_by"] = "src/corpus/non-existent/SKILL.md"
    valid_tamper, errors_tamper = validate_corpus_manifest(tampered_manifest)
    assert not valid_tamper
    assert any("IN-7" in e for e in errors_tamper)


def test_reconcile_manifest_integrity() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_root = Path(tmpdir)
        corpus_dir = repo_root / "src/corpus"
        corpus_dir.mkdir(parents=True)

        skill_dir = corpus_dir / "re-test"
        skill_dir.mkdir()
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text("# Test\n", encoding="utf-8")

        support_dir = skill_dir / "references"
        support_dir.mkdir()
        support_file = support_dir / "ref.md"
        support_file.write_text("Reference content\n", encoding="utf-8")

        manifest = {
            "schema_version": 1,
            "generator": "arsenal",
            "created_at": None,
            "summary": {"total_considered": 1, "admitted": 1, "quarantined": 0, "excluded": 0, "deduplicated": 0},
            "sources": {"arsenal-local": {"repo": "presets/skills", "rev": None, "license": "Apache-2.0"}},
            "files": [
                {
                    "path": "skills/re-test/SKILL.md",
                    "source": "arsenal-local",
                    "source_rev": None,
                    "license": "Apache-2.0",
                    "status": "admitted",
                    "destination_path": "src/corpus/re-test/SKILL.md",
                    "sha256": "oldhash",
                    "bytes": 0,
                    "support_files": [],
                }
            ],
        }
        manifest_file = corpus_dir / "MANIFEST.json"
        manifest_file.write_text(json.dumps(manifest), encoding="utf-8")

        res = reconcile_manifest(manifest_file, corpus_dir, write=True)
        assert res["updated"] > 0
        assert len(res["remainingErrors"]) == 0


# ==============================================================================
# 4. Reference Audit & Recursive URI Resolution
# ==============================================================================

def test_parse_skill_uri_canonical_and_invalid() -> None:
    valid_root = parse_skill_uri("skill://re-apk-reverse")
    assert valid_root["valid"]
    assert valid_root["skillId"] == "re-apk-reverse"
    assert valid_root["subpath"] == ""

    valid_sub = parse_skill_uri("skill://re-apk-reverse/references/checklist.md#section-1")
    assert valid_sub["valid"]
    assert valid_sub["skillId"] == "re-apk-reverse"
    assert valid_sub["subpath"] == "references/checklist.md"
    assert valid_sub["anchor"] == "section-1"

    # Doubled / nested skill://
    doubled = parse_skill_uri("skill://re-apk-reverse/skill://re-ida-reverse/references/foo.md")
    assert not doubled["valid"]
    assert "nested 'skill://'" in doubled["error"]

    # Traversal in subpath
    traversal = parse_skill_uri("skill://re-apk-reverse/../escaped.md")
    assert not traversal["valid"]


def test_scripts_audit_mutation_gate_and_verification() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_root = Path(tmpdir)
        corpus_dir = repo_root / "src/corpus"
        corpus_dir.mkdir(parents=True)

        skill_dir = corpus_dir / "re-target"
        skill_dir.mkdir()
        # Reference that points to nonexistent support file
        (skill_dir / "SKILL.md").write_text("# Target\nSee [Guide](references/nonexistent.md)\n", encoding="utf-8")

        # 1. --fix without --write must be refused (MUTATION_REFUSED, code 3)
        ctx_fix_no_write = Context(
            family="skills",
            subcommand="scripts-audit",
            positionals=[],
            values={"fix": True},
            repo_root=repo_root,
            profile_dir=repo_root,
            mode="check",
            is_json=True,
        )
        code = skills.handle(ctx_fix_no_write)
        assert code == ExitCodes.MUTATION_REFUSED

        # 2. Check mode reports dangling reference (exit code 1)
        ctx_check = Context(
            family="skills",
            subcommand="scripts-audit",
            positionals=[],
            values={},
            repo_root=repo_root,
            profile_dir=repo_root,
            mode="check",
            is_json=True,
        )
        code_check = skills.handle(ctx_check)
        assert code_check == ExitCodes.CHECK_FAILURE


# ==============================================================================
# 5. US12: Routing Coverage & Token Envelope Invariants
# ==============================================================================

def test_routing_invariants_and_token_budget() -> None:
    mock_table = {
        "schemaVersion": "1.0",
        "meta": {"domain": "webapp", "description": "Web app routing router", "fallbackId": "w-general"},
        "categories": ["injection", "traversal"],
        "priority": ["w-sqli", "w-general"],
        "routes": {
            "w-sqli": {"id": "w-sqli", "leaf": "webapp-sql-injection", "category": "injection", "must": "sql"},
            "w-general": {"id": "w-general", "leaf": "webapp-general", "category": "traversal", "must": "traversal"},
        },
    }

    body = render_router_body(mock_table)
    tokens = estimate_router_tokens(body)
    assert tokens <= ROUTER_TOKEN_BUDGET

    # Invariant evaluation
    violations = evaluate_routing_invariants({"webapp": mock_table})
    assert len(violations) == 0

    # RT-1 failure: declared category without route
    broken_table = json.loads(json.dumps(mock_table))
    broken_table["categories"].append("unrouted-category")
    broken_violations = evaluate_routing_invariants({"webapp": broken_table})
    assert any(v["invariant"] == "RT-1" for v in broken_violations)


# ==============================================================================
# 6. Build Orchestration Contract
# ==============================================================================

def test_build_orchestration_execute_and_verify() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_root = Path(tmpdir)
        corpus_dir = repo_root / "src/corpus"
        corpus_dir.mkdir(parents=True)
        presets_root = repo_root / "presets"
        presets_root.mkdir(parents=True)

        for d in DOMAINS:
            d_dir = presets_root / d
            d_dir.mkdir(parents=True)
            (d_dir / "routing.json").write_text(
                json.dumps({
                    "meta": {"domain": d, "description": f"{d} router"},
                    "categories": ["cat1"],
                    "priority": ["r1"],
                    "routes": {"r1": {"id": "r1", "leaf": f"{d}-playbook", "category": "cat1", "must": "test"}},
                }),
                encoding="utf-8",
            )

        # Admitted skill
        s1 = corpus_dir / "re-playbook"
        s1.mkdir()
        (s1 / "SKILL.md").write_text("# Playbook\n", encoding="utf-8")

        out_plugin = repo_root / "plugin"

        ctx_build = Context(
            family="build",
            subcommand=None,
            positionals=[],
            values={"out": str(out_plugin)},
            repo_root=repo_root,
            profile_dir=repo_root,
            mode="write",
            is_json=True,
        )
        code = build.handle(ctx_build)
        assert code == ExitCodes.SUCCESS

        # Assert output directories and files
        assert (out_plugin / "skills/re-playbook/SKILL.md").is_file()
        assert (out_plugin / "skills/arsenal-re-router/SKILL.md").is_file()
        assert (out_plugin / "catalog/skills.index.jsonl").is_file()
        assert (out_plugin / "package.json").is_file()
        assert (out_plugin / "plugin.json").is_file()
        assert (out_plugin / ".mcp.json").is_file()


def test_detect_tier_b_groups_reports_string_aliases() -> None:
    pending = detect_tier_b_groups({"red-old", "webapp-new"}, {"aliases": {"red-old": "webapp-new"}})
    assert len(pending) == 1
    assert pending[0]["tier"] == "B"
    assert pending[0]["members"] == ["red-old", "webapp-new"]
    assert pending[0]["applied"] is False

    applied = detect_tier_b_groups({"webapp-new"}, {"aliases": {"red-old": "webapp-new"}})
    assert len(applied) == 1
    assert applied[0]["members"] == ["webapp-new"]
    assert applied[0]["applied"] is True

    broken = detect_tier_b_groups({"red-old"}, {"aliases": {"red-old": "webapp-new"}})
    assert broken == []


def test_apply_tier_b_aliases_prunes_deprecated_and_marks_manifest() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_root = Path(tmpdir)
        corpus_dir = repo_root / "src/corpus"
        for name in ("red-old-skill", "webapp-new-skill"):
            (corpus_dir / name).mkdir(parents=True)
            (corpus_dir / name / "SKILL.md").write_text(f"# {name}\n", encoding="utf-8")

        manifest_path = corpus_dir / "MANIFEST.json"
        manifest = {
            "schema_version": 1,
            "generator": "arsenal",
            "created_at": None,
            "summary": {
                "total_considered": 2,
                "admitted": 2,
                "quarantined": 0,
                "excluded": 0,
                "deduplicated": 0,
            },
            "sources": {"arsenal-local": {"repo": "local", "rev": None, "license": "MIT"}},
            "files": [
                {
                    "path": "red-old-skill/SKILL.md",
                    "source": "arsenal-local",
                    "source_rev": None,
                    "license": "MIT",
                    "status": "admitted",
                    "destination_path": "src/corpus/red-old-skill/SKILL.md",
                    "sha256": "a" * 64,
                    "bytes": 10,
                    "source_path": "red-old-skill/SKILL.md",
                    "source_sha256": "b" * 64,
                },
                {
                    "path": "webapp-new-skill/SKILL.md",
                    "source": "arsenal-local",
                    "source_rev": None,
                    "license": "MIT",
                    "status": "admitted",
                    "destination_path": "src/corpus/webapp-new-skill/SKILL.md",
                    "sha256": "c" * 64,
                    "bytes": 12,
                    "source_path": "webapp-new-skill/SKILL.md",
                    "source_sha256": "d" * 64,
                },
            ],
        }
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        aliases = {"aliases": {"red-old-skill": "webapp-new-skill"}}
        result = apply_tier_b_aliases(corpus_dir, manifest_path, aliases)

        assert result["errors"] == []
        assert [row["key"] for row in result["applied"]] == ["red-old-skill"]
        assert result["manifestEntriesUpdated"] == 1
        assert result["dedupGroupsAdded"] == 1
        assert not (corpus_dir / "red-old-skill").exists()

        updated = json.loads(manifest_path.read_text(encoding="utf-8"))
        flipped = next(entry for entry in updated["files"] if entry["path"] == "red-old-skill/SKILL.md")
        assert flipped["status"] == "deduplicated"
        assert flipped["superseded_by"] == "src/corpus/webapp-new-skill/SKILL.md"
        assert flipped["reason"] == "tier B operator alias (red-old-skill -> webapp-new-skill)"
        assert "destination_path" not in flipped
        assert "sha256" not in flipped
        assert "bytes" not in flipped
        assert updated["summary"] == {
            "total_considered": 2,
            "admitted": 1,
            "quarantined": 0,
            "excluded": 0,
            "deduplicated": 1,
        }
        groups = [group for group in updated["dedup_groups"] if group["key"] == "red-old-skill"]
        assert len(groups) == 1
        assert groups[0]["tier"] == "B"
        assert groups[0]["members"] == ["red-old-skill", "webapp-new-skill"]
        assert groups[0]["winner"] == "webapp-new-skill"
        assert groups[0]["applied"] is True

        # Second run is a no-op and must not duplicate groups.
        again = apply_tier_b_aliases(corpus_dir, manifest_path, aliases)
        assert again["errors"] == []
        assert again["applied"] == []
        assert again["skipped"] == [{"key": "red-old-skill", "reason": "already applied"}]
        assert again["dedupGroupsAdded"] == 0
        reloaded = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert len([group for group in reloaded["dedup_groups"] if group["key"] == "red-old-skill"]) == 1

        # Missing canonical target aborts without mutating anything.
        (corpus_dir / "orphan-skill").mkdir()
        bad = apply_tier_b_aliases(corpus_dir, manifest_path, {"aliases": {"orphan-skill": "re-missing-skill"}})
        assert bad["applied"] == []
        assert bad["errors"] and "does not exist" in bad["errors"][0]
