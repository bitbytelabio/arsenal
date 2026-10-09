/**
 * src/core/coverage-baseline.ts
 *
 * Coverage baselines, coverage map, accepted gaps, and the per-domain coverage
 * engine (contracts/coverage-baseline.md; data-model.md §§7–11).
 *
 * Coverage is conferred ONLY by a reviewed entry in
 * `presets/baselines/coverage-map.json` naming a capability, a shipped playbook,
 * and a resolving `evidence.locator` (M-1..M-4). Machine scanning may emit
 * advisory `proposals` (playbook bodies only) which confer nothing.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { validateSchema } from "../schemas/validator.ts";
import type { SkillDomain } from "./skill-frontmatter.ts";
import { loadRoutingTable, computeRoutingCoverage, type RoutingCoverage } from "./skill-routing.ts";
import { auditCitations, type CitationDiagnostic } from "./reference-resolver.ts";

export const COVERAGE_BASELINE_SCHEMA_ID = "https://arsenal.security/schemas/coverage-baseline.json";

export interface Capability {
  id: string;
  title: string;
  category: string;
  source_ref: string;
}

export interface CoverageBaseline {
  schemaVersion: string;
  domain: SkillDomain;
  standard: { name: string; url: string; revision: string; version?: string | null };
  extracted_from: { path: string; sha256: string };
  license: string;
  capabilities: Capability[];
}

export interface CoverageMapEvidence {
  locator: string;
  note: string;
}

export interface CoverageMapSkill {
  id: string;
  evidence: CoverageMapEvidence;
}

export interface CoverageMapEntry {
  capability_id: string;
  domain: SkillDomain;
  skills: CoverageMapSkill[];
  reviewer: string;
  reviewed_at: string;
}

export interface CoverageMap {
  schemaVersion: string;
  entries: CoverageMapEntry[];
}

export interface AcceptedGap {
  domain: SkillDomain;
  capability_id: string;
  owner: string;
  scope: string;
  expiry_condition: string;
  migration_plan: string;
  recorded_at: string;
}

export interface AcceptedGapsFile {
  schemaVersion: string;
  entries: AcceptedGap[];
}

export interface CoverageRecord {
  id: string;
  title: string;
  category: string;
  status: "covered" | "uncovered" | "accepted-gap";
  covered_by: Array<{ id: string; locator: string; note: string }>;
  match: "reviewed" | null;
  gap_ref: string | null;
  proposals: string[];
}

export interface CoverageTotals {
  capabilities: number;
  covered: number;
  uncovered: number;
  accepted_gaps: number;
}

export interface CoverageReport {
  domain: SkillDomain;
  baseline: {
    standard: string;
    revision: string;
    version: string | null;
    extracted_from_sha256: string;
  };
  totals: CoverageTotals;
  capabilities: CoverageRecord[];
  routing: RoutingCoverage;
  citations: {
    playbooks_scanned: number;
    dangling_count: number;
    dangling: CitationDiagnostic[];
  };
  coverage_map: {
    entries: number;
    stale_locators: string[];
    dangling_refs: string[];
  };
}

/**
 * Baseline source registry (research.md R6.2) — deliberately separate from
 * UPSTREAM_SOURCES, which configures corpus ingestion, not evidence sources.
 */
export interface BaselineSource {
  id: SkillDomain;
  repo: string;
  url: string;
  revision: string;
  license: string;
  sourceRoot: string;
  artifactPaths: string[];
}

export const BASELINE_SOURCES: readonly BaselineSource[] = Object.freeze([
  {
    id: "webapp",
    repo: "OWASP/wstg",
    url: "https://github.com/OWASP/wstg",
    revision: "41825236dfaebda3f605f47963c5640bafd1355d",
    license: "CC-BY-SA-4.0",
    sourceRoot: "",
    artifactPaths: ["checklists/checklist.json"],
  },
  {
    id: "red",
    repo: "mitre-attack/attack-stix-data",
    url: "https://github.com/mitre-attack/attack-stix-data",
    revision: "",
    license: "Apache-2.0",
    sourceRoot: "enterprise-attack",
    artifactPaths: ["enterprise-attack.json"],
  },
  {
    id: "mobile",
    repo: "OWASP/mastg",
    url: "https://github.com/OWASP/mastg",
    revision: "",
    license: "CC-BY-SA-4.0",
    sourceRoot: "tests",
    artifactPaths: ["index.md"],
  },
  {
    id: "re",
    repo: "arsenal-local",
    url: "https://github.com/arsenal/arsenal",
    revision: "",
    license: "Apache-2.0",
    sourceRoot: "",
    artifactPaths: [],
  },
]);

export function baselineSource(id: SkillDomain): BaselineSource | undefined {
  return BASELINE_SOURCES.find((s) => s.id === id);
}

export function baselinePath(domain: SkillDomain, repoRoot = "."): string {
  return path.resolve(repoRoot, `presets/baselines/${domain}.json`);
}

export function coverageMapPath(repoRoot = "."): string {
  return path.resolve(repoRoot, "presets/baselines/coverage-map.json");
}

export function acceptedGapsPath(repoRoot = "."): string {
  return path.resolve(repoRoot, "presets/baselines/accepted-gaps.json");
}

export function loadBaseline(
  domain: SkillDomain,
  repoRoot = "."
): { baseline: CoverageBaseline | null; errors: string[] } {
  const file = baselinePath(domain, repoRoot);
  if (!fs.existsSync(file)) {
    return { baseline: null, errors: [`Missing baseline '${file}'`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    return { baseline: null, errors: [`Baseline '${file}' is not valid JSON: ${String(err)}`] };
  }
  const result = validateSchema<CoverageBaseline>(COVERAGE_BASELINE_SCHEMA_ID, parsed);
  if (!result.valid) {
    return { baseline: null, errors: result.errors.map((e) => `[coverage-baseline] ${file} ${e}`) };
  }
  const baseline = parsed as CoverageBaseline;
  const errors: string[] = [];
  if (baseline.domain !== domain) {
    errors.push(`[coverage-baseline] ${file} declares domain '${baseline.domain}', expected '${domain}'`);
  }
  const ids = baseline.capabilities.map((c) => c.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    errors.push(`[coverage-baseline] ${file} contains duplicate capability ids`);
  }
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  if (sorted.join("\u0000") !== ids.join("\u0000")) {
    errors.push(`[coverage-baseline] ${file} capabilities[] is not sorted ascending by id (IN-B2)`);
  }
  return { baseline, errors };
}

export function loadCoverageMap(repoRoot = "."): CoverageMap {
  const file = coverageMapPath(repoRoot);
  if (!fs.existsSync(file)) return { schemaVersion: "1.0", entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as CoverageMap;
    return { schemaVersion: parsed.schemaVersion ?? "1.0", entries: parsed.entries ?? [] };
  } catch {
    return { schemaVersion: "1.0", entries: [] };
  }
}

export function loadAcceptedGaps(repoRoot = "."): AcceptedGapsFile {
  const file = acceptedGapsPath(repoRoot);
  if (!fs.existsSync(file)) return { schemaVersion: "1.0", entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as AcceptedGapsFile;
    return { schemaVersion: parsed.schemaVersion ?? "1.0", entries: parsed.entries ?? [] };
  } catch {
    return { schemaVersion: "1.0", entries: [] };
  }
}

export function locatorResolves(content: string, locator: string): boolean {
  const needle = locator.trim();
  if (needle.length === 0) return false;
  return content.includes(needle);
}

/** Advisory proposals: capability ids mentioned in playbook BODIES only (M-5). */
export function buildProposalIndex(treeDir: string, skillIds?: readonly string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  if (!fs.existsSync(treeDir)) return index;
  const ids =
    skillIds ??
    fs
      .readdirSync(treeDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(treeDir, d.name, "SKILL.md")))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));

  const tokenRe = /\b(?:WSTG-[A-Z]+-\d+|MASTG-TEST-\d+|MASVS-[A-Z]+-\d+|T\d{4}(?:\.\d{3})?)\b/g;

  for (const id of ids) {
    const file = path.join(treeDir, id, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf-8");
    const tokens = new Set(content.match(tokenRe) ?? []);
    for (const token of tokens) {
      if (!index.has(token)) index.set(token, []);
      index.get(token)!.push(id);
    }
  }
  for (const list of index.values()) list.sort((a, b) => a.localeCompare(b));
  return index;
}

export function buildCoverageReport(opts: {
  domain: SkillDomain;
  repoRoot?: string;
  treeDir: string;
  baseline: CoverageBaseline;
  coverageMap: CoverageMap;
  acceptedGaps: AcceptedGapsFile;
  proposalIndex?: Map<string, string[]>;
}): CoverageReport {
  const repoRoot = opts.repoRoot ?? ".";
  const domain = opts.domain;
  const treeDir = opts.treeDir;

  const staleLocators: string[] = [];
  const danglingRefs: string[] = [];

  // Index reviewed entries for this domain.
  const reviewed = new Map<string, CoverageMapEntry>();
  for (const entry of opts.coverageMap.entries) {
    if (entry.domain !== domain) continue;
    const skillIds = new Set(
      fs.existsSync(treeDir)
        ? fs.readdirSync(treeDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
        : []
    );
    const validSkills: CoverageMapSkill[] = [];
    for (const skill of entry.skills ?? []) {
      if (!skillIds.has(skill.id)) {
        danglingRefs.push(`${entry.capability_id} -> ${skill.id} (unknown playbook)`);
        continue;
      }
      const content = fs.readFileSync(path.join(treeDir, skill.id, "SKILL.md"), "utf-8");
      if (!locatorResolves(content, skill.evidence?.locator ?? "")) {
        staleLocators.push(`${entry.capability_id} -> ${skill.id} @ '${skill.evidence?.locator ?? ""}'`);
        continue;
      }
      validSkills.push(skill);
    }
    if (validSkills.length > 0) {
      reviewed.set(entry.capability_id, { ...entry, skills: validSkills });
    } else if ((entry.skills ?? []).length > 0) {
      // Reference exists but no skill validated: the entry confers nothing.
      danglingRefs.push(`${entry.capability_id} (no resolving evidence)`);
    }
  }

  const gaps = new Map<string, AcceptedGap>();
  for (const gap of opts.acceptedGaps.entries) {
    if (gap.domain === domain) gaps.set(gap.capability_id, gap);
  }

  const baselineIds = new Set(opts.baseline.capabilities.map((c) => c.id));
  for (const entry of opts.coverageMap.entries) {
    if (entry.domain !== domain) continue;
    if (!baselineIds.has(entry.capability_id)) {
      danglingRefs.push(`${entry.capability_id} (not in ${domain} baseline)`);
    }
  }

  const records: CoverageRecord[] = opts.baseline.capabilities.map((cap) => {
    const entry = reviewed.get(cap.id);
    const proposals = opts.proposalIndex?.get(cap.id) ?? [];
    if (entry) {
      return {
        id: cap.id,
        title: cap.title,
        category: cap.category,
        status: "covered",
        covered_by: [...entry.skills]
          .map((s) => ({ id: s.id, locator: s.evidence.locator, note: s.evidence.note }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        match: "reviewed",
        gap_ref: null,
        proposals,
      };
    }
    const gap = gaps.get(cap.id);
    if (gap) {
      return {
        id: cap.id,
        title: cap.title,
        category: cap.category,
        status: "accepted-gap",
        covered_by: [],
        match: null,
        gap_ref: `${domain}:${cap.id}`,
        proposals,
      };
    }
    return {
      id: cap.id,
      title: cap.title,
      category: cap.category,
      status: "uncovered",
      covered_by: [],
      match: null,
      gap_ref: null,
      proposals,
    };
  });

  records.sort((a, b) => a.id.localeCompare(b.id));

  const totals: CoverageTotals = {
    capabilities: records.length,
    covered: records.filter((r) => r.status === "covered").length,
    uncovered: records.filter((r) => r.status === "uncovered").length,
    accepted_gaps: records.filter((r) => r.status === "accepted-gap").length,
  };

  const table = loadRoutingTable(domain, repoRoot);
  const routing: RoutingCoverage = table
    ? computeRoutingCoverage(table, treeDir)
    : {
        declared_categories: [],
        categories_with_routes: [],
        unrouted_categories: [],
        routes: 0,
        routes_missing_targets: [],
      };

  const citations = auditCitations({ treeDir });

  return {
    domain,
    baseline: {
      standard: opts.baseline.standard.name,
      revision: opts.baseline.standard.revision,
      version: opts.baseline.standard.version ?? null,
      extracted_from_sha256: opts.baseline.extracted_from.sha256,
    },
    totals,
    capabilities: records,
    routing,
    citations: {
      playbooks_scanned: citations.playbooks_scanned,
      dangling_count: citations.dangling_count,
      dangling: citations.dangling,
    },
    coverage_map: {
      entries: opts.coverageMap.entries.filter((e) => e.domain === domain).length,
      stale_locators: staleLocators.sort((a, b) => a.localeCompare(b)),
      dangling_refs: [...new Set(danglingRefs)].sort((a, b) => a.localeCompare(b)),
    },
  };
}
