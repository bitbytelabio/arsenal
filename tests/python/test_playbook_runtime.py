from __future__ import annotations

import json
from pathlib import Path
from typing import Any
import pytest


class FakeAuthorizationProvider:
    def __init__(self, default_status: str = "unavailable", default_reason: str = "authorization_missing") -> None:
        self.calls: list[dict[str, Any]] = []
        self.default_status = default_status
        self.default_reason = default_reason

    def evaluate(self, request: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(request)
        return {"status": self.default_status, "reason_code": self.default_reason}


class FakeProxyProvider:
    def __init__(self, default_status: str = "unavailable", default_reason: str = "proxy_missing") -> None:
        self.calls: list[dict[str, Any]] = []
        self.default_status = default_status
        self.default_reason = default_reason

    def evaluate(self, request: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(request)
        return {"status": self.default_status, "reason_code": self.default_reason}


class FakeEvidenceSink:
    def __init__(self, writable: bool = True) -> None:
        self.events: list[dict[str, Any]] = []
        self.writable = writable

    def append_receipt(self, receipt: dict[str, Any]) -> bool:
        if not self.writable:
            return False
        self.events.append(receipt)
        return True


@pytest.fixture
def mock_workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "workspace"
    ws.mkdir(parents=True, exist_ok=True)
    omp_dir = ws / ".omp" / "arsenal"
    omp_dir.mkdir(parents=True, exist_ok=True)
    scope_data = {
        "schema_version": 1,
        "engagement_id": "test-eng-1",
        "name": "Test Workspace Target",
        "created_at": "2026-10-13T00:00:00Z",
        "domain": "webapp",
        "auth": {
            "status": "granted",
            "basis": "Contract RoE",
            "reference": "REF-001",
            "ready_for_act": True,
        },
        "in_scope": ["example.com", "target.com", "192.168.1.10"],
        "out_of_scope": ["forbidden.com"],
        "disallowed_actions": ["dos"],
        "window": {
            "start": "2026-10-13T00:00:00Z",
            "end": "2026-10-20T00:00:00Z",
            "timezone": "UTC",
        },
    }
    (omp_dir / "scope.json").write_text(json.dumps(scope_data), encoding="utf-8")
    return ws


@pytest.fixture
def fake_auth_provider() -> FakeAuthorizationProvider:
    return FakeAuthorizationProvider()


@pytest.fixture
def fake_proxy_provider() -> FakeProxyProvider:
    return FakeProxyProvider()


@pytest.fixture
def fake_evidence_sink() -> FakeEvidenceSink:
    return FakeEvidenceSink()


def test_test_scaffolding_fixtures(mock_workspace: Path, fake_auth_provider: FakeAuthorizationProvider, fake_proxy_provider: FakeProxyProvider, fake_evidence_sink: FakeEvidenceSink) -> None:
    assert (mock_workspace / ".omp" / "arsenal" / "scope.json").is_file()
    assert fake_auth_provider.default_status == "unavailable"
    assert fake_proxy_provider.default_status == "unavailable"
    assert fake_evidence_sink.append_receipt({"test": 1}) is True
    assert len(fake_evidence_sink.events) == 1

def test_canonical_invocation_representative_endpoints(mock_workspace: Path) -> None:
    from arsenal.cli import main
    import io
    from contextlib import redirect_stdout, redirect_stderr

    # 1. Core handler: case-init
    f_out = io.StringIO()
    f_err = io.StringIO()
    with redirect_stdout(f_out), redirect_stderr(f_err):
        code = main(["scripts", "case-init", "--hint", "test", "--project-root", str(mock_workspace), "--json"])
    assert code == 0
    data = json.loads(f_out.getvalue())
    assert data["status"] == "success"
    assert "case_name" in data["data"]

    # 2. Red endpoint: with --help
    f_out = io.StringIO()
    f_err = io.StringIO()
    with redirect_stdout(f_out), redirect_stderr(f_err):
        code = main(["scripts", "red-performing-ransomware-tabletop-exercise/agent", "--help"])
    assert code == 0
    assert "tabletop" in f_out.getvalue().lower() or "usage" in f_out.getvalue().lower()

    # 3. Webapp endpoint: with --help
    f_out = io.StringIO()
    f_err = io.StringIO()
    with redirect_stdout(f_out), redirect_stderr(f_err):
        code = main(["scripts", "webapp-testing-for-ssrf-vulnerabilities/agent", "--help"])
    assert code == 0
    assert "usage" in f_out.getvalue().lower() or "ssrf" in f_out.getvalue().lower()

    # 4. RE endpoint: with --help
    f_out = io.StringIO()
    f_err = io.StringIO()
    with redirect_stdout(f_out), redirect_stderr(f_err):
        code = main(["scripts", "re-extracting-iocs-from-malware-samples/agent", "--help"])
    assert code == 0
    assert "usage" in f_out.getvalue().lower() or "ioc" in f_out.getvalue().lower()

    # 5. Mobile endpoint: with --help
    f_out = io.StringIO()
    f_err = io.StringIO()
    with redirect_stdout(f_out), redirect_stderr(f_err):
        code = main(["scripts", "mobile-analyzing-android-malware-with-apktool/agent", "--help"])
    assert code == 0
    assert "usage" in f_out.getvalue().lower() or "apk" in f_out.getvalue().lower()


def test_failure_contracts_and_malformed_output() -> None:
    from arsenal.cli import main
    from arsenal.common import ExitCodes
    from arsenal.scripts.playbook_runner import _clean_str
    from arsenal.storage import truncate_tail_to_byte_budget
    import io
    from contextlib import redirect_stdout, redirect_stderr

    # 1. Invalid argument returns CLI_USAGE_ERROR (code 2)
    f_out = io.StringIO()
    f_err = io.StringIO()
    with redirect_stdout(f_out), redirect_stderr(f_err):
        code = main(["scripts", "red-performing-ransomware-tabletop-exercise/agent", "--invalid-nonexistent-flag", "--json"])
    assert code == ExitCodes.CLI_USAGE_ERROR

    # 2. Unknown script returns CLI_USAGE_ERROR
    f_out = io.StringIO()
    f_err = io.StringIO()
    with redirect_stdout(f_out), redirect_stderr(f_err):
        code = main(["scripts", "nonexistent-script-id", "--json"])
    assert code == ExitCodes.CLI_USAGE_ERROR

    # 3. Directory traversal in script ID returns CLI_USAGE_ERROR
    f_out = io.StringIO()
    f_err = io.StringIO()
    with redirect_stdout(f_out), redirect_stderr(f_err):
        code = main(["scripts", "../etc/passwd", "--json"])
    assert code == ExitCodes.CLI_USAGE_ERROR

    # 4. Malformed oversized UTF-8 produced no \uFFFD and fits in byte budget
    malformed_bytes = b"Hello\xff\xfeWorld" * 2000
    cleaned = _clean_str(malformed_bytes)
    assert "\ufffd" not in cleaned
    bounded = truncate_tail_to_byte_budget(cleaned, 1024)
    assert len(bounded.encode("utf-8")) <= 1024
    assert "\ufffd" not in bounded

def test_side_effect_denial_reasons(tmp_path: Path) -> None:
    from arsenal.scripts.playbook_boundaries import evaluate_preflight

    base_entry = {
        "canonical_id": "test/playbook",
        "execution_mode": "managed_subprocess",
        "admission_status": "retained_isolated",
        "controls": {
            "scope": "required",
            "authorization": "host_required",
            "proxy": "burp_required",
            "write": "requires_write_gate",
            "verification": "none",
            "evidence": "execution_receipt",
        },
        "side_effects": {
            "network": "active",
            "credentials": "none",
            "target_mutation": "local",
            "filesystem": "write",
            "external_process": "none",
            "evidence_write": "required",
        },
        "dependencies": {},
    }

    empty_ws = tmp_path / "empty_ws"
    empty_ws.mkdir()

    # 1. Missing scope
    dec = evaluate_preflight(base_entry, workspace_root=empty_ws)
    assert dec.status == "unavailable"
    assert dec.reason_code == "scope_missing"

    # 1b. Conflicting scope sources
    conflict_ws = tmp_path / "conflict_ws"
    omp_a = conflict_ws / ".omp" / "arsenal"
    omp_b = conflict_ws / ".omp"
    omp_a.mkdir(parents=True)
    omp_b.mkdir(parents=True, exist_ok=True)
    (omp_a / "scope.json").write_text(json.dumps({
        "schema_version": 1,
        "engagement_id": "ENG-A",
        "name": "Target A",
        "created_at": "2026-10-13T00:00:00Z",
        "domain": "webapp",
        "auth": {"status": "granted", "basis": "RoE", "reference": "R1", "ready_for_act": True},
        "in_scope": ["a.com"],
        "out_of_scope": [],
        "disallowed_actions": [],
        "window": {"start": "2026-10-13T00:00:00Z", "end": "2026-10-20T00:00:00Z", "timezone": "UTC"},
    }), encoding="utf-8")
    (omp_b / "scope.json").write_text(json.dumps({
        "schema_version": 1,
        "engagement_id": "ENG-B",  # Conflicting engagement ID
        "name": "Target B",
        "created_at": "2026-10-13T00:00:00Z",
        "domain": "webapp",
        "auth": {"status": "granted", "basis": "RoE", "reference": "R2", "ready_for_act": True},
        "in_scope": ["b.com"],
        "out_of_scope": [],
        "disallowed_actions": [],
        "window": {"start": "2026-10-13T00:00:00Z", "end": "2026-10-20T00:00:00Z", "timezone": "UTC"},
    }), encoding="utf-8")
    dec_conflict = evaluate_preflight(base_entry, workspace_root=conflict_ws)
    assert dec_conflict.status == "unavailable"
    assert dec_conflict.reason_code == "scope_missing"

    # 2. Scope exists, but authorization missing
    ws_with_scope = tmp_path / "scope_ws"
    omp = ws_with_scope / ".omp" / "arsenal"
    omp.mkdir(parents=True)
    valid_scope_doc = {
        "schema_version": 1,
        "engagement_id": "ENG-DENIAL-01",
        "name": "Denial Test Target",
        "created_at": "2026-10-13T00:00:00Z",
        "domain": "webapp",
        "auth": {
            "status": "granted",
            "basis": "Contract RoE",
            "reference": "REF-001",
            "ready_for_act": True,
        },
        "in_scope": ["target.com"],
        "out_of_scope": ["forbidden.com"],
        "disallowed_actions": ["dos"],
        "window": {
            "start": "2026-10-13T00:00:00Z",
            "end": "2026-10-20T00:00:00Z",
            "timezone": "UTC",
        },
    }
    (omp / "scope.json").write_text(json.dumps(valid_scope_doc), encoding="utf-8")

    dec_auth = evaluate_preflight(base_entry, workspace_root=ws_with_scope)
    assert dec_auth.status == "unavailable"
    assert dec_auth.reason_code == "authorization_missing"

    # 2b. Scope exists, but ready_for_act = False
    scope_not_ready = dict(valid_scope_doc, auth=dict(valid_scope_doc["auth"], ready_for_act=False))
    ws_not_ready = tmp_path / "not_ready_ws"
    (ws_not_ready / ".omp" / "arsenal").mkdir(parents=True)
    (ws_not_ready / ".omp" / "arsenal" / "scope.json").write_text(json.dumps(scope_not_ready), encoding="utf-8")
    dec_not_ready = evaluate_preflight(base_entry, workspace_root=ws_not_ready)
    assert dec_not_ready.status == "deny"
    assert dec_not_ready.reason_code == "authorization_missing"

    # 2c. Scope window expired
    scope_expired = dict(valid_scope_doc, window={"start": "2020-01-01T00:00:00Z", "end": "2020-01-02T00:00:00Z", "timezone": "UTC"})
    ws_expired = tmp_path / "expired_ws"
    (ws_expired / ".omp" / "arsenal").mkdir(parents=True)
    (ws_expired / ".omp" / "arsenal" / "scope.json").write_text(json.dumps(scope_expired), encoding="utf-8")
    dec_expired = evaluate_preflight(base_entry, workspace_root=ws_expired)
    assert dec_expired.status == "deny"
    assert dec_expired.reason_code == "authorization_missing"

    # 2d. Disallowed action (e.g. dos action)
    dos_entry = dict(base_entry, canonical_id="webapp-dos-attack/agent")
    dec_dos = evaluate_preflight(dos_entry, workspace_root=ws_with_scope)
    assert dec_dos.status == "deny"
    assert dec_dos.reason_code == "authorization_missing"

    # 3. Target out of scope (with declared target_binding)
    entry_with_binding = dict(base_entry, side_effects=dict(base_entry["side_effects"], target_binding=["target"]))
    allowed_auth = FakeAuthorizationProvider(default_status="allow", default_reason=None)
    dec_target = evaluate_preflight(
        entry_with_binding,
        raw_args=["--target=https://forbidden.com"],
        workspace_root=ws_with_scope,
        auth_provider=allowed_auth,
    )
    assert dec_target.status == "deny"
    assert dec_target.reason_code == "target_out_of_scope"

    # 4. Missing write gate
    dec_write = evaluate_preflight(
        base_entry,
        raw_args=["--target=https://target.com"],
        workspace_root=ws_with_scope,
        auth_provider=allowed_auth,
        write_gate_approved=False,
    )
    assert dec_write.status == "deny"
    assert dec_write.reason_code == "write_gate_missing"

    # 5. Missing proxy
    dec_proxy = evaluate_preflight(
        base_entry,
        raw_args=["--target=https://target.com"],
        workspace_root=ws_with_scope,
        auth_provider=allowed_auth,
        write_gate_approved=True,
    )
    assert dec_proxy.status == "unavailable"
    assert dec_proxy.reason_code == "proxy_missing"

    # 6. Unavailable evidence sink
    allowed_proxy = FakeProxyProvider(default_status="allow", default_reason=None)
    bad_sink = FakeEvidenceSink()
    bad_sink.is_ready = lambda req: False
    dec_ev = evaluate_preflight(
        base_entry,
        raw_args=["--target=https://target.com"],
        workspace_root=ws_with_scope,
        auth_provider=allowed_auth,
        proxy_provider=allowed_proxy,
        evidence_sink=bad_sink,
        write_gate_approved=True,
    )
    assert dec_ev.status == "unavailable"
    assert dec_ev.reason_code == "evidence_unavailable"

    # 7. Missing tool
    tool_entry = dict(base_entry, dependencies={"tools": ["nonexistent_tool_12345"]})
    dec_tool = evaluate_preflight(
        tool_entry,
        workspace_root=ws_with_scope,
        auth_provider=allowed_auth,
        proxy_provider=allowed_proxy,
        write_gate_approved=True,
    )
    assert dec_tool.status == "unavailable"
    assert dec_tool.reason_code == "tool_missing"

    # 8. Missing dependency
    dep_entry = dict(base_entry, dependencies={"imports": ["nonexistent_pkg_xyz_999"]})
    dec_dep = evaluate_preflight(
        dep_entry,
        workspace_root=ws_with_scope,
        auth_provider=allowed_auth,
        proxy_provider=allowed_proxy,
        write_gate_approved=True,
    )
    assert dec_dep.status == "unavailable"
    assert dec_dep.reason_code == "dependency_missing"


def test_target_binding_evaluation(mock_workspace: Path) -> None:
    from arsenal.scripts.playbook_boundaries import evaluate_preflight

    entry = {
        "canonical_id": "test/target-binding",
        "execution_mode": "managed_subprocess",
        "admission_status": "retained_isolated",
        "controls": {
            "scope": "required",
            "authorization": "not_applicable",
            "proxy": "none",
            "write": "forbidden",
            "verification": "none",
            "evidence": "none",
        },
        "side_effects": {
            "network": "none",
            "credentials": "none",
            "target_mutation": "none",
            "filesystem": "read",
            "external_process": "none",
            "evidence_write": "none",
        },
        "dependencies": {},
    }

    # In-scope argument does not trigger target_out_of_scope
    dec_ok = evaluate_preflight(entry, raw_args=["example.com"], workspace_root=mock_workspace)
    assert dec_ok.is_allowed()

    # Non-target positional arguments like filenames or subcommands are not falsely blocked
    dec_file = evaluate_preflight(entry, raw_args=["--format=json", "output.txt"], workspace_root=mock_workspace)
    assert dec_file.is_allowed()


def test_locked_environment_offline_and_failure(tmp_path: Path) -> None:
    from arsenal.scripts.playbook_boundaries import evaluate_preflight

    # Missing environment dir / lockfile
    entry = {
        "canonical_id": "red-defending-llms-with-guardrails/agent",
        "execution_mode": "locked_environment",
        "admission_status": "retained_isolated",
        "controls": {
            "scope": "not_applicable",
            "authorization": "not_applicable",
            "proxy": "none",
            "write": "forbidden",
            "verification": "none",
            "evidence": "none",
        },
        "side_effects": {
            "network": "none",
            "credentials": "none",
            "target_mutation": "none",
            "filesystem": "read",
            "external_process": "none",
            "evidence_write": "none",
        },
        "dependencies": {
            "environment_dir": "nonexistent_env_dir",
            "lock_hash": "a" * 64,
        },
    }

    dec = evaluate_preflight(entry, workspace_root=tmp_path)
    assert dec.status == "unavailable"
    assert dec.reason_code == "lockfile_invalid"
    assert "uv sync --locked --project" in dec.message

    # Runner-level single attempt and no online retry verification (T026)
    from arsenal.scripts.playbook_runner import execute_catalog_entry
    from arsenal.common import Context, ExitCodes
    import subprocess

    fixture_env = tmp_path / "fixture_env"
    fixture_env.mkdir()
    (fixture_env / "pyproject.toml").write_text("[project]\nname='test'\n", encoding="utf-8")
    lock_content = "version = 1\n"
    (fixture_env / "uv.lock").write_text(lock_content, encoding="utf-8")
    import hashlib
    actual_lock_hash = hashlib.sha256(lock_content.encode("utf-8")).hexdigest()

    invocations: list[list[str]] = []

    class FakePopen:
        def __init__(self, cmd: list[str], *args: object, **kwargs: object) -> None:
            invocations.append(cmd)
            self.pid = 99999
            self.returncode = 1

        def communicate(self, timeout: float | None = None) -> tuple[bytes, bytes]:
            return b"", b"error: package not found offline"

        def kill(self) -> None:
            pass

    import pytest
    mp = pytest.MonkeyPatch()
    mp.setattr(subprocess, "Popen", FakePopen)

    runner_entry = {
        "canonical_id": "test/locked-runner",
        "execution_mode": "locked_environment",
        "admission_status": "retained_isolated",
        "implementation_ref": {"resource_path": "playbooks/test.py"},
        "dependencies": {"environment_dir": "fixture_env", "lock_hash": actual_lock_hash},
        "interface": {"timeout_ms": 5000, "stdout_limit": 1000, "stderr_limit": 1000},
        "controls": {"evidence": "none"},
        "side_effects": {"evidence_write": "none"},
    }

    ctx = Context(
        family="scripts",
        subcommand="test/locked-runner",
        positionals=[],
        values={},
        repo_root=tmp_path,
        profile_dir=tmp_path,
        mode="check",
        is_json=True,
    )

    mp.setattr("arsenal.scripts.playbook_runner.resolve_isolated_env_dir", lambda name, repo: fixture_env)
    fake_script = tmp_path / "fake_script.py"
    fake_script.write_text("print('hello')", encoding="utf-8")
    mp.setattr("arsenal.scripts.playbook_runner.resolve_resource_path", lambda path: fake_script)

    code = execute_catalog_entry(ctx, runner_entry)
    assert code == ExitCodes.ENVIRONMENT_UNAVAILABLE

    # Assert exactly one attempt occurred (no online retry)
    assert len(invocations) == 1
    assert "--offline" in invocations[0]
    assert "--locked" in invocations[0]

    # Assert lockfile bytes are unchanged
    assert (fixture_env / "uv.lock").read_text(encoding="utf-8") == lock_content
    mp.undo()
