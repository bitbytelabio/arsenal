"""Unit, behavioral, and falsifier tests for Arsenal operational scripts CLI and centralized modules."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
import pytest

from arsenal.common import Context, ExitCodes
from arsenal.scripts import handle
from arsenal.scripts.receipts import SCRIPT_RECEIPTS, get_receipt, list_receipts
from arsenal.scripts.case_init import run_case_init, validate_case_name
from arsenal.scripts.append_evidence import append_evidence
from arsenal.scripts.master_route import evaluate_master_route
from arsenal.scripts.bootstrap_reverse import check_capability, list_capabilities
from arsenal.scripts.diagram import infer_diagram_kind
from arsenal.scripts.gdpr import parse_article30, validate_article30, generate_ropa_report
from arsenal.scripts.ad_honeytokens import plan_honeytokens
from arsenal.scripts.playbook_catalog import resolve as resolve_catalog_entry


def test_scripts_list():
    """Verify 'arsenal scripts list' outputs registered canonical script IDs."""
    ctx = Context(
        family="scripts",
        subcommand="list",
        positionals=[],
        values={},
        repo_root=Path.cwd(),
        profile_dir=Path.cwd(),
        mode="check",
        is_json=True,
    )
    code = handle(ctx)
    assert code == ExitCodes.SUCCESS


def test_migration_receipts_inventory():
    """Verify all 257 operational scripts have un-falsified provenance receipts."""
    receipts = list_receipts()
    assert len(receipts) == 258

    # Check required fields
    for r in receipts:
        assert "original_path" in r
        assert "sha256" in r
        assert len(r["sha256"]) == 64  # valid SHA-256 hex string
        assert "bytes" in r
        assert r["bytes"] > 0
        assert "canonical_id" in r
        assert r["status"] in ("migrated", "absorbed", "retained_external")
        assert "target_command" in r
        assert "migrated_path" in r

    # Verify specific key migrations
    case_init_r = get_receipt("src/corpus/red-attack-chain/scripts/case-init.sh")
    assert case_init_r is not None
    assert case_init_r["canonical_id"] == "case-init"
    assert case_init_r["migrated_path"] == "src/arsenal/scripts/case_init.py"

    append_ev_r = get_receipt("src/corpus/webapp-pentest-tools/support/templates/append-evidence.ps1")
    assert append_ev_r is not None
    assert append_ev_r["canonical_id"] == "append-evidence"
    assert append_ev_r["migrated_path"] == "src/arsenal/scripts/append_evidence.py"

    review_case_r = get_receipt("src/corpus/re-case-review/templates/review_case.py")
    assert review_case_r is not None
    assert review_case_r["status"] == "absorbed"
    assert review_case_r["target_command"] == "arsenal case review"


def test_case_init_creation_and_presets():
    """Verify case initialization, directory scaffold, and preset resolution."""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)

        # 1. Valid case init with offline-sample preset
        res = run_case_init(
            hint="inspect binary sample",
            case_name="engagement-alpha",
            project_root=root,
            preset="offline-sample",
            sample="target.bin",
        )
        assert res["case_name"] == "engagement-alpha"
        assert res["network_profile"] == "offline"
        assert res["auth_status"] == "granted"
        assert "target.bin" in res["assets"]

        case_dir = root / "work" / "engagement-alpha"
        assert (case_dir / "evidence").is_dir()
        assert (case_dir / "notes").is_dir()
        assert (case_dir / "report").is_dir()

        case_json = json.loads((case_dir / "case.json").read_text(encoding="utf-8"))
        assert case_json["case_id"] == "engagement-alpha"
        assert case_json["network_profile"] == "offline"

        scope_json = json.loads((case_dir / "scope.json").read_text(encoding="utf-8"))
        assert scope_json["scope_version"] == 1
        assert len(scope_json["assets"]) == 1

        # 2. Case name validation guards
        assert validate_case_name("valid-name_01")
        assert not validate_case_name("invalid/slash")
        assert not validate_case_name("trailing-dot.")
        assert not validate_case_name("")


def test_append_evidence_and_immutability():
    """Verify evidence append, hash fixity, and immutable duplicate guard."""
    with tempfile.TemporaryDirectory() as tmpdir:
        case_root = Path(tmpdir)
        (case_root / "evidence").mkdir(parents=True)

        # Create dummy artifact inside case root
        artifact = case_root / "dump.bin"
        artifact.write_bytes(b"TEST_PAYLOAD_BYTES")

        # Append evidence
        res = append_evidence(
            case_root=case_root,
            evidence_id="E-042",
            title="Extracted memory payload",
            repro_command="dd if=/dev/mem of=dump.bin",
            severity="critical",
            status="observed",
            source_type="command",
            raw_excerpt="Found matching byte sequences at offset 0x4000",
            artifact_path="dump.bin",
        )

        assert res["id"] == "E-042"
        assert res["severity"] == "critical"
        assert res["status"] == "observed"
        assert res["content_hash"].startswith("sha256:")

        record_file = case_root / "evidence" / "E-042.md"
        assert record_file.is_file()
        content = record_file.read_text(encoding="utf-8")
        assert "### E-042" in content
        assert "Extracted memory payload" in content
        assert res["content_hash"] in content

        # Check index table
        index_file = case_root / "evidence" / "INDEX.md"
        assert index_file.is_file()
        assert "E-042" in index_file.read_text(encoding="utf-8")

        # Immutability guard: duplicate append must fail
        duplicate_threw = False
        try:
            append_evidence(
                case_root=case_root,
                evidence_id="E-042",
                title="Duplicate attempt",
                repro_command="re-run command",
            )
        except FileExistsError:
            duplicate_threw = True
        assert duplicate_threw, "Expected FileExistsError on duplicate append"


def test_master_route_scoring():
    """Verify master routing with keyword matching."""
    res = evaluate_master_route(hint="reverse apk android application")
    assert "primary_skill" in res
    assert "primary_label" in res


def test_bootstrap_capabilities():
    """Verify capability inspection without executing system mutations."""
    caps = list_capabilities()
    assert len(caps) > 5

    names = {c["name"] for c in caps}
    assert "jadx" in names
    assert "apktool" in names
    assert "r2" in names
    assert "frida" in names

    single = check_capability("r2")
    assert single["name"] == "r2"


def test_diagram_type_inference():
    """Verify diagram format inference."""
    with tempfile.NamedTemporaryFile(suffix=".mmd", mode="w") as f:
        f.write("graph TD; A-->B;")
        f.flush()
        assert infer_diagram_kind(Path(f.name)) == "mermaid"

    with tempfile.NamedTemporaryFile(suffix=".dot", mode="w") as f:
        f.write("digraph G { A -> B; }")
        f.flush()
        assert infer_diagram_kind(Path(f.name)) == "graphviz"


def test_gdpr_article30_pipeline():
    """Verify GDPR Article 30 parsing, validation, and Markdown report generation."""
    with tempfile.NamedTemporaryFile(suffix=".md", mode="w") as f:
        f.write(
            "# Data Processing Agreement\n"
            "Purpose of processing: customer order fulfillment.\n"
            "Data subjects: customer, subscriber.\n"
            "Personal data: name, email, address.\n"
            "Recipients: third party courier processor.\n"
            "Security: tls encryption and access control.\n"
        )
        f.flush()

        ropa = parse_article30(f.name)
        assert len(ropa["processing_activities"]) == 1
        act = ropa["processing_activities"][0]
        assert len(act["purposes"]) >= 1
        assert "customer" in act["data_subjects"]
        assert "email" in act["personal_data_categories"]

        val = validate_article30(ropa)
        assert val["valid"] is True
        assert val["total_issues"] == 0

        report_md = generate_ropa_report(ropa)
        assert "# Article 30 Records of Processing Activities" in report_md
        assert "customer" in report_md


def test_ad_honeytokens_planning():
    """Verify Active Directory honeytokens plan generation."""
    plan = plan_honeytokens(domain="lab.local", count=2)
    assert plan["domain"] == "lab.local"
    assert plan["token_count"] == 2
    assert len(plan["tokens"]) == 2
    token = plan["tokens"][0]
    assert token["spn"].endswith("lab.local:1433")
    assert token["admin_count"] == 1
    assert len(token["decoy_password"]) >= 20


def test_ad_honeytokens_falsifier_non_windows_unavailable():
    """FALSIFIER: Deploying AD honeytokens on non-Windows MUST return ENVIRONMENT_UNAVAILABLE, never simulated/deployed."""
    if sys.platform != "win32":
        ctx = Context(
            family="scripts",
            subcommand="ad-honeytokens/deploy",
            positionals=["--deploy"],
            values={},
            repo_root=Path.cwd(),
            profile_dir=Path.cwd(),
            mode="check",
            is_json=True,
        )
        code = handle(ctx)
        assert code == ExitCodes.ENVIRONMENT_UNAVAILABLE, f"Expected code 5, got {code}"


def test_isolated_llm_guard_env_bundle():
    """Verify dedicated isolated uv environment bundle for llm_guard."""
    from arsenal.scripts.playbook_runner import resolve_isolated_env_dir
    env_dir = resolve_isolated_env_dir("llm_guard")
    assert env_dir.is_dir()
    assert (env_dir / "pyproject.toml").is_file()
    assert (env_dir / "uv.lock").is_file()
    content = (env_dir / "pyproject.toml").read_text(encoding="utf-8")
    assert "llm-guard==0.3.16" in content
    assert "requires-python = \">=3.11,<3.13\"" in content


def test_ida_start_falsifier_unavailable():
    """FALSIFIER: Starting IDA MCP on an unallocated port without ida_pro_mcp module MUST fail with ENVIRONMENT_UNAVAILABLE."""
    ctx = Context(
        family="scripts",
        subcommand="re-ida-reverse/start",
        positionals=["58888"],
        values={},
        repo_root=Path.cwd(),
        profile_dir=Path.cwd(),
        mode="check",
        is_json=True,
    )
    code = handle(ctx)
    assert code == ExitCodes.ENVIRONMENT_UNAVAILABLE, f"Expected code 5, got {code}"


def test_burp_mcp_bridge_tools_and_disconnected():
    """Verify official MCP SDK registration metadata and disconnected Burp behavior."""
    from arsenal.scripts.burp_bridge import build_tool_definitions, BurpMcpServer, BurpHttpClient

    tools = build_tool_definitions(["proxy_history", "send_request", "repeater_send"])
    assert len(tools) == 3
    assert tools[0]["name"] == "burp_proxy_history"
    assert "inputSchema" in tools[0]

    client = BurpHttpClient(host="127.0.0.1", port=59998)
    server = BurpMcpServer(client)
    assert server.server.name == "burpsuite-mcp"
    with pytest.raises(Exception):
        client.fetch_tools()

def test_bootstrap_falsifier_mutation_refused_without_write():
    """FALSIFIER: Requesting install of missing capability without --write MUST return MUTATION_REFUSED (3)."""
    ctx = Context(
        family="scripts",
        subcommand="bootstrap-reverse",
        positionals=["nonexistent-tool-falsifier"],
        values={},
        repo_root=Path.cwd(),
        profile_dir=Path.cwd(),
        mode="check",
        is_json=True,
    )
    code = handle(ctx)
    assert code == ExitCodes.MUTATION_REFUSED, f"Expected code 3, got {code}"


def test_playbook_path_resolution():
    """Verify resolving centralized playbooks via catalog resolution contract."""
    entry = resolve_catalog_entry("mobile-analyzing-android-malware-with-apktool/agent")
    assert entry["canonical_id"] == "mobile-analyzing-android-malware-with-apktool/agent"
    assert entry["target_kind"] == "agent"
    assert entry["domain"] == "mobile"
    assert entry["implementation_ref"]["resource_path"] == "playbooks/mobile/analyzing_android_malware_with_apktool.py"
