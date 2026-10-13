/**
 * src/core/skill-routing.ts
 *
 * The single routing engine for the repository (contracts/routing-table.md §5).
 *
 * Consumed by:
 * - `tools/generate-routers.ts` (router body generation, contracts/routing-table.md §4)
 * - `arsenal skills route --hint` (CLI surface, contracts/cli-coverage.md §5)
 * - `arsenal skills check --domains` (invariants RT-1..RT-4, RT-6; contracts/routing-table.md §6)
 * - `arsenal skills coverage --domain` (routing section of the coverage report)
 * - `plugin/extensions/routing.ts` `skill_route` (runtime, read-only)
 *
 * Pure lookup: no execution, no mutation, no authorization semantics.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { validateSchema } from "../schemas/validator.ts";
import type { SkillDomain } from "./skill-frontmatter.ts";

export type { SkillDomain };

export const DOMAINS: readonly SkillDomain[] = Object.freeze(["re", "webapp", "mobile", "red"]);

export const ROUTING_TABLE_SCHEMA_ID = "https://github.com/bitbytelabio/arsenal/schemas/routing-table.json";

/** Router body token envelope (DESIGN §6.6 compact-router budget, research.md R8). */
export const ROUTER_TOKEN_BUDGET = 500;
export const ROUTER_COMBINED_TOKEN_BUDGET = 2000;

export interface RouteCrossDomain {
  reason: string;
}

export interface RouteRecord {
  id: string;
  leaf: string;
  category: string;
  must: string;
  mustAll?: string[];
  exclude?: string;
  note?: string;
  crossDomain?: RouteCrossDomain;
}

export interface RoutingTableMeta {
  domain: SkillDomain;
  description: string;
  fallbackId?: string;
}

export interface RoutingTable {
  schemaVersion: string;
  meta: RoutingTableMeta;
  categories: string[];
  priority: string[];
  routes: Record<string, RouteRecord>;
}

export interface RouteMatch {
  domain: SkillDomain;
  route_id: string;
  category: string;
  skill: string;
  score: number;
  matched: string[];
  fallback: boolean;
}

export interface NoRouteMatch {
  domain: SkillDomain | null;
  route_id: null;
  note: "NO_ROUTE_MATCH";
}

export type RouteResult = RouteMatch | NoRouteMatch;

export interface RoutingViolation {
  invariant: string;
  domain: SkillDomain;
  subject: string;
  message: string;
  remediation: string;
}

export interface RoutingCoverage {
  declared_categories: string[];
  categories_with_routes: string[];
  unrouted_categories: string[];
  routes: number;
  routes_missing_targets: string[];
}

export function routingTablePath(domain: SkillDomain, repoRoot = "."): string {
  return path.resolve(repoRoot, `presets/${domain}/routing.json`);
}

export function isSkillDomain(value: unknown): value is SkillDomain {
  return typeof value === "string" && (DOMAINS as readonly string[]).includes(value);
}

/**
 * Loads and structurally validates a routing table. Returns null when the file
 * is absent; throws nothing for malformed content (callers report violations).
 */
export function loadRoutingTable(domain: SkillDomain, repoRoot = "."): RoutingTable | null {
  const file = routingTablePath(domain, repoRoot);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as RoutingTable;
  } catch {
    return null;
  }
}

export function loadRoutingTables(repoRoot = "."): Record<SkillDomain, RoutingTable | null> {
  const tables = {} as Record<SkillDomain, RoutingTable | null>;
  for (const domain of DOMAINS) {
    tables[domain] = loadRoutingTable(domain, repoRoot);
  }
  return tables;
}

function safeRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

interface RawRouteEvaluation {
  route: RouteRecord;
  score: number;
  matched: string[];
}

/**
 * Evaluates one table against a hint, returning the winning route or null.
 * Scoring per contracts/routing-table.md §5.1–§5.4.
 */
export function evaluateTable(table: RoutingTable, hint: string): RawRouteEvaluation | null {
  let best: RawRouteEvaluation | null = null;
  let bestIndex = Number.MAX_SAFE_INTEGER;

  table.priority.forEach((routeId, index) => {
    const route = table.routes[routeId];
    if (!route) return;

    const matched: string[] = [];
    let score = 0;

    // must: required, +1 when it matches.
    const mustRe = safeRegExp(route.must ?? "");
    if (mustRe && mustRe.test(hint)) {
      score += 1;
      matched.push(route.must);
    } else if (!route.mustAll || route.mustAll.length === 0) {
      // No mustAll fallback available: route cannot participate.
      return;
    }

    // mustAll: every term must match; each match adds 1.
    if (route.mustAll && route.mustAll.length > 0) {
      for (const term of route.mustAll) {
        const termRe = safeRegExp(term);
        if (!termRe || !termRe.test(hint)) return; // disqualified
        score += 1;
        matched.push(term);
      }
    }

    // exclude: any match disqualifies.
    if (route.exclude && route.exclude.length > 0) {
      const excludeRe = safeRegExp(route.exclude);
      if (excludeRe && excludeRe.test(hint)) return;
    }

    if (score <= 0) return;

    if (score > (best?.score ?? 0) || (best && score === best.score && index < bestIndex)) {
      best = { route, score, matched };
      bestIndex = index;
    }
  });

  return best;
}

function toMatch(domain: SkillDomain, evaluation: RawRouteEvaluation, fallback: boolean): RouteMatch {
  return {
    domain,
    route_id: evaluation.route.id,
    category: evaluation.route.category,
    skill: evaluation.route.leaf,
    score: evaluation.score,
    matched: evaluation.matched,
    fallback,
  };
}

function applyFallback(
  domain: SkillDomain,
  table: RoutingTable
): RouteMatch | null {
  const fallbackId = table.meta?.fallbackId;
  if (!fallbackId) return null;
  const route = table.routes[fallbackId];
  if (!route) return null;
  return {
    domain,
    route_id: route.id,
    category: route.category,
    skill: route.leaf,
    score: 0,
    matched: [],
    fallback: true,
  };
}

/**
 * Routes a hint. When `domain` is omitted, all four tables are evaluated and the
 * highest-scoring route across domains wins (contracts/routing-table.md §5.5).
 */
export function routeHint(
  hint: string,
  domain: SkillDomain | undefined,
  tables: Record<SkillDomain, RoutingTable | null>
): RouteResult {
  const text = (hint ?? "").toString();
  const order: readonly SkillDomain[] = domain ? [domain] : DOMAINS;

  let best: RouteMatch | null = null;
  for (const d of order) {
    const table = tables[d];
    if (!table) continue;
    const evaluation = evaluateTable(table, text);
    if (evaluation) {
      const match = toMatch(d, evaluation, false);
      if (!best || match.score > best.score) {
        best = match;
      }
      continue;
    }
    const fallback = applyFallback(d, table);
    if (fallback && !best) {
      best = fallback;
    }
  }

  if (!best) {
    return { domain: domain ?? null, route_id: null, note: "NO_ROUTE_MATCH" };
  }
  return best;
}

/**
 * Category coverage + route target resolution for one table.
 * `treeDir` is the directory that must contain `<leaf>/SKILL.md`.
 */
export function computeRoutingCoverage(table: RoutingTable, treeDir?: string): RoutingCoverage {
  const declared = [...(table.categories ?? [])];
  const withRoutes = new Set<string>();
  const missingTargets: string[] = [];

  for (const [routeId, route] of Object.entries(table.routes ?? {})) {
    if (route?.category && declared.includes(route.category)) {
      withRoutes.add(route.category);
    }
    if (treeDir && route?.leaf) {
      const leafFile = path.join(treeDir, route.leaf, "SKILL.md");
      if (!fs.existsSync(leafFile)) {
        missingTargets.push(`${routeId} -> ${route.leaf}`);
      }
    }
  }

  const routed = declared.filter((c) => withRoutes.has(c));
  return {
    declared_categories: declared,
    categories_with_routes: routed,
    unrouted_categories: declared.filter((c) => !withRoutes.has(c)),
    routes: Object.keys(table.routes ?? {}).length,
    routes_missing_targets: missingTargets.sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Evaluates RT-1..RT-4 over the four tables.
 * `treeDir` (when provided) enables RT-2 leaf resolution.
 */
export function evaluateRoutingInvariants(
  tables: Record<SkillDomain, RoutingTable | null>,
  opts: { repoRoot?: string; treeDir?: string } = {}
): RoutingViolation[] {
  const violations: RoutingViolation[] = [];
  const treeDir = opts.treeDir;

  for (const domain of DOMAINS) {
    const table = tables[domain];
    if (!table) continue;

    const declared = new Set(table.categories ?? []);
    const covered = new Set<string>();

    for (const [routeId, route] of Object.entries(table.routes ?? {})) {
      if (!route) continue;

      // RT-3: route id in priority exactly once; category declared.
      if (!table.priority.includes(routeId)) {
        violations.push({
          invariant: "RT-3",
          domain,
          subject: routeId,
          message: `route '${routeId}' is missing from priority[] in presets/${domain}/routing.json`,
          remediation: "add the route id to priority[] exactly once",
        });
      }
      if (!route.category || !declared.has(route.category)) {
        violations.push({
          invariant: "RT-3",
          domain,
          subject: routeId,
          message: `route '${routeId}' category '${route.category ?? ""}' is not declared in presets/${domain}/routing.json`,
          remediation: `declare the category in categories[] or correct the route's category`,
        });
      } else {
        covered.add(route.category);
      }

      // RT-2: leaf exists in the shipped tree.
      if (treeDir && route.leaf) {
        const leafFile = path.join(treeDir, route.leaf, "SKILL.md");
        if (!fs.existsSync(leafFile)) {
          violations.push({
            invariant: "RT-2",
            domain,
            subject: `${routeId} -> ${route.leaf}`,
            message: `route '${routeId}' -> '${route.leaf}' not found in ${treeDir}`,
            remediation: "point the route at a shipped playbook or ship the missing playbook",
          });
        }
      }

      // RT-4: cross-domain target declares a reason.
      if (route.leaf && !route.leaf.startsWith(`${domain}-`)) {
        if (!route.crossDomain || !route.crossDomain.reason || route.crossDomain.reason.trim().length === 0) {
          violations.push({
            invariant: "RT-4",
            domain,
            subject: `${routeId} -> ${route.leaf}`,
            message: `route '${routeId}' -> '${route.leaf}' is outside domain '${domain}' and requires crossDomain.reason`,
            remediation: "add crossDomain: { reason: <rationale> } to the route",
          });
        }
      }
    }

    // RT-1: every declared category has >= 1 route.
    for (const category of table.categories ?? []) {
      if (!covered.has(category)) {
        violations.push({
          invariant: "RT-1",
          domain,
          subject: category,
          message: `domain '${domain}' category '${category}' has no route`,
          remediation: `add a route with category '${category}' targeting a shipped playbook`,
        });
      }
    }

    // RT-3: every priority id resolves; no duplicates.
    const seen = new Set<string>();
    for (const id of table.priority ?? []) {
      if (seen.has(id)) {
        violations.push({
          invariant: "RT-3",
          domain,
          subject: id,
          message: `priority[] lists route id '${id}' more than once`,
          remediation: "list each route id exactly once",
        });
      }
      seen.add(id);
      if (!table.routes?.[id]) {
        violations.push({
          invariant: "RT-3",
          domain,
          subject: id,
          message: `priority[] route id '${id}' does not exist in routes{}`,
          remediation: "remove the stale id or add the route",
        });
      }
    }
  }

  return violations;
}

/**
 * Deterministic router body token estimator (research.md R8):
 * floor(body_bytes_excluding_frontmatter / 4), UTF-8.
 */
export function estimateRouterTokens(body: string): number {
  return Math.floor(Buffer.byteLength(body, "utf-8") / 4);
}

/** Splits a router SKILL.md document into (frontmatter, body). */
export function splitRouterBody(document: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(document);
  return match ? document.slice(match[0].length) : document;
}

// ---------------------------------------------------------------------------
// Router body generation (contracts/routing-table.md §4)
// ---------------------------------------------------------------------------

interface RouterFraming {
  title: string;
  guidance: string;
  exampleQuery: string;
  exampleLeaf: string;
}

/** Fixed per-domain framing constants (contract §4: title + one-paragraph guidance). */
export const ROUTER_FRAMING: Readonly<Record<SkillDomain, RouterFraming>> = Object.freeze({
  re: Object.freeze({
    title: "Arsenal Reverse Engineering Router",
    guidance:
      "Use for binary analysis, decompilation (IDA Pro, Ghidra, radare2, Binary Ninja), disassembly, protocol reverse engineering, patch differential analysis, and format string / buffer overflow exploit engineering.",
    exampleQuery: "ida decompilation",
    exampleLeaf: "re-ida-reverse",
  }),
  webapp: Object.freeze({
    title: "Arsenal Web Application Security Router",
    guidance:
      "Use for authorized web application penetration testing, REST/GraphQL API assessment, SQL injection, SSRF, IDOR, path traversal, and JavaScript reverse engineering.",
    exampleQuery: "sql injection differential",
    exampleLeaf: "webapp-exploiting-sql-injection-vulnerabilities",
  }),
  mobile: Object.freeze({
    title: "Arsenal Mobile Application Security Router",
    guidance:
      "Use for Android and iOS mobile application reverse engineering, APK unpacking, smali modification, IPA analysis, Frida hooks, and certificate pinning bypasses.",
    exampleQuery: "frida hook android",
    exampleLeaf: "re-apk-reverse",
  }),
  red: Object.freeze({
    title: "Arsenal Red Team & Active Directory Router",
    guidance:
      "Use for authorized red team operations, Active Directory attacks, Kerberoasting, Linux/Windows privilege escalation, EDR bypass analysis, and network assessments.",
    exampleQuery: "kerberoasting active directory",
    exampleLeaf: "red-windows-ad",
  }),
});

/**
 * Orders declared categories by their first route's priority index, then name ascending.
 * Categories with no route sort last (name ascending).
 */
export function orderedCategories(table: RoutingTable): Array<{ category: string; routeId: string; leaf: string }> {
  const indexOf = new Map<string, number>();
  table.priority.forEach((id, i) => indexOf.set(id, i));

  const rows: Array<{ category: string; routeId: string; leaf: string; index: number }> = [];
  for (const category of table.categories ?? []) {
    let firstId: string | null = null;
    let firstIndex = Number.MAX_SAFE_INTEGER;
    let firstLeaf = "";
    for (const id of table.priority) {
      const route = table.routes[id];
      if (route?.category === category) {
        const idx = indexOf.get(id) ?? Number.MAX_SAFE_INTEGER;
        if (idx < firstIndex) {
          firstIndex = idx;
          firstId = id;
          firstLeaf = route.leaf;
        }
      }
    }
    rows.push({ category, routeId: firstId ?? "", leaf: firstLeaf, index: firstIndex });
  }

  rows.sort((a, b) => a.index - b.index || a.category.localeCompare(b.category));
  return rows.map((r) => ({ category: r.category, routeId: r.routeId, leaf: r.leaf }));
}

/**
 * Renders a router SKILL.md document from a routing table. Pure function of the
 * table + fixed framing (no timestamps, no environment reads) — contracts/routing-table.md §7.
 */
export function renderRouterBody(table: RoutingTable): string {
  const domain = table.meta.domain;
  const framing = ROUTER_FRAMING[domain];
  const description = table.meta.description;

  const categoryLines = orderedCategories(table)
    .map((row) => `- \`${row.category}\` → \`${row.routeId}\` (${row.leaf})`)
    .join("\n");

  return `---
name: arsenal-${domain}-router
description: "${description}"
domain: ${domain}
hide: false
license: MIT
---
# ${framing.title}

## Role & Guidance
${framing.guidance}

## On-Demand Playbook Retrieval
Leaf playbooks are hidden from the base prompt. Use runtime tools:
- \`skill_search(query: "${framing.exampleQuery}", domain: "${domain}")\`
- \`skill_route(hint: "${framing.exampleQuery}", domain: "${domain}")\`
- \`skill_load(name: "${framing.exampleLeaf}")\`

## Declared Categories
${categoryLines}
`;
}

/** Number of category lines in a generated router body (quickstart Scenario 5). */
export function countRouterCategoryLines(document: string): number {
  const body = splitRouterBody(document);
  return body.split("\n").filter((l) => /^- `[^`]+` → `[^`]+` \(.+\)$/.test(l)).length;
}

/** Validates a routing table against the registered routing-table.json schema. */
export function validateRoutingTableSchema(data: unknown): { valid: boolean; errors: string[] } {
  const result = validateSchema(ROUTING_TABLE_SCHEMA_ID, data);
  return { valid: result.valid, errors: result.errors };
}
