/**
 * tools/reconcile-corpus-manifest.ts
 * Reconciles src/corpus/MANIFEST.json support_files with actual files on disk
 * Eliminates D-1 (missing/unrecorded files) and D-2 (hash mismatch) errors
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256File } from "../src/core/hash.ts";
import type { CorpusManifest } from "../src/core/skill-manifest.ts";
import { validateSupportFileIntegrity } from "../src/core/skill-manifest.ts";

export function reconcileManifest(manifestPath: string, corpusDir: string): { updated: number; remainingErrors: string[] } {
  const raw = fs.readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as CorpusManifest;

  let updated = 0;
  const prefix = "src/corpus/";

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
          const sourcePath = oldSupportMap.get(rel) ?? rel;
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
        return !old || old.path !== f.path || old.sha256 !== f.sha256 || !old.source_path;
      });

    if (isDifferent) {
      entry.support_files = foundOnDisk;
      updated++;
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  const remainingErrors = validateSupportFileIntegrity(manifest, corpusDir);

  return { updated, remainingErrors };
}

if (import.meta.main) {
  const repoRoot = path.resolve(".");
  const corpusDir = path.join(repoRoot, "src/corpus");
  const manifestPath = path.join(corpusDir, "MANIFEST.json");

  const res = reconcileManifest(manifestPath, corpusDir);
  console.log(`Reconciled MANIFEST.json: updated ${res.updated} entries.`);
  console.log(`Remaining support file integrity errors: ${res.remainingErrors.length}`);
  if (res.remainingErrors.length > 0) {
    console.error(res.remainingErrors.slice(0, 10).join("\n"));
  }
}
