/**
 * arsenal build handler
 * Implements T076, User Story 9 & T011 (specs/002-refactor-skill-corpus)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import type { CommandContext } from "./router.ts";
import { generateRouters } from "../../tools/generate-routers.ts";
import { generateSkillIndex } from "../../tools/generate-skill-index.ts";
import { safeWriteFile } from "../core/fs-safe.ts";
import { sha256File } from "../core/hash.ts";
import { parseSkillFrontmatter } from "../core/skill-frontmatter.ts";

/**
 * Extracts an explicit override reason from local skill frontmatter.
 * Supports metadata.reason, override.reason, metadata.override.reason,
 * override: true with reason, override_reason, or top-level reason.
 */
function getLocalOverrideReason(fm: Record<string, unknown> | null | undefined): string | null {
  if (!fm || typeof fm !== "object") return null;

  // 1. metadata.reason, metadata.override.reason, or metadata.override string
  if (fm.metadata && typeof fm.metadata === "object") {
    const meta = fm.metadata as Record<string, unknown>;
    if (typeof meta.reason === "string" && meta.reason.trim().length > 0) {
      return meta.reason.trim();
    }
    if (meta.override && typeof meta.override === "object") {
      const metaOverride = meta.override as Record<string, unknown>;
      if (typeof metaOverride.reason === "string" && metaOverride.reason.trim().length > 0) {
        return metaOverride.reason.trim();
      }
    }
    if (typeof meta.override === "string" && meta.override.trim().length > 0) {
      return meta.override.trim();
    }
  }

  // 2. override.reason
  if (fm.override && typeof fm.override === "object") {
    const ov = fm.override as Record<string, unknown>;
    if (typeof ov.reason === "string" && ov.reason.trim().length > 0) {
      return ov.reason.trim();
    }
  }

  // 3. override: true with reason
  if (fm.override === true && typeof fm.reason === "string" && fm.reason.trim().length > 0) {
    return fm.reason.trim();
  }

  // 4. override as scalar string
  if (typeof fm.override === "string" && fm.override.trim().length > 0) {
    return fm.override.trim();
  }

  // 5. override_reason
  if (typeof fm.override_reason === "string" && fm.override_reason.trim().length > 0) {
    return fm.override_reason.trim();
  }

  // 6. reason
  if (typeof fm.reason === "string" && fm.reason.trim().length > 0) {
    return fm.reason.trim();
  }

  return null;
}

/**
 * Copies a skill directory preserving file bytes and deterministic order.
 */
function copySkillDirectory(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs
    .readdirSync(srcDir, { withFileTypes: true })
    .filter((ent) => ent.name !== ".DS_Store")
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const ent of entries) {
    const srcPath = path.join(srcDir, ent.name);
    const destPath = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      copySkillDirectory(srcPath, destPath);
    } else if (ent.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Recursively collects relative artifact paths and their SHA-256 hashes.
 */
export function collectArtifacts(baseDir: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(baseDir)) return map;

  function walk(currentDir: string): void {
    const entries = fs
      .readdirSync(currentDir, { withFileTypes: true })
      .filter((ent) => ent.name !== ".DS_Store")
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const rel = path.relative(baseDir, fullPath);
        map.set(rel, sha256File(fullPath));
      }
    }
  }

  walk(baseDir);
  return map;
}

/**
 * Executes a deterministic build into targetDir.
 * 1. Copies admitted upstream skills from src/corpus in sorted order.
 * 2. Merges local presets tier (presets/skills) in sorted order.
 * 3. Generates Tier 1 routers.
 * 4. Generates catalog index (skills.index.jsonl).
 * 5. Writes static plugin metadata (package.json, plugin.json, .mcp.json).
 */
export async function executeBuild(
  targetDir: string,
  corpusDir: string,
  presetsDir: string,
  corpusEntries: string[],
  presetEntries: string[],
  preset?: string
): Promise<{ copied: number; catalogLength: number }> {
  const outSkillsDir = path.join(targetDir, "skills");
  const outCatalogDir = path.join(targetDir, "catalog");
  const outCatalogFile = path.join(outCatalogDir, "skills.index.jsonl");

  fs.mkdirSync(outSkillsDir, { recursive: true });

  const writtenSkills = new Set<string>();

  // 1. Copy admitted skills from src/corpus in sorted order
  for (const name of corpusEntries) {
    if (preset && !name.startsWith(preset)) continue;
    const srcSkillDir = path.join(corpusDir, name);
    const destSkillDir = path.join(outSkillsDir, name);
    copySkillDirectory(srcSkillDir, destSkillDir);
    writtenSkills.add(name);
  }

  // 2. Merge local presets tier after corpus copy, in sorted order
  for (const name of presetEntries) {
    if (preset && !name.startsWith(preset)) continue;
    const srcSkillDir = path.join(presetsDir, name);
    const destSkillDir = path.join(outSkillsDir, name);
    if (fs.existsSync(destSkillDir)) {
      fs.rmSync(destSkillDir, { recursive: true, force: true });
    }
    copySkillDirectory(srcSkillDir, destSkillDir);
    writtenSkills.add(name);
  }

  // 3. Generate Tier 1 routers (table-driven; contracts/routing-table.md §2)
  const presetsRoot = path.dirname(presetsDir);
  generateRouters(outSkillsDir, path.dirname(presetsRoot));

  // 3b. Ship a verbatim copy of each routing table for runtime lookup (R3).
  const routingOutDir = path.join(outCatalogDir, "routing");
  fs.mkdirSync(routingOutDir, { recursive: true });
  for (const domain of ["re", "webapp", "mobile", "red"]) {
    const src = path.join(presetsRoot, domain, "routing.json");
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(routingOutDir, `${domain}.json`));
    }
  }

  // 4. Generate catalog index
  const catalog = generateSkillIndex(outSkillsDir, outCatalogFile);

  // 5. Write static plugin metadata files
  const packageJsonContent = JSON.stringify(
    {
      name: "arsenal",
      version: "3.0.0",
      description: "Arsenal Security Engagement Harness Plugin",
      type: "module",
      omp: {
        extensions: [
          "./dist/extensions/bounding.js",
          "./dist/extensions/ledger.js",
          "./dist/extensions/budget.js",
          "./dist/extensions/routing.js",
        ],
        skills: ["./skills"],
      },
      pi: {
        extensions: [
          "./dist/extensions/bounding.js",
          "./dist/extensions/ledger.js",
          "./dist/extensions/budget.js",
          "./dist/extensions/routing.js",
        ],
        skills: ["./skills"],
      },
    },
    null,
    2
  );
  safeWriteFile(path.join(targetDir, "package.json"), packageJsonContent, { write: true, force: true });

  const pluginJsonContent = JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      name: "arsenal",
      version: "3.0.0",
      description: "Arsenal Security Engagement Harness Plugin for Oh My Pi",
      author: {
        name: "arsenal",
      },
      license: "MIT",
      capabilities: {
        roles: ["master", "sec-re", "sec-webapp", "sec-mobile", "sec-red", "sec-verifier"],
        routers: [
          "arsenal-re-router",
          "arsenal-webapp-router",
          "arsenal-mobile-router",
          "arsenal-red-router",
        ],
        extensions: ["bounding", "ledger", "budget", "routing"],
        tools: [
          "evidence_exec",
          "skill_search",
          "skill_route",
          "skill_list",
          "skill_load",
          "consolidate_evidence",
          "case_review",
          "verify_oracle",
        ],
      },
    },
    null,
    2
  );
  safeWriteFile(path.join(targetDir, "plugin.json"), pluginJsonContent, { write: true, force: true });

  const mcpCatalogContent = JSON.stringify(
    {
      mcpServers: {
        "ida-pro": { transport: "stdio", command: "python3", args: ["-m", "ida_mcp"], enabled: false },
        ghidra: { transport: "stdio", command: "python3", args: ["-m", "ghidra_mcp"], enabled: false },
        frida: { transport: "stdio", command: "frida-mcp", enabled: false },
        jshook: { transport: "stdio", command: "jshookmcp", enabled: false },
        "burp-ultra": { transport: "sse", url: "http://127.0.0.1:8080/mcp", enabled: false },
      },
    },
    null,
    2
  );
  safeWriteFile(path.join(targetDir, ".mcp.json"), mcpCatalogContent, { write: true, force: true });

  // 6. Bundle OMP runtime extensions into standalone JavaScript artifacts
  const repoRoot = path.resolve(corpusDir, "../..");
  const pluginSrcDir = path.join(repoRoot, "plugin");
  const extEntrypoints = [
    path.join(pluginSrcDir, "extensions/bounding.ts"),
    path.join(pluginSrcDir, "extensions/ledger.ts"),
    path.join(pluginSrcDir, "extensions/budget.ts"),
    path.join(pluginSrcDir, "extensions/routing.ts"),
  ].filter((p) => fs.existsSync(p));

  if (extEntrypoints.length > 0) {
    const outExtensionsDir = path.join(targetDir, "dist/extensions");
    fs.mkdirSync(outExtensionsDir, { recursive: true });
    const buildResult = await Bun.build({
      entrypoints: extEntrypoints,
      outdir: outExtensionsDir,
      target: "bun",
      format: "esm",
      minify: false,
      sourcemap: "none",
    });

    if (!buildResult.success) {
      const logs = buildResult.logs.map((log) => String(log)).join("\n");
      throw new Error(`Extension bundling failed:\n${logs}`);
    }
  }

  return { copied: writtenSkills.size, catalogLength: catalog.length };
}

export async function handleBuild(ctx: CommandContext): Promise<number> {
  const isWrite = Boolean(ctx.values.write);
  const isForce = Boolean(ctx.values.force);
  const isCheckDeterminism = Boolean(
    ctx.values["check-determinism"] ?? ctx.values.checkDeterminism
  );
  const preset = ctx.values.preset as string | undefined;
  const outDir = ctx.values.out
    ? path.resolve(ctx.values.out as string)
    : path.resolve(ctx.repoRoot, "plugin");

  const corpusDir = path.resolve(ctx.repoRoot, "src/corpus");
  if (!fs.existsSync(corpusDir)) {
    const msg = `Corpus directory '${corpusDir}' missing. Run 'tools/internalize-corpus.ts' first.`;
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

  const presetsDir = path.resolve(ctx.repoRoot, "presets/skills");

  // Enumerate and sort corpus skills
  const corpusEntries = fs
    .readdirSync(corpusDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(corpusDir, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));

  // Enumerate and sort local presets skills (may be absent)
  const presetEntries = fs.existsSync(presetsDir)
    ? fs
        .readdirSync(presetsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(presetsDir, d.name, "SKILL.md")))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b))
    : [];

  // Deterministic explicit override check
  const corpusSet = new Set(corpusEntries);
  const collisionErrors: string[] = [];
  let localOverridesCount = 0;

  for (const name of presetEntries) {
    if (preset && !name.startsWith(preset)) continue;
    if (corpusSet.has(name)) {
      const localSkillFile = path.join(presetsDir, name, "SKILL.md");
      const rawContent = fs.readFileSync(localSkillFile, "utf-8");
      const fm = parseSkillFrontmatter<Record<string, unknown>>(rawContent);
      const reason = getLocalOverrideReason(fm);
      if (!reason) {
        collisionErrors.push(
          `Duplicate skill identifier '${name}' present in both 'src/corpus' and 'presets/skills' without an explicit override reason in local frontmatter.`
        );
      } else {
        localOverridesCount++;
      }
    }
  }

  if (collisionErrors.length > 0) {
    const effectiveMode = isCheckDeterminism ? "check" : ctx.mode;
    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.CHECK_FAILURE,
          effectiveMode,
          {},
          [],
          collisionErrors
        )
      );
    } else {
      for (const err of collisionErrors) {
        console.error(`Error: ${err}`);
      }
    }
    return EXIT_CODES.CHECK_FAILURE;
  }

  // Handle --check-determinism
  if (isCheckDeterminism) {
    const tmpBase = path.join(ctx.repoRoot, "tmp");
    fs.mkdirSync(tmpBase, { recursive: true });
    const tempRoot1 = fs.mkdtempSync(path.join(tmpBase, "arsenal-build-det1-"));
    const tempRoot2 = fs.mkdtempSync(path.join(tmpBase, "arsenal-build-det2-"));
    let artifactsChecked = 0;

    try {
      await executeBuild(tempRoot1, corpusDir, presetsDir, corpusEntries, presetEntries, preset);
      await executeBuild(tempRoot2, corpusDir, presetsDir, corpusEntries, presetEntries, preset);

      const artifacts1 = collectArtifacts(tempRoot1);
      const artifacts2 = collectArtifacts(tempRoot2);
      artifactsChecked = artifacts1.size;

      const discrepancies: string[] = [];
      for (const [relPath, hash1] of artifacts1.entries()) {
        if (!artifacts2.has(relPath)) {
          discrepancies.push(`Missing in second build: ${relPath}`);
        } else {
          const hash2 = artifacts2.get(relPath)!;
          if (hash1 !== hash2) {
            discrepancies.push(`Hash mismatch for ${relPath}: run 1 (${hash1}) vs run 2 (${hash2})`);
          }
        }
      }

      for (const relPath of artifacts2.keys()) {
        if (!artifacts1.has(relPath)) {
          discrepancies.push(`Missing in first build: ${relPath}`);
        }
      }

      if (discrepancies.length > 0) {
        if (ctx.isJson) {
          emitJson(
            createJsonEnvelope(
              ctx.rawArgs.join(" "),
              EXIT_CODES.CHECK_FAILURE,
              "check",
              {
                deterministic: false,
                totalArtifacts: artifactsChecked,
                discrepancies,
              },
              [],
              discrepancies
            )
          );
        } else {
          console.error(
            `[arsenal build --check-determinism] FAIL: Non-deterministic build output (${discrepancies.length} discrepancy(ies) detected across successive builds):`
          );
          for (const d of discrepancies) {
            console.error(` - ${d}`);
          }
        }
        return EXIT_CODES.CHECK_FAILURE;
      }

      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.SUCCESS,
            "check",
            {
              deterministic: true,
              totalArtifacts: artifactsChecked,
              artifactsChecked,
            }
          )
        );
      } else {
        console.log(
          `[arsenal build --check-determinism] PASS: DETERMINISTIC (all ${artifactsChecked} artifacts byte-identical across successive builds).`
        );
      }
      return EXIT_CODES.SUCCESS;
    } finally {
      try {
        fs.rmSync(tempRoot1, { recursive: true, force: true });
      } catch {
        // ignore
      }
      try {
        fs.rmSync(tempRoot2, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  // Preview mode: report counts without touching disk
  if (!isWrite) {
    const matchingCorpus = corpusEntries.filter((name) => !preset || name.startsWith(preset));
    const matchingPresets = presetEntries.filter((name) => !preset || name.startsWith(preset));
    const distinctLeaves = new Set([...matchingCorpus, ...matchingPresets]);
    const plannedArtifacts = distinctLeaves.size + 4; // 4 routers

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.SUCCESS, "preview", {
          targetDir: outDir,
          plannedSkills: plannedArtifacts,
          preset: preset ?? "all",
        })
      );
    } else {
      console.log(`[arsenal build preview] Target: ${outDir} | Preset: ${preset ?? "universal (all 4 domains)"}`);
      console.log(`Planned artifacts: ${distinctLeaves.size} leaf skills + 4 Tier 1 routers.`);
      console.log(`Add --write to persist build to disk.`);
    }
    return EXIT_CODES.SUCCESS;
  }

  // Write mode: clean/prepare outDir if requested
  const outSkillsDir = path.join(outDir, "skills");
  if (isForce && fs.existsSync(outSkillsDir)) {
    fs.rmSync(outSkillsDir, { recursive: true, force: true });
  }

  const { copied, catalogLength } = await executeBuild(
    outDir,
    corpusDir,
    presetsDir,
    corpusEntries,
    presetEntries,
    preset
  );

  if (ctx.isJson) {
    emitJson(
      createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.SUCCESS, "write", {
        targetDir: outDir,
        skillsCopied: copied,
        totalCatalog: catalogLength,
      })
    );
  } else {
    console.log(`[arsenal build] Built SSOT plugin at '${outDir}':`);
    console.log(` - ${copied} leaf skills copied`);
    console.log(` - 4 Tier 1 routers generated`);
    console.log(` - Catalog index generated (${catalogLength} entries)`);
    console.log(` - Package, plugin, and MCP manifests materialized`);
  }

  return EXIT_CODES.SUCCESS;
}
