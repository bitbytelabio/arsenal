/**
 * tests/us10-skill-standard.test.ts
 * Behavioral oracle suite for User Story 1: Canonical Skill Standard & Corpus Integrity
 *
 * Enforces:
 * - contracts/skill-standard.md §1 Identifier policy (grammar, max 64 chars, forbidden vendor tokens)
 * - contracts/skill-standard.md §2.1 Frontmatter schema, provenance isolation, forbidden vendor keys
 * - contracts/skill-standard.md §2.2 Description bounds (40-300), complete clauses, terminal punctuation, Latin purity
 * - contracts/skill-standard.md §2.4 Shipped body English-only prose and vendor-free bodies
 * - contracts/skill-standard.md §3 Catalog index bidirectional completeness, sorted order, and on-disk hash equality
 * - contracts/skill-standard.md §4.1 & §4.2 Router skills and routing tables leaf-name resolution
 *
 * Oracle guarantee: Fails before T013–T028 land; passes when the cutover is complete.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  SKILL_ID_PATTERN,
  MAX_SKILL_ID_LENGTH,
  FORBIDDEN_VENDOR_SEGMENTS,
  isRouterSkillId,
  containsForbiddenVendorToken,
} from "../src/core/skill-naming.ts";
import {
  parseSkillDocument,
  validateCanonicalSkillFrontmatter,
  splitFrontmatter,
} from "../src/core/skill-frontmatter.ts";
import {
  detectLanguageViolationsInFile,
  hasLanguageResidue,
} from "../src/core/skill-language.ts";
import { readCorpusManifest } from "../src/core/skill-manifest.ts";
import { sha256File } from "../src/core/hash.ts";

const REPO_ROOT = path.resolve(".");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugin");
const SKILLS_DIR = path.join(PLUGIN_DIR, "skills");
const CATALOG_DIR = path.join(PLUGIN_DIR, "catalog");
const INDEX_FILE = path.join(CATALOG_DIR, "skills.index.jsonl");
const MANIFEST_FILE = path.join(REPO_ROOT, "src/corpus/MANIFEST.json");

const ROUTER_IDS: Record<string, true> = {
  "arsenal-re-router": true,
  "arsenal-webapp-router": true,
  "arsenal-mobile-router": true,
  "arsenal-red-router": true,
};

const DOMAINS = ["re", "webapp", "mobile", "red"] as const;

describe("User Story 1: Skill Standard Oracles (T012)", () => {
  it("enforces canonical naming and identifier policy on all shipped skills (§1)", () => {
    expect(fs.existsSync(SKILLS_DIR)).toBe(true);

    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const skillDirs = entries.filter((e) => e.isDirectory());
    expect(skillDirs.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const dir of skillDirs) {
      const name = dir.name;

      if (ROUTER_IDS[name]) {
        expect(isRouterSkillId(name)).toBe(true);
        expect(name.length).toBeLessThanOrEqual(MAX_SKILL_ID_LENGTH);
        continue;
      }

      // Leaf skill identifier grammar
      if (!SKILL_ID_PATTERN.test(name)) {
        violations.push(
          `[grammar] Skill identifier '${name}' violates grammar ^(re|webapp|mobile|red)-[a-z0-9]+(-[a-z0-9]+)*$`
        );
      }

      // Max length
      if (name.length > MAX_SKILL_ID_LENGTH) {
        violations.push(
          `[length] Skill identifier '${name}' length ${name.length} exceeds max ${MAX_SKILL_ID_LENGTH}`
        );
      }

      // Forbidden vendor segments in identifier
      if (containsForbiddenVendorToken(name)) {
        violations.push(
          `[vendor-token] Skill identifier '${name}' contains forbidden vendor token`
        );
      }

      // Check SKILL.md frontmatter name matches directory name
      const skillFile = path.join(SKILLS_DIR, name, "SKILL.md");
      if (!fs.existsSync(skillFile)) {
        violations.push(`[missing-file] Missing SKILL.md in directory '${name}'`);
        continue;
      }

      const content = fs.readFileSync(skillFile, "utf-8");
      const parsed = parseSkillDocument(content);
      if (!parsed) {
        violations.push(`[frontmatter-parse] Failed to parse frontmatter in '${name}'`);
        continue;
      }

      if (parsed.data.name !== name) {
        violations.push(
          `[name-mismatch] Directory '${name}' frontmatter.name declared as '${parsed.data.name}'`
        );
      }

      // Domain must match identifier prefix
      const expectedDomain = name.split("-")[0];
      if (parsed.data.domain !== expectedDomain) {
        violations.push(
          `[domain-mismatch] Skill '${name}' domain '${parsed.data.domain}' does not match prefix '${expectedDomain}'`
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("enforces description bounds, completeness, and character purity (§2.2)", () => {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const skillDirs = entries.filter((e) => e.isDirectory());
    const violations: string[] = [];

    const TERMINAL_PUNCTUATION_REGEX = /[.!?…]$/;
    // Allows Latin script characters, standard ASCII, typographic punctuation, symbols, numbers, and whitespace
    const NON_LATIN_REGEX = /[^\p{Script=Latin}\p{Punctuation}\p{Symbol}\p{Number}\p{Separator}\p{Mark}]/u;

    for (const dir of skillDirs) {
      const name = dir.name;
      const skillFile = path.join(SKILLS_DIR, name, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;

      const content = fs.readFileSync(skillFile, "utf-8");
      const parsed = parseSkillDocument(content);
      if (!parsed) continue;

      const desc = parsed.data.description;
      if (typeof desc !== "string") {
        violations.push(`[desc-type] Skill '${name}' description is not a string`);
        continue;
      }

      // Bound: 40-300 characters
      if (desc.length < 40 || desc.length > 300) {
        violations.push(
          `[desc-length] Skill '${name}' description length ${desc.length} outside [40, 300]: "${desc}"`
        );
      }

      // Single-line scalar
      if (desc.includes("\n") || desc.includes("\r")) {
        violations.push(`[desc-multiline] Skill '${name}' description contains embedded newlines`);
      }

      // Complete sentence/clause ending in terminal punctuation
      if (!TERMINAL_PUNCTUATION_REGEX.test(desc.trim())) {
        violations.push(
          `[desc-fragment] Skill '${name}' description does not end in terminal punctuation: "${desc}"`
        );
      }

      // Zero descriptions containing non-Latin characters or language residue
      if (hasLanguageResidue(desc) || NON_LATIN_REGEX.test(desc)) {
        violations.push(
          `[desc-non-latin] Skill '${name}' description contains non-Latin or language residue characters: "${desc}"`
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("enforces frontmatter provenance isolation and prohibited vendor keys (§2.1)", () => {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const skillDirs = entries.filter((e) => e.isDirectory());
    const violations: string[] = [];

    const FORBIDDEN_KEYS: Record<string, true> = {
      upstream: true,
      source_path: true,
      source_sha256: true,
      source_rev: true,
      raw_source: true,
    };

    for (const dir of skillDirs) {
      const name = dir.name;
      const skillFile = path.join(SKILLS_DIR, name, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;

      const content = fs.readFileSync(skillFile, "utf-8");
      const split = splitFrontmatter(content);
      if (!split) {
        violations.push(`[split-frontmatter] Cannot split frontmatter in '${name}'`);
        continue;
      }

      const parsed = parseSkillDocument(content);
      if (!parsed) continue;

      const fm = parsed.data;

      if (ROUTER_IDS[name]) {
        if (fm.hide !== false) {
          violations.push(`[router-hide] Router '${name}' must have hide: false`);
        }
        continue;
      }

      // Leaves must have hide: true
      if (fm.hide !== true) {
        violations.push(`[leaf-hide] Leaf skill '${name}' must have hide: true`);
      }

      // Leaves must carry metadata.manifest_entry
      const meta = fm.metadata as Record<string, unknown> | undefined;
      if (!meta || typeof meta.manifest_entry !== "string" || meta.manifest_entry.trim().length === 0) {
        violations.push(
          `[missing-manifest-entry] Leaf skill '${name}' missing metadata.manifest_entry`
        );
      } else {
        // Pointer into MANIFEST.json MUST NOT contain a vendor token
        if (containsForbiddenVendorToken(meta.manifest_entry)) {
          violations.push(
            `[manifest-entry-vendor] metadata.manifest_entry '${meta.manifest_entry}' in '${name}' contains vendor token`
          );
        }
      }

      // Forbidden vendor-bearing keys in metadata
      if (meta) {
        for (const forbidden of Object.keys(FORBIDDEN_KEYS)) {
          if (forbidden in meta) {
            violations.push(
              `[forbidden-metadata-key] Leaf skill '${name}' carries forbidden metadata.${forbidden}`
            );
          }
        }
      }

      // Canonical schema validation
      const schemaValidation = validateCanonicalSkillFrontmatter(fm);
      if (!schemaValidation.valid) {
        violations.push(
          `[schema-invalid] Frontmatter in '${name}' fails canonical schema: ${schemaValidation.errors.join("; ")}`
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("enforces admitted manifest entry provenance and upstream receipts (§2.1, data-model)", () => {
    expect(fs.existsSync(MANIFEST_FILE)).toBe(true);

    const manifest = readCorpusManifest(MANIFEST_FILE);
    expect(manifest).toBeDefined();
    expect(manifest.files.length).toBeGreaterThan(0);

    const admitted = manifest.files.filter((f) => f.status === "admitted");
    expect(admitted.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const entry of admitted) {
      if (!entry.source || typeof entry.source !== "string" || entry.source.trim().length === 0) {
        violations.push(`[manifest-source] Admitted entry '${entry.path}' missing valid source`);
      }

      if (entry.source_rev === undefined) {
        violations.push(
          `[manifest-source-rev] Admitted entry '${entry.path}' missing source_rev`
        );
      }

      if (!entry.license || typeof entry.license !== "string" || entry.license.trim().length === 0) {
        violations.push(`[manifest-license] Admitted entry '${entry.path}' missing valid license`);
      }

      if (!entry.source_sha256 || !/^[a-f0-9]{64}$/.test(entry.source_sha256)) {
        violations.push(
          `[manifest-source-sha256] Admitted entry '${entry.path}' missing valid 64-hex source_sha256 (got '${entry.source_sha256}')`
        );
      }

      if (!entry.destination_path || typeof entry.destination_path !== "string") {
        violations.push(
          `[manifest-dest-path] Admitted entry '${entry.path}' missing destination_path`
        );
      }

      if (!entry.sha256 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
        violations.push(
          `[manifest-sha256] Admitted entry '${entry.path}' missing valid 64-hex sha256`
        );
      }

      if (typeof entry.bytes !== "number" || entry.bytes <= 0) {
        violations.push(
          `[manifest-bytes] Admitted entry '${entry.path}' invalid bytes count: ${entry.bytes}`
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("enforces zero forbidden vendor segments in shipped bodies and English-only prose (§1.2, §2.4)", () => {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const skillDirs = entries.filter((e) => e.isDirectory());
    const violations: string[] = [];

    for (const dir of skillDirs) {
      const name = dir.name;
      const skillFile = path.join(SKILLS_DIR, name, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;

      // 1. Language residue sweep (CJK, fullwidth, Vietnamese diacritics / function words)
      const langViolations = detectLanguageViolationsInFile(skillFile);
      if (langViolations.length > 0) {
        violations.push(
          `[language-residue] Skill '${name}' has ${langViolations.length} language residue occurrences (e.g. line ${langViolations[0]?.line}: [${langViolations[0]?.type}] ${langViolations[0]?.match})`
        );
      }

      // 2. Zero forbidden vendor segments in shipped bodies (leaf skills)
      if (!ROUTER_IDS[name]) {
        const content = fs.readFileSync(skillFile, "utf-8");
        const parsed = parseSkillDocument(content);
        const body = parsed ? parsed.body : content;

        for (const vendor of FORBIDDEN_VENDOR_SEGMENTS) {
          // Hyphen-delimited or word boundary vendor token regex
          const vendorRegex = new RegExp(`(?:^|[\\s/_-])${vendor}(?:[\\s/_-]|$)`, "i");
          if (vendorRegex.test(body)) {
            // Note: Report as vendor segment violation
            violations.push(
              `[vendor-in-body] Shipped body in '${name}' contains forbidden vendor token '${vendor}'`
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("enforces catalog bidirectional completeness and hash equality (§3)", () => {
    expect(fs.existsSync(INDEX_FILE)).toBe(true);

    const indexContent = fs.readFileSync(INDEX_FILE, "utf-8");
    const lines = indexContent.split("\n").filter((l) => l.trim().length > 0);
    const indexNames: string[] = [];
    const indexMap = new Map<string, { sha256: string; bytes: number; [k: string]: unknown }>();

    for (const line of lines) {
      const entry = JSON.parse(line);
      indexNames.push(entry.name);
      indexMap.set(entry.name, entry);
    }

    // Ascending sort check
    const sortedNames = [...indexNames].sort((a, b) => a.localeCompare(b));
    expect(indexNames).toEqual(sortedNames);

    const skillDirs = fs
      .readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    const violations: string[] = [];

    // Every disk skill indexed
    for (const name of skillDirs) {
      const entry = indexMap.get(name);
      if (!entry) {
        violations.push(`[unindexed-skill] Skill '${name}' is on disk but missing from catalog index`);
        continue;
      }

      const sFile = path.join(SKILLS_DIR, name, "SKILL.md");
      const currentHash = sha256File(sFile);
      const currentBytes = fs.statSync(sFile).size;

      if (entry.sha256 !== currentHash) {
        violations.push(
          `[hash-mismatch] Skill '${name}' catalog hash ${entry.sha256} != disk hash ${currentHash}`
        );
      }

      if (entry.bytes !== currentBytes) {
        violations.push(
          `[bytes-mismatch] Skill '${name}' catalog bytes ${entry.bytes} != disk bytes ${currentBytes}`
        );
      }
    }

    // Every index entry exists on disk
    for (const name of indexNames) {
      const sFile = path.join(SKILLS_DIR, name, "SKILL.md");
      if (!fs.existsSync(sFile)) {
        violations.push(`[orphaned-index] Catalog entry '${name}' does not exist on disk`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("enforces leaf-name resolution in routers and routing tables (§4.1, §4.2)", () => {
    const violations: string[] = [];

    // Exactly 4 routers must exist
    for (const routerId of Object.keys(ROUTER_IDS)) {
      const rFile = path.join(SKILLS_DIR, routerId, "SKILL.md");
      if (!fs.existsSync(rFile)) {
        violations.push(`[missing-router] Required Tier 1 router '${routerId}' missing on disk`);
        continue;
      }

      const rContent = fs.readFileSync(rFile, "utf-8");
      // Extract referenced leaf skills from router body: e.g. skill_load(name: "...") or `- \`...\`:`
      const leafMatches = [
        ...rContent.matchAll(/skill_load\(name:\s*"([a-z0-9-]+)"\)/g),
        ...rContent.matchAll(/-\s*`([a-z0-9-]+)`:/g),
      ];

      for (const m of leafMatches) {
        const leaf = m[1];
        if (!leaf || ROUTER_IDS[leaf]) continue;
        const leafFile = path.join(SKILLS_DIR, leaf, "SKILL.md");
        if (!fs.existsSync(leafFile)) {
          violations.push(
            `[router-dangling-leaf] Router '${routerId}' references unresolvable leaf skill '${leaf}'`
          );
        }
      }
    }

    // Routing tables in presets/<domain>/routing.json
    for (const domain of DOMAINS) {
      const routingFile = path.join(REPO_ROOT, "presets", domain, "routing.json");
      if (!fs.existsSync(routingFile)) {
        violations.push(`[missing-routing-file] Missing routing table '${routingFile}'`);
        continue;
      }

      const routing = JSON.parse(fs.readFileSync(routingFile, "utf-8"));
      const routes = routing.routes || {};
      const priority = routing.priority || [];

      // Every priority id listed exactly once in routes
      const prioritySet = new Set(priority);
      if (priority.length !== prioritySet.size) {
        violations.push(
          `[duplicate-priority] Routing table '${domain}' contains duplicate IDs in priority list`
        );
      }

      for (const routeId of priority) {
        const route = routes[routeId];
        if (!route) {
          violations.push(
            `[priority-route-missing] Route '${routeId}' in priority list missing from routes in '${domain}'`
          );
          continue;
        }

        const leaf = route.leaf;
        if (!leaf) {
          violations.push(`[missing-leaf] Route '${routeId}' in '${domain}' missing leaf property`);
          continue;
        }

        const leafFile = path.join(SKILLS_DIR, leaf, "SKILL.md");
        if (!fs.existsSync(leafFile)) {
          violations.push(
            `[routing-dangling-leaf] Route '${routeId}' in '${domain}' references unresolvable leaf skill '${leaf}'`
          );
        }

        // Must be in same domain (re-apk-reverse is shared mobile/RE reverse root per benchmark)
        if (!leaf.startsWith(`${domain}-`) && !(domain === "mobile" && leaf === "re-apk-reverse")) {
          violations.push(
            `[cross-domain-leaf] Route '${routeId}' in '${domain}' references leaf '${leaf}' from different domain`
          );
        }

        // Every route record carries a declared category (spec 003, RT-3).
        const declaredCategories: string[] = routing.categories || [];
        if (!route.category || !declaredCategories.includes(route.category)) {
          violations.push(
            `[routing-undeclared-category] Route '${routeId}' in '${domain}' category '${String(
              route.category
            )}' is not declared in presets/${domain}/routing.json`
          );
        }
      }
    }

    // §4.2 Generated router bodies enumerate every declared category exactly once
    // (contracts/routing-table.md §4; spec 003 T009).
    for (const domain of DOMAINS) {
      const routingFile = path.join(REPO_ROOT, "presets", domain, "routing.json");
      if (!fs.existsSync(routingFile)) continue;
      const routing = JSON.parse(fs.readFileSync(routingFile, "utf-8"));
      const declaredCount: number = (routing.categories || []).length;
      const routerFile = path.join(SKILLS_DIR, `arsenal-${domain}-router`, "SKILL.md");
      if (!fs.existsSync(routerFile)) {
        violations.push(`[router-missing] Missing generated router body '${routerFile}'`);
        continue;
      }
      const body = fs.readFileSync(routerFile, "utf-8");
      const categoryLines = body
        .split("\n")
        .filter((l) => /^- `[^`]+` → `[^`]+` \(.+\)$/.test(l.trim()));
      if (categoryLines.length !== declaredCount) {
        violations.push(
          `[router-category-lines] Router 'arsenal-${domain}-router' has ${categoryLines.length} category line(s), expected ${declaredCount}`
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("enforces recursive technical English and zero .ps1 script hygiene (US5 / T022)", () => {
    const corpusRoot = path.join(REPO_ROOT, "src/corpus");
    expect(fs.existsSync(corpusRoot)).toBe(true);

    // Assert 1: Zero .ps1 files anywhere in src/corpus
    function findFiles(dir: string, ext: string): string[] {
      const results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          results.push(...findFiles(full, ext));
        } else if (ent.isFile() && ent.name.endsWith(ext)) {
          results.push(full);
        }
      }
      return results;
    }

    const ps1Files = findFiles(corpusRoot, ".ps1");
    expect(ps1Files).toEqual([]);

    // Assert 2: Recursive language scan of all .md files across corpus
    const mdFiles = findFiles(corpusRoot, ".md");
    expect(mdFiles.length).toBeGreaterThan(1651); // Includes references/, assets/, support/

    const languageViolations: Array<{ file: string; line: number; type: string; match: string }> = [];
    for (const file of mdFiles) {
      const violations = detectLanguageViolationsInFile(file);
      for (const v of violations) {
        languageViolations.push({
          file: path.relative(REPO_ROOT, file),
          line: v.line,
          type: v.type,
          match: v.match,
        });
      }
    }

    expect(languageViolations).toEqual([]);
  });
});
