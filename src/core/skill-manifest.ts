/**
 * src/core/skill-manifest.ts
 *
 * Implements CorpusManifest and ManifestEntry models, validation, serialization,
 * and merge helpers per data-model.md §§2-3, contracts/skill-lifecycle.md §4, and Task T007.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { validateSchema } from "../schemas/validator.ts";
import { sha256File } from "./hash.ts";

export type ManifestEntryStatus = "admitted" | "deduplicated" | "quarantined" | "excluded";

export interface SupportFileRecord {
  path: string;
  source_path: string;
  sha256: string;
  bytes: number;
}

export interface ManifestEntry {
  path: string;
  source: string;
  source_rev: string | null;
  license: string;
  status: ManifestEntryStatus;
  reason?: string;
  destination_path?: string;
  sha256?: string;
  bytes?: number;
  superseded_by?: string;
  source_path?: string;
  source_sha256?: string;
  support_files?: SupportFileRecord[];
}

export interface CorpusManifestSource {
  repo: string;
  rev: string | null;
  license: string;
}

export interface CorpusManifestSummary {
  total_considered: number;
  admitted: number;
  quarantined: number;
  excluded: number;
  deduplicated: number;
}

export interface DedupGroup {
  key: string;
  tier: "A" | "B";
  members: string[];
  winner?: string;
  rationale: string;
  applied: boolean;
}

export interface CorpusManifest {
  schema_version: 1;
  generator: string;
  created_at: null;
  summary: CorpusManifestSummary;
  sources: Record<string, CorpusManifestSource>;
  files: ManifestEntry[];
  dedup_groups?: DedupGroup[];
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  manifest?: CorpusManifest;
}

export const CORPUS_MANIFEST_SCHEMA_ID = "https://github.com/bitbytelabio/arsenal/schemas/corpus-manifest.json";

export const LOCAL_SOURCE_ID = "arsenal-local";

export const DEFAULT_LOCAL_SOURCE_DESCRIPTOR: CorpusManifestSource = {
  repo: "presets/skills",
  rev: null,
  license: "Apache-2.0",
};

/**
 * Validates a CorpusManifest object against both JSON schema and domain invariants:
 * - JSON schema verification (Ajv via validator.ts)
 * - Summary counts matching actual files array distribution
 * - Deduplicated status invariant: superseded_by present, destination_path/sha256/bytes absent
 * - Admitted status invariant: destination_path, sha256, bytes present
 * - Quarantined/excluded status invariant: reason present
 * - superseded_by resolution: points to an admitted destination_path (IN-7)
 * - source_rev nullability matches source ID (null for arsenal-local, non-null matching sources table)
 * - created_at strictly null (IN-10)
 */
export function validateCorpusManifest(data: unknown): ManifestValidationResult {
  const schemaResult = validateSchema<CorpusManifest>(CORPUS_MANIFEST_SCHEMA_ID, data);
  if (!schemaResult.valid) {
    return {
      valid: false,
      errors: [...schemaResult.errors],
    };
  }

  const manifest = schemaResult.data;
  const invariantErrors: string[] = [];

  // Summary validation
  const counts = {
    admitted: 0,
    quarantined: 0,
    excluded: 0,
    deduplicated: 0,
  };

  const admittedDestinations = new Set<string>();

  for (let i = 0; i < manifest.files.length; i++) {
    const entry = manifest.files[i]!;
    if (entry.status in counts) {
      counts[entry.status as keyof typeof counts]++;
    } else {
      invariantErrors.push(`files[${i}]: unrecognized status '${entry.status}'`);
    }

    if (entry.status === "admitted" && entry.destination_path) {
      admittedDestinations.add(entry.destination_path);
    }

    // Source revision validation against sources dictionary
    const sourceDesc = manifest.sources[entry.source];
    if (!sourceDesc) {
      invariantErrors.push(`files[${i}]: referenced source '${entry.source}' not defined in sources`);
    } else if (entry.source === LOCAL_SOURCE_ID) {
      if (entry.source_rev !== null) {
        invariantErrors.push(`files[${i}]: arsenal-local entry must have source_rev: null`);
      }
    } else {
      if (entry.source_rev !== sourceDesc.rev) {
        invariantErrors.push(
          `files[${i}]: source_rev '${entry.source_rev}' does not match sources['${entry.source}'].rev '${sourceDesc.rev}'`
        );
      }
    }
  }

  const totalConsidered = manifest.files.length;
  if (manifest.summary.total_considered !== totalConsidered) {
    invariantErrors.push(
      `summary.total_considered (${manifest.summary.total_considered}) does not match files.length (${totalConsidered})`
    );
  }

  if (manifest.summary.admitted !== counts.admitted) {
    invariantErrors.push(`summary.admitted (${manifest.summary.admitted}) does not match counted admitted files (${counts.admitted})`);
  }
  if (manifest.summary.quarantined !== counts.quarantined) {
    invariantErrors.push(`summary.quarantined (${manifest.summary.quarantined}) does not match counted quarantined files (${counts.quarantined})`);
  }
  if (manifest.summary.excluded !== counts.excluded) {
    invariantErrors.push(`summary.excluded (${manifest.summary.excluded}) does not match counted excluded files (${counts.excluded})`);
  }
  if (manifest.summary.deduplicated !== counts.deduplicated) {
    invariantErrors.push(`summary.deduplicated (${manifest.summary.deduplicated}) does not match counted deduplicated files (${counts.deduplicated})`);
  }

  const sumCategories = counts.admitted + counts.quarantined + counts.excluded + counts.deduplicated;
  if (sumCategories !== totalConsidered) {
    invariantErrors.push(`Sum of status categories (${sumCategories}) does not equal total_considered (${totalConsidered})`);
  }

  // IN-7: Every superseded_by resolves to an entry with status: admitted
  for (let i = 0; i < manifest.files.length; i++) {
    const entry = manifest.files[i]!;
    if (entry.status === "deduplicated" && entry.superseded_by) {
      if (!admittedDestinations.has(entry.superseded_by)) {
        invariantErrors.push(
          `files[${i}]: superseded_by '${entry.superseded_by}' does not resolve to an admitted destination_path (IN-7)`
        );
      }
    }
  }

  if (invariantErrors.length > 0) {
    return {
      valid: false,
      errors: invariantErrors,
    };
  }

  return {
    valid: true,
    errors: [],
    manifest,
  };
}

/**
 * Deterministic comparator for manifest files entries:
 * Sorted by path ascending (localeCompare), then by source ascending.
 */
export function compareManifestEntries(a: ManifestEntry, b: ManifestEntry): number {
  const pathCmp = a.path.localeCompare(b.path);
  if (pathCmp !== 0) return pathCmp;
  return a.source.localeCompare(b.source);
}

/**
 * Formats a single ManifestEntry with deterministic key order.
 */
function serializeManifestEntry(entry: ManifestEntry): Record<string, unknown> {
  const ordered: Record<string, unknown> = {
    path: entry.path,
    source: entry.source,
    source_rev: entry.source_rev,
    license: entry.license,
    status: entry.status,
  };

  if (entry.reason !== undefined) ordered.reason = entry.reason;
  if (entry.destination_path !== undefined) ordered.destination_path = entry.destination_path;
  if (entry.sha256 !== undefined) ordered.sha256 = entry.sha256;
  if (entry.bytes !== undefined) ordered.bytes = entry.bytes;
  if (entry.superseded_by !== undefined) ordered.superseded_by = entry.superseded_by;
  if (entry.source_path !== undefined) ordered.source_path = entry.source_path;
  if (entry.source_sha256 !== undefined) ordered.source_sha256 = entry.source_sha256;
  if (entry.support_files && entry.support_files.length > 0) {
    ordered.support_files = [...entry.support_files]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((sf) => ({
        path: sf.path,
        source_path: sf.source_path,
        sha256: sf.sha256,
        bytes: sf.bytes,
      }));
  }

  return ordered;
}

/**
 * Serializes CorpusManifest with deterministic sorting and fixed key order.
 * IN-10: Deterministic serialization (null created_at, stable file order, stable key order).
 */
export function serializeCorpusManifest(manifest: CorpusManifest): string {
  // Sort sources alphabetically
  const sortedSourceKeys = Object.keys(manifest.sources).sort((a, b) => a.localeCompare(b));
  const sortedSources: Record<string, CorpusManifestSource> = {};
  for (const k of sortedSourceKeys) {
    const src = manifest.sources[k]!;
    sortedSources[k] = {
      repo: src.repo,
      rev: src.rev,
      license: src.license,
    };
  }

  // Sort files by path, then source
  const sortedFiles = [...manifest.files]
    .sort(compareManifestEntries)
    .map(serializeManifestEntry);

  const orderedManifest: Record<string, unknown> = {
    schema_version: manifest.schema_version,
    generator: manifest.generator,
    created_at: null,
    summary: {
      total_considered: manifest.summary.total_considered,
      admitted: manifest.summary.admitted,
      quarantined: manifest.summary.quarantined,
      excluded: manifest.summary.excluded,
      deduplicated: manifest.summary.deduplicated,
    },
    sources: sortedSources,
    files: sortedFiles,
  };

  if (manifest.dedup_groups && manifest.dedup_groups.length > 0) {
    // Sort dedup groups by key
    const sortedGroups = [...manifest.dedup_groups].sort((a, b) => a.key.localeCompare(b.key));
    orderedManifest.dedup_groups = sortedGroups.map((g) => {
      const groupObj: Record<string, unknown> = {
        key: g.key,
        tier: g.tier,
        members: [...g.members].sort((a, b) => a.localeCompare(b)),
      };
      if (g.winner !== undefined) groupObj.winner = g.winner;
      groupObj.rationale = g.rationale;
      groupObj.applied = g.applied;
      return groupObj;
    });
  }

  return JSON.stringify(orderedManifest, null, 2) + "\n";
}

/**
 * Support-file integrity (contracts/reference-materialization.md §5 D-1/D-2):
 * - D-1: every shipped support file has exactly one record, and every record
 *        resolves to a shipped file inside its owning playbook directory.
 * - D-2: a record whose sha256 does not match the shipped file is an evidence
 *        failure, not an accepted update.
 * Returns one diagnostic per violation; an empty array means clean.
 */
export function validateSupportFileIntegrity(manifest: CorpusManifest, corpusDir: string): string[] {
  const errors: string[] = [];
  for (const entry of manifest.files) {
    if (entry.status !== "admitted" || !entry.destination_path) continue;
    const prefix = "src/corpus/";
    if (!entry.destination_path.startsWith(prefix)) continue;
    const skillDir = path.join(corpusDir, entry.destination_path.slice(prefix.length).split("/")[0]!);

    const recorded = new Set<string>();
    for (const rec of entry.support_files ?? []) {
      recorded.add(rec.path);
      const abs = path.resolve(skillDir, rec.path);
      if (!abs.startsWith(skillDir + path.sep) || !fs.existsSync(abs)) {
        errors.push(`[D-1] ${entry.destination_path}: record '${rec.path}' has no shipped file`);
        continue;
      }
      const actual = sha256File(abs);
      if (rec.sha256 !== actual) {
        errors.push(`[D-2] ${entry.destination_path}: record '${rec.path}' hash mismatch`);
      }
    }

    if (fs.existsSync(skillDir)) {
      const walk = (dir: string): void => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          if (ent.name === ".DS_Store") continue;
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(full);
          else if (ent.isFile()) {
            const rel = path.relative(skillDir, full).replace(/\\/g, "/");
            if (rel === "SKILL.md") continue;
            if (!recorded.has(rel)) {
              errors.push(`[D-1] ${entry.destination_path}: shipped file '${rel}' has no manifest record`);
            }
          }
        }
      };
      walk(skillDir);
    }
  }
  return errors;
}

/**
 * Reads a CorpusManifest from a file and runs strict validation against it.
 */
export function readCorpusManifest(filePath: string): CorpusManifest {
  const content = fs.readFileSync(filePath, "utf-8");
  const raw = JSON.parse(content);
  const result = validateCorpusManifest(raw);
  if (!result.valid || !result.manifest) {
    throw new Error(
      `Corpus manifest at '${filePath}' failed validation:\n  ${result.errors.join("\n  ")}`
    );
  }
  return result.manifest;
}

/**
 * Recomputes the summary object based on the files array.
 */
export function computeManifestSummary(files: ManifestEntry[]): CorpusManifestSummary {
  const summary: CorpusManifestSummary = {
    total_considered: files.length,
    admitted: 0,
    quarantined: 0,
    excluded: 0,
    deduplicated: 0,
  };

  for (const f of files) {
    if (f.status === "admitted") summary.admitted++;
    else if (f.status === "quarantined") summary.quarantined++;
    else if (f.status === "excluded") summary.excluded++;
    else if (f.status === "deduplicated") summary.deduplicated++;
  }

  return summary;
}

/**
 * Merges newly rebuilt upstream manifest entries with previously preserved local-tier entries.
 * Per data-model §3 (IN-11) & contracts/skill-lifecycle.md §4:
 * - 'arsenal-local' entries survive upstream rebuild
 * - 'arsenal-local' sources descriptor survives upstream rebuild
 * - Summary counts are refreshed deterministically
 * - files are stably sorted by path, then source
 */
export function mergeCorpusManifest(
  upstream: CorpusManifest,
  previous?: CorpusManifest | null
): CorpusManifest {
  const localEntries: ManifestEntry[] = [];
  let localSourceDesc: CorpusManifestSource | undefined;

  if (previous) {
    for (const file of previous.files) {
      if (file.source === LOCAL_SOURCE_ID) {
        localEntries.push({ ...file });
      }
    }
    if (previous.sources[LOCAL_SOURCE_ID]) {
      localSourceDesc = { ...previous.sources[LOCAL_SOURCE_ID] };
    }
  }

  // Retain or add local source descriptor
  const mergedSources: Record<string, CorpusManifestSource> = {
    ...upstream.sources,
  };

  if (localSourceDesc) {
    mergedSources[LOCAL_SOURCE_ID] = localSourceDesc;
  } else if (localEntries.length > 0 && !mergedSources[LOCAL_SOURCE_ID]) {
    mergedSources[LOCAL_SOURCE_ID] = { ...DEFAULT_LOCAL_SOURCE_DESCRIPTOR };
  }

  // Filter upstream to ensure no accidental arsenal-local entries are duplicated if upstream had them
  const upstreamFiles = upstream.files.filter((f) => f.source !== LOCAL_SOURCE_ID);

  const mergedFiles: ManifestEntry[] = [...upstreamFiles, ...localEntries].sort(
    compareManifestEntries
  );

  const summary = computeManifestSummary(mergedFiles);

  return {
    schema_version: 1,
    generator: upstream.generator,
    created_at: null,
    summary,
    sources: mergedSources,
    files: mergedFiles,
    ...(upstream.dedup_groups ? { dedup_groups: upstream.dedup_groups } : {}),
  };
}
