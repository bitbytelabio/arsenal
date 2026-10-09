/**
 * src/core/skill-references.ts
 *
 * Support-material planning and materialization.
 *
 * contracts/reference-materialization.md:
 * - Validity is decided by the shipped tree (see reference-resolver.ts); the
 *   gitignored `upstream/` checkout is a materialization *source* only (C-1).
 * - Materialize every file under a playbook's upstream `references/` and
 *   `assets/` (cited or not); `scripts/` only when the body cites it; never
 *   `LICENSE*`/`COPYING*`/`NOTICE*` (FR-017).
 * - Deterministic (`localeCompare` walk); idempotent.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256Bytes } from "./hash.ts";
import {
  readCorpusManifest,
  serializeCorpusManifest,
  type CorpusManifest,
  type SupportFileRecord,
} from "./skill-manifest.ts";
import { loadUpstreamSources, type UpstreamSourceConfig } from "./upstream-sources.ts";
import {
  extractSkillReferences,
  resolveCitation,
  type ExtractedSkillReference,
  type ReferenceKind,
  type CitationStatus,
} from "./reference-resolver.ts";

export type { SupportFileRecord, ReferenceKind, CitationStatus };

export interface ResolvedSkillReference {
  raw: string;
  target: string;
  originalTarget?: string;
  kind: ReferenceKind;
  status: CitationStatus;
  sourceRoot?: string;
  sourcePath?: string;
  sourceRelPath?: string;
  shippedRelPath?: string;
  canonicalSkill?: string;
  resolution?: string;
  candidatePaths?: string[];
  diagnosticReason?: string;
}

export interface MaterializationPlanItem {
  sourceAbsPath: string;
  destRelPath: string;
  destAbsPath: string;
  record: SupportFileRecord;
  content: Buffer;
}

export interface SkillReferenceContext {
  skillSlug: string;
  source: string;
  sourcePath: string;
  repoRoot?: string;
  upstreamConfig?: Record<string, UpstreamSourceConfig>;
  admittedSkillsMap?: Map<string, string>;
}

export interface SkillMaterializationPlan {
  skillSlug: string;
  skillDir: string;
  rewrittenContent: string;
  items: MaterializationPlanItem[];
  supportFiles: SupportFileRecord[];
  danglingReferences: ResolvedSkillReference[];
  crossSkillReferences: ResolvedSkillReference[];
}

export interface PlanCorpusReferencesOptions {
  repoRoot?: string;
  corpusDir?: string;
  preview?: boolean;
  admittedSkillsMap?: Map<string, string>;
}

export interface CorpusReferenceMaterializationResult {
  totalSkillsConsidered: number;
  totalSupportFilesMaterialized: number;
  totalDanglingReferences: number;
  plans: SkillMaterializationPlan[];
  danglingDiagnostics: Array<{
    skill: string;
    raw: string;
    sourceRoot: string;
    candidatePaths: string[];
    reason: string;
  }>;
}

export function sortSupportFiles(files: SupportFileRecord[]): SupportFileRecord[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
}

export function sortResolvedReferences(refs: ResolvedSkillReference[]): ResolvedSkillReference[] {
  return [...refs].sort((a, b) => a.raw.localeCompare(b.raw));
}

/**
 * Resolves the upstream checkout root and skills subdirectory for a source id.
 * Used only to *locate material to copy*, never to validate a citation.
 */
export function resolveSourceRoot(
  source: string,
  repoRoot = "."
): { rootDir: string; skillsSubdir: string; url?: string; rev?: string; license?: string } {
  const configs = loadUpstreamSources(repoRoot);
  const matched =
    configs[source] || configs[source.replace(/-Cybersecurity-Skills$/, "")] || configs["reverse-skill"];

  const rootDir = path.resolve(repoRoot, matched ? matched.upstreamDir : `upstream/${source}`);
  const skillsSubdir = matched ? matched.skillsSubdir : "skills";

  return {
    rootDir,
    skillsSubdir,
    url: matched?.url,
    rev: matched?.rev,
    license: matched?.license,
  };
}

/**
 * Locates the upstream source directory that produced a playbook, trying both
 * `upstreamDir/<sourcePath>` and `upstreamDir/<sourceRoot>/<sourcePath>`.
 */
export function resolveUpstreamSkillDir(
  source: string,
  sourcePath: string,
  repoRoot = "."
): string | null {
  const info = resolveSourceRoot(source, repoRoot);
  const relSkillDir = path.posix.dirname(sourcePath.replace(/\\/g, "/"));
  const candidates = [
    path.resolve(info.rootDir, relSkillDir),
    path.resolve(info.rootDir, info.skillsSubdir, relSkillDir),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
  }
  return null;
}

function isLicenseText(name: string): boolean {
  return /^(LICENSE|COPYING|NOTICE)/i.test(name);
}

/** Deterministic recursive file walk of an absolute directory. */
function walkAllFiles(baseDir: string): string[] {
  if (!fs.existsSync(baseDir)) return [];
  const out: string[] = [];
  const recurse = (dir: string): void => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.name !== ".DS_Store")
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) recurse(full);
      else if (entry.isFile()) out.push(path.relative(baseDir, full).replace(/\\/g, "/"));
    }
  };
  recurse(baseDir);
  return out.sort((a, b) => a.localeCompare(b));
}

/** Deterministic recursive file walk returning paths relative to `baseDir`. */
function walkFiles(baseDir: string, sub: string): string[] {
  const abs = path.join(baseDir, sub);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  const recurse = (dir: string): void => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.name !== ".DS_Store")
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) recurse(full);
      else if (entry.isFile()) out.push(path.relative(baseDir, full).replace(/\\/g, "/"));
    }
  };
  recurse(abs);
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Locates a `references/<file>` published at the *same* source's shared
 * skills-level root (e.g. `upstream/reverse-skill/skills/references/<file>`),
 * which is what a `../references/<file>` citation from a playbook directory
 * points at. Restricted to the playbook's own source so the entry-level
 * provenance (`source`/`source_rev`/`license`) stays accurate. A helper only
 * another source provides is repaired as a documented prerequisite instead
 * (contracts/reference-materialization.md §3), never copied across sources.
 */
export function resolveSharedReferencesFile(
  rel: string,
  source: string,
  repoRoot = "."
): { abs: string; sourceRelPath: string } | null {
  if (!rel.startsWith("references/")) return null;
  const cfg = loadUpstreamSources(repoRoot)[source];
  if (!cfg) return null;
  const cand = path.resolve(repoRoot, cfg.upstreamDir, cfg.skillsSubdir, rel);
  if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
    return { abs: cand, sourceRelPath: rel };
  }
  return null;
}

/**
 * Builds the materialization plan for one skill document.
 * `content` is the current shipped SKILL.md body.
 */
export function buildSkillMaterializationPlan(
  content: string,
  context: SkillReferenceContext
): SkillMaterializationPlan {
  const repoRoot = context.repoRoot || ".";
  const skillDir = path.resolve(repoRoot, "src/corpus", context.skillSlug);

  const citations: ExtractedSkillReference[] = extractSkillReferences(content);
  const resolvedList: ResolvedSkillReference[] = [];
  const dangling: ResolvedSkillReference[] = [];
  const crossSkill: ResolvedSkillReference[] = [];
  const itemsMap = new Map<string, MaterializationPlanItem>();

  const upstreamDir = resolveUpstreamSkillDir(context.source, context.sourcePath, repoRoot);

  const addItem = (relPath: string, overrideSource?: { abs: string; sourceRelPath: string }): void => {
    if (itemsMap.has(relPath)) return;
    // Never materialize outside the playbook directory.
    if (relPath.includes("..") || path.isAbsolute(relPath)) return;
    const base = path.basename(relPath);
    if (isLicenseText(base)) return;
    let sourceAbs: string;
    let sourceRel: string;
    if (overrideSource) {
      sourceAbs = overrideSource.abs;
      sourceRel = overrideSource.sourceRelPath;
    } else {
      if (!upstreamDir) return;
      sourceAbs = path.join(upstreamDir, relPath);
      sourceRel = relPath;
    }
    if (!fs.existsSync(sourceAbs)) return;
    const bytes = fs.readFileSync(sourceAbs);
    const record: SupportFileRecord = {
      path: relPath,
      source_path: sourceRel,
      sha256: sha256Bytes(bytes),
      bytes: bytes.byteLength,
    };
    itemsMap.set(relPath, {
      sourceAbsPath: sourceAbs,
      destRelPath: relPath,
      destAbsPath: path.resolve(skillDir, relPath),
      record,
      content: bytes,
    });
  };

  if (upstreamDir) {
    // Ship every file under references/ and assets/ (cited or not).
    for (const rel of walkFiles(upstreamDir, "references")) addItem(rel);
    for (const rel of walkFiles(upstreamDir, "assets")) addItem(rel);

    // Ship scripts/ only when the body cites the exact path.
    const citedScripts = new Set(
      citations
        .map((c) => c.target.replace(/\\/g, "/").replace(/^\.\//, ""))
        .filter((t) => t.startsWith("scripts/"))
    );
    if (citedScripts.size > 0) {
      for (const rel of walkFiles(upstreamDir, "scripts")) {
        if (citedScripts.has(rel)) addItem(rel);
      }
    }
  }

  // Repair pass: only `../references/<file>` normalization is performed, and only
  // when the target ships at the same source's shared skills-level root
  // (contracts/reference-materialization.md §3 rewrite option). Cross-source
  // copies are deliberately NOT performed, because the manifest's entry-level
  // provenance cannot truthfully describe a file from another repository.
  const rewrites: Array<{ from: string; to: string }> = [];

  // Shipped-first resolution against the corpus tree (+ planned items).
  const plannedPaths = new Set(itemsMap.keys());
  for (const citation of citations) {
    let resolution = resolveCitation(citation, {
      skillId: context.skillSlug,
      shippedTree: path.resolve(repoRoot, "src/corpus"),
    });

    if (
      resolution.status === "dangling" &&
      plannedPaths.has(resolution.target.replace(/\\/g, "/").replace(/^\.\//, ""))
    ) {
      // Will resolve once materialized (raw path is fine as-is).
      resolvedList.push({
        raw: resolution.raw,
        target: resolution.target,
        originalTarget: resolution.originalTarget,
        kind: resolution.kind,
        status: "resolved-shipped",
        shippedRelPath: resolution.target.replace(/\\/g, "/").replace(/^\.\//, ""),
        resolution: "Materialized",
      });
      continue;
    }

    if (resolution.status === "dangling" && citation.target.includes("../")) {
      // Rewrite a `../`-prefixed citation to its in-playbook equivalent when that
      // target ships (contracts/reference-materialization.md §3 rewrite option).
      const stripped = citation.target.replace(/\\/g, "/").replace(/^(\.\.\/)+/, "");
      if (stripped.startsWith("references/")) {
        const shared = resolveSharedReferencesFile(stripped, context.source, repoRoot);
        if (shared) addItem(stripped, shared);
        if (itemsMap.has(stripped) || fs.existsSync(path.join(skillDir, stripped))) {
          rewrites.push({ from: citation.target, to: stripped });
          resolution = {
            raw: citation.raw,
            kind: citation.kind,
            target: stripped,
            originalTarget: citation.target,
            status: "resolved-shipped",
            shippedRelPath: stripped,
            resolution: "Rewritten to shipped path",
          };
        }
      }
    }

    const resource: ResolvedSkillReference = {
      raw: resolution.raw,
      target: resolution.target,
      originalTarget: resolution.originalTarget,
      kind: resolution.kind,
      status: resolution.status,
      shippedRelPath: resolution.shippedRelPath,
      canonicalSkill: resolution.canonicalSkill,
      resolution: resolution.resolution,
      diagnosticReason: resolution.diagnosticReason,
    };
    resolvedList.push(resource);

    if (resolution.status === "dangling") {
      dangling.push(resource);
    } else if (resolution.status === "resolved-cross-skill") {
      crossSkill.push(resource);
    }
  }

  let rewrittenContent = content;
  for (const { from, to } of rewrites) {
    rewrittenContent = rewrittenContent.split(from).join(to);
  }

  const supportFiles = sortSupportFiles(Array.from(itemsMap.values()).map((i) => i.record));
  const items = Array.from(itemsMap.values()).sort((a, b) => a.destRelPath.localeCompare(b.destRelPath));

  return {
    skillSlug: context.skillSlug,
    skillDir,
    rewrittenContent,
    items,
    supportFiles,
    danglingReferences: sortResolvedReferences(dangling),
    crossSkillReferences: sortResolvedReferences(crossSkill),
  };
}

/** Applies or previews a plan. In preview mode nothing is written. */
export function applyMaterializationPlan(
  plan: SkillMaterializationPlan,
  options: { preview?: boolean } = {}
): { writtenCount: number; errors: string[] } {
  const isPreview = options.preview ?? false;
  const errors: string[] = [];
  let writtenCount = 0;

  if (isPreview) {
    return { writtenCount: plan.items.length, errors };
  }

  for (const item of plan.items) {
    try {
      if (!item.destAbsPath.startsWith(plan.skillDir + path.sep)) {
        errors.push(`Refused to write outside the playbook directory: ${item.destRelPath}`);
        continue;
      }
      fs.mkdirSync(path.dirname(item.destAbsPath), { recursive: true });
      fs.writeFileSync(item.destAbsPath, item.content);
      writtenCount++;
    } catch (err) {
      errors.push(
        `Failed to write '${item.destRelPath}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Write the repaired SKILL.md only when a citation was rewritten.
  if (plan.rewrittenContent) {
    const skillMdPath = path.join(plan.skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath) || fs.readFileSync(skillMdPath, "utf-8") !== plan.rewrittenContent) {
      try {
        fs.writeFileSync(skillMdPath, plan.rewrittenContent, "utf-8");
        writtenCount++;
      } catch (err) {
        errors.push(`Failed to write SKILL.md: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return { writtenCount, errors };
}

/**
 * Plans (and, unless preview, applies) support materialization across the corpus,
 * and records `files[].support_files[]` in MANIFEST.json.
 */
export function planCorpusReferenceMaterialization(
  options: PlanCorpusReferencesOptions = {}
): CorpusReferenceMaterializationResult {
  const repoRoot = options.repoRoot || ".";
  const corpusDir = options.corpusDir || path.resolve(repoRoot, "src/corpus");

  const plans: SkillMaterializationPlan[] = [];
  const danglingDiagnostics: CorpusReferenceMaterializationResult["danglingDiagnostics"] = [];
  let totalSupportFiles = 0;

  if (!fs.existsSync(corpusDir)) {
    return {
      totalSkillsConsidered: 0,
      totalSupportFilesMaterialized: 0,
      totalDanglingReferences: 0,
      plans,
      danglingDiagnostics,
    };
  }

  const manifestPath = path.join(corpusDir, "MANIFEST.json");
  let manifest: CorpusManifest | null = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = readCorpusManifest(manifestPath);
    } catch {
      manifest = null;
    }
  }

  const byDestination = new Map<string, { source: string; sourcePath: string }>();
  for (const entry of manifest?.files ?? []) {
    if (!entry.destination_path) continue;
    byDestination.set(entry.destination_path, {
      source: entry.source,
      sourcePath: entry.source_path ?? entry.path,
    });
  }

  const skillDirs = fs
    .readdirSync(corpusDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(corpusDir, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));

  const supportBySkill = new Map<string, SupportFileRecord[]>();

  for (const slug of skillDirs) {
    const skillFilePath = path.join(corpusDir, slug, "SKILL.md");
    const content = fs.readFileSync(skillFilePath, "utf-8");

    const meta = byDestination.get(`src/corpus/${slug}/SKILL.md`);
    const source = meta?.source ?? "reverse-skill";
    const sourcePath = meta?.sourcePath ?? `skills/${slug}/SKILL.md`;

    const plan = buildSkillMaterializationPlan(content, {
      skillSlug: slug,
      source,
      sourcePath,
      repoRoot,
      admittedSkillsMap: options.admittedSkillsMap,
    });

    plans.push(plan);
    totalSupportFiles += plan.supportFiles.length;
    if (plan.supportFiles.length > 0) supportBySkill.set(slug, plan.supportFiles);

    for (const dang of plan.danglingReferences) {
      danglingDiagnostics.push({
        skill: slug,
        raw: dang.raw,
        sourceRoot: resolveSourceRoot(source, repoRoot).rootDir,
        candidatePaths: [],
        reason: dang.diagnosticReason || "unresolved",
      });
    }

    if (!options.preview) {
      applyMaterializationPlan(plan, { preview: false });
    }
  }

  if (!options.preview && manifest) {
    for (const entry of manifest.files) {
      if (entry.status !== "admitted" || !entry.destination_path) continue;
      const prefix = "src/corpus/";
      if (!entry.destination_path.startsWith(prefix)) continue;
      const slug = entry.destination_path.slice(prefix.length).split("/")[0]!;
      const skillDir = path.join(corpusDir, slug);

      const map = new Map<string, SupportFileRecord>();
      // Preserve existing records whose file still ships (legacy provenance).
      for (const rec of entry.support_files ?? []) {
        if (fs.existsSync(path.join(skillDir, rec.path))) map.set(rec.path, rec);
      }
      // Records for materialized items (authoritative).
      for (const rec of supportBySkill.get(slug) ?? []) map.set(rec.path, rec);
      // D-1: every shipped support file has exactly one record.
      for (const rel of walkAllFiles(skillDir)) {
        if (rel === "SKILL.md") continue;
        if (isLicenseText(path.basename(rel))) continue;
        if (map.has(rel)) continue;
        const bytes = fs.readFileSync(path.join(skillDir, rel));
        map.set(rel, {
          path: rel,
          source_path: rel,
          sha256: sha256Bytes(bytes),
          bytes: bytes.byteLength,
        });
      }

      const records = [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
      if (records.length > 0) entry.support_files = records;
      else delete entry.support_files;
    }
    fs.writeFileSync(manifestPath, serializeCorpusManifest(manifest), "utf-8");
  }

  danglingDiagnostics.sort((a, b) => a.skill.localeCompare(b.skill) || a.raw.localeCompare(b.raw));

  return {
    totalSkillsConsidered: skillDirs.length,
    totalSupportFilesMaterialized: totalSupportFiles,
    totalDanglingReferences: danglingDiagnostics.length,
    plans,
    danglingDiagnostics,
  };
}
