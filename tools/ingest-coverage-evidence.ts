/**
 * tools/ingest-coverage-evidence.ts
 * Ingests audited technique mappings from /tmp/coverage-evidence.json into presets/baselines/coverage-map.json
 * and reconciles presets/baselines/accepted-gaps.json per Principle III & CM-4.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface SkillEvidence {
  locator: string;
  note: string;
}

export interface SkillEntry {
  id: string;
  evidence: SkillEvidence;
}

export interface CoverageEntry {
  capability_id: string;
  domain: string;
  skills: SkillEntry[];
  reviewer: string;
  reviewed_at: string;
}

export interface AcceptedGapEntry {
  capability_id: string;
  domain: string;
  reason: string;
  reviewer?: string;
  reviewed_at?: string;
}

export function ingestCoverageEvidence(
  evidencePath: string,
  coverageMapPath: string,
  acceptedGapsPath: string,
  corpusDir: string
): { newlyEnrolled: number; gapsRemoved: number; totalCovered: number } {
  if (!fs.existsSync(evidencePath)) {
    throw new Error(`Evidence file not found at: ${evidencePath}`);
  }

  const rawEvidence = JSON.parse(fs.readFileSync(evidencePath, "utf-8")) as {
    entries: CoverageEntry[];
  };

  const coverageDoc = JSON.parse(fs.readFileSync(coverageMapPath, "utf-8")) as {
    schemaVersion?: string;
    entries: CoverageEntry[];
  };

  const gapsDoc = JSON.parse(fs.readFileSync(acceptedGapsPath, "utf-8")) as {
    schemaVersion?: string;
    entries: AcceptedGapEntry[];
  };

  const existingMap = new Map<string, CoverageEntry>();
  for (const entry of coverageDoc.entries) {
    existingMap.set(entry.capability_id, entry);
  }

  let newlyEnrolled = 0;

  for (const item of rawEvidence.entries) {
    // Validate that every skill and heading exists
    let valid = true;
    for (const sk of item.skills) {
      const skillPath = path.join(corpusDir, sk.id, "SKILL.md");
      if (!fs.existsSync(skillPath)) {
        valid = false;
        break;
      }
      const md = fs.readFileSync(skillPath, "utf-8");
      const cleanLocator = sk.evidence.locator.trim();
      const stripped = cleanLocator.replace(/^#+\s*/, "").trim().toLowerCase();
      const hasHeading =
        md.includes(cleanLocator) ||
        md
          .split("\n")
          .some((l) => l.trim().startsWith("#") && l.trim().replace(/^#+\s*/, "").trim().toLowerCase() === stripped);

      if (!hasHeading) {
        valid = false;
        break;
      }
    }

    if (valid) {
      if (!existingMap.has(item.capability_id)) {
        newlyEnrolled++;
      }
      existingMap.set(item.capability_id, item);
    }
  }

  // Deterministically sort coverage entries by capability_id
  const sortedCoverage = Array.from(existingMap.values()).sort((a, b) =>
    a.capability_id.localeCompare(b.capability_id)
  );

  coverageDoc.entries = sortedCoverage;
  fs.writeFileSync(coverageMapPath, JSON.stringify(coverageDoc, null, 2) + "\n", "utf-8");

  // Reconcile accepted-gaps: remove any capability_id now covered
  const coveredSet = new Set(sortedCoverage.map((c) => c.capability_id));
  const remainingGaps = gapsDoc.entries.filter((g) => !coveredSet.has(g.capability_id));
  const gapsRemoved = gapsDoc.entries.length - remainingGaps.length;

  remainingGaps.sort((a, b) => a.capability_id.localeCompare(b.capability_id));
  gapsDoc.entries = remainingGaps;
  fs.writeFileSync(acceptedGapsPath, JSON.stringify(gapsDoc, null, 2) + "\n", "utf-8");

  return {
    newlyEnrolled,
    gapsRemoved,
    totalCovered: sortedCoverage.length,
  };
}

if (import.meta.main) {
  const repoRoot = path.resolve(".");
  const evidencePath = "/tmp/coverage-evidence.json";
  const coverageMapPath = path.join(repoRoot, "presets/baselines/coverage-map.json");
  const acceptedGapsPath = path.join(repoRoot, "presets/baselines/accepted-gaps.json");
  const corpusDir = path.join(repoRoot, "src/corpus");

  const res = ingestCoverageEvidence(evidencePath, coverageMapPath, acceptedGapsPath, corpusDir);
  console.log(`Successfully enrolled ${res.newlyEnrolled} techniques into coverage-map.json (Total covered: ${res.totalCovered})`);
  console.log(`Reconciled accepted-gaps.json: removed ${res.gapsRemoved} artificial gaps (Remaining: 800 - ${res.gapsRemoved} = ${800 - res.gapsRemoved})`);
}
