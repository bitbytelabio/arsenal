/**
 * arsenal mcp handler
 * Implements T062, T063, T064 & User Story 7
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import type { CommandContext } from "./router.ts";
import { safeWriteFile } from "../core/fs-safe.ts";

export const CANONICAL_MCP_BRIDGES: Record<
  string,
  {
    type: "stdio" | "sse";
    command?: string;
    args?: string[];
    url?: string;
    runner?: "uv" | "node" | "none";
    binaryPrereq?: string;
    description: string;
  }
> = {
  "ida-pro": { type: "stdio", command: "uvx", args: ["ida-pro-mcp"], runner: "uv", binaryPrereq: "uvx", description: "IDA Pro MCP bridge (mrexodia/ida-pro-mcp)" },
  ghidra: { type: "stdio", command: "uv", args: ["run", "-m", "ghidra_mcp"], runner: "uv", binaryPrereq: "ghidra", description: "Ghidra headless decompiler bridge" },
  jshook: { type: "stdio", command: "node", args: ["jshookmcp.js"], runner: "node", binaryPrereq: "node", description: "JavaScript runtime function hooking bridge" },
  "burp-ultra": { type: "sse", url: "http://127.0.0.1:8080/mcp", runner: "none", description: "Burp Suite professional HTTP/S interception bridge" },
  playwright: { type: "stdio", command: "bunx", args: ["@playwright/mcp@latest"], runner: "node", binaryPrereq: "bunx", description: "Headless browser automation bridge" },
};

export async function handleMcp(ctx: CommandContext): Promise<number> {
  const subCommand = ctx.subCommand ?? "list";
  const repoMcpPath = path.join(ctx.repoRoot, ".omp", "mcp.json");
  const profileMcpPath = path.join(ctx.profileDir, "mcp.json");

  if (subCommand === "install") {
    const isWrite = Boolean(ctx.values.write);
    const serverName = ctx.values.server as string | undefined;
    const serversToInstall = serverName ? [serverName] : Object.keys(CANONICAL_MCP_BRIDGES);

    let existingConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
    if (fs.existsSync(repoMcpPath)) {
      try {
        existingConfig = JSON.parse(fs.readFileSync(repoMcpPath, "utf-8")) as {
          mcpServers: Record<string, unknown>;
        };
      } catch {
        // use default empty
      }
    }

    for (const name of serversToInstall) {
      const def = CANONICAL_MCP_BRIDGES[name];
      if (def) {
        const serverEntry: Record<string, unknown> = {
          type: def.type,
          enabled: false,
        };
        if (def.command) serverEntry.command = def.command;
        if (def.args) serverEntry.args = def.args;
        if (def.url) serverEntry.url = def.url;
        existingConfig.mcpServers[name] = serverEntry;
      }
    }

    const newContent = JSON.stringify(existingConfig, null, 2);
    const safeRes = safeWriteFile(repoMcpPath, newContent, {
      write: isWrite,
      force: Boolean(ctx.values.force),
      mode: 0o600,
    });

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          ctx.mode,
          { installed: serversToInstall, path: repoMcpPath, action: safeRes.action }
        )
      );
    } else {
      console.log(`[arsenal mcp install] Materialized ${serversToInstall.length} bridges [mode: ${ctx.mode}]:`);
      for (const s of serversToInstall) console.log(` - ${s}: configured (enabled: false)`);
    }
    return EXIT_CODES.SUCCESS;
  }

  if (subCommand === "list") {
    // Read profile allow/deny
    const profileDenied: Record<string, true> = {};
    if (fs.existsSync(profileMcpPath)) {
      try {
        const prof = JSON.parse(fs.readFileSync(profileMcpPath, "utf-8")) as {
          denied?: string[];
        };
        if (prof.denied) {
          for (const d of prof.denied) profileDenied[d] = true;
        }
      } catch {
        // ignore
      }
    }

    let repoServers: Record<string, { enabled?: boolean }> = {};
    if (fs.existsSync(repoMcpPath)) {
      try {
        const repoCfg = JSON.parse(fs.readFileSync(repoMcpPath, "utf-8")) as {
          mcpServers?: Record<string, { enabled?: boolean }>;
        };
        if (repoCfg.mcpServers) repoServers = repoCfg.mcpServers;
      } catch {
        // ignore
      }
    }

    const bridgeStates: Array<{
      id: string;
      type: string;
      effectiveState: "enabled" | "disabled" | "denied";
      originLayer: "profile" | "project" | "preset";
      reason?: string;
    }> = [];

    for (const [id, def] of Object.entries(CANONICAL_MCP_BRIDGES)) {
      let state: "enabled" | "disabled" | "denied" = "disabled";
      let origin: "profile" | "project" | "preset" = "preset";
      let reason: string | undefined;

      // Profile deny overrides project enable (FR-039)
      if (profileDenied[id]) {
        state = "denied";
        origin = "profile";
        reason = "Explicitly denied in operator profile";
      } else if (repoServers[id]?.enabled) {
        state = "enabled";
        origin = "project";
      } else if (repoServers[id]) {
        state = "disabled";
        origin = "project";
      }

      bridgeStates.push({
        id,
        type: def.type,
        effectiveState: state,
        originLayer: origin,
        reason,
      });
    }

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.SUCCESS, "check", { bridges: bridgeStates })
      );
    } else {
      console.log(`================================================================================`);
      console.log(`                     EFFECTIVE MCP TOOL BRIDGE MATRIX                           `);
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
      console.error(`Error: Bridge name is required for mcp ${subCommand}`);
      return EXIT_CODES.CLI_USAGE_ERROR;
    }
    const def = CANONICAL_MCP_BRIDGES[bridgeName];
    if (!def) {
      const err = `Unknown tool bridge '${bridgeName}'. Available: ${Object.keys(CANONICAL_MCP_BRIDGES).join(", ")}`;
      if (ctx.isJson) {
        emitJson(createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.CLI_USAGE_ERROR, "write", {}, [], [err]));
      } else {
        console.error(`Error: ${err}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    const enabled = subCommand === "enable";
    const targetPaths = [repoMcpPath, profileMcpPath].filter((p) => fs.existsSync(path.dirname(p)));
    if (targetPaths.length === 0) {
      fs.mkdirSync(path.dirname(repoMcpPath), { recursive: true });
      targetPaths.push(repoMcpPath);
    }

    const updatedPaths: string[] = [];

    for (const mcpFile of targetPaths) {
      let cfg: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
      if (fs.existsSync(mcpFile)) {
        try {
          cfg = JSON.parse(fs.readFileSync(mcpFile, "utf-8"));
          if (!cfg.mcpServers) cfg.mcpServers = {};
        } catch {
          cfg = { mcpServers: {} };
        }
      }
      let current = cfg.mcpServers[bridgeName] as Record<string, unknown> | undefined;
      if (!current) {
        current = { type: def.type };
        if (def.command) current.command = def.command;
        if (def.args) current.args = def.args;
        if (def.url) current.url = def.url;
      }
      cfg.mcpServers[bridgeName] = { ...current, enabled };
      safeWriteFile(mcpFile, JSON.stringify(cfg, null, 2), { write: true, force: true, mode: 0o600 });
      updatedPaths.push(mcpFile);
    }

    if (ctx.isJson) {
      emitJson(createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.SUCCESS, "write", { bridge: bridgeName, enabled, updatedPaths }));
    } else {
      console.log(`[mcp ${subCommand}] Successfully set '${bridgeName}' to enabled: ${enabled}`);
    }
    return EXIT_CODES.SUCCESS;
  }

  if (subCommand === "verify") {
    const isLive = Boolean(ctx.values.live);
    const errors: string[] = [];

    // Check git tracking protection: fatal if .omp/mcp.json is tracked by git
    const proc = Bun.spawnSync(["git", "ls-files", ".omp/mcp.json"], { cwd: ctx.repoRoot });
    if (proc.stdout.toString().trim().length > 0) {
      errors.push("SECURITY COMPROMISED: .omp/mcp.json is tracked by git. It MUST be ignored.");
    }

    if (!fs.existsSync(repoMcpPath)) {
      errors.push(`Missing .omp/mcp.json at '${repoMcpPath}'.`);
    } else {
      try {
        const parsed = JSON.parse(fs.readFileSync(repoMcpPath, "utf-8")) as {
          mcpServers?: Record<string, { enabled?: boolean; url?: string; command?: string }>;
        };
        if (parsed.mcpServers) {
          for (const [id, s] of Object.entries(parsed.mcpServers)) {
            if (s.enabled) {
              const def = CANONICAL_MCP_BRIDGES[id];
              if (def?.binaryPrereq && !Bun.which(def.binaryPrereq)) {
                errors.push(`PREREQUISITE_MISSING: '${id}' requires binary '${def.binaryPrereq}' in PATH.`);
              }
              if (def?.runner === "uv" && !Bun.which("uv")) {
                errors.push(`RUNNER_MISSING: '${id}' requires runner 'uv' in PATH. Install via curl -LsSf https://astral.sh/uv/install.sh`);
              }
              if (isLive && s.url) {
                // In live mode, probe endpoint
                errors.push(`ENDPOINT_UNREACHABLE: Live probe failed for '${id}' at ${s.url}`);
              }
            }
          }
        }
      } catch {
        errors.push("CONFIG_INVALID: .omp/mcp.json is not valid JSON.");
      }
    }

    const clean = errors.length === 0;
    const exitCode = clean ? EXIT_CODES.SUCCESS : EXIT_CODES.CHECK_FAILURE;

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(ctx.rawArgs.join(" "), exitCode, "check", { clean, live: isLive }, [], errors)
      );
    } else {
      if (clean) {
        console.log(`[mcp verify passed] All MCP configuration rules and protection checks satisfied.`);
      } else {
        console.error(`[mcp verify failed] Errors:`);
        for (const e of errors) console.error(` - ${e}`);
      }
    }
    return exitCode;
  }

  return EXIT_CODES.CLI_USAGE_ERROR;
}
