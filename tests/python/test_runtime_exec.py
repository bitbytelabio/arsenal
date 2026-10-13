"""Tests for native process execution, timeout handling, and stream capture."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from arsenal.common import Context, ExitCodes
from arsenal.tools import execute_command, handle_exec


class TestRuntimeExec(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temp_dir.name)
        self.evidence_dir = self.repo_root / "evidence"
        self.evidence_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_execute_command_success_and_artifact_capture(self) -> None:
        # Run python to print deterministically
        argv = [sys.executable, "-c", "import sys; print('stdout test line'); print('stderr err line', file=sys.stderr)"]
        res = execute_command(argv, cwd=self.repo_root, evidence_dir=self.evidence_dir)

        self.assertEqual(res["exitCode"], 0)
        self.assertIn("stdout test line", res["stdout"])
        self.assertIn("stderr err line", res["stderr"])
        self.assertFalse(res["timed_out"])
        self.assertIsNone(res["capture_gap"])

        # Check raw artifact files on disk
        stdout_art = self.repo_root / res["stdout_artifact"]["path"]
        stderr_art = self.repo_root / res["stderr_artifact"]["path"]
        self.assertTrue(stdout_art.is_file())
        self.assertTrue(stderr_art.is_file())
        self.assertIn("stdout test line", stdout_art.read_text(encoding="utf-8"))
        self.assertIn("stderr err line", stderr_art.read_text(encoding="utf-8"))

    def test_execute_command_timeout_kills_process_and_sets_exit_124(self) -> None:
        # Sleep for 5 seconds with a 200 ms timeout
        argv = [sys.executable, "-c", "import time; print('started'); time.sleep(5)"]
        res = execute_command(argv, cwd=self.repo_root, timeout_ms=200, evidence_dir=self.evidence_dir)

        self.assertEqual(res["exitCode"], 124)
        self.assertTrue(res["timed_out"])
        self.assertIsNotNone(res["capture_gap"])
        self.assertIn("timed out after 200ms", res["capture_gap"])

    def test_cli_exec_with_argv_remainder(self) -> None:
        ctx = Context(
            family="exec",
            subcommand=None,
            positionals=[],
            values={"json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="preview",
            is_json=True,
            raw_args=["exec", "--", sys.executable, "-c", "print('hello from cli exec')"],
            remainder=[sys.executable, "-c", "print('hello from cli exec')"],
        )
        code = handle_exec(ctx)
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
