/**
 * tools/reconcile-corpus-manifest.ts
 * Reconciles src/corpus/MANIFEST.json support_files with actual files on disk
 * Eliminates D-1 (missing/unrecorded files) and D-2 (hash mismatch) errors
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256File } from "../src/core/hash.ts";
import {
  type CorpusManifest,
  serializeCorpusManifest,
  validateCorpusManifest,
  validateSupportFileIntegrity,
} from "../src/core/skill-manifest.ts";

const ADAPTED_POSIX_SCRIPT_SOURCES: Record<string, string> = {
  "re-apk-reverse:templates/manifest-summary.sh": "arsenal-adapted-from:scripts/manifest-summary.ps1",
  "re-ida-reverse:templates/install-autostart.sh": "arsenal-adapted-from:scripts/install-autostart.ps1",
  "re-ida-reverse:templates/open.sh": "arsenal-adapted-from:scripts/open.ps1",
  "re-ida-reverse:templates/recover.sh": "arsenal-adapted-from:scripts/recover.ps1",
  "re-ida-reverse:templates/start-gui.sh": "arsenal-adapted-from:scripts/start-gui.ps1",
  "re-ida-reverse:templates/start.sh": "arsenal-adapted-from:scripts/start.ps1",
};

function resolveSupportSourcePath(
  skillId: string,
  entrySource: string,
  entrySourcePath: string | undefined,
  relPath: string,
  repoRoot: string
): string | null {
  const adapted = ADAPTED_POSIX_SCRIPT_SOURCES[`${skillId}:${relPath}`];
  if (adapted) return adapted;

  if (entrySource === "Anthropic-Cybersecurity-Skills" && entrySourcePath) {
    const slugDir = path.posix.dirname(entrySourcePath);
    const upRoot = path.join(repoRoot, "upstream/Anthropic-Cybersecurity-Skills/skills", slugDir);
    if (fs.existsSync(path.join(upRoot, relPath))) return relPath;
    if (relPath.startsWith("templates/")) {
      const asScript = `scripts/${relPath.slice("templates/".length)}`;
      if (fs.existsSync(path.join(upRoot, asScript))) return asScript;
    }
    return null;
  }

  if (entrySource === "reverse-skill" && entrySourcePath) {
    const skillSubDir = path.posix.dirname(entrySourcePath); // e.g. skills/apk-reverse
    const revRoot = path.join(repoRoot, "upstream/reverse-skill");
    if (fs.existsSync(path.join(revRoot, skillSubDir, relPath))) return relPath;
    if (relPath.startsWith("references/")) {
      const sub = relPath.slice("references/".length);
      if (fs.existsSync(path.join(revRoot, "skills/references", sub))) return `skills/references/${sub}`;
    }
    if (relPath.startsWith("templates/")) {
      const sub = relPath.slice("templates/".length);
      if (fs.existsSync(path.join(revRoot, skillSubDir, "scripts", sub))) return `scripts/${sub}`;
      if (fs.existsSync(path.join(revRoot, "skills/scripts", sub))) return `skills/scripts/${sub}`;
    }
    if (relPath.startsWith("scripts/")) {
      const sub = relPath.slice("scripts/".length);
      if (fs.existsSync(path.join(revRoot, skillSubDir, "scripts", sub))) return `scripts/${sub}`;
      if (fs.existsSync(path.join(revRoot, "skills/scripts", sub))) return `skills/scripts/${sub}`;
    }
    if (relPath.startsWith("support/templates/")) {
      const sub = relPath.slice("support/templates/".length);
      if (fs.existsSync(path.join(revRoot, "skills/scripts", sub))) return `skills/scripts/${sub}`;
    }
    if (relPath.startsWith("support/")) {
      const sub = relPath.slice("support/".length);
      if (fs.existsSync(path.join(revRoot, "skills", sub))) return `skills/${sub}`;
      if (fs.existsSync(path.join(revRoot, sub))) return sub;
    }
    return null;
  }

  if (entrySource === "rea" || entrySource === "arsenal-local" || entrySource === "xalgorix" || entrySource === "claude-red" || entrySource === "strix") {
    return relPath;
  }

  return null;
}

export function reconcileManifest(
  manifestPath: string,
  corpusDir: string
): { updated: number; remainingErrors: string[]; schemaValid: boolean; schemaErrors: string[]; unresolvedProvenance: string[] } {
  const repoRoot = path.resolve(corpusDir, "../..");
  const raw = fs.readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as CorpusManifest;

  let updated = 0;
  const prefix = "src/corpus/";

  const unresolvedProvenance: string[] = [];
  for (const entry of manifest.files) {
    if (entry.status !== "admitted" || !entry.destination_path) continue;
    if (!entry.destination_path.startsWith(prefix)) continue;

    const skillId = entry.destination_path.slice(prefix.length).split("/")[0]!;
    const skillDir = path.join(corpusDir, skillId);
    if (!fs.existsSync(skillDir)) continue;

    // Check SKILL.md hash
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (fs.existsSync(skillMdPath)) {
      const currentMdHash = sha256File(skillMdPath);
      const currentMdBytes = fs.statSync(skillMdPath).size;
      if (entry.sha256 !== currentMdHash || entry.bytes !== currentMdBytes) {
        entry.sha256 = currentMdHash;
        entry.bytes = currentMdBytes;
        updated++;
      }
    }

    // Collect all support files on disk
    const oldSupportMap = new Map<string, string>();
    for (const s of entry.support_files ?? []) {
      if (s.path && s.source_path) oldSupportMap.set(s.path, s.source_path);
    }

    const foundOnDisk: Array<{ path: string; source_path: string; sha256: string; bytes: number }> = [];
    const walk = (dir: string): void => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === ".DS_Store") continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(full);
        } else if (ent.isFile()) {
          const rel = path.relative(skillDir, full).replace(/\\/g, "/");
          if (rel === "SKILL.md") continue;
          const hash = sha256File(full);
          const size = fs.statSync(full).size;
          const sourcePath = resolveSupportSourcePath(skillId, entry.source, entry.source_path, rel, repoRoot);
          if (!sourcePath) {
            unresolvedProvenance.push(`${entry.destination_path}: unable to resolve upstream source_path for '${rel}'`);
            continue;
          }
          foundOnDisk.push({ path: rel, source_path: sourcePath, sha256: hash, bytes: size });
        }
      }
    };

    walk(skillDir);
    foundOnDisk.sort((a, b) => a.path.localeCompare(b.path));

    const oldSupport = entry.support_files ?? [];
    const isDifferent =
      oldSupport.length !== foundOnDisk.length ||
      foundOnDisk.some((f, idx) => {
        const old = oldSupport[idx];
        return !old || old.path !== f.path || old.sha256 !== f.sha256 || old.source_path !== f.source_path;
      });

    if (isDifferent) {
      entry.support_files = foundOnDisk;
      updated++;
    }
  }

  fs.writeFileSync(manifestPath, serializeCorpusManifest(manifest), "utf-8");
  const remainingErrors = validateSupportFileIntegrity(manifest, corpusDir);
  const validation = validateCorpusManifest(manifest);

  return {
    updated,
    remainingErrors,
    schemaValid: validation.valid,
    schemaErrors: validation.errors,
    unresolvedProvenance,
  };
}

if (import.meta.main) {
  const repoRoot = path.resolve(".");
  const corpusDir = path.join(repoRoot, "src/corpus");
  const manifestPath = path.join(corpusDir, "MANIFEST.json");

  const res = reconcileManifest(manifestPath, corpusDir);
  console.log(`Reconciled MANIFEST.json: updated ${res.updated} entries.`);
  console.log(`Remaining support file integrity errors: ${res.remainingErrors.length}`);
  console.log(`Manifest schema valid: ${res.schemaValid}`);
  console.log(`Unresolved support provenance: ${res.unresolvedProvenance.length}`);
  if (res.remainingErrors.length > 0) {
    console.error(res.remainingErrors.slice(0, 10).join("\n"));
  }
  if (!res.schemaValid) {
    console.error(res.schemaErrors.slice(0, 10).join("\n"));
  }
  if (res.unresolvedProvenance.length > 0) {
    console.error(res.unresolvedProvenance.slice(0, 10).join("\n"));
  }
  if (res.remainingErrors.length > 0 || !res.schemaValid || res.unresolvedProvenance.length > 0) {
    process.exit(1);
  }
}
