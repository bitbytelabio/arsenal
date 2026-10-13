"""Arsenal Shared MCP Core.

Canonical tool bridge definitions, schemas, structural validation,
merge engine, state evaluation, and official MCP SDK live verification.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

DEFAULT_MCP_SCHEMA: Final[str] = (
    "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json"
)

CANONICAL_MCP_BRIDGES: Final[dict[str, dict[str, Any]]] = {
    "ida-pro": {
        "type": "stdio",
        "command": "uvx",
        "args": ["ida-pro-mcp"],
        "runner": "uv",
        "binaryPrereq": "uvx",
        "description": "IDA Pro MCP bridge (mrexodia/ida-pro-mcp)",
    },
    "ghidra": {
        "type": "stdio",
        "command": "uv",
        "args": ["run", "-m", "ghidra_mcp"],
        "runner": "uv",
        "binaryPrereq": "ghidra",
        "description": "Ghidra headless decompiler bridge",
    },
    "jshook": {
        "type": "stdio",
        "command": "node",
        "args": ["jshookmcp.js"],
        "runner": "node",
        "binaryPrereq": "node",
        "description": "JavaScript runtime function hooking bridge",
    },
    "burp-ultra": {
        "type": "sse",
        "url": "${BURP_MCP_URL:-http://127.0.0.1:9876/}",
        "headers": {
            "Authorization": "Bearer ${BURP_MCP_TOKEN}",
        },
        "runner": "none",
        "description": "Burp Suite professional HTTP/S interception bridge (BurpMCP-Ultra)",
    },
    "playwright": {
        "type": "stdio",
        "command": "bunx",
        "args": ["@playwright/mcp@latest"],
        "runner": "node",
        "binaryPrereq": "bunx",
        "description": "Headless browser automation bridge",
    },
    "rea": {
        "type": "stdio",
        "command": "bunx",
        "args": ["rea-agents@6.4.0", "mcp"],
        "runner": "node",
        "binaryPrereq": "bunx",
        "description": "Reverse engineering assistant bridge (morluto/rea)",
    },
}


def build_canonical_server_entry(
    definition: dict[str, Any], enabled: bool = False
) -> dict[str, Any]:
    """Construct an initial mcpServers entry from a canonical definition."""
    entry: dict[str, Any] = {
        "type": definition["type"],
        "enabled": enabled,
    }
    if "command" in definition:
        entry["command"] = definition["command"]
    if "args" in definition:
        entry["args"] = list(definition["args"])
    if "url" in definition:
        entry["url"] = definition["url"]
    if "headers" in definition:
        entry["headers"] = dict(definition["headers"])
    return entry


def create_canonical_mcp_catalog(
    bridges: dict[str, dict[str, Any]] = CANONICAL_MCP_BRIDGES,
) -> dict[str, Any]:
    """Construct full canonical MCP catalog with all bridges present and disabled."""
    servers: dict[str, dict[str, Any]] = {}
    for name, defn in bridges.items():
        servers[name] = build_canonical_server_entry(defn, enabled=False)
    return {
        "$schema": DEFAULT_MCP_SCHEMA,
        "mcpServers": servers,
    }


def parse_and_validate_mcp_config(
    raw: Any,
) -> tuple[bool, dict[str, Any] | None, str | None]:
    """Validate MCP JSON configuration structure.

    Returns (is_valid, parsed_dict, error_message).
    """
    if isinstance(raw, (str, bytes)):
        try:
            parsed = json.loads(raw)
        except Exception:
            return False, None, "Invalid JSON syntax"
    elif isinstance(raw, dict):
        parsed = raw
    else:
        return False, None, "Root MCP configuration must be a JSON object"

    if not isinstance(parsed, dict) or isinstance(parsed, list):
        return False, None, "Root MCP configuration must be a JSON object"

    schema = parsed.get("$schema")
    if schema is not None and not isinstance(schema, str):
        return False, None, "Property '$schema' must be a string"

    servers = parsed.get("mcpServers")
    if servers is not None:
        if not isinstance(servers, dict) or isinstance(servers, list):
            return (
                False,
                None,
                "Property 'mcpServers' must be a JSON object mapping server names to server configs",
            )
        for name, s_val in servers.items():
            if not isinstance(s_val, dict) or isinstance(s_val, list):
                return False, None, f"Server '{name}' in 'mcpServers' must be a JSON object"
            s = s_val
            if "type" in s and not isinstance(s["type"], str):
                return False, None, f"Server '{name}' property 'type' must be a string"
            if "command" in s and not isinstance(s["command"], str):
                return False, None, f"Server '{name}' property 'command' must be a string"
            if "args" in s:
                if not isinstance(s["args"], list) or not all(
                    isinstance(a, str) for a in s["args"]
                ):
                    return False, None, f"Server '{name}' property 'args' must be an array of strings"
            if "url" in s and not isinstance(s["url"], str):
                return False, None, f"Server '{name}' property 'url' must be a string"
            if "headers" in s:
                if not isinstance(s["headers"], dict) or not all(
                    isinstance(v, str) for v in s["headers"].values()
                ):
                    return (
                        False,
                        None,
                        f"Server '{name}' property 'headers' must be an object with string values",
                    )
            if "env" in s:
                if not isinstance(s["env"], dict) or not all(
                    isinstance(v, str) for v in s["env"].values()
                ):
                    return (
                        False,
                        None,
                        f"Server '{name}' property 'env' must be an object with string values",
                    )
            if "enabled" in s and not isinstance(s["enabled"], bool):
                return False, None, f"Server '{name}' property 'enabled' must be a boolean"

    for list_field in ("disabledServers", "enabledServers", "denied", "allowed"):
        val = parsed.get(list_field)
        if val is not None:
            if not isinstance(val, list) or not all(isinstance(item, str) for item in val):
                return False, None, f"Property '{list_field}' must be an array of strings"

    return True, parsed, None


def merge_mcp_config_with_defaults(
    existing: dict[str, Any] | None = None,
    server_names_to_install: list[str] | None = None,
    canonical_bridges: dict[str, dict[str, Any]] = CANONICAL_MCP_BRIDGES,
) -> dict[str, Any]:
    """Idempotently merge canonical defaults into an existing configuration."""
    result: dict[str, Any] = dict(existing) if existing else {}

    if "$schema" not in result:
        result["$schema"] = DEFAULT_MCP_SCHEMA

    existing_servers = dict(result.get("mcpServers") or {})
    merged_servers: dict[str, Any] = {}

    for name, cfg in existing_servers.items():
        merged_servers[name] = dict(cfg) if isinstance(cfg, dict) else cfg

    target_names = server_names_to_install or list(canonical_bridges.keys())
    for name in target_names:
        if name not in merged_servers:
            defn = canonical_bridges.get(name)
            if defn:
                merged_servers[name] = build_canonical_server_entry(defn, enabled=False)

    result["mcpServers"] = merged_servers
    return result


@dataclass
class ServerStateEvaluation:
    effective_state: str  # "enabled" | "disabled" | "denied"
    origin_layer: str  # "profile" | "project" | "preset"
    reason: str | None = None


def evaluate_server_state(
    server_id: str,
    scope: str,
    target_config: dict[str, Any],
    profile_config: dict[str, Any] | None = None,
) -> ServerStateEvaluation:
    """Compute effective server state taking precedence and allow/deny lists into account."""
    target_servers = target_config.get("mcpServers") or {}
    target_entry = target_servers.get(server_id)

    # 1. Profile denylist precedence
    if profile_config:
        prof_disabled = profile_config.get("disabledServers") or []
        prof_denied = profile_config.get("denied") or []
        if server_id in prof_disabled or server_id in prof_denied:
            return ServerStateEvaluation(
                effective_state="denied",
                origin_layer="profile",
                reason="Explicitly denied in operator profile",
            )

    # 2. Scope denylist precedence
    tgt_disabled = target_config.get("disabledServers") or []
    tgt_denied = target_config.get("denied") or []
    if server_id in tgt_disabled or server_id in tgt_denied:
        return ServerStateEvaluation(
            effective_state="denied",
            origin_layer=scope,
            reason="Explicitly denied",
        )

    # 3. Allowlist overrides explicit false
    is_allowed_in_profile = bool(
        profile_config
        and (
            server_id in (profile_config.get("enabledServers") or [])
            or server_id in (profile_config.get("allowed") or [])
        )
    )
    is_allowed_in_target = bool(
        server_id in (target_config.get("enabledServers") or [])
        or server_id in (target_config.get("allowed") or [])
    )

    if is_allowed_in_profile or is_allowed_in_target:
        origin = scope if target_entry else ("profile" if is_allowed_in_profile else scope)
        return ServerStateEvaluation(
            effective_state="enabled",
            origin_layer=origin,
        )

    # 4. Target entry configuration
    if target_entry is not None:
        if target_entry.get("enabled") is False:
            return ServerStateEvaluation(
                effective_state="disabled",
                origin_layer=scope,
                reason="Explicitly disabled",
            )
        # Absent enabled property defaults to True on an existing entry
        return ServerStateEvaluation(
            effective_state="enabled",
            origin_layer=scope,
        )

    # 5. Unconfigured preset default
    return ServerStateEvaluation(
        effective_state="disabled",
        origin_layer="preset",
    )


def interpolate_env(text: str) -> str:
    """Interpolate ${VAR:-default} and ${VAR} from environment at runtime only."""
    pattern = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")

    def repl(m: re.Match[str]) -> str:
        var_name = m.group(1)
        default_val = m.group(2)
        val = os.environ.get(var_name)
        if val is not None and val != "":
            return val
        if default_val is not None:
            return default_val
        return ""

    return pattern.sub(repl, text)


def load_dotenv_without_override(paths: list[Path]) -> None:
    """Load key-value pairs from .env files without overwriting existing OS environment variables."""
    try:
        from dotenv import dotenv_values

        for p in paths:
            if p.is_file():
                vals = dotenv_values(p)
                for k, v in vals.items():
                    if k and v is not None and k not in os.environ:
                        os.environ[k] = v
    except ImportError:
        pass


def sanitize_url(url: str) -> str:
    """Sanitize user credentials and tokens from URL strings."""
    try:
        import urllib.parse

        parsed = urllib.parse.urlsplit(url)
        if not parsed.scheme or not parsed.netloc:
            return url

        netloc = parsed.netloc
        if "@" in netloc:
            userinfo, hostpart = netloc.split("@", 1)
            if ":" in userinfo:
                username, _ = userinfo.split(":", 1)
                userinfo = f"{username}:[REDACTED]"
            else:
                userinfo = "[REDACTED]"
            netloc = f"{userinfo}@{hostpart}"

        query = parsed.query
        if query:
            q_pairs = urllib.parse.parse_qsl(query, keep_blank_values=True)
            sensitive_keys = {"token", "auth", "key", "access_token", "api_key", "secret", "password"}
            new_pairs = [
                (k, "[REDACTED]") if k.lower() in sensitive_keys else (k, v)
                for k, v in q_pairs
            ]
            query = urllib.parse.urlencode(new_pairs)

        return urllib.parse.urlunsplit((parsed.scheme, netloc, parsed.path, query, parsed.fragment))
    except Exception:
        return url


def sanitize_credentials(message: str) -> str:
    """Remove Bearer tokens, passwords, and sensitive query tokens from output text."""
    redacted = re.sub(r"(?i)bearer\s+[^\s\"']+", "Bearer [REDACTED]", message)
    redacted = re.sub(r"(?i)authorization['\":\s]+bearer\s+[^\s\"']+", "Authorization: Bearer [REDACTED]", redacted)
    redacted = re.sub(r"(?i)basic\s+[A-Za-z0-9+/=]+", "Basic [REDACTED]", redacted)
    redacted = re.sub(r"(?i)(token|password|secret|api_key|access_token)=([^\s&\"']+)", r"\1=[REDACTED]", redacted)
    redacted = re.sub(r"(https?://[^:/@\s]+):([^/@\s]+)@", r"\1:[REDACTED]@", redacted)
    return redacted


async def _probe_live_server_async(
    server_id: str,
    entry: dict[str, Any],
    http_client: Any = None,
) -> tuple[bool, str | None]:
    """Execute real live MCP tool enumeration using official MCP SDK v1."""
    server_type = entry.get("type", "stdio")

    try:
        from mcp import ClientSession

        if server_type == "stdio":
            from mcp import StdioServerParameters
            from mcp.client.stdio import stdio_client

            command = entry.get("command")
            if not command:
                return False, "Missing command for stdio server"

            args = [interpolate_env(str(a)) for a in entry.get("args", [])]
            raw_env = entry.get("env") or {}
            env_vars = {k: interpolate_env(str(v)) for k, v in raw_env.items()}
            full_env = {**os.environ, **env_vars} if env_vars else None

            params = StdioServerParameters(
                command=command,
                args=args,
                env=full_env,
            )
            async with stdio_client(params) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    await session.list_tools()
            return True, None

        elif server_type in ("sse", "http", "streamable_http"):
            url_raw = entry.get("url")
            if not url_raw:
                return False, f"Missing url for {server_type} server"
            url = interpolate_env(url_raw)

            headers_raw = entry.get("headers") or {}
            headers = {k: interpolate_env(str(v)) for k, v in headers_raw.items()}

            if server_type == "sse":
                from mcp.client.sse import sse_client

                try:
                    async with sse_client(url=url, headers=headers) as (read_stream, write_stream):
                        async with ClientSession(read_stream, write_stream) as session:
                            await session.initialize()
                            await session.list_tools()
                    return True, None
                except Exception as sse_err:
                    # OMP profiles use type: 'sse' for generic remote endpoints (e.g. Burp Ultra);
                    # if SSE transport fails, auto-negotiate with standard streamable_http_client
                    try:
                        import httpx
                        from mcp.client.streamable_http import streamable_http_client

                        if http_client is not None:
                            async with streamable_http_client(url=url, http_client=http_client) as (read_stream, write_stream, _):
                                async with ClientSession(read_stream, write_stream) as session:
                                    await session.initialize()
                                    await session.list_tools()
                        else:
                            async with httpx.AsyncClient(headers=headers) as client:
                                async with streamable_http_client(url=url, http_client=client) as (read_stream, write_stream, _):
                                    async with ClientSession(read_stream, write_stream) as session:
                                        await session.initialize()
                                        await session.list_tools()
                        return True, None
                    except Exception:
                        safe_url = sanitize_url(url)
                        return False, f"Live probe failed at {safe_url}: {sanitize_credentials(str(sse_err))}"

            else:
                import httpx
                from mcp.client.streamable_http import streamable_http_client

                if http_client is not None:
                    async with streamable_http_client(url=url, http_client=http_client) as (read_stream, write_stream, _):
                        async with ClientSession(read_stream, write_stream) as session:
                            await session.initialize()
                            await session.list_tools()
                else:
                    async with httpx.AsyncClient(headers=headers) as client:
                        async with streamable_http_client(url=url, http_client=client) as (read_stream, write_stream, _):
                            async with ClientSession(read_stream, write_stream) as session:
                                await session.initialize()
                                await session.list_tools()
                return True, None

        return False, f"Unsupported server type '{server_type}'"

    except Exception as e:
        safe_msg = sanitize_credentials(str(e))
        return False, safe_msg


def probe_live_server(
    server_id: str,
    entry: dict[str, Any],
    timeout: float = 5.0,
    http_client: Any = None,
) -> tuple[bool, str | None]:
    """Synchronous runner for live probe with bounded timeout."""
    try:
        return asyncio.run(asyncio.wait_for(_probe_live_server_async(server_id, entry, http_client=http_client), timeout=timeout))
    except asyncio.TimeoutError:
        return False, f"Live probe timed out after {timeout}s"
    except Exception as e:
        return False, sanitize_credentials(str(e))
