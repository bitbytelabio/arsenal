/**
 * tests/us12-domain-coverage.test.ts
 * Behavioral oracle for spec 003: routing coverage, shipped-first citation gate,
 * coverage report shape, mobile parity, and specialist definitions.
 *
 * Oracle guarantee: fails against the pre-change routing tables (26 unrouted
 * categories, no route `category` field, upstream-resolved citations) and passes
 * once the cutover is complete.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DOMAINS,
  loadRoutingTables,
  evaluateRoutingInvariants,
  computeRoutingCoverage,
  renderRouterBody,
  estimateRouterTokens,
  splitRouterBody,
  ROUTER_TOKEN_BUDGET,
  type SkillDomain,
} from "../src/core/skill-routing.ts";
import { auditCitations } from "../src/core/reference-resolver.ts";
import { getDeclaredDomainCategories } from "../src/core/corpus-normalize.ts";
import {
  evaluateSpecialistParity,
  parseOwnedCategories,
  SPECIALIST_FILE,
} from "../src/core/specialist-parity.ts";
import { parseSkillDocument } from "../src/core/skill-frontmatter.ts";
import {
  buildCoverageReport,
  loadAcceptedGaps,
  loadBaseline,
  loadCoverageMap,
} from "../src/core/coverage-baseline.ts";

const REPO_ROOT = path.resolve(".");
const CORPUS_DIR = path.join(REPO_ROOT, "src/corpus");

function skillIds(): string[] {
  return fs
    .readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(CORPUS_DIR, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

describe("US1 — routing coverage (RT-1..RT-4, IN-R4)", () => {
  const tables = loadRoutingTables(REPO_ROOT);

  it("RT-1/RT-2/RT-3/RT-4 hold for all four domains against the shipped corpus", () => {
    const violations = evaluateRoutingInvariants(tables, { repoRoot: REPO_ROOT, treeDir: CORPUS_DIR });
    expect(violations.map((v) => `${v.invariant} ${v.domain} ${v.subject}`)).toEqual([]);
  });

  it("RT-1: every declared category has at least one route", () => {
    for (const domain of DOMAINS) {
      const table = tables[domain]!;
      const coverage = computeRoutingCoverage(table, CORPUS_DIR);
      expect({ domain, unrouted: coverage.unrouted_categories }).toEqual({ domain, unrouted: [] });
    }
  });

  it("RT-2: every route leaf exists under src/corpus", () => {
    for (const domain of DOMAINS) {
      const table = tables[domain]!;
      for (const [routeId, route] of Object.entries(table.routes)) {
        expect({
          domain,
          routeId,
          leaf: route.leaf,
          exists: fs.existsSync(path.join(CORPUS_DIR, route.leaf, "SKILL.md")),
        }).toEqual({ domain, routeId, leaf: route.leaf, exists: true });
      }
    }
  });

  it("RT-3: every route declares a category, and every route id appears in priority exactly once", () => {
    for (const domain of DOMAINS) {
      const table = tables[domain]!;
      const declared = new Set(table.categories);
      for (const [routeId, route] of Object.entries(table.routes)) {
        expect(declared.has(route.category)).toBe(true);
        expect(table.priority.filter((id) => id === routeId).length).toBe(1);
      }
    }
  });

  it("RT-4: a cross-domain route carries a non-empty crossDomain.reason", () => {
    for (const domain of DOMAINS) {
      const table = tables[domain]!;
      for (const route of Object.values(table.routes)) {
        if (route.leaf.startsWith(`${domain}-`)) continue;
        expect(typeof route.crossDomain?.reason).toBe("string");
        expect((route.crossDomain?.reason ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("IN-R4: every shipped playbook's category is a declared category of its domain", () => {
    const violations: string[] = [];
    for (const id of skillIds()) {
      const parsed = parseSkillDocument(fs.readFileSync(path.join(CORPUS_DIR, id, "SKILL.md"), "utf-8"));
      if (!parsed) {
        violations.push(`${id}: malformed frontmatter`);
        continue;
      }
      const domain = parsed.data.domain as SkillDomain;
      const category = parsed.data.category as string;
      const declared = new Set(getDeclaredDomainCategories(domain, REPO_ROOT));
      if (!declared.has(category)) violations.push(`${id}: ${domain}/${category} undeclared`);
    }
    expect(violations).toEqual([]);
  });

  it("RT-6: every generated router body stays within the token budget", () => {
    for (const domain of DOMAINS) {
      const table = tables[domain]!;
      const est = estimateRouterTokens(splitRouterBody(renderRouterBody(table)));
      expect({ domain, withinBudget: est <= ROUTER_TOKEN_BUDGET }).toEqual({ domain, withinBudget: true });
    }
  });
});

describe("US2 — shipped-first citation gate (IN-C1..IN-C3)", () => {
  it("IN-C1/IN-C3: the shipped corpus cites zero files that do not ship with it", () => {
    const result = auditCitations({ treeDir: CORPUS_DIR });
    expect(result.dangling.map((d) => `${d.skill} -> ${d.raw}`)).toEqual([]);
  });

  it("IN-C2: prose tokens are not reported as dangling", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-cite-"));
    try {
      const skillDir = path.join(dir, "webapp-fixture");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: webapp-fixture",
          "description: Fixture playbook for the citation gate oracle.",
          "domain: webapp",
          "category: injection",
          "hide: true",
          "license: MIT",
          "---",
          "",
          "The credential example `support/support` is prose, as are `scripts/macros/DLLs` and `scripts/binaries`.",
          "Read `references/present.md` for details.",
          "",
        ].join("\n"),
        "utf-8"
      );
      fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
      fs.writeFileSync(path.join(skillDir, "references", "present.md"), "# present\n", "utf-8");

      const result = auditCitations({ treeDir: dir });
      expect(result.dangling).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fault injection: a broken citation is reported and restoring it clears the gate", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-cite-fault-"));
    try {
      const skillDir = path.join(dir, "webapp-fixture");
      fs.mkdirSync(skillDir, { recursive: true });
      const skillFile = path.join(skillDir, "SKILL.md");
      const baseline = [
        "---",
        "name: webapp-fixture",
        "description: Fixture playbook for the citation gate oracle.",
        "domain: webapp",
        "category: injection",
        "hide: true",
        "license: MIT",
        "---",
        "",
        "Follow the steps.",
        "",
      ].join("\n");
      fs.writeFileSync(skillFile, baseline, "utf-8");
      expect(auditCitations({ treeDir: dir }).dangling_count).toBe(0);

      fs.writeFileSync(
        skillFile,
        `${baseline}\nSee \`references/definitely-not-shipped.md\` for details.\n`,
        "utf-8"
      );
      const broken = auditCitations({ treeDir: dir });
      expect(broken.dangling_count).toBeGreaterThanOrEqual(1);
      expect(broken.dangling[0]?.skill).toBe("webapp-fixture");
      expect(broken.dangling[0]?.raw).toContain("definitely-not-shipped.md");

      fs.writeFileSync(skillFile, baseline, "utf-8");
      expect(auditCitations({ treeDir: dir }).dangling_count).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("US4 — mobile domain parity (SC-006)", () => {
  const mobile = loadRoutingTables(REPO_ROOT).mobile!;

  it("every mobile declared category is backed by a shipped playbook", () => {
    const backed = new Set<string>();
    for (const route of Object.values(mobile.routes)) {
      if (fs.existsSync(path.join(CORPUS_DIR, route.leaf, "SKILL.md"))) backed.add(route.category);
    }
    const missing = mobile.categories.filter((c) => !backed.has(c));
    expect(missing).toEqual([]);
  });

  it("mobile route M1 declares its cross-domain dependency on re-apk-reverse", () => {
    const m1 = mobile.routes.M1!;
    expect(m1.leaf).toBe("re-apk-reverse");
    expect((m1.crossDomain?.reason ?? "").trim().length).toBeGreaterThan(0);
  });

  it("skills coverage for mobile has uncovered 0 and names its MASTG revision", () => {
    const { baseline } = loadBaseline("mobile", REPO_ROOT);
    expect(baseline).not.toBeNull();
    const r = buildCoverageReport({
      domain: "mobile",
      repoRoot: REPO_ROOT,
      treeDir: CORPUS_DIR,
      baseline: baseline!,
      coverageMap: loadCoverageMap(REPO_ROOT),
      acceptedGaps: loadAcceptedGaps(REPO_ROOT),
    });
    expect(r.totals.uncovered).toBe(0);
    expect(r.baseline.revision.length).toBeGreaterThan(0);
    expect(r.baseline.standard).toContain("Mobile Application Security Testing Guide");
  });
});

describe("US5 — specialist definitions (P-1..P-4, SC-007, SC-008)", () => {
  it("each domain specialist states owned categories, retrieval, baseline, handoff, and gap protocol", () => {
    for (const domain of DOMAINS) {
      const file = path.join(REPO_ROOT, "plugin/agents", SPECIALIST_FILE[domain]);
      const md = fs.readFileSync(file, "utf-8");
      for (const phrase of [
        "Owned Categories",
        "Retrieval",
        "Governing Baseline",
        "Handoff",
        "Capability Gap Protocol",
      ]) {
        expect({ file, phrase, present: md.includes(`## ${phrase}`) }).toEqual({ file, phrase, present: true });
      }
    }
  });

  it("P-1..P-4 parity holds and no mismatch is reported", () => {
    const violations = evaluateSpecialistParity(REPO_ROOT);
    expect(violations.map((v) => `${v.invariant} ${v.domain ?? "-"} ${v.subject}`)).toEqual([]);
  });

  it("sec-verifier owns no domain category", () => {
    const md = fs.readFileSync(path.join(REPO_ROOT, "plugin/agents/sec-verifier.md"), "utf-8");
    expect(parseOwnedCategories(md) ?? []).toEqual([]);
  });
});

describe("US3 — coverage report (IN-V1..IN-V3, M-4/M-6, CM-2/CM-3)", () => {
  const TREE = fs.existsSync(path.join(REPO_ROOT, "plugin/skills"))
    ? path.join(REPO_ROOT, "plugin/skills")
    : CORPUS_DIR;

  function report(domain: SkillDomain, overrides: Record<string, unknown> = {}) {
    const { baseline } = loadBaseline(domain, REPO_ROOT);
    if (!baseline) throw new Error(`missing baseline for ${domain}`);
    return buildCoverageReport({
      domain,
      repoRoot: REPO_ROOT,
      treeDir: TREE,
      baseline: (overrides.baseline as never) ?? baseline,
      coverageMap: (overrides.coverageMap as never) ?? loadCoverageMap(REPO_ROOT),
      acceptedGaps: (overrides.acceptedGaps as never) ?? loadAcceptedGaps(REPO_ROOT),
    });
  }

  it("IN-V1: covered + uncovered + accepted_gaps == capabilities for every domain", () => {
    for (const domain of DOMAINS) {
      const r = report(domain);
      expect({ domain, sum: r.totals.covered + r.totals.uncovered + r.totals.accepted_gaps }).toEqual({
        domain,
        sum: r.totals.capabilities,
      });
      expect(r.capabilities.length).toBe(r.totals.capabilities);
    }
  });

  it("every coverage report names its baseline revision and artifact hash", () => {
    for (const domain of DOMAINS) {
      const r = report(domain);
      expect(r.baseline.revision.length).toBeGreaterThan(0);
      expect(r.baseline.extracted_from_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("a covered record names a shipped playbook with a locator that resolves (M-1/CM-3)", () => {
    const violations: string[] = [];
    for (const domain of DOMAINS) {
      for (const record of report(domain).capabilities) {
        if (record.status !== "covered") continue;
        if (record.match !== "reviewed") violations.push(`${domain}/${record.id}: match != reviewed`);
        if (record.covered_by.length === 0) violations.push(`${domain}/${record.id}: no covered_by`);
        for (const cb of record.covered_by) {
          const file = path.join(TREE, cb.id, "SKILL.md");
          if (!fs.existsSync(file)) violations.push(`${domain}/${record.id}: ${cb.id} not shipped`);
          else if (!fs.readFileSync(file, "utf-8").includes(cb.locator)) {
            violations.push(`${domain}/${record.id}: locator '${cb.locator}' does not resolve in ${cb.id}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("IN-V3: two runs on unchanged inputs are byte-identical", () => {
    for (const domain of DOMAINS) {
      expect(JSON.stringify(report(domain))).toBe(JSON.stringify(report(domain)));
    }
  });

  it("M-4/M-6: a capability id present only in a copied support file confers no coverage", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-cov-"));
    try {
      const skillDir = path.join(dir, "webapp-fixture");
      fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: webapp-fixture",
          "description: Fixture playbook for the coverage oracle.",
          "domain: webapp",
          "category: injection",
          "hide: true",
          "license: MIT",
          "---",
          "",
          "## Overview",
          "",
          "No technique identifiers appear in this body.",
          "",
        ].join("\n"),
        "utf-8"
      );
      // The identifier appears ONLY inside a copied support file.
      fs.writeFileSync(path.join(skillDir, "references", "notes.md"), "See T1001 for details.\n", "utf-8");

      const r = buildCoverageReport({
        domain: "red",
        repoRoot: REPO_ROOT,
        treeDir: dir,
        baseline: {
          schemaVersion: "1.0",
          domain: "red",
          standard: { name: "fixture", url: "https://example.invalid", revision: "fixture" },
          extracted_from: { path: "fixture", sha256: "0".repeat(64) },
          license: "Apache-2.0",
          capabilities: [{ id: "T1001", title: "Fixture technique", category: "tactic", source_ref: "fixture" }],
        },
        coverageMap: { schemaVersion: "1.0", entries: [] },
        acceptedGaps: { schemaVersion: "1.0", entries: [] },
      });
      expect(r.totals.covered).toBe(0);
      expect(r.totals.uncovered).toBe(1);
      expect(r.capabilities[0]?.proposals).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fault injection: an unreviewed capability is uncovered and a stale locator is reported", () => {
    // 1. synthetic capability with no reviewed mapping
    const loaded = loadBaseline("webapp", REPO_ROOT);
    if (!loaded.baseline) throw new Error("missing webapp baseline");
    const baseline = loaded.baseline;
    const synthetic = {
      ...baseline,
      capabilities: [
        ...baseline.capabilities,
        { id: "WSTG-SYNTH-99", title: "Synthetic capability", category: "WSTG-INJT", source_ref: "synthetic" },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    };
    const withSynthetic = report("webapp", { baseline: synthetic });
    const syntheticRecord = withSynthetic.capabilities.find((c) => c.id === "WSTG-SYNTH-99");
    expect(syntheticRecord?.status).toBe("uncovered");
    expect(withSynthetic.totals.uncovered).toBeGreaterThan(0);

    // 2. a coverage-map entry whose locator no longer resolves
    const map = loadCoverageMap(REPO_ROOT);
    const target = map.entries.find((e) => e.domain === "re" && e.skills.length > 0);
    expect(target).toBeDefined();
    const mutated = {
      schemaVersion: map.schemaVersion,
      entries: map.entries.map((e) =>
        e === target
          ? { ...e, skills: [{ ...e.skills[0]!, evidence: { ...e.skills[0]!.evidence, locator: "## This Heading Does Not Exist" } }] }
          : e
      ),
    };
    const stale = report("re", { coverageMap: mutated });
    expect(stale.coverage_map.stale_locators.length).toBeGreaterThanOrEqual(1);
    expect(stale.totals.covered).toBeLessThan(target!.skills.length === 0 ? 0 : 20);
  });

  it("routing and citation sections are clean in every report", () => {
    for (const domain of DOMAINS) {
      const r = report(domain);
      expect({ domain, unrouted: r.routing.unrouted_categories }).toEqual({ domain, unrouted: [] });
      expect({ domain, dangling: r.citations.dangling_count }).toEqual({ domain, dangling: 0 });
    }
  });

  it("re is fully covered by reviewed mappings (the mechanism is exercised end to end)", () => {
    const r = report("re");
    expect(r.totals.capabilities).toBe(20);
    expect(r.totals.covered).toBe(20);
    expect(r.totals.uncovered).toBe(0);
  });

  it("every domain has zero uncovered capabilities (SC-005)", () => {
    for (const domain of DOMAINS) {
      const r = report(domain);
      expect({ domain, uncovered: r.totals.uncovered }).toEqual({ domain, uncovered: 0 });
      expect(r.totals.covered + r.totals.accepted_gaps).toBe(r.totals.capabilities);
      expect(r.coverage_map.stale_locators).toEqual([]);
      expect(r.coverage_map.dangling_refs).toEqual([]);
    }
  });

  it("enforces baseline integrity across all 4 domains with 0 uncovered and valid gap rationales (US6 / T027)", () => {
    const gaps = loadAcceptedGaps(REPO_ROOT);
    expect(gaps.entries.length).toBeGreaterThan(0);

    // Validate that every accepted gap has a valid non-empty scope, owner, and migration plan
    for (const gap of gaps.entries) {
      expect(gap.domain).toBeDefined();
      expect(gap.capability_id).toBeDefined();
      expect(gap.scope).toBeDefined();
      expect(gap.scope.trim().length).toBeGreaterThan(5);
      expect(gap.owner).toBeDefined();
      expect(gap.migration_plan).toBeDefined();
    }

    // Verify all 4 domains report 0 uncovered
    for (const domain of DOMAINS) {
      const r = report(domain);
      expect(r.totals.uncovered).toBe(0);
      expect(r.totals.covered + r.totals.accepted_gaps).toBe(r.totals.capabilities);
      expect(r.coverage_map.stale_locators).toEqual([]);
      expect(r.coverage_map.dangling_refs).toEqual([]);
    }
  });
});
