/**
 * arsenal vendor handler
 * Implements T074, T075 & User Story 9
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import type { CommandContext } from "./router.ts";
import { evaluateQuarantine } from "../core/quarantine.ts";
import { sha256File } from "../core/hash.ts";
import { parseSkillFrontmatter } from "../core/skill-frontmatter.ts";
export async function handleVendor(ctx: CommandContext): Promise<number> {
  const subCommand = ctx.subCommand ?? "check";
  const corpusDir = path.resolve(ctx.repoRoot, "src/corpus");

  if (subCommand === "check") {
    if (!fs.existsSync(corpusDir)) {
      const msg = `Corpus directory '${corpusDir}' does not exist.`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CHECK_FAILURE,
            "check",
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.CHECK_FAILURE;
    }

    const errors: string[] = [];
    const entries = fs.readdirSync(corpusDir, { withFileTypes: true });
    let validatedCount = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sFile = path.join(corpusDir, entry.name, "SKILL.md");
      if (!fs.existsSync(sFile)) {
        errors.push(`Missing SKILL.md in '${entry.name}'.`);
        continue;
      }

      const content = fs.readFileSync(sFile, "utf-8");

      // Check quarantine
      const q = evaluateQuarantine(entry.name, undefined, content);
      if (!q.allowed) {
        errors.push(`Quarantined component in corpus: '${entry.name}': ${q.reason}`);
      }

      const fm = parseSkillFrontmatter(content);
      if (!fm) {
        errors.push(`Malformed frontmatter in '${entry.name}'.`);
        continue;
      }

      // Check name regex
      const matchedName = typeof fm.name === "string" ? fm.name : undefined;
      if (!matchedName || matchedName !== entry.name) {
        errors.push(`Name mismatch in '${entry.name}': declared '${matchedName ?? "none"}'.`);
      } else if (!/^(re|webapp|mobile|red)-[a-z0-9]+(-[a-z0-9]+)*$/.test(matchedName) || matchedName.length > 64) {
        errors.push(`Name in '${entry.name}' does not match regex ^(re|webapp|mobile|red)-[a-z0-9]+(-[a-z0-9]+)*$ or exceeds 64 chars.`);
      }

      // Check description >= 40 chars
      const matchedDesc = typeof fm.description === "string" ? fm.description : undefined;
      if (!matchedDesc || matchedDesc.length < 40) {
        errors.push(`Description in '${entry.name}' is invalid or < 40 chars.`);
      }

      // Check license and provenance
      if (!fm.license) {
        errors.push(`Missing license declaration in '${entry.name}'.`);
      }
      if (!fm.metadata?.manifest_entry && !fm.metadata?.upstream) {
        errors.push(`Missing provenance (manifest_entry or upstream metadata) in '${entry.name}'.`);
      }

      validatedCount++;
    }

    const clean = errors.length === 0;
    const exitCode = clean ? EXIT_CODES.SUCCESS : EXIT_CODES.CHECK_FAILURE;

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          exitCode,
          "check",
          { totalValidated: validatedCount, clean },
          [],
          errors
        )
      );
    } else {
      if (clean) {
        console.log(`[vendor check passed] Validated ${validatedCount} skills against license and quarantine rules.`);
      } else {
        console.error(`[vendor check failed] Errors found:`);
        for (const e of errors) {
          console.error(` - ${e}`);
        }
      }
    }
    return exitCode;
  }

  if (subCommand === "sync") {
    const isWrite = Boolean(ctx.values.write);
    const manifestPath = path.join(corpusDir, "MANIFEST.json");

    if (!fs.existsSync(manifestPath)) {
      const msg = `Manifest '${manifestPath}' missing. Run 'tools/internalize-corpus.ts' first.`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.ENVIRONMENT_UNAVAILABLE,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.ENVIRONMENT_UNAVAILABLE;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      summary: { total_considered: number; admitted: number };
    };

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.SUCCESS, ctx.mode, {
          summary: manifest.summary,
          synced: isWrite,
        })
      );
    } else {
      console.log(`[vendor sync] Corpus synchronized. Total considered: ${manifest.summary.total_considered}, admitted: ${manifest.summary.admitted} [mode: ${ctx.mode}].`);
    }
    return EXIT_CODES.SUCCESS;
  }

  return EXIT_CODES.CLI_USAGE_ERROR;
}
