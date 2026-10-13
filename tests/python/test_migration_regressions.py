"""Migration regression test suite preserving observable oracles for retired TS modules.

Covers:
1. Legacy corpus helper append-evidence (replaces append-evidence.ps1 and corpus-evidence-helper.test.ts):
   - Path containment guard (rejects artifacts outside case root)
   - Immutability guard (rejects duplicate evidence IDs)
   - Multiline excerpt preservation and YAML literal block formatting
   - Severity and status validation
   - CLI execution through 'arsenal scripts append-evidence'
2. Canonical MCP tool bridge configuration invariants (from mcp-uv-runner.test.ts):
   - uvx runner and command for ida-pro
   - uv runner for ghidra
   - bunx runner and stdio type for playwright
   - sse type, dynamic URL, and bearer token header for burp-ultra
3. Concurrency and process file lock mutual exclusion (from concurrency.test.ts):
   - ProcessFileLock deterministic enter/exit and file preservation
4. Scope parsing, attribution precedence, and window validation (from scope.test.ts):
   - Window ordering (start < end)
   - Out-of-scope exclusion precedence over in-scope inclusion
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
import unittest

from arsenal.common import Context, ExitCodes
from arsenal.installation.mcp_core import CANONICAL_MCP_BRIDGES
from arsenal.scope import attribute_target, parse_scope
from arsenal.scripts.append_evidence import (
    ALLOWED_SEVERITIES,
    ALLOWED_STATUSES,
    append_evidence,
    handle as handle_append_evidence,
)
from arsenal.storage import ProcessFileLock


class TestMigrationRegressions(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.case_root = Path(self.temp_dir.name) / "case with spaces"
        self.case_root.mkdir(parents=True, exist_ok=True)
        (self.case_root / "evidence").mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    # -------------------------------------------------------------------------
    # 1. Legacy Corpus Helper & append-evidence Regressions
    # -------------------------------------------------------------------------

    def test_append_evidence_preserves_multiline_artifacts_and_computes_sha256(self) -> None:
        """Verify multiline formatting and SHA-256 computation for in-case artifacts."""
        artifact = self.case_root / "sample.txt"
        artifact.write_text("offline artifact\n", encoding="utf-8")
        expected_hash = f"sha256:{hashlib.sha256(artifact.read_bytes()).hexdigest()}"

        raw_excerpt = "first line\nsecond line: preserved\n"

        res = append_evidence(
            case_root=self.case_root,
            evidence_id="E-001",
            title="Offline evidence",
            repro_command="cat sample.txt",
            severity="info",
            status="observed",
            raw_excerpt=raw_excerpt,
            artifact_path="sample.txt",
        )

        self.assertEqual(res["id"], "E-001")
        self.assertEqual(res["content_hash"], expected_hash)

        record_file = self.case_root / "evidence" / "E-001.md"
        self.assertTrue(record_file.is_file())
        content = record_file.read_text(encoding="utf-8")

        # Multiline excerpt preserved in indented YAML block
        self.assertIn("    first line\n    second line: preserved", content)
        self.assertIn("artifact_path: sample.txt", content)
        self.assertIn(expected_hash, content)

        # Index file updated
        index_file = self.case_root / "evidence" / "INDEX.md"
        self.assertTrue(index_file.is_file())
        index_content = index_file.read_text(encoding="utf-8")
        self.assertIn("E-001", index_content)

    def test_append_evidence_path_containment_falsifier(self) -> None:
        """FALSIFIER: Reject artifacts located outside the case root directory."""
        outside_file = Path(self.temp_dir.name) / "outside.txt"
        outside_file.write_text("not inside the case", encoding="utf-8")

        with self.assertRaises(ValueError) as cm:
            append_evidence(
                case_root=self.case_root,
                evidence_id="E-004",
                title="Outside artifact",
                repro_command="cat outside.txt",
                artifact_path=outside_file,
            )
        self.assertIn("must be located inside CaseRoot", str(cm.exception))
        self.assertFalse((self.case_root / "evidence" / "E-004.md").exists())

    def test_append_evidence_immutability_duplicate_rejected(self) -> None:
        """FALSIFIER: Immutable records must reject duplicate IDs without modifying existing file."""
        res1 = append_evidence(
            case_root=self.case_root,
            evidence_id="E-001",
            title="Initial record",
            repro_command="echo initial",
        )
        self.assertEqual(res1["id"], "E-001")
        record_file = self.case_root / "evidence" / "E-001.md"
        orig_content = record_file.read_text(encoding="utf-8")

        with self.assertRaises(FileExistsError) as cm:
            append_evidence(
                case_root=self.case_root,
                evidence_id="E-001",
                title="Attempted overwrite",
                repro_command="echo overwrite",
            )
        self.assertIn("already exists and is immutable", str(cm.exception))
        # Ensure disk content is untouched
        self.assertEqual(record_file.read_text(encoding="utf-8"), orig_content)

    def test_append_evidence_invalid_severity_and_status(self) -> None:
        """FALSIFIER: Reject disallowed severity or status values."""
        with self.assertRaises(ValueError) as cm_sev:
            append_evidence(
                case_root=self.case_root,
                evidence_id="E-002",
                title="Bogus severity",
                repro_command="echo test",
                severity="bogus",
            )
        self.assertIn("Invalid severity", str(cm_sev.exception))

        with self.assertRaises(ValueError) as cm_st:
            append_evidence(
                case_root=self.case_root,
                evidence_id="E-003",
                title="Bogus status",
                repro_command="echo test",
                status="bogus",
            )
        self.assertIn("Invalid status", str(cm_st.exception))

    def test_append_evidence_cli_context_invocation(self) -> None:
        """Verify CLI execution via Context respects error codes and validation."""
        # 1. Success execution
        ctx_ok = Context(
            family="scripts",
            subcommand="append-evidence",
            positionals=[],
            values={
                "case-root": str(self.case_root),
                "id": "E-010",
                "title": "CLI Added Evidence",
                "repro-command": "cat /dev/null",
                "severity": "medium",
                "status": "candidate",
            },
            repo_root=self.case_root,
            profile_dir=self.case_root,
            mode="write",
            is_json=True,
            raw_args=["scripts", "append-evidence"],
        )
        code = handle_append_evidence(ctx_ok)
        self.assertEqual(code, ExitCodes.SUCCESS)
        self.assertTrue((self.case_root / "evidence" / "E-010.md").is_file())

        # 2. Duplicate ID fails with CLI_USAGE_ERROR
        code_dup = handle_append_evidence(ctx_ok)
        self.assertEqual(code_dup, ExitCodes.CLI_USAGE_ERROR)

        # 3. Missing repro_command fails
        ctx_bad = Context(
            family="scripts",
            subcommand="append-evidence",
            positionals=[],
            values={
                "case-root": str(self.case_root),
                "id": "E-011",
                "title": "Missing repro",
                "repro-command": "",
            },
            repo_root=self.case_root,
            profile_dir=self.case_root,
            mode="write",
            is_json=True,
            raw_args=["scripts", "append-evidence"],
        )
        code_missing = handle_append_evidence(ctx_bad)
        self.assertEqual(code_missing, ExitCodes.CLI_USAGE_ERROR)

    # -------------------------------------------------------------------------
    # 2. Canonical MCP Tool Bridge Invariants (from mcp-uv-runner.test.ts)
    # -------------------------------------------------------------------------

    def test_canonical_mcp_bridge_runners_and_configurations(self) -> None:
        """Verify runner, command, type, and args invariants for canonical bridges."""
        # ida-pro uses uvx
        self.assertIn("ida-pro", CANONICAL_MCP_BRIDGES)
        ida = CANONICAL_MCP_BRIDGES["ida-pro"]
        self.assertEqual(ida["runner"], "uv")
        self.assertEqual(ida["command"], "uvx")
        self.assertEqual(ida["args"], ["ida-pro-mcp"])

        # ghidra uses uv
        self.assertIn("ghidra", CANONICAL_MCP_BRIDGES)
        ghidra = CANONICAL_MCP_BRIDGES["ghidra"]
        self.assertEqual(ghidra["runner"], "uv")
        self.assertEqual(ghidra["command"], "uv")

        # playwright uses bunx stdio
        self.assertIn("playwright", CANONICAL_MCP_BRIDGES)
        pw = CANONICAL_MCP_BRIDGES["playwright"]
        self.assertEqual(pw["command"], "bunx")
        self.assertEqual(pw["type"], "stdio")
        self.assertEqual(pw["args"], ["@playwright/mcp@latest"])

        # burp-ultra uses sse with auth header
        self.assertIn("burp-ultra", CANONICAL_MCP_BRIDGES)
        burp = CANONICAL_MCP_BRIDGES["burp-ultra"]
        self.assertEqual(burp["type"], "sse")
        self.assertEqual(burp["url"], "${BURP_MCP_URL:-http://127.0.0.1:9876/}")
        self.assertEqual(
            burp["headers"],
            {"Authorization": "Bearer ${BURP_MCP_TOKEN}"},
        )

    # -------------------------------------------------------------------------
    # 3. Process Advisory File Lock Regressions (from concurrency.test.ts)
    # -------------------------------------------------------------------------

    def test_process_file_lock_mutual_exclusion(self) -> None:
        """Verify ProcessFileLock context manager acquires and releases lock file."""
        lock_file = self.case_root / ".test.lock"

        with ProcessFileLock(lock_file):
            self.assertTrue(lock_file.is_file())

        # Cleanly exits and permits subsequent acquisition
        with ProcessFileLock(lock_file):
            self.assertTrue(lock_file.is_file())

    # -------------------------------------------------------------------------
    # 4. Scope Attribution and Invariants (from scope.test.ts)
    # -------------------------------------------------------------------------

    def test_scope_attribution_precedence_and_window_validation(self) -> None:
        """Verify scope parsing, out-of-scope precedence, and window validation."""
        valid_scope = {
            "schema_version": 1,
            "engagement_id": "ENG-REGRESSION-001",
            "name": "Regression Scope Test",
            "created_at": "2026-10-13T00:00:00Z",
            "domain": "webapp",
            "auth": {
                "status": "granted",
                "basis": "Authorization Agreement",
                "reference": "AUTH-001",
                "ready_for_act": True,
            },
            "in_scope": ["https://api.target.com/*", "*.app.target.com"],
            "out_of_scope": ["https://api.target.com/admin/*", "billing.app.target.com"],
            "disallowed_actions": ["dos"],
            "window": {
                "start": "2026-10-13T00:00:00Z",
                "end": "2026-10-20T00:00:00Z",
                "timezone": "UTC",
            },
            "budget_usd": "100.00",
        }

        # 1. Valid scope parses successfully
        import json
        doc = parse_scope(json.dumps(valid_scope))
        self.assertEqual(doc["engagement_id"], "ENG-REGRESSION-001")

        # 2. In-scope target attributes correctly
        attr_in = attribute_target("https://api.target.com/v1/users", doc)
        self.assertEqual(attr_in["status"], "in_scope")

        # 3. Out-of-scope exclusion wins precedence over in-scope wildcard
        attr_out = attribute_target("https://api.target.com/admin/settings", doc)
        self.assertEqual(attr_out["status"], "out_of_scope")

        # 4. Inverted window (start >= end) fails validation
        bad_scope = dict(valid_scope)
        bad_scope["window"] = {
            "start": "2026-10-20T00:00:00Z",
            "end": "2026-10-13T00:00:00Z",
            "timezone": "UTC",
        }
        with self.assertRaises(ValueError):
            parse_scope(json.dumps(bad_scope))


if __name__ == "__main__":
    unittest.main()
