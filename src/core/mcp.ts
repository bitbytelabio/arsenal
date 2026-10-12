/**
 * Arsenal Shared MCP Core
 * Canonical tool bridge definitions, schemas, structural validation, and merge engine
 */

export const DEFAULT_MCP_SCHEMA =
  "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json";

export interface CanonicalMcpBridgeDef {
  type: "stdio" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  runner?: "uv" | "node" | "none";
  binaryPrereq?: string;
  description: string;
}

export const CANONICAL_MCP_BRIDGES: Record<string, CanonicalMcpBridgeDef> = {
  "ida-pro": {
    type: "stdio",
    command: "uvx",
    args: ["ida-pro-mcp"],
    runner: "uv",
    binaryPrereq: "uvx",
    description: "IDA Pro MCP bridge (mrexodia/ida-pro-mcp)",
  },
  ghidra: {
    type: "stdio",
    command: "uv",
    args: ["run", "-m", "ghidra_mcp"],
    runner: "uv",
    binaryPrereq: "ghidra",
    description: "Ghidra headless decompiler bridge",
  },
  jshook: {
    type: "stdio",
    command: "node",
    args: ["jshookmcp.js"],
    runner: "node",
    binaryPrereq: "node",
    description: "JavaScript runtime function hooking bridge",
  },
  "burp-ultra": {
    type: "sse",
    url: "${BURP_MCP_URL:-http://127.0.0.1:9876/}",
    headers: {
      Authorization: "Bearer ${BURP_MCP_TOKEN}",
    },
    runner: "none",
    description: "Burp Suite professional HTTP/S interception bridge (BurpMCP-Ultra)",
  },
  playwright: {
    type: "stdio",
    command: "bunx",
    args: ["@playwright/mcp@latest"],
    runner: "node",
    binaryPrereq: "bunx",
    description: "Headless browser automation bridge",
  },
  rea: {
    type: "stdio",
    command: "bunx",
    args: ["rea-agents@6.4.0", "mcp"],
    runner: "node",
    binaryPrereq: "bunx",
    description: "Reverse engineering assistant bridge (morluto/rea)",
  },
};

export interface McpServerConfig {
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface McpConfig {
  $schema?: string;
  mcpServers?: Record<string, McpServerConfig>;
  disabledServers?: string[];
  enabledServers?: string[];
  denied?: string[];
  allowed?: string[];
  [key: string]: unknown;
}

export function buildCanonicalServerEntry(
  def: CanonicalMcpBridgeDef,
  enabled = false
): McpServerConfig {
  const entry: McpServerConfig = {
    type: def.type,
    enabled,
  };
  if (def.command) entry.command = def.command;
  if (def.args) entry.args = [...def.args];
  if (def.url) entry.url = def.url;
  if (def.headers) entry.headers = { ...def.headers };
  return entry;
}

export function createCanonicalMcpCatalog(
  bridges: Record<string, CanonicalMcpBridgeDef> = CANONICAL_MCP_BRIDGES
): McpConfig {
  const mcpServers: Record<string, McpServerConfig> = {};
  for (const [name, def] of Object.entries(bridges)) {
    mcpServers[name] = buildCanonicalServerEntry(def, false);
  }
  return {
    $schema: DEFAULT_MCP_SCHEMA,
    mcpServers,
  };
}

export interface ValidationSuccess {
  ok: true;
  config: McpConfig;
}

export interface ValidationFailure {
  ok: false;
  error: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Structural validation of MCP configuration JSON
 * Validates document root, mcpServers map, individual server objects, and allow/deny lists.
 * Preserves extra keys and metadata.
 */
export function parseAndValidateMcpConfig(raw: unknown): ValidationResult {
  let parsed: unknown;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        error: "Invalid JSON syntax",
      };
    }
  } else {
    parsed = raw;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "Root MCP configuration must be a JSON object",
    };
  }

  const doc = parsed as Record<string, unknown>;

  if (doc.$schema !== undefined && typeof doc.$schema !== "string") {
    return {
      ok: false,
      error: "Property '$schema' must be a string",
    };
  }

  if (doc.mcpServers !== undefined) {
    if (typeof doc.mcpServers !== "object" || doc.mcpServers === null || Array.isArray(doc.mcpServers)) {
      return {
        ok: false,
        error: "Property 'mcpServers' must be a JSON object mapping server names to server configs",
      };
    }

    const servers = doc.mcpServers as Record<string, unknown>;
    for (const [name, sVal] of Object.entries(servers)) {
      if (typeof sVal !== "object" || sVal === null || Array.isArray(sVal)) {
        return {
          ok: false,
          error: `Server '${name}' in 'mcpServers' must be a JSON object`,
        };
      }
      const s = sVal as Record<string, unknown>;
      if (s.type !== undefined && typeof s.type !== "string") {
        return {
          ok: false,
          error: `Server '${name}' property 'type' must be a string`,
        };
      }
      if (s.command !== undefined && typeof s.command !== "string") {
        return {
          ok: false,
          error: `Server '${name}' property 'command' must be a string`,
        };
      }
      if (s.args !== undefined) {
        if (!Array.isArray(s.args) || !s.args.every((a) => typeof a === "string")) {
          return {
            ok: false,
            error: `Server '${name}' property 'args' must be an array of strings`,
          };
        }
      }
      if (s.url !== undefined && typeof s.url !== "string") {
        return {
          ok: false,
          error: `Server '${name}' property 'url' must be a string`,
        };
      }
      if (s.headers !== undefined) {
        if (
          typeof s.headers !== "object" ||
          s.headers === null ||
          Array.isArray(s.headers) ||
          !Object.values(s.headers).every((v) => typeof v === "string")
        ) {
          return {
            ok: false,
            error: `Server '${name}' property 'headers' must be an object with string values`,
          };
        }
      }
      if (s.env !== undefined) {
        if (
          typeof s.env !== "object" ||
          s.env === null ||
          Array.isArray(s.env) ||
          !Object.values(s.env).every((v) => typeof v === "string")
        ) {
          return {
            ok: false,
            error: `Server '${name}' property 'env' must be an object with string values`,
          };
        }
      }
      if (s.enabled !== undefined && typeof s.enabled !== "boolean") {
        return {
          ok: false,
          error: `Server '${name}' property 'enabled' must be a boolean`,
        };
      }
    }
  }

  // Validate allow/deny collections if present
  for (const listField of ["disabledServers", "enabledServers", "denied", "allowed"] as const) {
    if (doc[listField] !== undefined) {
      if (!Array.isArray(doc[listField]) || !doc[listField].every((item) => typeof item === "string")) {
        return {
          ok: false,
          error: `Property '${listField}' must be an array of strings`,
        };
      }
    }
  }

  return {
    ok: true,
    config: doc as McpConfig,
  };
}

/**
 * Idempotently merges canonical defaults into existing configuration.
 * Preserves all operator servers, user metadata, existing custom fields, and allow/deny lists.
 * Adds missing canonical servers disabled.
 * Sets default $schema if missing.
 */
export function mergeMcpConfigWithDefaults(
  existing?: McpConfig,
  serverNamesToInstall?: string[],
  canonicalBridges: Record<string, CanonicalMcpBridgeDef> = CANONICAL_MCP_BRIDGES
): McpConfig {
  const result: McpConfig = existing ? { ...existing } : {};

  if (!result.$schema) {
    result.$schema = DEFAULT_MCP_SCHEMA;
  }

  const existingServers = (result.mcpServers ?? {}) as Record<string, McpServerConfig>;
  const mergedServers: Record<string, McpServerConfig> = {};

  // Preserve all existing servers exactly as configured
  for (const [name, cfg] of Object.entries(existingServers)) {
    mergedServers[name] = { ...cfg };
  }

  // Add missing canonical servers disabled
  const targetNames = serverNamesToInstall ?? Object.keys(canonicalBridges);
  for (const name of targetNames) {
    if (!mergedServers[name]) {
      const def = canonicalBridges[name];
      if (def) {
        mergedServers[name] = buildCanonicalServerEntry(def, false);
      }
    }
  }

  result.mcpServers = mergedServers;
  return result;
}

export interface ServerStateEvaluation {
  effectiveState: "enabled" | "disabled" | "denied";
  originLayer: "profile" | "project" | "preset";
  reason?: string;
}

/**
 * Computes effective state of a server taking into account:
 * 1. Active profile denylist precedence over allowlist and enabled fields.
 * 2. Scope denylist precedence.
 * 3. Scope / profile allowlist precedence over explicit false.
 * 4. Explicit enabled state, or default enabled when omitted on existing entry.
 * 5. Unconfigured preset default.
 */
export function evaluateServerState(params: {
  id: string;
  scope: "profile" | "project";
  targetConfig: McpConfig;
  profileConfig?: McpConfig;
}): ServerStateEvaluation {
  const { id, scope, targetConfig, profileConfig } = params;
  const targetEntry = targetConfig.mcpServers?.[id];

  const isDeniedInProfile = Boolean(
    profileConfig?.disabledServers?.includes(id) ||
    profileConfig?.denied?.includes(id)
  );
  if (isDeniedInProfile) {
    return {
      effectiveState: "denied",
      originLayer: "profile",
      reason: "Explicitly denied in operator profile",
    };
  }

  const isDeniedInTarget = Boolean(
    targetConfig.disabledServers?.includes(id) ||
    targetConfig.denied?.includes(id)
  );
  if (isDeniedInTarget) {
    return {
      effectiveState: "denied",
      originLayer: scope,
      reason: "Explicitly denied",
    };
  }

  const isAllowedInProfile = Boolean(
    profileConfig?.enabledServers?.includes(id) ||
    profileConfig?.allowed?.includes(id)
  );
  const isAllowedInTarget = Boolean(
    targetConfig.enabledServers?.includes(id) ||
    targetConfig.allowed?.includes(id)
  );

  if (isAllowedInProfile || isAllowedInTarget) {
    return {
      effectiveState: "enabled",
      originLayer: targetEntry ? scope : (isAllowedInProfile ? "profile" : scope),
    };
  }

  if (targetEntry) {
    if (targetEntry.enabled === false) {
      return {
        effectiveState: "disabled",
        originLayer: scope,
        reason: "Explicitly disabled",
      };
    }
    return {
      effectiveState: "enabled",
      originLayer: scope,
    };
  }

  return {
    effectiveState: "disabled",
    originLayer: "preset",
  };
}
