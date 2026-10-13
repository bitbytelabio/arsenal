"""Tests for scope parsing, validation, attribution, and CLI scope operations."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from arsenal.common import Context, ExitCodes
from arsenal.scope import (
    attribute_target,
    handle_scope,
    matches_selector,
    parse_scope,
)


class TestRuntimeScope(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temp_dir.name)
        self.omp_dir = self.repo_root / ".omp"
        self.omp_dir.mkdir(parents=True, exist_ok=True)

        self.valid_scope = {
            "schema_version": 1,
            "engagement_id": "ENG-SCOPE-001",
            "name": "Scope Test Target",
            "created_at": "2026-10-13T00:00:00Z",
            "domain": "webapp",
            "auth": {
                "status": "granted",
                "basis": "Contract RoE",
                "reference": "OP-AUTH-01",
                "ready_for_act": True,
            },
            "in_scope": [
                "api.target.com",
                "https://web.target.com/*",
                "*.staging.target.com",
            ],
            "out_of_scope": [
                "billing.target.com",
                "https://api.target.com/admin/*",
            ],
            "disallowed_actions": ["dos"],
            "window": {
                "start": "2026-10-13T00:00:00Z",
                "end": "2026-10-20T00:00:00Z",
                "timezone": "UTC",
            },
            "budget_usd": 5000.0,
        }
        self.scope_file = self.omp_dir / "scope.json"
        self.scope_file.write_text(json.dumps(self.valid_scope, indent=2), encoding="utf-8")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_parse_valid_scope(self) -> None:
        doc = parse_scope(self.scope_file)
        self.assertEqual(doc["engagement_id"], "ENG-SCOPE-001")
        self.assertEqual(doc["domain"], "webapp")
        self.assertTrue(doc["auth"]["ready_for_act"])

    def test_invalid_window_start_after_end_fails(self) -> None:
        bad_scope = dict(self.valid_scope)
        bad_scope["window"] = {
            "start": "2026-10-25T00:00:00Z",
            "end": "2026-10-10T00:00:00Z",
            "timezone": "UTC",
        }
        with self.assertRaises(ValueError) as ctx:
            parse_scope(json.dumps(bad_scope))
        self.assertIn("start time must precede end time", str(ctx.exception))

    def test_exclusion_precedence_in_attribution(self) -> None:
        doc = parse_scope(self.scope_file)

        # In-scope candidate
        attr_in = attribute_target("https://web.target.com/login", doc)
        self.assertEqual(attr_in["status"], "in_scope")

        # Subdomain match
        attr_sub = attribute_target("test.staging.target.com", doc)
        self.assertEqual(attr_sub["status"], "in_scope")

        # Excluded target wins over general domain
        attr_admin = attribute_target("https://api.target.com/admin/delete", doc)
        self.assertEqual(attr_admin["status"], "out_of_scope")
        self.assertIn("out-of-scope selector", attr_admin["reason"])

        attr_billing = attribute_target("billing.target.com", doc)
        self.assertEqual(attr_billing["status"], "out_of_scope")

        # Unknown target
        attr_unknown = attribute_target("evil.com", doc)
        self.assertEqual(attr_unknown["status"], "unknown")

    def test_empty_in_scope_treated_as_incomplete_not_permitted(self) -> None:
        doc = dict(self.valid_scope)
        doc["in_scope"] = []
        attr = attribute_target("https://anywhere.com", doc)
        self.assertEqual(attr["status"], "unknown")
        self.assertIn("incomplete scope", attr["reason"])

    def test_cli_scope_show_and_add(self) -> None:
        # Show
        ctx_show = Context(
            family="scope",
            subcommand="show",
            positionals=[],
            values={"json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="check",
            is_json=True,
        )
        code = handle_scope(ctx_show)
        self.assertEqual(code, ExitCodes.SUCCESS)

        # Add target
        ctx_add = Context(
            family="scope",
            subcommand="add",
            positionals=["https://new.target.com/*"],
            values={"json": True, "target": "https://new.target.com/*"},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="write",
            is_json=True,
        )
        code_add = handle_scope(ctx_add)
        self.assertEqual(code_add, ExitCodes.SUCCESS)

        # Verify added to scope
        updated_doc = parse_scope(self.scope_file)
        self.assertIn("https://new.target.com/*", updated_doc["in_scope"])


if __name__ == "__main__":
    unittest.main()
