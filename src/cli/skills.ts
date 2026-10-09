/**
 * arsenal skills handler
 * Implements index, check, route, normalize, rename, dedup, scripts-audit, update, new
 * per specs/002-refactor-skill-corpus and contracts/skill-lifecycle.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import type { CommandContext } from "./router.ts";
import { sha256File, sha256String } from "../core/hash.ts";
import {
  parseSkillFrontmatter,
  parseSkillDocument,
  serializeSkillDocument,
  boundDescription,
  validateCanonicalSkillFrontmatter,
  type SkillDomain,
} from "../core/skill-frontmatter.ts";
import {
  isValidSkillId,
  containsForbiddenVendorToken,
  deriveSkillId,
  parseSkillId,
  isRouterSkillId,
  FORBIDDEN_VENDOR_SEGMENTS,
} from "../core/skill-naming.ts";
import { detectLanguageViolationsInFile } from "../core/skill-language.ts";
import { normalizeCorpus } from "../core/corpus-normalize.ts";
import {
  detectTierACollisionGroups,
  detectTierBGroups,
  loadTierBAliases,
  formatDedupSummary,
  type DedupGroup,
} from "../core/skill-dedup.ts";
import { planCorpusReferenceMaterialization } from "../core/skill-references.ts";
import { auditCitations } from "../core/reference-resolver.ts";
import {
  DOMAINS,
  ROUTER_TOKEN_BUDGET,
  ROUTER_COMBINED_TOKEN_BUDGET,
  evaluateRoutingInvariants,
  estimateRouterTokens,
  loadRoutingTables,
  renderRouterBody,
  routeHint,
  splitRouterBody,
  countRouterCategoryLines,
  isSkillDomain,
} from "../core/skill-routing.ts";
import {
  buildCoverageReport,
  buildProposalIndex,
  baselinePath,
  loadAcceptedGaps,
  loadBaseline,
  loadCoverageMap,
} from "../core/coverage-baseline.ts";
import { evaluateSpecialistParity } from "../core/specialist-parity.ts";
import { getDeclaredDomainCategories } from "../core/corpus-normalize.ts";
import {
  type ManifestEntry,
  type CorpusManifest,
  LOCAL_SOURCE_ID,
  DEFAULT_LOCAL_SOURCE_DESCRIPTOR,
  computeManifestSummary,
  serializeCorpusManifest,
  readCorpusManifest,
  validateSupportFileIntegrity,
} from "../core/skill-manifest.ts";
import { resolveSkillUri } from "../core/reference-resolver.ts";
import { safeReadBoundedFile } from "../core/fs-safe.ts";

function findMarkdownFilesRecursively(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      results.push(...findMarkdownFilesRecursively(full));
    } else if (ent.isFile() && (ent.name.endsWith(".md") || ent.name.endsWith(".markdown"))) {
      results.push(full);
    }
  }
  return results;
}

export interface SkillIndexEntry {
  name: string;
  domain: string;
  category: string;
  description: string;
  sha256: string;
  bytes: number;
}

export async function handleSkills(ctx: CommandContext): Promise<number> {
  const subCommand = ctx.subCommand ?? "check";
  const fallbackRepoRoot = fs.existsSync(path.join(ctx.repoRoot, "src/corpus"))
    ? ctx.repoRoot
    : path.resolve(import.meta.dir, "../..");
  const pluginDir = path.resolve(fallbackRepoRoot, "plugin");
  const skillsDir = path.join(pluginDir, "skills");
  const catalogDir = path.join(pluginDir, "catalog");
  const indexFile = path.join(catalogDir, "skills.index.jsonl");
  const corpusDir = path.resolve(fallbackRepoRoot, "src/corpus");
  const manifestPath = path.join(corpusDir, "MANIFEST.json");
  const isWrite = Boolean(ctx.values.write);


  // skills read-asset
  if (subCommand === "read-asset") {
    const rawUri = (ctx.values.uri as string) ?? ctx.positionals[0];
    if (!rawUri) {
      console.error("Error: --uri <skill://...> is required");
      return EXIT_CODES.CLI_USAGE_ERROR;
    }
    const res = resolveSkillUri(rawUri, corpusDir);
    if (!res.exists || !res.resolvedPath) {
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.CHECK_FAILURE, "check", {
            error: res.error,
            uri: rawUri,
          })
        );
      } else {
        console.error(`Error: ${res.error}`);
      }
      return EXIT_CODES.CHECK_FAILURE;
    }

    const bounded = safeReadBoundedFile(res.resolvedPath);
    const output = {
      uri: rawUri,
      path: res.resolvedPath,
      content: bounded.content,
      sizeBytes: bounded.sizeBytes,
      truncated: bounded.truncated,
    };

    if (ctx.isJson) {
      emitJson(createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.SUCCESS, "preview", output));
    } else {
      console.log(bounded.content);
    }
    return EXIT_CODES.SUCCESS;
  }
  // 1. skills index
  if (subCommand === "index") {
    if (!fs.existsSync(skillsDir)) {
      const msg = `Skills directory '${skillsDir}' does not exist. Run 'arsenal build' first.`;
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

    const entries: SkillIndexEntry[] = [];
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const sFile = path.join(skillsDir, d.name, "SKILL.md");
      if (!fs.existsSync(sFile)) continue;

      const raw = fs.readFileSync(sFile, "utf-8");
      const hash = sha256File(sFile);
      const fm = parseSkillFrontmatter(raw);

      entries.push({
        name: d.name,
        domain: typeof fm?.domain === "string" ? fm.domain : "re",
        category: typeof fm?.category === "string" ? fm.category : "general",
        description: typeof fm?.description === "string" ? fm.description : "",
        sha256: hash,
        bytes: Buffer.byteLength(raw, "utf-8"),
      });
    }

    // Sort entries alphabetically by canonical name for deterministic output
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const jsonlContent = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

    if (!isWrite) {
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.SUCCESS,
            "preview",
            { count: entries.length, indexFile }
          )
        );
      } else {
        console.log(`[skills index preview] Scanned ${entries.length} skills for catalog index.`);
      }
      return EXIT_CODES.SUCCESS;
    }

    fs.mkdirSync(catalogDir, { recursive: true });
    fs.writeFileSync(indexFile, jsonlContent, "utf-8");

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          "write",
          { indexed: entries.length, path: indexFile }
        )
      );
    } else {
      console.log(`[skills index] Indexed ${entries.length} skills to ${indexFile}`);
    }
    return EXIT_CODES.SUCCESS;
  }

  // 2. skills check
  if (subCommand === "check") {
    const checkLanguage = Boolean(ctx.values.language);
    const targetDir = fs.existsSync(skillsDir) ? skillsDir : corpusDir;
    const errors: string[] = [];
    const violationsByName: Record<string, string[]> = {};

    function addError(name: string, msg: string) {
      errors.push(`[${name}] ${msg}`);
      if (!violationsByName[name]) violationsByName[name] = [];
      violationsByName[name]!.push(msg);
    }

    // Check catalog index if present
    const indexMap: Record<string, SkillIndexEntry> = {};
    if (fs.existsSync(indexFile)) {
      const lines = fs
        .readFileSync(indexFile, "utf-8")
        .split("\n")
        .filter((l) => l.trim().length > 0);
      for (const l of lines) {
        try {
          const parsed = JSON.parse(l) as SkillIndexEntry;
          indexMap[parsed.name] = parsed;
        } catch {
          // ignore corrupted lines
        }
      }
    }

    // Scan target directories
    const dirs = fs.existsSync(targetDir)
      ? fs.readdirSync(targetDir, { withFileTypes: true }).filter((d) => d.isDirectory())
      : [];

    for (const d of dirs) {
      const name = d.name;
      const sFile = path.join(targetDir, name, "SKILL.md");
      if (!fs.existsSync(sFile)) {
        addError(name, "Missing SKILL.md");
        continue;
      }

      // §1 Identifier policy
      if (!isRouterSkillId(name)) {
        if (!isValidSkillId(name)) {
          addError(name, "Identifier violates grammar ^(re|webapp|mobile|red)-[a-z0-9]+(-[a-z0-9]+)*$");
        }
        if (containsForbiddenVendorToken(name)) {
          addError(name, "Identifier contains forbidden vendor segment");
        }
      }

      const content = fs.readFileSync(sFile, "utf-8");
      const parsed = parseSkillDocument(content);
      if (!parsed) {
        addError(name, "Malformed frontmatter or document syntax");
        continue;
      }

      const fm = parsed.data;

      // §2.1 & §2.2 Description bounds
      const desc = typeof fm.description === "string" ? fm.description : "";
      if (desc.length < 40) {
        addError(name, `Description under 40 characters (${desc.length})`);
      } else if (desc.length > 300) {
        addError(name, `Description over 300 characters (${desc.length})`);
      } else if (!/[.!?…]$/.test(desc.trim())) {
        addError(name, "Description does not end in terminal punctuation or ellipsis");
      }

      // Check Latin purity in description
      if (/[^\p{Script=Latin}\p{Punctuation}\p{Symbol}\p{Number}\p{Separator}\p{Mark}]/u.test(desc)) {
        addError(name, "Description contains non-Latin characters");
      }

      // §3 Catalog index verification
      if (Object.keys(indexMap).length > 0 && targetDir === skillsDir) {
        const entry = indexMap[name];
        if (!entry) {
          addError(name, "Unindexed in skills.index.jsonl");
        } else {
          const currentHash = sha256File(sFile);
          if (currentHash !== entry.sha256) {
            addError(name, `Hash mismatch against catalog: expected ${entry.sha256}, got ${currentHash}`);
          }
        }
      }

      // Language check (--language) - recursive scan of all .md files in playbook directory
      if (checkLanguage) {
        const skillDir = path.join(targetDir, name);
        const mdFiles = findMarkdownFilesRecursively(skillDir);
        let totalViolations = 0;
        for (const mdFile of mdFiles) {
          const langViolations = detectLanguageViolationsInFile(mdFile);
          totalViolations += langViolations.length;
        }
        if (totalViolations > 0) {
          addError(name, `${totalViolations} non-English residue occurrence(s) found across markdown files`);
        }
      }
    }

    // Check routing table leaf bindings (§4.1)
    const routingFiles = [
      path.resolve(ctx.repoRoot, "presets/re/routing.json"),
      path.resolve(ctx.repoRoot, "presets/webapp/routing.json"),
      path.resolve(ctx.repoRoot, "presets/mobile/routing.json"),
      path.resolve(ctx.repoRoot, "presets/red/routing.json"),
    ];

    for (const rf of routingFiles) {
      if (!fs.existsSync(rf)) continue;
      try {
        const rData = JSON.parse(fs.readFileSync(rf, "utf-8")) as {
          routes?: Record<string, { leaf?: string }>;
        };
        for (const [rid, rObj] of Object.entries(rData.routes ?? {})) {
          if (!rObj.leaf) continue;
          const leafPath = path.join(targetDir, rObj.leaf);
          if (!fs.existsSync(leafPath)) {
            errors.push(`Routing leaf binding unresolved in '${path.basename(rf)}': route '${rid}' -> '${rObj.leaf}'`);
          }
        }
      } catch {
        // ignore parse error
      }
    }

    // Domain invariants (T015/T047): RT-1..RT-4, RT-6, IN-R4, P-1..P-4, baseline presence.
    const checkDomains = Boolean(ctx.values.domains);
    let routingData: Record<string, unknown> | undefined;
    let domainsData: Record<string, unknown> | undefined;

    if (checkDomains) {
      const treeDir = fs.existsSync(skillsDir) ? skillsDir : corpusDir;
      const tables = loadRoutingTables(ctx.repoRoot);

      for (const domain of DOMAINS) {
        if (!tables[domain]) {
          addError("routing", `[routing-table-missing] presets/${domain}/routing.json is missing`);
        }
      }

      for (const v of evaluateRoutingInvariants(tables, { repoRoot: ctx.repoRoot, treeDir })) {
        addError(
          "routing",
          `[${v.invariant}] domain '${v.domain}' ${v.subject}: ${v.message}; remediation: ${v.remediation}`
        );
      }

      const routerLines: Record<string, number> = {};
      let combined = 0;
      for (const domain of DOMAINS) {
        const table = tables[domain];
        if (!table) continue;
        const body = renderRouterBody(table);
        const est = estimateRouterTokens(splitRouterBody(body));
        combined += est;
        routerLines[`arsenal-${domain}-router`] = countRouterCategoryLines(body);
        if (est > ROUTER_TOKEN_BUDGET) {
          addError(
            "routing",
            `[RT-6] 'arsenal-${domain}-router' estimated ${est} tokens exceeds ${ROUTER_TOKEN_BUDGET}`
          );
        }
      }
      if (combined > ROUTER_COMBINED_TOKEN_BUDGET) {
        addError("routing", `[RT-6] combined router bodies estimated ${combined} tokens exceeds ${ROUTER_COMBINED_TOKEN_BUDGET}`);
      }

      // IN-R4: every shipped playbook's category is a declared category of its domain.
      for (const d of dirs) {
        if (isRouterSkillId(d.name)) continue;
        const sFile = path.join(targetDir, d.name, "SKILL.md");
        if (!fs.existsSync(sFile)) continue;
        const parsed = parseSkillDocument(fs.readFileSync(sFile, "utf-8"));
        if (!parsed) continue;
        const dom = parsed.data.domain;
        const cat = parsed.data.category;
        if (typeof dom !== "string" || !isSkillDomain(dom)) {
          addError(d.name, `[IN-R4] frontmatter domain '${String(dom)}' is not a known domain`);
          continue;
        }
        const declared = new Set(getDeclaredDomainCategories(dom, ctx.repoRoot));
        if (typeof cat !== "string" || !declared.has(cat)) {
          addError(d.name, `[IN-R4] category '${String(cat)}' is not declared for domain '${dom}'`);
        }
      }

      // P-1..P-4: specialist definition parity and required headings.
      for (const v of evaluateSpecialistParity(ctx.repoRoot)) {
        addError("domains", `[${v.invariant}] ${v.domain ?? "-"} ${v.subject}: ${v.message}`);
      }

      // Baseline presence for all four domains.
      for (const domain of DOMAINS) {
        const bp = baselinePath(domain, ctx.repoRoot);
        if (!fs.existsSync(bp)) {
          addError("domains", `[baseline-missing] domain '${domain}' expected baseline '${bp}'`);
        }
      }

      // D-1/D-2: manifest support-file integrity.
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = readCorpusManifest(manifestPath);
          for (const err of validateSupportFileIntegrity(manifest, corpusDir)) {
            addError("domains", err);
          }
        } catch (err) {
          addError("domains", `[D-1] corpus manifest failed to load: ${String(err)}`);
        }
      }

      routingData = { router_category_lines: routerLines, combined_estimated_tokens: combined };
      domainsData = { checked: true, domains: [...DOMAINS] };
    }

    const clean = errors.length === 0;
    const exitCode = clean ? EXIT_CODES.SUCCESS : EXIT_CODES.CHECK_FAILURE;

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          exitCode,
          "check",
          {
            totalChecked: dirs.length,
            clean,
            languageChecked: checkLanguage,
            violationsByName,
            ...(routingData ? { routing: routingData } : {}),
            ...(domainsData ? { domains: domainsData } : {}),
          },
          [],
          errors
        )
      );
    } else {
      if (clean) {
        console.log(`[skills check passed] Verified ${dirs.length} skills with clean standards.`);
      } else {
        console.error(`[skills check failed] ${errors.length} error(s) detected:`);
        for (const e of errors.slice(0, 30)) {
          console.error(` - ${e}`);
        }
        if (errors.length > 30) {
          console.error(` ... and ${errors.length - 30} more.`);
        }
      }
    }
    return exitCode;
  }

  // 3. skills route
  if (subCommand === "route") {
    const hintRaw = (ctx.values.hint as string | undefined) ?? "";
    if (hintRaw.trim().length === 0) {
      const msg = "Missing required flag: --hint <keywords>";
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.CLI_USAGE_ERROR, ctx.mode, {}, [], [msg])
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    const domainValue = ctx.values.domain as string | undefined;
    if (domainValue !== undefined && !isSkillDomain(domainValue)) {
      const msg = `Unknown domain '${domainValue}'. Expected one of: ${DOMAINS.join(", ")}.`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.CLI_USAGE_ERROR, ctx.mode, {}, [], [msg])
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    const tables = loadRoutingTables(ctx.repoRoot);
    const result = routeHint(hintRaw, domainValue as SkillDomain | undefined, tables);

    const data =
      result.route_id !== null
        ? {
            hint: hintRaw,
            domain: result.domain,
            route_id: result.route_id,
            routeId: result.route_id,
            category: result.category,
            skill: result.skill,
            score: result.score,
            matched: result.matched,
            fallback: result.fallback,
          }
        : {
            hint: hintRaw,
            domain: result.domain,
            route_id: null,
            routeId: null,
            note: "NO_ROUTE_MATCH",
          };

    if (ctx.isJson) {
      emitJson(createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.SUCCESS, ctx.mode, data));
    } else if (result.route_id !== null) {
      console.log(
        `[skills route] "${hintRaw}" -> ${result.domain}/${result.route_id} (${result.category}) skill=${result.skill} score=${result.score}`
      );
    } else {
      console.log(`[skills route] "${hintRaw}" -> NO_ROUTE_MATCH`);
    }
    return EXIT_CODES.SUCCESS;
  }

  // 4. skills normalize
  if (subCommand === "normalize") {
    const res = await normalizeCorpus({
      repoRoot: ctx.repoRoot,
      write: isWrite,
    });

    const status = res.errors.length === 0 ? "success" : "failure";
    const exitCode = res.errors.length === 0 ? EXIT_CODES.SUCCESS : EXIT_CODES.CHECK_FAILURE;

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          exitCode,
          isWrite ? "write" : "preview",
          {
            totalConsidered: res.totalConsidered,
            admitted: res.admitted,
            deduplicated: res.deduplicated,
            quarantined: res.quarantined,
            excluded: res.excluded,
            changesCount: res.changes.length,
          },
          [],
          res.errors
        )
      );
    } else {
      console.log(`[skills normalize ${isWrite ? "applied" : "preview"}]`);
      console.log(` - Total considered: ${res.totalConsidered}`);
      console.log(` - Admitted: ${res.admitted}`);
      console.log(` - Deduplicated: ${res.deduplicated}`);
      console.log(` - Quarantined: ${res.quarantined}`);
      console.log(` - Excluded: ${res.excluded}`);
      if (!isWrite) {
        console.log(`Add --write to persist normalized corpus to disk.`);
      }
    }
    return exitCode;
  }

  // 5. skills rename
  if (subCommand === "rename") {
    const mapFile = ctx.values.map as string | undefined;
    if (!mapFile || !fs.existsSync(mapFile)) {
      const msg = `Missing or non-existent rename map file: ${mapFile ?? "none"}. Specify --map <file>.`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CLI_USAGE_ERROR,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    const rawMap = JSON.parse(fs.readFileSync(mapFile, "utf-8")) as Record<string, string>;
    const renamePairs = Object.entries(rawMap).filter(([k, v]) => k !== v);

    if (!isWrite) {
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.SUCCESS,
            "preview",
            { plannedRenames: renamePairs.length, pairs: renamePairs.slice(0, 20) }
          )
        );
      } else {
        console.log(`[skills rename preview] Planned ${renamePairs.length} renames from ${mapFile}.`);
        console.log(`Add --write to persist renames to disk.`);
      }
      return EXIT_CODES.SUCCESS;
    }

    // Apply renames across src/corpus, presets/skills, routing.json, benchmark
    for (const [oldId, newId] of renamePairs) {
      const oldCorpusDir = path.join(corpusDir, oldId);
      const newCorpusDir = path.join(corpusDir, newId);
      if (fs.existsSync(oldCorpusDir) && !fs.existsSync(newCorpusDir)) {
        fs.renameSync(oldCorpusDir, newCorpusDir);
      }
    }

    // Update routing tables
    const routingFiles = [
      path.resolve(ctx.repoRoot, "presets/re/routing.json"),
      path.resolve(ctx.repoRoot, "presets/webapp/routing.json"),
      path.resolve(ctx.repoRoot, "presets/mobile/routing.json"),
      path.resolve(ctx.repoRoot, "presets/red/routing.json"),
    ];
    for (const rf of routingFiles) {
      if (!fs.existsSync(rf)) continue;
      let rText = fs.readFileSync(rf, "utf-8");
      for (const [oldId, newId] of renamePairs) {
        rText = rText.replaceAll(`"${oldId}"`, `"${newId}"`);
      }
      fs.writeFileSync(rf, rText, "utf-8");
    }

    // Update benchmark
    const benchFile = path.resolve(ctx.repoRoot, "tests/routing-benchmark.json");
    if (fs.existsSync(benchFile)) {
      let bText = fs.readFileSync(benchFile, "utf-8");
      for (const [oldId, newId] of renamePairs) {
        bText = bText.replaceAll(`"${oldId}"`, `"${newId}"`);
      }
      fs.writeFileSync(benchFile, bText, "utf-8");
    }

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          "write",
          { appliedRenames: renamePairs.length }
        )
      );
    } else {
      console.log(`[skills rename] Successfully applied ${renamePairs.length} renames across corpus and routing tables.`);
    }
    return EXIT_CODES.SUCCESS;
  }

  // 6. skills dedup
  if (subCommand === "dedup") {
    const applyTierA = Boolean(ctx.values["apply-tier-a"] ?? ctx.values.applyTierA);
    const applyAlias = ctx.values["apply-alias"] as string | undefined;

    // Load candidates from corpus or manifest
    let manifestData: CorpusManifest | null = null;
    if (fs.existsSync(manifestPath)) {
      try {
        manifestData = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as CorpusManifest;
      } catch {
        // ignore
      }
    }

    const candidateInputs = (manifestData?.files ?? [])
      .filter((f) => f.status === "admitted" || f.status === "deduplicated")
      .map((f) => ({
        identifier: path.basename(path.dirname(f.destination_path ?? f.path)),
        source: f.source,
        bytes: f.bytes ?? 0,
        source_path: f.source_path ?? f.path,
      }));

    const tierAGroups =
      manifestData?.dedup_groups && manifestData.dedup_groups.length > 0
        ? manifestData.dedup_groups.filter((g) => g.tier === "A")
        : detectTierACollisionGroups(candidateInputs);
    const aliasesPath = path.resolve(ctx.repoRoot, "presets/skills/dedup-aliases.json");
    const tierBGroups = detectTierBGroups(aliasesPath);
    const allGroups = [...tierAGroups, ...tierBGroups];
    const summary = formatDedupSummary(allGroups);

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          ctx.mode,
          {
            summary,
            tierAGroupsCount: tierAGroups.length,
            tierBGroupsCount: tierBGroups.length,
            tierAGroups: tierAGroups.slice(0, 30),
            tierBGroups,
          }
        )
      );
    } else {
      console.log(`[skills dedup report]`);
      console.log(` - Total collision/alias groups: ${allGroups.length}`);
      console.log(` - Tier A (automatic name collisions): ${tierAGroups.length} groups`);
      console.log(` - Tier B (operator-reviewed aliases): ${tierBGroups.length} groups`);
      for (const g of tierAGroups.slice(0, 10)) {
        console.log(`   [Tier A] Key: ${g.key} | Winner: ${g.winner ?? "none"} | Members: ${g.members.length}`);
      }
    }
    return EXIT_CODES.SUCCESS;
  }

  // 7. skills scripts-audit
  if (subCommand === "scripts-audit") {
    const isFix = Boolean(ctx.values.fix);

    if (isFix && !isWrite) {
      const msg =
        "skills scripts-audit --fix requires --write when invoked in a build pipeline; refusing to mutate.";
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.MUTATION_REFUSED,
            ctx.mode,
            { requiredFlag: "--write" },
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.MUTATION_REFUSED;
    }

    let materializedFiles = 0;
    if (isFix) {
      const fixRes = planCorpusReferenceMaterialization({ repoRoot: ctx.repoRoot, preview: false });
      materializedFiles = fixRes.totalSupportFilesMaterialized;
    }

    const corpusAudit = auditCitations({ treeDir: corpusDir });
    const seen = new Set(corpusAudit.dangling.map((d) => `${d.skill}\u0000${d.raw}`));
    const diagnostics: Array<{
      skill: string;
      raw: string;
      sourceRoot: string;
      candidatePaths: string[];
      reason: string;
    }> = corpusAudit.dangling.map((d) => ({
      skill: d.skill,
      raw: d.raw,
      sourceRoot: "src/corpus",
      candidatePaths: [],
      reason: d.reason,
    }));

    let scanned = corpusAudit.playbooks_scanned;
    if (fs.existsSync(skillsDir)) {
      const pluginAudit = auditCitations({ treeDir: skillsDir });
      scanned += pluginAudit.playbooks_scanned;
      for (const d of pluginAudit.dangling) {
        if (seen.has(`${d.skill}\u0000${d.raw}`)) continue;
        diagnostics.push({
          skill: d.skill,
          raw: d.raw,
          sourceRoot: "plugin/skills",
          candidatePaths: [],
          reason: d.reason,
        });
      }
    }

    diagnostics.sort((a, b) => a.skill.localeCompare(b.skill) || a.raw.localeCompare(b.raw));
    const clean = diagnostics.length === 0;
    const exitCode = clean ? EXIT_CODES.SUCCESS : EXIT_CODES.CHECK_FAILURE;

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          exitCode,
          isFix ? "write" : "check",
          {
            totalSkillsConsidered: scanned,
            totalSupportFilesMaterialized: materializedFiles,
            totalDanglingReferences: diagnostics.length,
            clean,
            danglingDiagnostics: diagnostics.slice(0, 50),
            ...(isFix ? { fixed: true } : {}),
          },
          [],
          diagnostics.map((d) => `[${d.skill}] Dangling: ${d.raw} -> ${d.reason}`)
        )
      );
    } else {
      if (clean) {
        console.log(
          `[skills scripts-audit passed] All shipped citations resolve to shipped files.`
        );
      } else {
        console.error(
          `[skills scripts-audit failed] ${diagnostics.length} dangling reference(s) detected:`
        );
        for (const d of diagnostics.slice(0, 20)) {
          console.error(` - [${d.skill}] ${d.raw} (${d.reason})`);
        }
      }
    }
    return exitCode;
  }

  // 7b. skills coverage
  if (subCommand === "coverage") {
    const domainValue = ctx.values.domain as string | undefined;
    if (domainValue === undefined || !isSkillDomain(domainValue)) {
      const msg = `Missing or unknown --domain. Expected one of: ${DOMAINS.join(", ")}.`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.CLI_USAGE_ERROR, ctx.mode, {}, [], [msg])
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }
    const domain = domainValue as SkillDomain;
    const expectedBaseline = baselinePath(domain, ctx.repoRoot);
    if (!fs.existsSync(expectedBaseline)) {
      const msg = `Missing baseline '${expectedBaseline}'.`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.ENVIRONMENT_UNAVAILABLE,
            ctx.mode,
            { domain, expectedPath: expectedBaseline },
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.ENVIRONMENT_UNAVAILABLE;
    }

    const { baseline, errors: baselineErrors } = loadBaseline(domain, ctx.repoRoot);
    if (!baseline) {
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.ENVIRONMENT_UNAVAILABLE,
            ctx.mode,
            { domain, expectedPath: expectedBaseline },
            [],
            baselineErrors
          )
        );
      } else {
        for (const e of baselineErrors) console.error(`Error: ${e}`);
      }
      return EXIT_CODES.ENVIRONMENT_UNAVAILABLE;
    }

    const treeDir = fs.existsSync(skillsDir) ? skillsDir : corpusDir;
    const withProposals = Boolean(ctx.values.proposals) || true;
    const report = buildCoverageReport({
      domain,
      repoRoot: ctx.repoRoot,
      treeDir,
      baseline,
      coverageMap: loadCoverageMap(ctx.repoRoot),
      acceptedGaps: loadAcceptedGaps(ctx.repoRoot),
      proposalIndex: withProposals ? buildProposalIndex(treeDir) : undefined,
    });

    const checkMode = ctx.mode === "check";
    const problems: string[] = [];
    if (checkMode) {
      for (const record of report.capabilities) {
        if (record.status === "uncovered") {
          problems.push(
            `[IN-V2] domain '${domain}' capability '${record.id}' is uncovered; remediation: coverage-map | author | accepted-gap`
          );
        }
      }
      for (const category of report.routing.unrouted_categories) {
        problems.push(
          `[RT-1] domain '${domain}' category '${category}' has no route; remediation: add a route targeting a shipped playbook`
        );
      }
      for (const dangling of report.citations.dangling) {
        problems.push(
          `[IN-C3] playbook '${dangling.skill}' cites '${dangling.raw}' which does not ship; remediation: materialize | rewrite | prerequisite`
        );
      }
      for (const stale of report.coverage_map.stale_locators) {
        problems.push(`[CM-3] stale coverage-map locator ${stale}; remediation: update the coverage-map entry`);
      }
      for (const ref of report.coverage_map.dangling_refs) {
        problems.push(`[CM-2] dangling coverage-map reference ${ref}; remediation: update the coverage-map entry`);
      }
    }

    const exitCode = problems.length === 0 ? EXIT_CODES.SUCCESS : EXIT_CODES.CHECK_FAILURE;

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(ctx.rawArgs.join(" "), exitCode, checkMode ? "check" : "preview", report, [], problems)
      );
    } else {
      console.log(
        `[skills coverage] domain=${domain} standard=${report.baseline.standard} revision=${report.baseline.revision}`
      );
      console.log(
        ` - capabilities=${report.totals.capabilities} covered=${report.totals.covered} uncovered=${report.totals.uncovered} accepted_gaps=${report.totals.accepted_gaps}`
      );
      console.log(
        ` - routing: declared=${report.routing.declared_categories.length} routed=${report.routing.categories_with_routes.length} unrouted=${report.routing.unrouted_categories.length} routes=${report.routing.routes}`
      );
      console.log(
        ` - citations: scanned=${report.citations.playbooks_scanned} dangling=${report.citations.dangling_count}`
      );
      for (const p of problems.slice(0, 20)) console.error(` - ${p}`);
    }
    return exitCode;
  }

  // 8. skills update
  if (subCommand === "update") {
    const target = ctx.values.target as string | undefined;
    if (!target) {
      const msg = "Missing required flag: --target <id>";
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CLI_USAGE_ERROR,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    const fromFile = ctx.values.from as string | undefined;
    const presetsSkillPath = path.resolve(ctx.repoRoot, `presets/skills/${target}/SKILL.md`);
    const corpusSkillPath = path.resolve(ctx.repoRoot, `src/corpus/${target}/SKILL.md`);
    const targetFilePath = fs.existsSync(presetsSkillPath)
      ? presetsSkillPath
      : fs.existsSync(corpusSkillPath)
      ? corpusSkillPath
      : presetsSkillPath;

    let candidateContent = "";
    if (fromFile && fs.existsSync(fromFile)) {
      candidateContent = fs.readFileSync(fromFile, "utf-8");
    } else if (fs.existsSync(targetFilePath)) {
      candidateContent = fs.readFileSync(targetFilePath, "utf-8");
    } else {
      const msg = `Target skill '${target}' not found. Use 'arsenal skills new' to create a new skill.`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CLI_USAGE_ERROR,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    const parsed = parseSkillDocument(candidateContent);
    if (!parsed) {
      const msg = "Candidate content has invalid frontmatter structure.";
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CHECK_FAILURE,
            ctx.mode,
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

    if (!isWrite) {
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.SUCCESS,
            "preview",
            { target, targetFilePath, description: parsed.data.description }
          )
        );
      } else {
        console.log(`[skills update preview] Validated update for '${target}' -> ${targetFilePath}`);
        console.log(`Add --write to persist changes.`);
      }
      return EXIT_CODES.SUCCESS;
    }

    fs.mkdirSync(path.dirname(targetFilePath), { recursive: true });
    fs.writeFileSync(targetFilePath, candidateContent, "utf-8");

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          "write",
          { target, targetFilePath, written: true }
        )
      );
    } else {
      console.log(`[skills update] Updated '${target}' at ${targetFilePath}`);
    }
    return EXIT_CODES.SUCCESS;
  }

  // 9. skills new
  if (subCommand === "new") {
    const domain = ctx.values.domain as string | undefined;
    const slug = ctx.values.slug as string | undefined;

    if (!domain || !slug) {
      const msg = "Missing required flags: --domain <domain> --slug <slug>";
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CLI_USAGE_ERROR,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    // Guardrail: check forbidden vendor token
    if (containsForbiddenVendorToken(slug)) {
      const msg = `Slug '${slug}' contains forbidden vendor token. Rejection per contracts/skill-standard.md §1.2.`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CLI_USAGE_ERROR,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    const canonicalId = deriveSkillId(domain as SkillDomain, slug);
    const presetsSkillDir = path.resolve(ctx.repoRoot, `presets/skills/${canonicalId}`);
    const presetsSkillFile = path.join(presetsSkillDir, "SKILL.md");

    const defaultContent = `---
name: ${canonicalId}
description: "Comprehensive operational guidance and verification procedures for ${slug} methodology."
domain: ${domain}
category: general
hide: true
license: MIT
metadata:
  manifest_entry: "presets/skills/${canonicalId}/SKILL.md"
---

# ${canonicalId}

## Preconditions
- Scope verification completed and verified in target environment.

## Execution Methodology
1. Execute authorized assessment procedures according to engagement boundaries.

## Evidence Collection
- Collect relevant command outputs and verifiable proofs.

## Verification Oracle
- Assert operational results against expected criteria.
`;

    if (!isWrite) {
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.SUCCESS,
            "preview",
            { canonicalId, targetPath: presetsSkillFile }
          )
        );
      } else {
        console.log(`[skills new preview] Planned creation of '${canonicalId}' at ${presetsSkillFile}`);
        console.log(`Add --write to persist to disk.`);
      }
      return EXIT_CODES.SUCCESS;
    }

    fs.mkdirSync(presetsSkillDir, { recursive: true });
    fs.writeFileSync(presetsSkillFile, defaultContent, "utf-8");

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          "write",
          { canonicalId, path: presetsSkillFile }
        )
      );
    } else {
      console.log(`[skills new] Created operator-authored skill '${canonicalId}' at ${presetsSkillFile}`);
    }
    return EXIT_CODES.SUCCESS;
  }

  return EXIT_CODES.CLI_USAGE_ERROR;
}
