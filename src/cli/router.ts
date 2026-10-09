/**
 * Command router for Arsenal CLI
 * Wires all 13 command families to their respective handlers
 */

import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import { handleBuild } from "./build.ts";
import { handleProfile } from "./profile.ts";
import { handleContext } from "./context.ts";
import { handleInit } from "./init.ts";
import { handleScope } from "./scope.ts";
import { handlePlugin } from "./plugin.ts";
import { handleDoctor } from "./doctor.ts";
import { handleTools } from "./tools.ts";
import { handleEvidence } from "./evidence.ts";
import { handleSkills } from "./skills.ts";
import { handleMcp } from "./mcp.ts";
import { handleVendor } from "./vendor.ts";
import { handleCase } from "./case.ts";
import { handleReport } from "./report.ts";

export interface CommandContext {
  family: string;
  subCommand?: string;
  positionals: string[];
  values: Record<string, unknown>;
  rawArgs: string[];
  repoRoot: string;
  profileDir: string;
  mode: "preview" | "write" | "check";
  isJson: boolean;
}

export type CommandHandler = (ctx: CommandContext) => Promise<number>;

const handlers: Record<string, CommandHandler> = {
  build: handleBuild,
  profile: handleProfile,
  context: handleContext,
  init: handleInit,
  scope: handleScope,
  plugin: handlePlugin,
  doctor: handleDoctor,
  tools: handleTools,
  evidence: handleEvidence,
  skills: handleSkills,
  mcp: handleMcp,
  vendor: handleVendor,
  case: handleCase,
  report: handleReport,
};

export async function dispatch(ctx: CommandContext): Promise<number> {
  const handler = handlers[ctx.family];
  if (!handler) {
    const errorMsg = `Unrecognized command family: '${ctx.family}'`;
    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.CLI_USAGE_ERROR,
          ctx.mode,
          {},
          [],
          [errorMsg]
        )
      );
    } else {
      console.error(`Error: ${errorMsg}`);
    }
    return EXIT_CODES.CLI_USAGE_ERROR;
  }

  return await handler(ctx);
}
