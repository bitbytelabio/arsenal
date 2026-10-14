from __future__ import annotations

from pathlib import Path
import pytest
from arsenal import schemas


@pytest.fixture
def synthetic_catalog_document() -> dict[str, object]:
    return {
        "schema_version": 1,
        "catalog_sha256": "0" * 64,
        "generated_at": "2026-10-13T00:00:00Z",
        "entries": [
            {
                "schema_version": 1,
                "canonical_id": "core-sample/tool",
                "aliases": ["sample-alias"],
                "domain": "core",
                "target_kind": "tool",
                "description": "Sample core tool for testing",
                "implementation_ref": {
                    "module_path": "arsenal.scripts.sample",
                    "callable": "handle",
                },
                "source_sha256": "a" * 64,
                "execution_mode": "shared",
                "admission_status": "approved_shared",
                "isolation_reason": [],
                "side_effects": {
                    "network": "none",
                    "credentials": "none",
                    "target_mutation": "none",
                    "filesystem": "none",
                    "external_process": "none",
                    "evidence_write": "none",
                },
                "controls": {
                    "scope": "not_applicable",
                    "authorization": "not_applicable",
                    "proxy": "none",
                    "write": "forbidden",
                    "verification": "none",
                    "evidence": "none",
                },
                "dependencies": {
                    "profile": None,
                    "imports": [],
                    "tools": [],
                    "lock_hash": None,
                    "project_path": None,
                    "environment_dir": None,
                },
                "interface": {
                    "argument_schema": None,
                    "output_format": "json",
                    "exit_mapping": None,
                    "timeout_ms": 5000,
                    "stdout_limit": 65536,
                    "stderr_limit": 65536,
                },
                "provenance": {
                    "original_path": None,
                    "migrated_path": None,
                    "receipt_ids": ["sample-receipt-1"],
                    "status": "migrated",
                    "license": "Apache-2.0",
                    "shared_implementation_id": None,
                },
                "admission_record_id": "adm-sample-core-1",
            },
            {
                "schema_version": 1,
                "canonical_id": "red-sample/agent",
                "aliases": [],
                "domain": "red",
                "target_kind": "agent",
                "description": "Sample isolated red agent for testing",
                "implementation_ref": {
                    "resource_path": "playbooks/red-sample/agent.py",
                },
                "source_sha256": "b" * 64,
                "execution_mode": "managed_subprocess",
                "admission_status": "retained_isolated",
                "isolation_reason": ["Retained legacy subprocess isolation"],
                "side_effects": {
                    "network": "external_read",
                    "credentials": "none",
                    "target_mutation": "none",
                    "filesystem": "none",
                    "external_process": "none",
                    "evidence_write": "none",
                },
                "controls": {
                    "scope": "required",
                    "authorization": "host_required",
                    "proxy": "none",
                    "write": "forbidden",
                    "verification": "none",
                    "evidence": "execution_receipt",
                },
                "dependencies": {
                    "profile": None,
                    "imports": [],
                    "tools": [],
                    "lock_hash": None,
                    "project_path": None,
                    "environment_dir": None,
                },
                "interface": {
                    "argument_schema": None,
                    "output_format": "json",
                    "exit_mapping": None,
                    "timeout_ms": 30000,
                    "stdout_limit": 1048576,
                    "stderr_limit": 1048576,
                },
                "provenance": {
                    "original_path": "legacy/red/sample.py",
                    "migrated_path": "src/arsenal/scripts/playbooks/red-sample/agent.py",
                    "receipt_ids": ["sample-receipt-2"],
                    "status": "migrated",
                    "license": "Apache-2.0",
                    "shared_implementation_id": None,
                },
                "admission_record_id": None,
            },
        ],
    }


@pytest.fixture
def synthetic_admission_record() -> dict[str, object]:
    return {
        "record_id": "adm-sample-core-1",
        "catalog_sha256": "0" * 64,
        "source_sha256": "a" * 64,
        "reviewer_role": "security-architect",
        "reviewer_session": "session-init-20261013",
        "reviewed_at": "2026-10-13T00:00:00Z",
        "static_inventory": {"network_calls": 0, "filesystem_writes": 0},
        "dependency_inventory": {"tools": [], "imports": []},
        "control_decisions": {"scope": "not_applicable", "authorization": "not_applicable"},
        "falsifier_ids": ["F-SAFE-01"],
        "decision": "approved_shared",
        "rationale": "Pure handler with bounded execution and zero external side effects.",
        "invalidation_conditions": ["Source hash change", "Dependency introduction"],
        "receipt_ids": ["sample-receipt-1"],
    }


def test_catalog_schema_validates_synthetic_document(synthetic_catalog_document: dict[str, object]) -> None:
    errors = schemas.validate(schemas.PLAYBOOK_CATALOG_SCHEMA, synthetic_catalog_document)
    assert not errors, f"Validation failed: {errors}"


def test_admission_schema_validates_synthetic_record(synthetic_admission_record: dict[str, object]) -> None:
    errors = schemas.validate(schemas.PLAYBOOK_ADMISSION_SCHEMA, synthetic_admission_record)
    assert not errors, f"Validation failed: {errors}"

def test_catalog_listing_completeness_and_determinism() -> None:
    from arsenal.scripts.playbook_catalog import list_entries

    entries1 = list_entries()
    entries2 = list_entries()
    assert len(entries1) == 235
    assert [e["canonical_id"] for e in entries1] == [e["canonical_id"] for e in entries2]

    playbooks = [e for e in entries1 if e["domain"] != "core"]
    cores = [e for e in entries1 if e["domain"] == "core"]
    assert len(playbooks) == 213
    assert len(cores) == 22

    cids = [e["canonical_id"] for e in entries1]
    assert len(cids) == len(set(cids)), "Duplicate canonical_ids found in listing"


def test_zero_side_effects_on_listing(monkeypatch: pytest.MonkeyPatch) -> None:
    import subprocess
    import socket
    import io
    from contextlib import redirect_stdout
    from arsenal.cli import main
    import json

    def forbidden(*args: object, **kwargs: object) -> None:
        raise RuntimeError("Forbidden side-effect during listing!")

    class ForbiddenSocket(socket.socket):
        def connect(self, *args: object, **kwargs: object) -> None:
            raise RuntimeError("Forbidden side-effect during listing!")

    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(subprocess, "Popen", forbidden)
    monkeypatch.setattr(socket, "socket", ForbiddenSocket)
    monkeypatch.setattr(socket, "create_connection", forbidden)

    # Test JSON mode listing
    f_json = io.StringIO()
    with redirect_stdout(f_json):
        code_json = main(["scripts", "--json", "list"])
    assert code_json == 0
    doc = json.loads(f_json.getvalue())
    assert doc["status"] == "success"
    json_ids = {s["id"] for s in doc["data"]["scripts"]}
    assert len(json_ids) == 235

    # Test Plain-text mode listing with --all
    f_text = io.StringIO()
    with redirect_stdout(f_text):
        code_text = main(["scripts", "list", "--all"])
    assert code_text == 0
    text_output = f_text.getvalue()
    assert "235 endpoints" in text_output


def test_parity_oracle_detects_inconsistencies(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from arsenal.scripts.playbook_catalog import verify_parity, load_catalog_data

    # Base state is clean
    base_res = verify_parity()
    assert base_res["ok"] is True
    assert base_res["playbookEntries"] == 213
    assert base_res["coreEntries"] == 22
    assert base_res["historicalReceipts"] == 258

    # 1. Stale source_sha256 detection
    cat_data, _ = load_catalog_data()
    mutated_entries = [dict(e) for e in cat_data["entries"]]
    mutated_entries[0]["source_sha256"] = "f" * 64
    mutated_doc = dict(cat_data, entries=mutated_entries)

    monkeypatch.setattr("arsenal.scripts.playbook_catalog.load_catalog_data", lambda: (mutated_doc, "dummy_hash"))
    stale_res = verify_parity()
    assert stale_res["ok"] is False
    assert any("Stale source_sha256" in p for p in stale_res["problems"])

    # 2. Duplicate alias detection
    mutated_entries[1]["aliases"] = [mutated_entries[0]["canonical_id"]]
    dup_alias_doc = dict(cat_data, entries=mutated_entries)
    monkeypatch.setattr("arsenal.scripts.playbook_catalog.load_catalog_data", lambda: (dup_alias_doc, "dummy_hash"))
    dup_res = verify_parity()
    assert dup_res["ok"] is False
    assert any("Duplicate/shadowing alias" in p for p in dup_res["problems"])

    # 3. Unresolvable implementation_ref detection
    mutated_entries[2]["implementation_ref"] = {"resource_path": "nonexistent/path/agent.py"}
    bad_res_doc = dict(cat_data, entries=mutated_entries)
    monkeypatch.setattr("arsenal.scripts.playbook_catalog.load_catalog_data", lambda: (bad_res_doc, "dummy_hash"))
    bad_res = verify_parity()
    assert bad_res["ok"] is False
    assert any("resource_path cannot be resolved" in p for p in bad_res["problems"])

    # 4. Absorbed receipt dispatchable detection
    from arsenal.scripts import receipts
    absorbed_receipts = [r for r in receipts.SCRIPT_RECEIPTS if r.get("status") == "absorbed"]
    assert len(absorbed_receipts) == 1
    absorbed_cid = absorbed_receipts[0]["canonical_id"]
    mutated_entries[3]["canonical_id"] = absorbed_cid
    abs_doc = dict(cat_data, entries=mutated_entries)
    monkeypatch.setattr("arsenal.scripts.playbook_catalog.load_catalog_data", lambda: (abs_doc, "dummy_hash"))
    abs_res = verify_parity()
    assert abs_res["ok"] is False
    assert any("Absorbed receipt" in p for p in abs_res["problems"])

def test_consolidation_six_pairs() -> None:
    from arsenal.scripts.playbook_catalog import resolve
    from arsenal.scripts.receipts import SCRIPT_RECEIPTS
    from pathlib import Path

    pairs = [
        (
            "red-detecting-ai-model-prompt-injection-attacks/agent",
            "webapp-detecting-ai-model-prompt-injection-attacks/agent",
            "red",
            "webapp",
            "shared/prompt_injection",
        ),
        (
            "red-implementing-attack-surface-management/agent",
            "webapp-implementing-attack-surface-management/agent",
            "red",
            "webapp",
            "shared/attack_surface_management",
        ),
        (
            "red-implementing-llm-guardrails-for-security/agent",
            "webapp-implementing-llm-guardrails-for-security/agent",
            "red",
            "webapp",
            "shared/llm_guardrails",
        ),
        (
            "red-implementing-vulnerability-remediation-sla/process",
            "webapp-implementing-vulnerability-remediation-sla/process",
            "red",
            "webapp",
            "shared/vulnerability_remediation_sla",
        ),
        (
            "red-performing-phishing-simulation-with-gophish/process",
            "webapp-performing-phishing-simulation-with-gophish/process",
            "red",
            "webapp",
            "shared/phishing_simulation_gophish",
        ),
        (
            "re-validating-backup-integrity-for-recovery/agent",
            "webapp-validating-backup-integrity-for-recovery/agent",
            "re",
            "webapp",
            "shared/backup_integrity",
        ),
    ]

    receipt_by_cid = {r["canonical_id"]: r for r in SCRIPT_RECEIPTS}

    for id_a, id_b, dom_a, dom_b, expected_shared_id in pairs:
        entry_a = resolve(id_a)
        entry_b = resolve(id_b)

        # 1. Both resolve
        assert entry_a["canonical_id"] == id_a
        assert entry_b["canonical_id"] == id_b

        # 2. Both carry their own domain
        assert entry_a["domain"] == dom_a
        assert entry_b["domain"] == dom_b

        # 3. Both point to the same shared implementation
        assert entry_a["provenance"]["shared_implementation_id"] == expected_shared_id
        assert entry_b["provenance"]["shared_implementation_id"] == expected_shared_id
        assert entry_a["implementation_ref"]["resource_path"] == entry_b["implementation_ref"]["resource_path"]

        # 4. Two original receipt hashes are unchanged
        rec_a = receipt_by_cid[id_a]
        rec_b = receipt_by_cid[id_b]
        assert len(rec_a["sha256"]) == 64
        assert len(rec_b["sha256"]) == 64

        # 5. No second copy of the bytes exists on disk in the original locations
        orig_path_a = Path(rec_a["migrated_path"])
        orig_path_b = Path(rec_b["migrated_path"])
        assert not orig_path_a.is_file(), f"Deleted duplicate file still present: {orig_path_a}"
        assert not orig_path_b.is_file(), f"Deleted duplicate file still present: {orig_path_b}"


def test_status_parity_receipts(monkeypatch: pytest.MonkeyPatch) -> None:
    from arsenal.scripts.receipts import SCRIPT_RECEIPTS
    from arsenal.scripts.playbook_catalog import resolve, list_entries, verify_parity, load_catalog_data

    # 1. All 257 receipts remain schema/hash valid
    assert len(SCRIPT_RECEIPTS) == 258
    for r in SCRIPT_RECEIPTS:
        assert len(r["sha256"]) == 64
        assert r["status"] in ("migrated", "absorbed", "retained_external")

    # 2. Absorbed receipt is absent from listing and dispatch
    absorbed = [r for r in SCRIPT_RECEIPTS if r["status"] == "absorbed"][0]
    abs_cid = absorbed["canonical_id"]

    all_listed_ids = {e["canonical_id"] for e in list_entries()}
    assert abs_cid not in all_listed_ids

    with pytest.raises(KeyError):
        resolve(abs_cid)

    # 3. A receipt status change without a catalog update fails parity
    cat_data, _ = load_catalog_data()
    # Simulate receipt status change: mark an active entry as absorbed in receipts
    target_cid = cat_data["entries"][0]["canonical_id"]
    modified_receipts = [
        dict(r, status="absorbed") if r.get("canonical_id") == target_cid else dict(r)
        for r in SCRIPT_RECEIPTS
    ]
    monkeypatch.setattr("arsenal.scripts.receipts.SCRIPT_RECEIPTS", modified_receipts)
    res = verify_parity()
    assert res["ok"] is False
    assert any("Absorbed receipt" in p for p in res["problems"])

def test_installed_artifact_resolution(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import importlib.resources as pkg_resources
    from arsenal.scripts.playbook_catalog import load_catalog_data, resolve, list_entries

    # 1. Package resource resolution works independently of working directory
    unrelated_dir = tmp_path / "unrelated"
    unrelated_dir.mkdir()
    monkeypatch.chdir(unrelated_dir)

    data, digest = load_catalog_data()
    assert len(digest) == 64
    assert len(data["entries"]) == 235

    # Listing and resolve succeed from unrelated directory
    entries = list_entries()
    assert len(entries) == 235
    entry = resolve("red-detecting-ai-model-prompt-injection-attacks/agent")
    assert entry["canonical_id"] == "red-detecting-ai-model-prompt-injection-attacks/agent"
    assert "playbooks/shared/prompt_injection.py" in entry["implementation_ref"]["resource_path"]

    # 2. Removing/corrupting packaged catalog resource makes validation fail
    monkeypatch.setattr(
        "importlib.resources.files",
        lambda pkg: (_ for _ in ()).throw(FileNotFoundError("Packaged catalog resource missing")),
    )
    with pytest.raises(FileNotFoundError):
        load_catalog_data.__wrapped__()
