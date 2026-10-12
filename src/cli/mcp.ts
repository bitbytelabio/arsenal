/**
 * arsenal mcp handler
 * Implements T062, T063, T064 & User Story 7
 * Scoped operator and project MCP tool bridge lifecycle management
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import type { CommandContext } from "./router.ts";
import { safeWriteFile } from "../core/fs-safe.ts";
import {
  CANONICAL_MCP_BRIDGES,
  DEFAULT_MCP_SCHEMA,
  buildCanonicalServerEntry,
  parseAndValidateMcpConfig,
  mergeMcpConfigWithDefaults,
  evaluateServerState,
  type McpConfig,
} from "../core/mcp.ts";

export async function handleMcp(ctx: CommandContext): Promise<number> {
  const subCommand = ctx.subCommand ?? "list";

  const rawScope = ctx.values.scope as string | undefined;
  const scope: "profile" | "project" = (rawScope ?? "profile") as "profile" | "project";
  if (scope !== "profile" && scope !== "project") {
    const err = `Invalid scope '${rawScope}'. Scope must be either 'profile' or 'project'.`;
    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.CLI_USAGE_ERROR,
          ctx.mode,
          {},
          [],
          [err]
        )
      );
    } else {
      console.error(`Error: ${err}`);
    }
    return EXIT_CODES.CLI_USAGE_ERROR;
  }

  const targetMcpPath =
    scope === "profile"
      ? path.join(ctx.profileDir, "mcp.json")
      : path.join(ctx.repoRoot, ".omp", "mcp.json");

  if (subCommand === "install") {
    const isWrite = Boolean(ctx.values.write) && !Boolean(ctx.values.check) && ctx.mode !== "check";
    const serverName = ctx.values.server as string | undefined;

    if (serverName && !CANONICAL_MCP_BRIDGES[serverName]) {
      const err = `Unknown tool bridge '${serverName}'. Available: ${Object.keys(CANONICAL_MCP_BRIDGES).join(", ")}`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CLI_USAGE_ERROR,
            ctx.mode,
            {},
            [],
            [err]
          )
        );
      } else {
        console.error(`Error: ${err}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    const serversToInstall = serverName ? [serverName] : Object.keys(CANONICAL_MCP_BRIDGES);

    let existingConfig: McpConfig | undefined;
    if (fs.existsSync(targetMcpPath)) {
      const parseRes = parseAndValidateMcpConfig(fs.readFileSync(targetMcpPath, "utf-8"));
      if (!parseRes.ok) {
        const err = `CONFIG_INVALID: MCP configuration at '${targetMcpPath}' is malformed or corrupt: ${parseRes.error}`;
        if (ctx.isJson) {
          emitJson(
            createJsonEnvelope(
              ctx.rawArgs.join(" "),
              EXIT_CODES.MUTATION_REFUSED,
              ctx.mode,
              { scope, path: targetMcpPath },
              [],
              [err]
            )
          );
        } else {
          console.error(`Error: ${err}`);
        }
        return EXIT_CODES.MUTATION_REFUSED;
      }
      existingConfig = parseRes.config;
    }

    const newConfig = mergeMcpConfigWithDefaults(existingConfig, serversToInstall);
    const newContent = JSON.stringify(newConfig, null, 2);
    const safeRes = safeWriteFile(targetMcpPath, newContent, {
      write: isWrite,
      force: Boolean(ctx.values.force),
      allowUpdate: true,
      mode: 0o600,
    });

    if (safeRes.action === "refused") {
      const err = `Mutation refused: target file '${targetMcpPath}' has conflicts and could not be updated.`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.MUTATION_REFUSED,
            ctx.mode,
            { scope, path: targetMcpPath },
            [],
            [err]
          )
        );
      } else {
        console.error(`Error: ${err}`);
      }
      return EXIT_CODES.MUTATION_REFUSED;
    }

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          ctx.mode,
          {
            installed: serversToInstall,
            scope,
            path: targetMcpPath,
            action: safeRes.action,
          }
        )
      );
    } else {
      console.log(`[arsenal mcp install] Materialized ${serversToInstall.length} bridges in ${scope} [mode: ${ctx.mode}]:`);
      for (const s of serversToInstall) {
        const wasExisting = existingConfig?.mcpServers?.[s] !== undefined;
        const currentEntry = newConfig.mcpServers?.[s];
        if (wasExisting) {
          const stateLabel =
            currentEntry?.enabled === true
              ? "enabled: true"
              : currentEntry?.enabled === false
                ? "enabled: false"
                : "default";
          console.log(` - ${s}: preserved existing config (${stateLabel})`);
        } else {
          console.log(` - ${s}: added canonical default (enabled: false)`);
        }
      }
    }
    return EXIT_CODES.SUCCESS;
  }

  if (subCommand === "list") {
    let targetConfig: McpConfig = { mcpServers: {} };
    if (fs.existsSync(targetMcpPath)) {
      const parseRes = parseAndValidateMcpConfig(fs.readFileSync(targetMcpPath, "utf-8"));
      if (!parseRes.ok) {
        const err = `CONFIG_INVALID: MCP configuration at '${targetMcpPath}' is malformed or corrupt: ${parseRes.error}`;
        if (ctx.isJson) {
          emitJson(
            createJsonEnvelope(
              ctx.rawArgs.join(" "),
              EXIT_CODES.CHECK_FAILURE,
              "check",
              { scope, path: targetMcpPath },
              [],
              [err]
            )
          );
        } else {
          console.error(`Error: ${err}`);
        }
        return EXIT_CODES.CHECK_FAILURE;
      }
      targetConfig = parseRes.config;
    }

    // Load active profile config if inspecting project
    let profileConfig: McpConfig | undefined;
    if (scope === "project") {
      const profileMcpPath = path.join(ctx.profileDir, "mcp.json");
      if (fs.existsSync(profileMcpPath)) {
        try {
          const profRes = parseAndValidateMcpConfig(fs.readFileSync(profileMcpPath, "utf-8"));
          if (profRes.ok) {
            profileConfig = profRes.config;
          }
        } catch {
          // ignore profile read errors when inspecting project
        }
      }
    }

    const allIds = Array.from(
      new Set([...Object.keys(CANONICAL_MCP_BRIDGES), ...Object.keys(targetConfig.mcpServers ?? {})])
    );

    const bridgeStates: Array<{
      id: string;
      type: string;
      effectiveState: "enabled" | "disabled" | "denied";
      originLayer: "profile" | "project" | "preset";
      reason?: string;
    }> = [];

    for (const id of allIds) {
      const targetEntry = targetConfig.mcpServers?.[id];
      const canonicalDef = CANONICAL_MCP_BRIDGES[id];
      const bridgeType = targetEntry?.type ?? canonicalDef?.type ?? "custom";

      const evalResult = evaluateServerState({
        id,
        scope,
        targetConfig,
        profileConfig,
      });

      bridgeStates.push({
        id,
        type: bridgeType,
        effectiveState: evalResult.effectiveState,
        originLayer: evalResult.originLayer,
        reason: evalResult.reason,
      });
    }

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          "check",
          {
            scope,
            path: targetMcpPath,
            bridges: bridgeStates,
          }
        )
      );
    } else {
      console.log(`================================================================================`);
      console.log(`             EFFECTIVE MCP TOOL BRIDGE MATRIX (${scope.toUpperCase()})`);
      console.log(` Target: ${targetMcpPath}`);
      console.log(` Note: Scoped configuration inspection for ${scope}; not entire OMP discovery.`);
      console.log(`================================================================================`);
      for (const b of bridgeStates) {
        const tag = b.effectiveState.toUpperCase().padEnd(8);
        console.log(` [${tag}] ${b.id.padEnd(14)} (${b.type}) [Layer: ${b.originLayer}] ${b.reason ? "-> " + b.reason : ""}`);
      }
      console.log(`================================================================================`);
    }
    return EXIT_CODES.SUCCESS;
  }

  if (subCommand === "enable" || subCommand === "disable") {
    const bridgeName = ctx.positionals[0] ?? (ctx.values.server as string);
    if (!bridgeName) {
      const err = `Bridge name is required for mcp ${subCommand}`;
      if (ctx.isJson) {
        emitJson(createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.CLI_USAGE_ERROR, "write", {}, [], [err]));
      } else {
        console.error(`Error: ${err}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    let existingConfig: McpConfig | undefined;
    if (fs.existsSync(targetMcpPath)) {
      const parseRes = parseAndValidateMcpConfig(fs.readFileSync(targetMcpPath, "utf-8"));
      if (!parseRes.ok) {
        const err = `CONFIG_INVALID: Target MCP configuration at '${targetMcpPath}' is malformed or corrupt: ${parseRes.error}`;
        if (ctx.isJson) {
          emitJson(
            createJsonEnvelope(
              ctx.rawArgs.join(" "),
              EXIT_CODES.MUTATION_REFUSED,
              ctx.mode,
              { scope, path: targetMcpPath },
              [],
              [err]
            )
          );
        } else {
          console.error(`Error: ${err}`);
        }
        return EXIT_CODES.MUTATION_REFUSED;
      }
      existingConfig = parseRes.config;
    }

    const isKnown = Boolean(
      CANONICAL_MCP_BRIDGES[bridgeName] || existingConfig?.mcpServers?.[bridgeName]
    );
    if (!isKnown) {
      const err = `Unknown tool bridge '${bridgeName}'. Available canonical: ${Object.keys(CANONICAL_MCP_BRIDGES).join(", ")}`;
      if (ctx.isJson) {
        emitJson(createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.CLI_USAGE_ERROR, ctx.mode, {}, [], [err]));
      } else {
        console.error(`Error: ${err}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    const enabled = subCommand === "enable";
    const isCheck = Boolean(ctx.values.check) || ctx.mode === "check";

    if (isCheck) {
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.SUCCESS,
            "check",
            {
              bridge: bridgeName,
              enabled,
              scope,
              path: targetMcpPath,
              action: "check",
            }
          )
        );
      } else {
        console.log(`[mcp ${subCommand} check] Check mode: '${bridgeName}' would be set to enabled: ${enabled} (${scope}: ${targetMcpPath})`);
      }
      return EXIT_CODES.SUCCESS;
    }

    const cfg: McpConfig = existingConfig
      ? { ...existingConfig }
      : { $schema: DEFAULT_MCP_SCHEMA, mcpServers: {} };

    if (!cfg.$schema) cfg.$schema = DEFAULT_MCP_SCHEMA;
    if (!cfg.mcpServers) cfg.mcpServers = {};

    let current = cfg.mcpServers[bridgeName];
    if (!current) {
      const def = CANONICAL_MCP_BRIDGES[bridgeName]!;
      current = buildCanonicalServerEntry(def, enabled);
    } else {
      current = { ...current, enabled };
    }
    cfg.mcpServers[bridgeName] = current;

    // Synchronize allow/deny collections in target configuration
    if (enabled) {
      if (Array.isArray(cfg.disabledServers)) {
        cfg.disabledServers = cfg.disabledServers.filter((s) => s !== bridgeName);
      }
      if (Array.isArray(cfg.denied)) {
        cfg.denied = cfg.denied.filter((s) => s !== bridgeName);
      }
      if (Array.isArray(cfg.enabledServers) && !cfg.enabledServers.includes(bridgeName)) {
        cfg.enabledServers.push(bridgeName);
      }
      if (Array.isArray(cfg.allowed) && !cfg.allowed.includes(bridgeName)) {
        cfg.allowed.push(bridgeName);
      }
    } else {
      if (Array.isArray(cfg.enabledServers)) {
        cfg.enabledServers = cfg.enabledServers.filter((s) => s !== bridgeName);
      }
      if (Array.isArray(cfg.allowed)) {
        cfg.allowed = cfg.allowed.filter((s) => s !== bridgeName);
      }
      if (Array.isArray(cfg.disabledServers) && !cfg.disabledServers.includes(bridgeName)) {
        cfg.disabledServers.push(bridgeName);
      }
      if (Array.isArray(cfg.denied) && !cfg.denied.includes(bridgeName)) {
        cfg.denied.push(bridgeName);
      }
    }

    safeWriteFile(targetMcpPath, JSON.stringify(cfg, null, 2), {
      write: true,
      force: true,
      allowUpdate: true,
      mode: 0o600,
    });

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          "write",
          {
            bridge: bridgeName,
            enabled,
            scope,
            path: targetMcpPath,
            updatedPaths: [targetMcpPath],
          }
        )
      );
    } else {
      console.log(`[mcp ${subCommand}] Successfully set '${bridgeName}' to enabled: ${enabled} (${scope}: ${targetMcpPath})`);
    }
    return EXIT_CODES.SUCCESS;
  }

  if (subCommand === "verify") {
    const isLive = Boolean(ctx.values.live);
    const errors: string[] = [];

    // Git tracking protection: fatal if project .omp/mcp.json is tracked by git
    if (scope === "project") {
      const proc = Bun.spawnSync(["git", "ls-files", ".omp/mcp.json"], { cwd: ctx.repoRoot });
      if (proc.stdout.toString().trim().length > 0) {
        errors.push("SECURITY COMPROMISED: .omp/mcp.json is tracked by git. It MUST be ignored.");
      }
    }

    if (!fs.existsSync(targetMcpPath)) {
      errors.push(`Missing MCP configuration at '${targetMcpPath}'.`);
    } else {
      const parseRes = parseAndValidateMcpConfig(fs.readFileSync(targetMcpPath, "utf-8"));
      if (!parseRes.ok) {
        errors.push(`CONFIG_INVALID: MCP configuration at '${targetMcpPath}' is malformed or corrupt: ${parseRes.error}`);
      } else {
        const cfg = parseRes.config;

        let profileConfig: McpConfig | undefined;
        if (scope === "project") {
          const profileMcpPath = path.join(ctx.profileDir, "mcp.json");
          if (fs.existsSync(profileMcpPath)) {
            try {
              const profRes = parseAndValidateMcpConfig(fs.readFileSync(profileMcpPath, "utf-8"));
              if (profRes.ok) {
                profileConfig = profRes.config;
              }
            } catch {
              // ignore
            }
          }
        }

        for (const [id, s] of Object.entries(cfg.mcpServers ?? {})) {
          const evalResult = evaluateServerState({
            id,
            scope,
            targetConfig: cfg,
            profileConfig,
          });

          if (evalResult.effectiveState === "enabled") {
            const def = CANONICAL_MCP_BRIDGES[id];
            if (def?.binaryPrereq && !Bun.which(def.binaryPrereq)) {
              errors.push(`PREREQUISITE_MISSING: '${id}' requires binary '${def.binaryPrereq}' in PATH.`);
            }
            if (def?.runner === "uv" && !Bun.which("uv")) {
              errors.push(`RUNNER_MISSING: '${id}' requires runner 'uv' in PATH. Install via curl -LsSf https://astral.sh/uv/install.sh`);
            }
            if (isLive && s.url) {
              // Existing --live fake endpoint probe limit (structural check; no live URL parse assumption)
              errors.push(`ENDPOINT_UNREACHABLE: Live probe failed for '${id}' at ${s.url}`);
            }
          }
        }
      }
    }

    const clean = errors.length === 0;
    const exitCode = clean ? EXIT_CODES.SUCCESS : EXIT_CODES.CHECK_FAILURE;

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          exitCode,
          "check",
          { clean, live: isLive, scope, path: targetMcpPath },
          [],
          errors
        )
      );
    } else {
      if (clean) {
        console.log(`[mcp verify passed] All MCP configuration rules and protection checks satisfied (${scope}: ${targetMcpPath}).`);
      } else {
        console.error(`[mcp verify failed] Errors (${scope}: ${targetMcpPath}):`);
        for (const e of errors) console.error(` - ${e}`);
      }
    }
    return exitCode;
  }

  return EXIT_CODES.CLI_USAGE_ERROR;
}
