"""Burp Suite MCP Stdio Bridge - Python port of mcp-bridge.js.

Bridges the Burp Suite HTTP API (port 9876) to standard MCP stdio protocol.
Enables MCP clients (Claude Code, Cursor, Pi, OMP) to access all Burp Suite tools
via 'arsenal scripts burp-mcp-bridge'.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes
from mcp.server.lowlevel import NotificationOptions, Server
import mcp.types as mcp_types
from mcp.server.stdio import stdio_server

DEFAULT_BURP_HOST = os.environ.get("BURP_MCP_HOST", "127.0.0.1")
DEFAULT_BURP_PORT = int(os.environ.get("BURP_MCP_PORT", "9876"))


def resolve_token() -> str | None:
    """Resolve Burp MCP auth token from environment or ~/.burp-mcp-token."""
    token = os.environ.get("BURP_MCP_TOKEN")
    if token:
        return token.strip()
    token_file = Path.home() / ".burp-mcp-token"
    if token_file.is_file():
        try:
            return token_file.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    return None


TOOL_DESCRIPTIONS: dict[str, str] = {
    "proxy_history": "Get Burp proxy history with optional filtering by URL, method, status code",
    "proxy_detail": "Get full request/response details for a specific proxy history item by index",
    "proxy_websocket": "Get WebSocket message history",
    "proxy_clear": "Clear proxy history",
    "proxy_history_filtered": "Filter proxy history by annotation color or notes",
    "send_request": "Send an HTTP request through Burp and get the response",
    "send_to_repeater": "Send a raw request to Burp Repeater tab",
    "repeater_send": "Send a request and get response (like Repeater)",
    "repeater_modify_send": "Modify headers/body of a request then send it",
    "send_to_intruder": "Send a request to Burp Intruder",
    "intruder_attack": "Run a numeric range brute force attack (synchronous)",
    "intruder_attack_async": "Run a multi-threaded numeric range brute force attack",
    "intruder_attack_wordlist": "Run a wordlist-based attack",
    "intruder_pitchfork": "Run a Pitchfork attack (parallel multi-param)",
    "intruder_cluster_bomb": "Run a Cluster Bomb attack (cartesian product multi-param)",
    "intruder_battering_ram": "Run a Battering Ram attack (same payload all positions)",
    "intruder_with_options": "Run attack with advanced options (throttle, encoding, grep, timing)",
    "sitemap": "Get site map entries with optional URL prefix filter",
    "target_info": "Get target information (hosts, technologies detected)",
    "intercept_toggle": "Enable or disable proxy intercept",
    "encode": "Encode a string (base64, url, hex)",
    "decode": "Decode a string (base64, url)",
    "convert_request": "Convert HTTP request method (e.g. GET to POST)",
    "export_request": "Export a request as curl command",
    "generate_csrf_poc": "Generate a CSRF proof-of-concept HTML page",
    "extract_from_response": "Extract data from a response using regex",
    "payload_process": "Process a payload (hash, encode, reverse, etc.)",
    "scan": "Start a vulnerability scan",
    "scan_active": "Start active scan on a specific request",
    "scan_results": "Get scan results (discovered vulnerabilities)",
    "scan_issue_detail": "Get detailed information about a specific scan issue",
    "crawl": "Start crawling a URL (adds to scope)",
    "get_scope": "Check if a URL is in Burp scope",
    "add_to_scope": "Add a URL to Burp scope",
    "remove_from_scope": "Remove a URL from Burp scope",
    "collaborator_generate": "Generate Burp Collaborator payloads for OOB testing",
    "collaborator_poll": "Poll for Collaborator interactions (DNS/HTTP callbacks)",
    "search_history": "Search proxy history with regex (in URL, request, or response)",
    "highlight": "Highlight a proxy history item with a color",
    "annotate": "Add a note/annotation to a proxy history item",
    "compare": "Compare two proxy history responses (diff)",
    "export_config": "Export Burp project configuration as JSON",
    "import_config": "Import Burp project configuration from JSON",
    "set_upstream_proxy": "Set upstream proxy (SOCKS/HTTP) for all Burp traffic",
    "set_dns_override": "Override DNS resolution for a hostname",
    "set_http2": "Enable or disable HTTP/2",
    "cookie_jar": "View cookies in Burp cookie jar (with optional domain filter)",
    "token_analysis": "Analyze token entropy and randomness",
    "sequencer": "Analyze a batch of tokens for randomness quality",
    "save_project": "Save the current Burp project",
    "burp_version": "Get Burp Suite version information",
    "add_issue": "Manually add a vulnerability issue to the site map",
    "register_http_handler": "Register an auto-modify rule for HTTP requests (add header or replace text)",
    "remove_http_handler": "Remove/clear HTTP handler rules",
    "register_proxy_rule": "Register a proxy intercept rule (intercept URLs containing a string)",
    "remove_proxy_rule": "Remove/clear proxy intercept rules",
    "extensions_list": "Get information about loaded extensions",
    "log": "Write a message to Burp extension output log",
    "audit_log": "View audit log entries",
    "privacy_mode": "Set privacy mode (strict/off)",
    "scope_gate": "Enable/disable scope gate",
    "inline_fuzzer": "FUZZ marker fuzzing",
    "race_condition": "Race condition testing",
    "access_control_sweep": "Test different auth levels",
    "injection_probe": "SQLi/SSTI/LFI probe",
    "jwt_attack": "JWT attacks (alg:none)",
    "jwt_decode": "Decode JWT tokens",
    "session_remove_rule": "Remove session rule",
    "session_list_rules": "List session rules",
    "session_create_rule": "Create session handling rule",
    "passive_intel": "Extract secrets from proxy history",
    "websocket_list": "List active WebSockets",
    "websocket_close": "Close WebSocket",
    "websocket_send_binary": "Send binary on WebSocket",
    "websocket_send_text": "Send text on WebSocket",
    "websocket_create": "Create WebSocket connection",
    "send_request_parallel": "Send parallel HTTP requests",
    "cookie_jar_set": "Set cookie in Burp cookie jar",
}

TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "proxy_history": {"limit": {"type": "number", "description": "Max items"}, "offset": {"type": "number"}, "url_filter": {"type": "string"}, "method_filter": {"type": "string"}, "status_filter": {"type": "number"}},
    "proxy_detail": {"index": {"type": "number", "description": "History item index"}},
    "proxy_websocket": {"limit": {"type": "number"}},
    "proxy_history_filtered": {"has_notes": {"type": "string"}, "color": {"type": "string"}, "limit": {"type": "number"}},
    "send_request": {"method": {"type": "string"}, "url": {"type": "string", "description": "Full URL"}, "body": {"type": "string"}, "headers": {"type": "object"}},
    "repeater_send": {"request": {"type": "string", "description": "Raw HTTP request"}, "host": {"type": "string"}, "port": {"type": "number"}, "https": {"type": "boolean"}},
    "repeater_modify_send": {"request": {"type": "string"}, "host": {"type": "string"}, "port": {"type": "number"}, "https": {"type": "boolean"}, "replace_header": {"type": "object"}, "add_header": {"type": "object"}, "replace_body": {"type": "string"}},
    "send_to_repeater": {"request": {"type": "string"}, "tab_name": {"type": "string"}},
    "send_to_intruder": {"request": {"type": "string"}},
    "intruder_attack": {"url_template": {"type": "string"}, "from": {"type": "number"}, "to": {"type": "number"}, "pad_digits": {"type": "number"}, "method": {"type": "string"}, "headers": {"type": "object"}, "success_length_not": {"type": "number"}, "success_contains": {"type": "string"}},
    "sitemap": {"url_prefix": {"type": "string"}, "limit": {"type": "number"}},
    "target_info": {"url": {"type": "string"}},
    "intercept_toggle": {"enable": {"type": "boolean"}},
    "encode": {"input": {"type": "string"}, "type": {"type": "string", "description": "base64, url, or hex"}},
    "decode": {"input": {"type": "string"}, "type": {"type": "string", "description": "base64 or url"}},
    "convert_request": {"request": {"type": "string"}, "convert_to": {"type": "string"}},
    "export_request": {"request": {"type": "string"}, "host": {"type": "string"}, "format": {"type": "string", "description": "curl or python"}, "https": {"type": "boolean"}},
    "generate_csrf_poc": {"request": {"type": "string"}, "host": {"type": "string"}, "https": {"type": "boolean"}},
    "extract_from_response": {"index": {"type": "number"}, "regex": {"type": "string"}},
    "payload_process": {"input": {"type": "string"}, "operation": {"type": "string"}},
    "scan_active": {"request": {"type": "string"}, "host": {"type": "string"}, "port": {"type": "number"}, "https": {"type": "boolean"}},
    "scan_results": {"limit": {"type": "number"}},
    "scan_issue_detail": {"index": {"type": "number"}},
    "crawl": {"url": {"type": "string"}},
    "get_scope": {"url": {"type": "string"}},
    "add_to_scope": {"url": {"type": "string"}},
    "remove_from_scope": {"url": {"type": "string"}},
    "collaborator_generate": {"count": {"type": "number"}},
    "search_history": {"regex": {"type": "string"}, "search_in": {"type": "string"}, "limit": {"type": "number"}},
    "highlight": {"index": {"type": "number"}, "color": {"type": "string"}},
    "annotate": {"index": {"type": "number"}, "note": {"type": "string"}},
    "compare": {"index1": {"type": "number"}, "index2": {"type": "number"}},
    "import_config": {"config": {"type": "string"}},
    "set_upstream_proxy": {"proxy_host": {"type": "string"}, "proxy_port": {"type": "number"}, "type": {"type": "string"}},
    "set_dns_override": {"hostname": {"type": "string"}, "ip": {"type": "string"}},
    "set_http2": {"enable": {"type": "boolean"}},
    "cookie_jar": {"limit": {"type": "number"}, "domain": {"type": "string"}},
    "token_analysis": {"tokens": {"type": "array", "items": {"type": "string"}}},
    "sequencer": {"tokens": {"type": "array", "items": {"type": "string"}}},
    "add_issue": {"name": {"type": "string"}, "url": {"type": "string"}, "detail": {"type": "string"}, "severity": {"type": "string"}, "confidence": {"type": "string"}},
    "register_http_handler": {"header_name": {"type": "string"}, "header_value": {"type": "string"}, "match": {"type": "string"}, "replace": {"type": "string"}},
    "register_proxy_rule": {"url_contains": {"type": "string"}},
    "log": {"message": {"type": "string"}, "level": {"type": "string"}},
    "audit_log": {"limit": {"type": "number"}},
    "privacy_mode": {"mode": {"type": "string"}},
    "scope_gate": {"action": {"type": "string"}},
    "inline_fuzzer": {"template": {"type": "string"}, "host": {"type": "string"}, "wordlist": {"type": "array"}},
    "race_condition": {"request": {"type": "string"}, "host": {"type": "string"}, "count": {"type": "number"}},
    "access_control_sweep": {"request": {"type": "string"}, "host": {"type": "string"}, "auth_headers": {"type": "string"}},
    "injection_probe": {"url": {"type": "string"}, "param": {"type": "string"}, "type": {"type": "string"}},
    "jwt_attack": {"token": {"type": "string"}, "attack": {"type": "string"}},
    "jwt_decode": {"token": {"type": "string"}},
    "passive_intel": {"limit": {"type": "number"}},
    "websocket_list": {},
    "websocket_close": {"id": {"type": "string"}},
    "websocket_send_binary": {"id": {"type": "string"}, "data": {"type": "string"}},
    "websocket_send_text": {"id": {"type": "string"}, "text": {"type": "string"}},
    "websocket_create": {"host": {"type": "string"}, "port": {"type": "number"}},
    "send_request_parallel": {"requests": {"type": "array"}},
    "cookie_jar_set": {"url": {"type": "string"}, "name": {"type": "string"}, "value": {"type": "string"}},
}


class BurpHttpClient:
    """HTTP client communicating with Burp Suite MCP REST API."""

    def __init__(self, host: str = DEFAULT_BURP_HOST, port: int = DEFAULT_BURP_PORT, token: str | None = None):
        self.host = host
        self.port = port
        self.token = token or resolve_token()

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def fetch_tools(self) -> list[str]:
        """Fetch available tool names from Burp Suite extension."""
        url = f"http://{self.host}:{self.port}/tools"
        req = urllib.request.Request(url, headers=self._headers(), method="GET")
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            data = resp.read().decode("utf-8")
            return json.loads(data)

    def call_tool(self, tool_name: str, params: dict[str, Any]) -> Any:
        """Execute a tool via Burp Suite HTTP API."""
        url = f"http://{self.host}:{self.port}/"
        body = json.dumps({"tool": tool_name, "params": params or {}}).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers=self._headers(), method="POST")
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            data = resp.read().decode("utf-8")
            try:
                return json.loads(data)
            except Exception:
                return {"result": data}


def build_tool_definitions(tool_names: list[str]) -> list[dict[str, Any]]:
    """Format tools into MCP Tool schemas."""
    definitions = []
    for name in tool_names:
        definitions.append({
            "name": f"burp_{name}",
            "description": TOOL_DESCRIPTIONS.get(name, f"Burp Suite tool: {name}"),
            "inputSchema": {
                "type": "object",
                "properties": TOOL_SCHEMAS.get(name, {}),
            },
        })
    return definitions


class BurpMcpServer:
    """Official MCP SDK v1 low-level server backed by Burp's REST API."""

    def __init__(self, client: BurpHttpClient):
        self.client = client
        self.tools_cache: list[str] | None = None
        self.server = Server("burpsuite-mcp")
        self._register_handlers()

    def ensure_tools(self) -> list[str]:
        if self.tools_cache is None:
            self.tools_cache = self.client.fetch_tools()
        return self.tools_cache

    def _register_handlers(self) -> None:
        @self.server.list_tools()
        async def list_tools() -> list[mcp_types.Tool]:
            tools = self.ensure_tools()
            return [
                mcp_types.Tool(
                    name=definition["name"],
                    description=definition["description"],
                    inputSchema=definition["inputSchema"],
                )
                for definition in build_tool_definitions(tools)
            ]

        @self.server.call_tool()
        async def call_tool(name: str, arguments: dict[str, Any]) -> list[mcp_types.ContentBlock]:
            tool_name = name.removeprefix("burp_")
            result = await asyncio.to_thread(self.client.call_tool, tool_name, arguments or {})
            return [
                mcp_types.TextContent(
                    type="text",
                    text=json.dumps(result, indent=2),
                )
            ]

    async def run(self) -> None:
        async with stdio_server() as (read_stream, write_stream):
            await self.server.run(
                read_stream,
                write_stream,
                self.server.create_initialization_options(
                    notification_options=NotificationOptions(tools_changed=True),
                ),
            )


def run_bridge(host: str = DEFAULT_BURP_HOST, port: int = DEFAULT_BURP_PORT) -> int:
    """Run the Burp Suite bridge through the official MCP SDK stdio transport."""
    client = BurpHttpClient(host=host, port=port)
    asyncio.run(BurpMcpServer(client).run())
    return 0

def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal scripts burp-mcp-bridge'."""
    parser = argparse.ArgumentParser(
        prog="arsenal scripts burp-mcp-bridge",
        description="Burp Suite MCP stdio bridge server",
    )
    parser.add_argument("--host", default=DEFAULT_BURP_HOST, help="Burp HTTP API host")
    parser.add_argument("--port", type=int, default=DEFAULT_BURP_PORT, help="Burp HTTP API port")

    argv = list(ctx.positionals)
    if ctx.remainder:
        argv.extend(ctx.remainder)

    try:
        args, _ = parser.parse_known_args(argv)
        return run_bridge(host=args.host, port=args.port)
    except Exception as exc:
        return ctx.fail(str(exc), code=ExitCodes.ENVIRONMENT_UNAVAILABLE)
