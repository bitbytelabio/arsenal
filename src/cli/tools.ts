/**
 * arsenal tools handler
 * Implements T060, T061 & User Story 7
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import type { CommandContext } from "./router.ts";
import { safeWriteFile } from "../core/fs-safe.ts";

export interface ToolEntry {
  id: string;
  category: string;
  resolved_path: string | null;
  version: string | null;
  state: "ready" | "missing" | "error";
  install_instructions: string;
}

const PRESET_TOOL_REQUIREMENTS: Record<string, string[]> = {
  re: ["radare2", "git", "python3"],
  webapp: ["curl", "git", "bun"],
  mobile: ["adb", "apktool", "frida"],
  red: ["nmap", "curl", "python3"],
};

const COMMON_TOOL_PROBES: Record<string, { category: string; install: string }> = {
  radare2: { category: "disassembler", install: "brew install radare2 / apt install radare2" },
  ghidra: { category: "decompiler", install: "brew install --cask ghidra / apt install ghidra" },
  frida: { category: "instrumentation", install: "pip3 install frida-tools" },
  nmap: { category: "network", install: "brew install nmap / apt install nmap" },
  apktool: { category: "mobile", install: "brew install apktool / apt install apktool" },
  sqlmap: { category: "injection", install: "pip3 install sqlmap" },
  curl: { category: "transport", install: "brew install curl / apt install curl" },
  git: { category: "vcs", install: "brew install git / apt install git" },
  bun: { category: "runtime", install: "curl -fsSL https://bun.sh/install | bash" },
  python3: { category: "runtime", install: "brew install python / apt install python3" },
  adb: { category: "mobile", install: "brew install --cask android-platform-tools" },
};

export async function handleTools(ctx: CommandContext): Promise<number> {
  const subCommand = ctx.subCommand ?? "check";

  if (subCommand === "scan") {
    const isWrite = Boolean(ctx.values.write);
    const results: ToolEntry[] = [];

    for (const [id, info] of Object.entries(COMMON_TOOL_PROBES)) {
      const resolved = Bun.which(id);
      results.push({
        id,
        category: info.category,
        resolved_path: resolved,
        version: resolved ? "detected" : null,
        state: resolved ? "ready" : "missing",
        install_instructions: info.install,
      });
    }

    const toolIndexPath = path.join(ctx.repoRoot, ".omp", "tool-index.json");
    const content = JSON.stringify(
      {
        schema_version: 1,
        observed_at: new Date().toISOString(),
        tools: results,
      },
      null,
      2
    );

    const safeRes = safeWriteFile(toolIndexPath, content, {
      write: isWrite,
      force: Boolean(ctx.values.force),
    });

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          ctx.mode,
          { tools: results, path: toolIndexPath, action: safeRes.action }
        )
      );
    } else {
      console.log(`[arsenal tools scan] Probed ${results.length} security tools [mode: ${ctx.mode}]:`);
      for (const t of results) {
        console.log(` - ${t.id} (${t.category}): ${t.state} [${t.resolved_path ?? "NOT FOUND"}]`);
      }
    }
    return EXIT_CODES.SUCCESS;
  }

  if (subCommand === "check") {
    const preset = (ctx.values.preset as string | undefined)?.toLowerCase() ?? "webapp";
    const required = PRESET_TOOL_REQUIREMENTS[preset] ?? ["git", "curl"];

    const detected: string[] = [];
    const missing: Array<{ id: string; install: string }> = [];

    for (const req of required) {
      const loc = Bun.which(req);
      if (loc) {
        detected.push(req);
      } else {
        const info = COMMON_TOOL_PROBES[req];
        missing.push({ id: req, install: info ? info.install : `Install ${req} package` });
      }
    }

    const clean = missing.length === 0;
    const exitCode = clean ? EXIT_CODES.SUCCESS : EXIT_CODES.CHECK_FAILURE;

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          exitCode,
          "check",
          { preset, required, detected, missing, clean }
        )
      );
    } else {
      console.log(`[arsenal tools check] Preset '${preset}':`);
      console.log(` Detected: ${detected.join(", ") || "none"}`);
      if (missing.length > 0) {
        console.error(` Missing required tools:`);
        for (const m of missing) {
          console.error(`  - ${m.id}: Guidance -> ${m.install}`);
        }
      }
    }
    return exitCode;
  }

  return EXIT_CODES.CLI_USAGE_ERROR;
}
