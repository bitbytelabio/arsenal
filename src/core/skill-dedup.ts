/**
 * src/core/skill-dedup.ts
 *
 * Implements the DedupGroup model and Tier A / Tier B deduplication mechanics
 * per data-model.md §6, research.md R4, and Task T009.
 *
 * Tier A (automatic, name collision):
 * - Collision groups keyed on `<domain>-<capability-slug>`.
 * - Deterministic pure function winner selection:
 *   (body bytes desc, source priority desc, source_path asc)
 *   Declared source priority:
 *   reverse-skill > claude-red > xalgorix > Anthropic-Cybersecurity-Skills > strix
 * - Zero dependence on wall-clock, randomness, or input order.
 * - applied is always true.
 *
 * Tier B (operator-reviewed alias groups):
 * - Reads presets/skills/dedup-aliases.json.
 * - Report-only output when applied is false.
 */

import * as fs from "node:fs";

/**
 * Small candidate model for deduplication to remain completely decoupled
 * from the manifest schema/agent.
 */
export interface DedupCandidate {
  identifier: string;
  domain: string;
  slug: string;
  bytes: number;
  source: string;
  source_path: string;
}

export interface DedupCandidateInput {
  identifier?: string;
  name?: string;
  domain?: string;
  slug?: string;
  bytes?: number;
  bodyBytes?: number;
  source: string;
  source_path?: string;
  sourcePath?: string;
  path?: string;
}

/**
 * DedupGroup shape per data-model.md §6 and CORPUS_MANIFEST_SCHEMA.
 */
export interface DedupGroup {
  key: string;
  tier: "A" | "B";
  members: string[];
  winner?: string;
  rationale: string;
  applied: boolean;
}

export interface TierAWinnerResult {
  winner: DedupCandidate;
  losers: DedupCandidate[];
  rationale: string;
}

export interface DedupAliasesFile {
  schemaVersion: string;
  aliases: Record<
    string,
    | string
    | string[]
    | {
        members?: string[];
        winner?: string;
        rationale?: string;
        applied?: boolean;
      }
  >;
}

export const DEFAULT_ALIASES_PATH = "presets/skills/dedup-aliases.json";

/**
 * Declared upstream source priorities per research.md R4:
 * reverse-skill > claude-red > xalgorix > Anthropic-Cybersecurity-Skills > strix
 */
export const DECLARED_SOURCE_PRIORITIES: Readonly<Record<string, number>> = Object.freeze({
  "reverse-skill": 50,
  revskill: 50,
  "claude-red": 40,
  claudered: 40,
  xalgorix: 30,
  "Anthropic-Cybersecurity-Skills": 20,
  anthropic: 20,
  strix: 10,
});

export const SOURCE_PRIORITY_ORDER: readonly string[] = Object.freeze([
  "reverse-skill",
  "claude-red",
  "xalgorix",
  "Anthropic-Cybersecurity-Skills",
  "strix",
]);

/**
 * Resolves the numeric priority for a given source name (case-insensitive fallback).
 */
export function getSourcePriority(source: string): number {
  return (
    DECLARED_SOURCE_PRIORITIES[source] ??
    DECLARED_SOURCE_PRIORITIES[source.toLowerCase()] ??
    0
  );
}

/**
 * Normalizes a partial or alternative candidate input into a strict DedupCandidate.
 */
export function normalizeDedupCandidate(input: DedupCandidateInput): DedupCandidate {
  const identifier = input.identifier ?? input.name ?? "";
  let domain = input.domain ?? "";
  let slug = input.slug ?? "";

  if ((!domain || !slug) && identifier) {
    const dashIndex = identifier.indexOf("-");
    if (dashIndex > 0) {
      domain = domain || identifier.substring(0, dashIndex);
      slug = slug || identifier.substring(dashIndex + 1);
    }
  }

  return {
    identifier,
    domain,
    slug,
    bytes: input.bytes ?? input.bodyBytes ?? 0,
    source: input.source,
    source_path: input.source_path ?? input.sourcePath ?? input.path ?? "",
  };
}

/**
 * Pure deterministic comparator for Tier A candidate selection.
 * Ordering: (body bytes desc, source priority desc, source_path asc, identifier asc).
 * Returns negative if a ranks before b (a wins), positive if b ranks before a (b wins).
 */
export function compareDedupCandidates(a: DedupCandidate, b: DedupCandidate): number {
  // 1. Body bytes descending (larger wins)
  if (a.bytes !== b.bytes) {
    return b.bytes - a.bytes;
  }

  // 2. Source priority descending (higher priority wins)
  const prioA = getSourcePriority(a.source);
  const prioB = getSourcePriority(b.source);
  if (prioA !== prioB) {
    return prioB - prioA;
  }

  // 3. source_path ascending (lexicographical asc wins)
  if (a.source_path !== b.source_path) {
    return a.source_path.localeCompare(b.source_path);
  }

  // 4. Stable tie-breaker: identifier ascending
  return a.identifier.localeCompare(b.identifier);
}

/**
 * Returns a new array of candidates sorted deterministically by the Tier A priority function.
 */
export function sortDedupCandidates(candidates: Iterable<DedupCandidate>): DedupCandidate[] {
  return [...candidates].sort(compareDedupCandidates);
}

/**
 * Resolves the deterministic Tier A winner and losers from a list of collision candidates.
 */
export function resolveTierAWinner(candidates: readonly DedupCandidate[]): TierAWinnerResult {
  if (candidates.length === 0) {
    throw new Error("Cannot resolve Tier A winner from an empty candidate list");
  }

  const sorted = sortDedupCandidates(candidates);
  const winner = sorted[0]!;
  const losers = sorted.slice(1);

  if (losers.length === 0) {
    return {
      winner,
      losers: [],
      rationale: "unique technique",
    };
  }

  const runnerUp = losers[0]!;
  let rationale = "";

  if (winner.bytes !== runnerUp.bytes) {
    rationale = `body bytes (${winner.bytes} > ${runnerUp.bytes})`;
  } else if (getSourcePriority(winner.source) !== getSourcePriority(runnerUp.source)) {
    rationale = `source priority (${winner.source} > ${runnerUp.source})`;
  } else if (winner.source_path !== runnerUp.source_path) {
    rationale = `source_path lexicographic (${winner.source_path} < ${runnerUp.source_path})`;
  } else {
    rationale = `deterministic tie-breaker (${winner.identifier} <= ${runnerUp.identifier})`;
  }

  return {
    winner,
    losers,
    rationale,
  };
}

/**
 * Detects Tier A collision groups among candidates keyed on `<domain>-<capability-slug>`.
 * Returns only groups that contain 2 or more candidates.
 * Output is deterministically sorted by group key.
 */
export function detectTierACollisionGroups(
  candidates: Iterable<DedupCandidateInput>,
): DedupGroup[] {
  const groupsByKey = new Map<string, DedupCandidate[]>();

  for (const raw of candidates) {
    const candidate = normalizeDedupCandidate(raw);
    const key = candidate.domain && candidate.slug
      ? `${candidate.domain}-${candidate.slug}`
      : candidate.identifier;

    const existing = groupsByKey.get(key);
    if (existing) {
      existing.push(candidate);
    } else {
      groupsByKey.set(key, [candidate]);
    }
  }

  const result: DedupGroup[] = [];

  for (const [key, groupCandidates] of groupsByKey.entries()) {
    if (groupCandidates.length < 2) {
      continue;
    }

    const { winner, rationale } = resolveTierAWinner(groupCandidates);
    const sorted = sortDedupCandidates(groupCandidates);

    result.push({
      key,
      tier: "A",
      members: sorted.map((c) => c.identifier),
      winner: winner.identifier,
      rationale,
      applied: true,
    });
  }

  return result.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Loads the Tier B alias table from disk.
 * Returns default empty structure if file does not exist.
 */
export function loadTierBAliases(filePath = DEFAULT_ALIASES_PATH): DedupAliasesFile {
  if (!fs.existsSync(filePath)) {
    return { schemaVersion: "1.0", aliases: {} };
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as DedupAliasesFile;
    return {
      schemaVersion: parsed.schemaVersion || "1.0",
      aliases: parsed.aliases || {},
    };
  } catch (err) {
    throw new Error(
      `Failed to read Tier B dedup aliases from ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Produces Tier B DedupGroups from an alias map or alias file.
 * Invariant IN-19: Tier B groups with applied: false produce report output only.
 */
export function detectTierBGroups(
  aliasesInput?: string | DedupAliasesFile,
  applied = false,
): DedupGroup[] {
  const aliasData =
    typeof aliasesInput === "string"
      ? loadTierBAliases(aliasesInput)
      : aliasesInput ?? loadTierBAliases();

  const groups: DedupGroup[] = [];
  const entries = Object.entries(aliasData.aliases || {});

  // Group alias-to-canonical pairs if format is { aliasSlug: canonicalKey }
  const canonicalToMembers = new Map<string, Set<string>>();

  for (const [key, value] of entries) {
    if (typeof value === "string") {
      const canonicalKey = value;
      const set = canonicalToMembers.get(canonicalKey) ?? new Set<string>();
      set.add(canonicalKey);
      set.add(key);
      canonicalToMembers.set(canonicalKey, set);
    } else if (Array.isArray(value)) {
      const memberSet = new Set<string>([key, ...value]);
      const members = [...memberSet].sort();
      if (members.length >= 2) {
        groups.push({
          key,
          tier: "B",
          members,
          winner: key,
          rationale: "operator-reviewed alias group",
          applied,
        });
      }
    } else if (value && typeof value === "object") {
      const declaredMembers = value.members ?? [];
      const memberSet = new Set<string>([key, ...declaredMembers]);
      const members = [...memberSet].sort();
      if (members.length >= 2) {
        groups.push({
          key,
          tier: "B",
          members,
          winner: value.winner ?? key,
          rationale: value.rationale ?? "operator-reviewed alias group",
          applied: value.applied ?? applied,
        });
      }
    }
  }

  for (const [canonicalKey, memberSet] of canonicalToMembers.entries()) {
    const members = [...memberSet].sort();
    if (members.length >= 2) {
      groups.push({
        key: canonicalKey,
        tier: "B",
        members,
        winner: canonicalKey,
        rationale: "operator-reviewed alias group",
        applied,
      });
    }
  }

  return groups.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Calculates summary metrics for dedup groups.
 */
export function formatDedupSummary(groups: readonly DedupGroup[]): {
  totalGroups: number;
  tierA: number;
  tierB: number;
  totalCollisions: number;
} {
  let tierA = 0;
  let tierB = 0;
  let totalCollisions = 0;

  for (const g of groups) {
    if (g.tier === "A") {
      tierA++;
    } else if (g.tier === "B") {
      tierB++;
    }
    totalCollisions += g.members.length;
  }

  return {
    totalGroups: groups.length,
    tierA,
    tierB,
    totalCollisions,
  };
}
