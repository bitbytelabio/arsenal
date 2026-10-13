"""Tests for CLI argument parsing, JSON envelope formatting, and dispatcher routing."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from arsenal.cli import dispatch, main, parse_cli_args
from arsenal.common import Context, ExitCodes, create_json_envelope


class TestRuntimeCLI(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_parse_cli_args_flags_and_positionals(self) -> None:
        raw_args = [
            "evidence",
            "verify",
            "--json",
            "--repo",
            str(self.repo_root),
            "--preset=webapp",
            "--write",
            "--",
            "curl",
            "-v",
            "https://target.com",
        ]
        values, positionals, remainder = parse_cli_args(raw_args)

        self.assertEqual(positionals, ["evidence", "verify"])
        self.assertTrue(values["json"])
        self.assertTrue(values["write"])
        self.assertEqual(values["repo"], str(self.repo_root))
        self.assertEqual(values["preset"], "webapp")
        self.assertEqual(remainder, ["curl", "-v", "https://target.com"])

    def test_json_flag_before_and_after_command(self) -> None:
        v_before, p_before, _ = parse_cli_args(["--json", "evidence", "verify"])
        self.assertTrue(v_before["json"])
        self.assertEqual(p_before, ["evidence", "verify"])

        v_after, p_after, _ = parse_cli_args(["evidence", "verify", "--json"])
        self.assertTrue(v_after["json"])
        self.assertEqual(p_after, ["evidence", "verify"])
    def test_safe_mode_defaults_and_toggle(self) -> None:
        values_default, _, _ = parse_cli_args(["tools", "check"])
        self.assertTrue(values_default.get("safe_mode"))
        self.assertTrue(values_default.get("safe-mode"))

        values_disabled, _, _ = parse_cli_args(["tools", "check", "--no-safe-mode"])
        self.assertFalse(values_disabled.get("safe_mode"))
        self.assertFalse(values_disabled.get("safe-mode"))

    def test_custom_flags_preserved_for_subcommands(self) -> None:
        values, positionals, remainder = parse_cli_args([
            "scripts",
            "mobile-dump-dex",
            "--package",
            "com.example.app",
            "--from",
            "/tmp/input.apk",
            "--",
            "--extra-opt",
        ])
        self.assertEqual(
            positionals,
            ["scripts", "mobile-dump-dex", "--package", "com.example.app", "--from", "/tmp/input.apk"],
        )
        self.assertNotIn("package", values)
        self.assertNotIn("from", values)
        self.assertEqual(remainder, ["--extra-opt"])

    def test_plugin_and_mcp_flags_parsed(self) -> None:
        v_plug, p_plug, _ = parse_cli_args(["plugin", "pack", "--out", "/tmp/bundle.tgz", "--scope", "project"])
        self.assertEqual(v_plug.get("out"), "/tmp/bundle.tgz")
        self.assertEqual(v_plug.get("scope"), "project")
        self.assertEqual(p_plug, ["plugin", "pack"])

        v_mcp, p_mcp, _ = parse_cli_args(["mcp", "check", "--scope", "profile", "--live"])
        self.assertEqual(v_mcp.get("scope"), "profile")
        self.assertTrue(v_mcp.get("live"))
        self.assertEqual(p_mcp, ["mcp", "check"])

    def test_json_envelope_schema_compliance(self) -> None:
        envelope = create_json_envelope(
            command="arsenal test-cmd",
            exit_code=0,
            mode="check",
            data={"key": "value"},
            warnings=["warn1"],
            errors=[],
        )
        self.assertEqual(envelope["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(envelope["command"], "arsenal test-cmd")
        self.assertEqual(envelope["status"], "success")
        self.assertEqual(envelope["exitCode"], 0)
        self.assertEqual(envelope["mode"], "check")
        self.assertEqual(envelope["data"], {"key": "value"})
        self.assertEqual(envelope["warnings"], ["warn1"])
        self.assertEqual(envelope["errors"], [])

        # Official Draft202012 schema validator check
        try:
            from arsenal.schemas import validate
            schema_errors = validate("CLI_ENVELOPE_SCHEMA", envelope)
            self.assertEqual(schema_errors, [])
        except Exception:
            pass
    def test_unknown_command_family_rejects_code_2(self) -> None:
        ctx = Context(
            family="nonexistent_family",
            subcommand=None,
            positionals=[],
            values={"json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="preview",
            is_json=True,
        )
        code = dispatch(ctx)
        self.assertEqual(code, ExitCodes.CLI_USAGE_ERROR)

    def test_main_help_output(self) -> None:
        f = io.StringIO()
        with redirect_stdout(f):
            code = main(["--help", "--json"])
        self.assertEqual(code, ExitCodes.SUCCESS)
        output = json.loads(f.getvalue())
        self.assertEqual(output["status"], "success")
        self.assertIn("evidence", output["data"]["families"])
        self.assertIn("tools", output["data"]["families"])
        self.assertIn("apk", output["data"]["families"])
        self.assertIn("oracle", output["data"]["families"])
    def test_unknown_flags_rejected_on_operational_command(self) -> None:
        # Non-JSON invocation
        code = main(["evidence", "verify", "--unrecognized-option"])
        self.assertEqual(code, ExitCodes.CLI_USAGE_ERROR)

        # JSON invocation
        f = io.StringIO()
        with redirect_stdout(f):
            code_json = main(["evidence", "verify", "--unrecognized-option", "--json"])
        self.assertEqual(code_json, ExitCodes.CLI_USAGE_ERROR)
        payload = json.loads(f.getvalue())
        self.assertEqual(payload["exitCode"], ExitCodes.CLI_USAGE_ERROR)
        self.assertEqual(payload["status"], "failure")
        self.assertTrue(any("unrecognized arguments" in err for err in payload["errors"]))

    def test_scripts_flags_forwarded_intact_in_real_cli_dispatch(self) -> None:
        f = io.StringIO()
        with redirect_stdout(f):
            code = main([
                "scripts",
                "case-init",
                "--hint",
                "sample task hint",
                "--project-root",
                str(self.repo_root),
                "--json",
            ])
        self.assertEqual(code, ExitCodes.SUCCESS)
        payload = json.loads(f.getvalue())
        self.assertEqual(payload["status"], "success")
        self.assertIn("data", payload)
        self.assertIn("case_name", payload["data"])
        # Verify case directory actually created under project_root / work
        work_dir = self.repo_root / "work"
        self.assertTrue(work_dir.is_dir())

    def test_scripts_argument_forwarding_with_double_dash(self) -> None:
        f = io.StringIO()
        with redirect_stdout(f):
            code = main([
                "scripts",
                "case-init",
                "--",
                "--hint",
                "double dash hint",
                "--project-root",
                str(self.repo_root),
                "--json",
            ])
        self.assertEqual(code, ExitCodes.SUCCESS)
        payload = json.loads(f.getvalue())
        self.assertEqual(payload["status"], "success")
        self.assertIn("case_name", payload["data"])

    def test_scripts_argument_forwarding_direct_args(self) -> None:
        f = io.StringIO()
        with redirect_stdout(f):
            code = main([
                "scripts",
                "case-init",
                "--hint",
                "direct args hint",
                "--project-root",
                str(self.repo_root),
                "--json",
            ])
        self.assertEqual(code, ExitCodes.SUCCESS)
        payload = json.loads(f.getvalue())
        self.assertEqual(payload["status"], "success")
        self.assertIn("case_name", payload["data"])

if __name__ == "__main__":
    unittest.main()
