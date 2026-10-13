"""Tests for plugin link and pack packaging functionality."""

from __future__ import annotations

import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from arsenal.common import Context, ExitCodes
from arsenal.installation.plugin import handle_plugin


class TestInstallPlugin(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.temp_dir.name)
        self.repo_root = self.base_dir / "repo"
        self.fake_home = self.base_dir / "home"
        self.repo_root.mkdir(parents=True)
        self.fake_home.mkdir(parents=True)

        # Mock Path.home() to point to self.fake_home
        self.home_patcher = patch.object(Path, "home", return_value=self.fake_home)
        self.home_patcher.start()

        # Create plugin directory with some sample files
        self.plugin_dir = self.repo_root / "plugin"
        self.plugin_dir.mkdir(parents=True)
        (self.plugin_dir / "plugin.json").write_text('{"name": "arsenal"}', encoding="utf-8")
        (self.plugin_dir / "package.json").write_text('{"version": "3.0.2"}', encoding="utf-8")

    def tearDown(self) -> None:
        self.home_patcher.stop()
        self.temp_dir.cleanup()

    def test_link_preview_does_not_create_symlink(self) -> None:
        ctx = Context(
            family="plugin",
            subcommand="link",
            positionals=[],
            values={},
            repo_root=self.repo_root,
            profile_dir=self.fake_home,
            mode="preview",
            is_json=True,
            raw_args=["plugin", "link", "--json"],
        )
        code = handle_plugin(ctx)
        self.assertEqual(code, ExitCodes.SUCCESS)

        link_target = self.fake_home / ".omp/plugins/node_modules/arsenal"
        self.assertFalse(link_target.exists())

    def test_link_write_creates_symlink_and_refuses_without_force(self) -> None:
        ctx_write = Context(
            family="plugin",
            subcommand="link",
            positionals=[],
            values={"write": True},
            repo_root=self.repo_root,
            profile_dir=self.fake_home,
            mode="write",
            is_json=True,
            raw_args=["plugin", "link", "--write", "--json"],
        )
        code = handle_plugin(ctx_write)
        self.assertEqual(code, ExitCodes.SUCCESS)

        link_target = self.fake_home / ".omp/plugins/node_modules/arsenal"
        self.assertTrue(link_target.is_symlink())
        self.assertEqual(link_target.resolve(), self.plugin_dir.resolve())

        # Calling again without force must refuse
        code_refused = handle_plugin(ctx_write)
        self.assertEqual(code_refused, ExitCodes.MUTATION_REFUSED)

        # Calling with force must succeed
        ctx_force = Context(
            family="plugin",
            subcommand="link",
            positionals=[],
            values={"write": True, "force": True},
            repo_root=self.repo_root,
            profile_dir=self.fake_home,
            mode="write",
            is_json=True,
            raw_args=["plugin", "link", "--write", "--force", "--json"],
        )
        code_forced = handle_plugin(ctx_force)
        self.assertEqual(code_forced, ExitCodes.SUCCESS)
        self.assertTrue(link_target.is_symlink())

    def test_pack_preview_and_write_with_secrets_exclusion(self) -> None:
        dist_dir = self.base_dir / "dist"

        # Add a secret file and a regular file to plugin
        (self.plugin_dir / ".env").write_text("SECRET_KEY=leak\n", encoding="utf-8")
        (self.plugin_dir / "agent.key").write_text("PRIVATE_KEY\n", encoding="utf-8")
        (self.plugin_dir / "valid.txt").write_text("valid content\n", encoding="utf-8")

        # Preview mode
        ctx_preview = Context(
            family="plugin",
            subcommand="pack",
            positionals=[],
            values={"out": str(dist_dir)},
            repo_root=self.repo_root,
            profile_dir=self.fake_home,
            mode="preview",
            is_json=True,
            raw_args=["plugin", "pack", "--out", str(dist_dir), "--json"],
        )
        code_prev = handle_plugin(ctx_preview)
        self.assertEqual(code_prev, ExitCodes.SUCCESS)
        self.assertFalse(dist_dir.exists())

        # Write mode
        ctx_write = Context(
            family="plugin",
            subcommand="pack",
            positionals=[],
            values={"out": str(dist_dir), "write": True},
            repo_root=self.repo_root,
            profile_dir=self.fake_home,
            mode="write",
            is_json=True,
            raw_args=["plugin", "pack", "--out", str(dist_dir), "--write", "--json"],
        )
        code_write = handle_plugin(ctx_write)
        self.assertEqual(code_write, ExitCodes.SUCCESS)

        self.assertTrue((dist_dir / "marketplace.json").is_file())
        market = json.loads((dist_dir / "marketplace.json").read_text(encoding="utf-8"))
        self.assertEqual(market["name"], "arsenal")
        self.assertTrue(market["archive"].startswith("arsenal-"))

        tar_path = dist_dir / market["archive"]
        self.assertTrue(tar_path.is_file())

        with tarfile.open(tar_path, "r:gz") as tar:
            names = tar.getnames()
            # Ensure valid file is present
            self.assertTrue(any("valid.txt" in n for n in names))
            # Ensure secrets are excluded
            self.assertFalse(any(".env" in n for n in names))
            self.assertFalse(any("agent.key" in n for n in names))


if __name__ == "__main__":
    unittest.main()
