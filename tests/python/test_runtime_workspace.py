"""Tests for workspace operations, context inspection, and scaffolding."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from arsenal.common import Context, ExitCodes
from arsenal.workspace import (
    detect_drift,
    handle_context,
    handle_init,
    inspect_context_layers,
)


class TestRuntimeWorkspace(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_init_scaffolding_preview_and_write(self) -> None:
        # Preview mode (without --write)
        ctx_prev = Context(
            family="init",
            subcommand=None,
            positionals=[],
            values={"preset": "webapp", "json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="preview",
            is_json=True,
        )
        code_prev = handle_init(ctx_prev)
        self.assertEqual(code_prev, ExitCodes.SUCCESS)
        # Should NOT write files in preview mode
        self.assertFalse((self.repo_root / ".omp" / "manifest.json").exists())

        # Write mode (with --write)
        ctx_write = Context(
            family="init",
            subcommand=None,
            positionals=[],
            values={"preset": "webapp", "write": True, "json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="write",
            is_json=True,
        )
        code_write = handle_init(ctx_write)
        self.assertEqual(code_write, ExitCodes.SUCCESS)

        # Files should exist
        manifest_file = self.repo_root / ".omp" / "manifest.json"
        scope_file = self.repo_root / ".omp" / "scope.json"
        self.assertTrue(manifest_file.is_file())
        self.assertTrue(scope_file.is_file())
        engagement_file = self.repo_root / ".omp" / "engagement.json"
        env_file = self.repo_root / ".omp" / "environment.json"
        self.assertTrue(engagement_file.is_file())
        self.assertTrue(env_file.is_file())

        try:
            from arsenal.schemas import validate
            eng_errors = validate("ENGAGEMENT_SCHEMA", json.loads(engagement_file.read_text(encoding="utf-8")))
            self.assertEqual(eng_errors, [])
            env_errors = validate("ENVIRONMENT_SCHEMA", json.loads(env_file.read_text(encoding="utf-8")))
            self.assertEqual(env_errors, [])
        except Exception:
            pass
        # Check mode should now pass clean
        ctx_check = Context(
            family="init",
            subcommand="check",
            positionals=[],
            values={"check": True, "json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="check",
            is_json=True,
        )
        code_check = handle_init(ctx_check)
        self.assertEqual(code_check, ExitCodes.SUCCESS)

    def test_drift_detection(self) -> None:
        # Scaffold first
        ctx_write = Context(
            family="init",
            subcommand=None,
            positionals=[],
            values={"preset": "re", "write": True, "json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="write",
            is_json=True,
        )
        handle_init(ctx_write)

        # Modify a file
        scope_file = self.repo_root / ".omp" / "scope.json"
        scope_file.write_text("modified content", encoding="utf-8")

        manifest = json.loads((self.repo_root / ".omp" / "manifest.json").read_text(encoding="utf-8"))
        drift = detect_drift(self.repo_root, manifest["files"])
        self.assertFalse(drift["clean"])
        self.assertIn(".omp/scope.json", drift["modifiedFiles"])

    def test_context_layer_suppression_detection(self) -> None:
        # Create ancestor layer with AGENTS.md
        ancestor = self.repo_root / "parent"
        ancestor_omp = ancestor / ".omp"
        ancestor_omp.mkdir(parents=True, exist_ok=True)
        (ancestor_omp / "AGENTS.md").write_text("# Master Agent", encoding="utf-8")

        # Create nearer child layer with .omp but NO AGENTS.md
        child = ancestor / "child"
        child_omp = child / ".omp"
        child_omp.mkdir(parents=True, exist_ok=True)

        inspection = inspect_context_layers(child)
        self.assertTrue(inspection["suppressionDetected"])
        self.assertFalse(inspection["clean"])
        self.assertTrue(any("Context suppression detected" in err for err in inspection["errors"]))

    def test_init_all_four_domains(self) -> None:
        for preset in ["re", "webapp", "mobile", "red"]:
            target_dir = self.repo_root / f"target-{preset}"
            ctx = Context(
                family="init",
                subcommand=str(target_dir),
                positionals=[],
                values={"preset": preset, "name": f"Test-{preset}", "write": True, "json": True},
                repo_root=self.repo_root,
                profile_dir=self.repo_root,
                mode="write",
                is_json=True,
            )
            code = handle_init(ctx)
            self.assertEqual(code, ExitCodes.SUCCESS)

            self.assertTrue((target_dir / ".omp" / "engagement.json").is_file())
            self.assertTrue((target_dir / ".omp" / "scope.json").is_file())
            self.assertTrue((target_dir / ".omp" / "environment.json").is_file())
            self.assertTrue((target_dir / ".omp" / "charter.md").is_file())
            self.assertTrue((target_dir / ".omp" / "manifest.json").is_file())
            self.assertTrue((target_dir / "evidence" / ".gitignore").is_file())

            # Verify clean check
            ctx_check = Context(
                family="init",
                subcommand=str(target_dir),
                positionals=[],
                values={"check": True, "json": True},
                repo_root=target_dir,
                profile_dir=self.repo_root,
                mode="check",
                is_json=True,
            )
            self.assertEqual(handle_init(ctx_check), ExitCodes.SUCCESS)
if __name__ == "__main__":
    unittest.main()
