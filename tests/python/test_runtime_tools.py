"""Tests for security tool scanning, preset readiness checks, and doctor health diagnostics."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from arsenal.common import Context, ExitCodes
from arsenal.tools import handle_doctor, handle_tools


class TestRuntimeTools(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temp_dir.name)
        (self.repo_root / ".omp").mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_tools_scan_materializes_tool_index(self) -> None:
        ctx = Context(
            family="tools",
            subcommand="scan",
            positionals=[],
            values={"write": True, "json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="write",
            is_json=True,
        )
        code = handle_tools(ctx)
        self.assertEqual(code, ExitCodes.SUCCESS)

        tool_index = self.repo_root / ".omp" / "tool-index.json"
        self.assertTrue(tool_index.is_file())
        doc = json.loads(tool_index.read_text(encoding="utf-8"))
        self.assertEqual(doc["schema_version"], 1)
        self.assertIsInstance(doc["tools"], list)
        self.assertTrue(any(t["id"] == "git" for t in doc["tools"]))

    def test_tools_check_for_preset(self) -> None:
        ctx = Context(
            family="tools",
            subcommand="check",
            positionals=[],
            values={"preset": "webapp", "json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="check",
            is_json=True,
        )
        code = handle_tools(ctx)
        # webapp requires git and curl; return code is 0 if present, 1 if missing
        self.assertIn(code, (ExitCodes.SUCCESS, ExitCodes.CHECK_FAILURE))

    def test_doctor_diagnostics(self) -> None:
        ctx = Context(
            family="doctor",
            subcommand=None,
            positionals=[],
            values={"json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="check",
            is_json=True,
        )
        code = handle_doctor(ctx)
        self.assertIn(code, (ExitCodes.SUCCESS, ExitCodes.CHECK_FAILURE))


if __name__ == "__main__":
    unittest.main()
