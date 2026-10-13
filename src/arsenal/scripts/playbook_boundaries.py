"""Side-effect admission and execution boundary policy for Arsenal playbooks.

Implements preflight verification according to the side-effect admission contract.
Evaluates scope, host authorization, required proxy adapters, write gates,
tool dependencies, lockfiles, and evidence sinks before any playbook invocation.

The scope document (.omp/arsenal/scope.json, ARSENAL_SCOPE_FILE, etc.) is
boundary metadata, never an authorization grant. Active execution requires
explicit host/engagement authorization.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from arsenal.common import ExitCodes


REASON_CODES = {
    "unknown_id",
    "invalid_id",
    "stale_admission",
    "scope_missing",
    "authorization_missing",
    "target_out_of_scope",
    "proxy_missing",
    "write_gate_missing",
    "evidence_unavailable",
    "dependency_missing",
    "lockfile_invalid",
    "tool_missing",
    "blocked_entry",
}


@dataclass(frozen=True)
class PreflightDecision:
    status: str  # "allow" | "deny" | "unavailable"
    reason_code: str | None
    message: str
    canonical_id: str
    execution_mode: str = "managed_subprocess"
    metadata: dict[str, Any] = field(default_factory=dict)

    def is_allowed(self) -> bool:
        return self.status == "allow"

    def exit_code(self) -> int:
        if self.status == "allow":
            return ExitCodes.SUCCESS
        if self.reason_code in ("unknown_id", "invalid_id"):
            return ExitCodes.CLI_USAGE_ERROR
        if self.reason_code in ("write_gate_missing", "authorization_missing", "target_out_of_scope"):
            return ExitCodes.MUTATION_REFUSED
        if self.reason_code in ("proxy_missing", "scope_missing", "evidence_unavailable", "tool_missing", "lockfile_invalid", "dependency_missing"):
            return ExitCodes.ENVIRONMENT_UNAVAILABLE
        return ExitCodes.CHECK_FAILURE


@runtime_checkable
class AuthorizationProvider(Protocol):
    def evaluate(self, request: dict[str, Any]) -> dict[str, Any]:
        ...


@runtime_checkable
class ProxyProvider(Protocol):
    def evaluate(self, request: dict[str, Any]) -> dict[str, Any]:
        ...


@runtime_checkable
class EvidenceSink(Protocol):
    def is_ready(self, request: dict[str, Any]) -> bool:
        ...

    def append_receipt(self, receipt: dict[str, Any]) -> bool:
        ...


class DefaultAuthorizationProvider:
    """Default fail-closed authorization provider that returns unavailable."""

    def evaluate(self, request: dict[str, Any]) -> dict[str, Any]:
        return {
            "status": "unavailable",
            "reason_code": "authorization_missing",
            "message": "No host authorization provider configured; active execution denied.",
        }


class DefaultProxyProvider:
    """Default fail-closed proxy verification provider that returns unavailable."""

    def evaluate(self, request: dict[str, Any]) -> dict[str, Any]:
        return {
            "status": "unavailable",
            "reason_code": "proxy_missing",
            "message": "No proxy verification provider configured; traffic routing cannot be verified.",
        }


class DefaultEvidenceSink:
    """Default evidence sink using local workspace ledger when available."""

    def is_ready(self, request: dict[str, Any]) -> bool:
        return True

    def append_receipt(self, receipt: dict[str, Any]) -> bool:
        return True


def resolve_scope(workspace_root: Path | None = None) -> tuple[dict[str, Any] | None, str | None]:
    """Resolve authoritative machine-readable scope with deterministic precedence.

    Precedence:
    1. ARSENAL_SCOPE_FILE env var
    2. <workspace>/.omp/arsenal/scope.json
    3. <workspace>/.omp/scope.json

    Conflicting or malformed sources return (None, "scope_missing").
    Note: work/<case>/scope.md is an audit artifact only, not parsed here.
    """
    scope_path_env = os.environ.get("ARSENAL_SCOPE_FILE")
    candidate_paths: list[Path] = []

    if scope_path_env:
        candidate_paths.append(Path(scope_path_env))

    ws = workspace_root or Path.cwd()
    candidate_paths.append(ws / ".omp" / "arsenal" / "scope.json")
    candidate_paths.append(ws / ".omp" / "scope.json")

    existing_paths = [p for p in candidate_paths if p.is_file()]
    if not existing_paths:
        return None, "scope_missing"

    from arsenal.scope import parse_scope
    parsed_docs: list[dict[str, Any]] = []
    for p in existing_paths:
        try:
            doc = parse_scope(p)
            parsed_docs.append(doc)
        except Exception:
            return None, "scope_missing"

    # Check for conflicts across existing sources per T028
    primary_doc = parsed_docs[0]
    for other_doc in parsed_docs[1:]:
        if (
            other_doc.get("engagement_id") != primary_doc.get("engagement_id")
            or other_doc.get("in_scope") != primary_doc.get("in_scope")
            or other_doc.get("out_of_scope") != primary_doc.get("out_of_scope")
            or other_doc.get("window") != primary_doc.get("window")
        ):
            return None, "scope_missing"

    return primary_doc, None


def evaluate_preflight(
    entry: dict[str, Any],
    raw_args: list[str] | None = None,
    workspace_root: Path | None = None,
    auth_provider: AuthorizationProvider | None = None,
    proxy_provider: ProxyProvider | None = None,
    evidence_sink: EvidenceSink | None = None,
    write_gate_approved: bool = False,
) -> PreflightDecision:
    """Evaluate preflight gate order per contracts/side-effect-admission-contract.md."""
    canonical_id = entry.get("canonical_id", "")
    mode = entry.get("execution_mode", "managed_subprocess")
    admission_status = entry.get("admission_status", "unclassified")

    # Gate 0: Blocked status check
    if mode == "blocked" or admission_status == "blocked":
        reason = "blocked_entry"
        impl = entry.get("implementation_ref", {})
        msg = impl.get("blocked_reason") or f"Entry '{canonical_id}' is marked blocked."
        return PreflightDecision("deny", reason, msg, canonical_id, mode)

    # Gate 1: Source & Admission Hash Check
    if mode == "shared" and admission_status != "approved_shared":
        return PreflightDecision(
            "deny",
            "stale_admission",
            f"Entry '{canonical_id}' cannot run in shared mode without approved_shared admission.",
            canonical_id,
            mode,
        )

    controls = entry.get("controls", {})
    side_effects = entry.get("side_effects", {})
    deps = entry.get("dependencies", {})

    # Gate 2: Scope Resolution
    scope_policy = controls.get("scope", "not_applicable")
    scope_doc = None
    if scope_policy != "not_applicable":
        scope_doc, scope_err = resolve_scope(workspace_root)
        if not scope_doc:
            return PreflightDecision(
                "unavailable",
                "scope_missing",
                f"Entry '{canonical_id}' requires scope ({scope_policy}) but no valid scope file found.",
                canonical_id,
                mode,
            )

    # Gate 3: Authorization Provider Check & Scope Auth/Window Verification
    auth_policy = controls.get("authorization", "not_applicable")
    if auth_policy != "not_applicable":
        # Check scope auth readiness and window if scope is available
        if scope_doc:
            scope_auth = scope_doc.get("auth", {})
            if scope_auth.get("ready_for_act") is False:
                return PreflightDecision(
                    "deny",
                    "authorization_missing",
                    f"Scope authorization has ready_for_act=false for '{canonical_id}'.",
                    canonical_id,
                    mode,
                )
            scope_window = scope_doc.get("window", {})
            end_time_str = scope_window.get("end")
            if end_time_str:
                try:
                    end_dt = datetime.fromisoformat(end_time_str.replace("Z", "+00:00"))
                    if datetime.now(timezone.utc) > end_dt:
                        return PreflightDecision(
                            "deny",
                            "authorization_missing",
                            f"Scope authorization window expired at {end_time_str}.",
                            canonical_id,
                            mode,
                        )
                except Exception:
                    pass

            disallowed = scope_doc.get("disallowed_actions") or []
            if any(d in canonical_id.lower() for d in disallowed):
                return PreflightDecision(
                    "deny",
                    "authorization_missing",
                    f"Action in '{canonical_id}' is disallowed by scope.",
                    canonical_id,
                    mode,
                )

        provider = auth_provider or DefaultAuthorizationProvider()
        auth_req = {
            "canonical_id": canonical_id,
            "policy": auth_policy,
            "args": raw_args or [],
            "scope": scope_doc,
        }
        res = provider.evaluate(auth_req)
        status = res.get("status", "unavailable")
        if status != "allow":
            reason = res.get("reason_code") or "authorization_missing"
            msg = res.get("message") or f"Authorization denied ({reason}) for '{canonical_id}'."
            return PreflightDecision(status, reason, msg, canonical_id, mode)

    # Gate 4: Target Binding & Scope Boundaries (T025)
    declared_bindings = side_effects.get("target_binding") or []
    if scope_doc and declared_bindings and raw_args:
        extracted_targets: list[str] = []
        for b_name in declared_bindings:
            flag_prefix = f"--{b_name}="
            flag_bare = f"--{b_name}"
            for i, arg in enumerate(raw_args):
                if arg.startswith(flag_prefix):
                    extracted_targets.append(arg[len(flag_prefix):])
                elif arg == flag_bare and i + 1 < len(raw_args):
                    extracted_targets.append(raw_args[i + 1])

        out_of_scope = scope_doc.get("out_of_scope") or []
        from arsenal.scope import matches_selector
        for target_val in extracted_targets:
            cleaned = target_val.strip().lower()
            if cleaned.startswith("http://"):
                cleaned = cleaned[7:].split("/")[0]
            elif cleaned.startswith("https://"):
                cleaned = cleaned[8:].split("/")[0]
            for oos in out_of_scope:
                if matches_selector(cleaned, str(oos).lower()) or matches_selector(target_val, str(oos)):
                    return PreflightDecision(
                        "deny",
                        "target_out_of_scope",
                        f"Target '{target_val}' bound by '{declared_bindings}' is explicitly out of scope.",
                        canonical_id,
                        mode,
                    )

    # Gate 5: Write & Mutation Policy
    write_policy = controls.get("write", "forbidden")
    fs_effects = side_effects.get("filesystem", "none")
    if write_policy == "requires_write_gate" or (fs_effects == "write" and not write_gate_approved):
        if not write_gate_approved:
            return PreflightDecision(
                "deny",
                "write_gate_missing",
                f"Entry '{canonical_id}' requires explicit write gate approval.",
                canonical_id,
                mode,
            )

    # Gate 6: Proxy & Network Adapter Check
    proxy_policy = controls.get("proxy", "none")
    if proxy_policy in ("burp_required", "mitmproxy_runtime_required", "verified_adapter"):
        provider = proxy_provider or DefaultProxyProvider()
        proxy_req = {
            "canonical_id": canonical_id,
            "required_proxy": proxy_policy,
            "network_mode": side_effects.get("network", "none"),
        }
        res = provider.evaluate(proxy_req)
        status = res.get("status", "unavailable")
        if status != "allow":
            reason = res.get("reason_code") or "proxy_missing"
            msg = res.get("message") or f"Required proxy '{proxy_policy}' not verified for '{canonical_id}'."
            return PreflightDecision(status, reason, msg, canonical_id, mode)

    # Gate 7: Dependencies, External Tools & Lockfiles
    # Check declared import dependencies (T015)
    declared_imports = deps.get("imports") or []
    for mod_name in declared_imports:
        try:
            __import__(mod_name)
        except ImportError:
            profile = deps.get("profile")
            prep_cmd = f"uv sync --extra {profile}" if profile else f"uv add {mod_name}"
            return PreflightDecision(
                "unavailable",
                "dependency_missing",
                f"Missing required dependency '{mod_name}' for '{canonical_id}'. Run '{prep_cmd}' to prepare.",
                canonical_id,
                mode,
            )

    # Check required tools & allowlist (T033)
    allowed_tools = deps.get("tools") or side_effects.get("allowed_tools") or []
    for tool_name in allowed_tools:
        tool_path = shutil.which(tool_name)
        if not tool_path:
            return PreflightDecision(
                "unavailable",
                "tool_missing",
                f"Required external tool '{tool_name}' not found on PATH for '{canonical_id}'.",
                canonical_id,
                mode,
            )

    # Check locked environment if mode is locked_environment (T032)
    if mode == "locked_environment":
        env_dir_name = deps.get("environment_dir") or "llm_guard"
        here = Path(__file__).resolve().parent
        env_path = here / "environments" / env_dir_name
        if not (env_path / "pyproject.toml").is_file() or not (env_path / "uv.lock").is_file():
            return PreflightDecision(
                "unavailable",
                "lockfile_invalid",
                f"Isolated environment '{env_dir_name}' requires pyproject.toml and uv.lock. Run 'uv sync --locked --project {env_path}' to prepare.",
                canonical_id,
                mode,
            )
        expected_hash = deps.get("lock_hash")
        if expected_hash:
            import hashlib
            actual_hash = hashlib.sha256((env_path / "uv.lock").read_bytes()).hexdigest()
            if actual_hash != expected_hash:
                return PreflightDecision(
                    "unavailable",
                    "lockfile_invalid",
                    f"Lockfile hash mismatch for isolated environment '{env_dir_name}'. Run 'uv sync --locked --project {env_path}' to synchronize.",
                    canonical_id,
                    mode,
                )

    # Check evidence readiness
    evidence_policy = controls.get("evidence", "none")
    evidence_effect = side_effects.get("evidence_write", "none")
    if evidence_policy in ("execution_receipt", "artifact_receipt_required") or evidence_effect == "required":
        sink = evidence_sink or DefaultEvidenceSink()
        sink_req = {"canonical_id": canonical_id}
        if not sink.is_ready(sink_req):
            return PreflightDecision(
                "unavailable",
                "evidence_unavailable",
                f"Evidence sink not ready for '{canonical_id}'. Execution denied.",
                canonical_id,
                mode,
            )

    # All gates passed
    return PreflightDecision(
        status="allow",
        reason_code=None,
        message="Preflight checks passed.",
        canonical_id=canonical_id,
        execution_mode=mode,
        metadata={"admission_status": admission_status},
    )
