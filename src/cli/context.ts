/**
 * arsenal context handler
 * Implements T020 & User Story 1
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import type { CommandContext } from "./router.ts";

export interface ContextLayer {
  path: string;
  hasAgents: boolean;
  hasRules: boolean;
  hasOmpDir: boolean;
  suppressesAncestor: boolean;
  imports: string[];
  brokenImports: string[];
}

export function inspectContextLayers(startDir: string): {
  layers: ContextLayer[];
  clean: boolean;
  suppressionDetected: boolean;
  errors: string[];
} {
  const layers: ContextLayer[] = [];
  const errors: string[] = [];
  let curr = path.resolve(startDir);

  // 1. Collect all layers from startDir upwards
  while (true) {
    const ompDir = path.join(curr, ".omp");
    const hasOmpDir = fs.existsSync(ompDir);

    if (hasOmpDir) {
      const agentsFile = path.join(ompDir, "AGENTS.md");
      const rulesFile = path.join(ompDir, "RULES.md");
      const hasAgents = fs.existsSync(agentsFile);
      const hasRules = fs.existsSync(rulesFile);

      // Check @path imports in AGENTS.md and RULES.md
      const imports: string[] = [];
      const brokenImports: string[] = [];

      for (const f of [agentsFile, rulesFile]) {
        if (fs.existsSync(f)) {
          const content = fs.readFileSync(f, "utf-8");
          const importMatches = content.match(/@path\s+([^\s\n\r]+)/g);
          if (importMatches) {
            for (const imp of importMatches) {
              const rel = imp.replace(/^@path\s+/, "").trim();
              imports.push(rel);
              const target = path.resolve(curr, rel);
              if (!fs.existsSync(target)) {
                brokenImports.push(rel);
                errors.push(`Broken import in '${f}': target '${target}' does not exist.`);
              }
            }
          }
        }
      }

      layers.push({
        path: curr,
        hasAgents,
        hasRules,
        hasOmpDir,
        suppressesAncestor: false,
        imports,
        brokenImports,
      });
    }

    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  // 2. Detect context suppression:
  // If an ancestor layer (index j > i) has AGENTS.md, but a nearer layer (index i)
  // has .omp without AGENTS.md, the nearer layer suppresses the ancestor AGENTS.md context!
  for (let i = 0; i < layers.length; i++) {
    const nearer = layers[i]!;
    if (nearer.hasOmpDir && !nearer.hasAgents) {
      for (let j = i + 1; j < layers.length; j++) {
        const ancestor = layers[j]!;
        if (ancestor.hasAgents) {
          nearer.suppressesAncestor = true;
          errors.push(
            `Context suppression detected: Nearer layer '${nearer.path}' has .omp without AGENTS.md, hiding ancestor context from '${ancestor.path}'.`
          );
          break;
        }
      }
    }
  }

  const clean = errors.length === 0;
  const suppressionDetected = layers.some((l) => l.suppressesAncestor);

  return {
    layers,
    clean,
    suppressionDetected,
    errors,
  };
}

export async function handleContext(ctx: CommandContext): Promise<number> {
  const inspection = inspectContextLayers(ctx.repoRoot);

  if (!inspection.clean) {
    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.CHECK_FAILURE,
          "check",
          inspection,
          [],
          inspection.errors
        )
      );
    } else {
      console.error(`[context verify failed] Discrepancies found:`);
      for (const err of inspection.errors) {
        console.error(` - ${err}`);
      }
    }
    return EXIT_CODES.CHECK_FAILURE;
  }

  if (ctx.isJson) {
    emitJson(createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.SUCCESS, "check", inspection));
  } else {
    console.log(`[context verify passed] Discovered ${inspection.layers.length} context layers in hierarchy:`);
    for (const l of inspection.layers) {
      console.log(` - ${l.path} (AGENTS: ${l.hasAgents}, RULES: ${l.hasRules})`);
    }
  }

  return EXIT_CODES.SUCCESS;
}
