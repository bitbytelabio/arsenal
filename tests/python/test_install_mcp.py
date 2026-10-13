"""Tests for MCP lifecycle management: scoped enable, disable, install, list, and verify."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from arsenal.common import Context, ExitCodes
from arsenal.installation.mcp import handle_mcp
from arsenal.installation.mcp_core import evaluate_server_state


class TestInstallMcp(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.temp_dir.name)
        self.repo_root = self.base_dir / "repo"
        self.profile_dir = self.base_dir / "profile with spaces"
        self.repo_root.mkdir(parents=True)
        self.profile_dir.mkdir(parents=True)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_path_isolation_fresh_profile_gets_mcp_while_repo_untouched(self) -> None:
        ctx = Context(
            family="mcp",
            subcommand="install",
            positionals=[],
            values={"write": True},
            repo_root=self.repo_root,
            profile_dir=self.profile_dir,
            mode="write",
            is_json=True,
            raw_args=["mcp", "install", "--write", "--json"],
        )
        code = handle_mcp(ctx)
        self.assertEqual(code, ExitCodes.SUCCESS)

        prof_mcp = self.profile_dir / "mcp.json"
        self.assertTrue(prof_mcp.is_file())

        repo_mcp = self.repo_root / ".omp" / "mcp.json"
        self.assertFalse(repo_mcp.exists())

    def test_path_isolation_profile_toggle_vs_project_toggle(self) -> None:
        # 1. Enable playwright in profile
        ctx_prof = Context(
            family="mcp",
            subcommand="enable",
            positionals=["playwright"],
            values={},
            repo_root=self.repo_root,
            profile_dir=self.profile_dir,
            mode="write",
            is_json=True,
            raw_args=["mcp", "enable", "playwright", "--json"],
        )
        self.assertEqual(handle_mcp(ctx_prof), ExitCodes.SUCCESS)

        prof_cfg = json.loads((self.profile_dir / "mcp.json").read_text(encoding="utf-8"))
        self.assertTrue(prof_cfg["mcpServers"]["playwright"]["enabled"])
        self.assertFalse((self.repo_root / ".omp" / "mcp.json").exists())

        # 2. Enable playwright in project scope
        ctx_proj_enable = Context(
            family="mcp",
            subcommand="enable",
            positionals=["playwright"],
            values={"scope": "project"},
            repo_root=self.repo_root,
            profile_dir=self.profile_dir,
            mode="write",
            is_json=True,
            raw_args=["mcp", "enable", "playwright", "--scope", "project", "--json"],
        )
        self.assertEqual(handle_mcp(ctx_proj_enable), ExitCodes.SUCCESS)

        proj_mcp = self.repo_root / ".omp" / "mcp.json"
        self.assertTrue(proj_mcp.is_file())
        proj_cfg = json.loads(proj_mcp.read_text(encoding="utf-8"))
        self.assertTrue(proj_cfg["mcpServers"]["playwright"]["enabled"])

        # 3. Disable in project scope
        ctx_proj_disable = Context(
            family="mcp",
            subcommand="disable",
            positionals=["playwright"],
            values={"scope": "project"},
            repo_root=self.repo_root,
            profile_dir=self.profile_dir,
            mode="write",
            is_json=True,
            raw_args=["mcp", "disable", "playwright", "--scope", "project", "--json"],
        )
        self.assertEqual(handle_mcp(ctx_proj_disable), ExitCodes.SUCCESS)

        proj_cfg_disabled = json.loads(proj_mcp.read_text(encoding="utf-8"))
        self.assertFalse(proj_cfg_disabled["mcpServers"]["playwright"]["enabled"])

        # Profile playwright remains enabled: True
        prof_cfg_after = json.loads((self.profile_dir / "mcp.json").read_text(encoding="utf-8"))
        self.assertTrue(prof_cfg_after["mcpServers"]["playwright"]["enabled"])

    def test_check_flag_causes_zero_filesystem_mutations(self) -> None:
        prof_mcp = self.profile_dir / "mcp.json"
        initial_content = '{"mcpServers": {}}'
        prof_mcp.write_text(initial_content, encoding="utf-8")

        ctx_check = Context(
            family="mcp",
            subcommand="enable",
            positionals=["rea"],
            values={"check": True},
            repo_root=self.repo_root,
            profile_dir=self.profile_dir,
            mode="check",
            is_json=True,
            raw_args=["mcp", "enable", "rea", "--check", "--json"],
        )
        self.assertEqual(handle_mcp(ctx_check), ExitCodes.SUCCESS)
        self.assertEqual(prof_mcp.read_text(encoding="utf-8"), initial_content)

        # Check flag suppresses writes even when write=True is passed
        ctx_write_check = Context(
            family="mcp",
            subcommand="install",
            positionals=[],
            values={"write": True, "check": True},
            repo_root=self.repo_root,
            profile_dir=self.profile_dir,
            mode="check",
            is_json=True,
            raw_args=["mcp", "install", "--write", "--check", "--json"],
        )
        self.assertEqual(handle_mcp(ctx_write_check), ExitCodes.SUCCESS)
        self.assertEqual(prof_mcp.read_text(encoding="utf-8"), initial_content)

    def test_effective_state_evaluation_precedence(self) -> None:
        target_config = {
            "enabledServers": ["playwright"],
            "disabledServers": ["ida-pro"],
            "mcpServers": {
                "playwright": {"type": "stdio", "enabled": False},  # Allowlist overrides explicit False
                "jshook": {"type": "stdio", "command": "node"},      # Absent enabled property defaults to True
                "ida-pro": {"type": "stdio", "enabled": True},       # Denylist wins over explicit True
            },
        }

        s_playwright = evaluate_server_state("playwright", "profile", target_config)
        self.assertEqual(s_playwright.effective_state, "enabled")

        s_jshook = evaluate_server_state("jshook", "profile", target_config)
        self.assertEqual(s_jshook.effective_state, "enabled")

        s_idapro = evaluate_server_state("ida-pro", "profile", target_config)
        self.assertEqual(s_idapro.effective_state, "denied")

        # Profile denylist overrides project allowlist
        profile_config = {"disabledServers": ["playwright"]}
        project_config = {
            "enabledServers": ["playwright"],
            "mcpServers": {"playwright": {"type": "stdio", "enabled": True}},
        }
        s_denied_by_prof = evaluate_server_state("playwright", "project", project_config, profile_config)
        self.assertEqual(s_denied_by_prof.effective_state, "denied")
        self.assertEqual(s_denied_by_prof.origin_layer, "profile")

    def test_preserves_custom_remote_burp_url_and_operator_servers(self) -> None:
        prof_mcp = self.profile_dir / "mcp.json"
        custom_burp_url = "http://remote-burp.internal:8443/"
        initial_cfg = {
            "customMeta": "operator-meta",
            "mcpServers": {
                "burp-ultra": {
                    "type": "sse",
                    "url": custom_burp_url,
                    "headers": {"Authorization": "Bearer remote-secret-token"},
                    "enabled": False,
                },
                "frida": {
                    "type": "stdio",
                    "command": "uv",
                    "args": ["run", "frida-mcp"],
                    "enabled": True,
                },
            },
        }
        prof_mcp.write_text(json.dumps(initial_cfg, indent=2), encoding="utf-8")

        # Reinstall canonical bridges
        ctx_install = Context(
            family="mcp",
            subcommand="install",
            positionals=[],
            values={"write": True},
            repo_root=self.repo_root,
            profile_dir=self.profile_dir,
            mode="write",
            is_json=True,
            raw_args=["mcp", "install", "--write", "--json"],
        )
        self.assertEqual(handle_mcp(ctx_install), ExitCodes.SUCCESS)

        cfg_after = json.loads(prof_mcp.read_text(encoding="utf-8"))
        self.assertEqual(cfg_after["customMeta"], "operator-meta")
        self.assertEqual(cfg_after["mcpServers"]["burp-ultra"]["url"], custom_burp_url)
        self.assertEqual(cfg_after["mcpServers"]["burp-ultra"]["headers"]["Authorization"], "Bearer remote-secret-token")
        self.assertTrue(cfg_after["mcpServers"]["frida"]["enabled"])
        self.assertFalse(cfg_after["mcpServers"]["ida-pro"]["enabled"])

        # Enable burp-ultra
        ctx_enable = Context(
            family="mcp",
            subcommand="enable",
            positionals=["burp-ultra"],
            values={},
            repo_root=self.repo_root,
            profile_dir=self.profile_dir,
            mode="write",
            is_json=True,
            raw_args=["mcp", "enable", "burp-ultra", "--json"],
        )
        self.assertEqual(handle_mcp(ctx_enable), ExitCodes.SUCCESS)

        cfg_enabled = json.loads(prof_mcp.read_text(encoding="utf-8"))
        self.assertEqual(cfg_enabled["mcpServers"]["burp-ultra"]["url"], custom_burp_url)
        self.assertTrue(cfg_enabled["mcpServers"]["burp-ultra"]["enabled"])

    def test_corrupt_config_fails_without_writes(self) -> None:
        prof_mcp = self.profile_dir / "mcp.json"
        prof_mcp.write_text("corrupt-scalar-string", encoding="utf-8")

        ctx = Context(
            family="mcp",
            subcommand="enable",
            positionals=["playwright"],
            values={"force": True},
            repo_root=self.repo_root,
            profile_dir=self.profile_dir,
            mode="write",
            is_json=True,
            raw_args=["mcp", "enable", "playwright", "--force", "--json"],
        )
        code = handle_mcp(ctx)
        self.assertEqual(code, ExitCodes.MUTATION_REFUSED)
        self.assertEqual(prof_mcp.read_text(encoding="utf-8"), "corrupt-scalar-string")

    def test_rejects_unknown_bridge_and_invalid_scope(self) -> None:
        ctx_scope = Context(
            family="mcp",
            subcommand="list",
            positionals=[],
            values={"scope": "invalid-scope"},
            repo_root=self.repo_root,
            profile_dir=self.profile_dir,
            mode="check",
            is_json=True,
            raw_args=["mcp", "list", "--scope", "invalid-scope", "--json"],
        )
        self.assertEqual(handle_mcp(ctx_scope), ExitCodes.CLI_USAGE_ERROR)

        ctx_unknown = Context(
            family="mcp",
            subcommand="enable",
            positionals=["non-existent-bridge"],
            values={},
            repo_root=self.repo_root,
            profile_dir=self.profile_dir,
            mode="write",
            is_json=True,
            raw_args=["mcp", "enable", "non-existent-bridge", "--json"],
        )
        self.assertEqual(handle_mcp(ctx_unknown), ExitCodes.CLI_USAGE_ERROR)
    def test_credential_and_url_redaction(self) -> None:
        from arsenal.installation.mcp_core import sanitize_credentials, sanitize_url

        # 1. URL with userinfo password
        url_with_pass = "http://admin:secretPass123@127.0.0.1:8080/mcp"
        self.assertEqual(sanitize_url(url_with_pass), "http://admin:[REDACTED]@127.0.0.1:8080/mcp")

        # 2. URL with query tokens
        url_with_token = "https://endpoint.local/sse?token=my-secret-token&action=stream"
        self.assertIn("token=%5BREDACTED%5D", sanitize_url(url_with_token))

        # 3. Text containing Bearer tokens with arbitrary whitespace
        msg = "Error connecting: Authorization: Bearer   sk-1234567890abcdef"
        self.assertEqual(sanitize_credentials(msg), "Error connecting: Authorization: Bearer [REDACTED]")

    def test_dotenv_loaded_without_overwriting_os_environ(self) -> None:
        from arsenal.installation.mcp_core import load_dotenv_without_override
        import os

        os.environ["TEST_EXISTING_OS_VAR"] = "keep_me"
        dot_env_path = self.profile_dir / ".env"
        dot_env_path.write_text("TEST_EXISTING_OS_VAR=overwritten\nTEST_NEW_ENV_VAR=loaded_from_dotenv\n", encoding="utf-8")

        load_dotenv_without_override([dot_env_path])
        self.assertEqual(os.environ.get("TEST_EXISTING_OS_VAR"), "keep_me")
        self.assertEqual(os.environ.get("TEST_NEW_ENV_VAR"), "loaded_from_dotenv")

    def test_streamable_http_live_transport_fastmcp(self) -> None:
        import asyncio
        import httpx
        from mcp.server.fastmcp import FastMCP
        from arsenal.installation.mcp_core import probe_live_server

        server = FastMCP("test-server")

        @server.tool()
        def ping() -> str:
            return "pong"

        app = server.streamable_http_app()

        async def run_probe():
            async with server.session_manager.run():
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://127.0.0.1:8000",
                ) as client:
                    server_entry = {
                        "type": "http",
                        "url": "http://127.0.0.1:8000/mcp",
                        "enabled": True,
                    }
                    from arsenal.installation.mcp_core import _probe_live_server_async
                    return await _probe_live_server_async(
                        "fastmcp-test",
                        server_entry,
                        client,
                    )

        ok, err = asyncio.run(run_probe())
        self.assertTrue(ok)
        self.assertIsNone(err)


if __name__ == "__main__":
    unittest.main()
