#!/usr/bin/env bun
/**
 * tools/check-vendored-skills.ts
 *
 * Automated verification for vendored reverse-skill corpus in arsenal:
 * (a) Every skill SKILL.md is at exactly one subdirectory level: skills/<dir>/SKILL.md
 * (b) Frontmatter `name` matches directory name and regex ^[a-z0-9][a-z0-9-]{0,63}$
 * (c) Frontmatter `description` exists, is single-line (scalar), and >= 40 characters
 * (d) Frontmatter `license` and `metadata.upstream` exist
 * (e) No .ps1 files or .ps1 references outside data/ and NOTICE.md
 * (f) MANIFEST.json SHA-256 hashes and byte lengths match real on-disk files
 *
 * Exit code 0 if all checks PASS, non-zero if any check FAILS.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { parseSkillFrontmatter } from "../src/core/skill-frontmatter.ts";

const VENDOR_ROOT = path.resolve("vendor/reverse-skill");
const SKILLS_DIR = path.join(VENDOR_ROOT, "skills");
const MANIFEST_PATH = path.join(VENDOR_ROOT, "MANIFEST.json");

interface ValidationResult {
  check: string;
  passed: boolean;
  details: string[];
}

interface SkillMetadata {
  upstream?: string;
  upstream_path?: string;
  vendored_at?: string;
  transformations?: string[];
  [key: string]: unknown;
}

interface Frontmatter {
  name?: string;
  description?: string;
  license?: string;
  metadata?: SkillMetadata;
  [key: string]: unknown;
}

interface DroppedComponent {
  component: string;
  upstream_path: string;
  reason: string;
}

interface ManifestEntry {
  path: string;
  sha256: string;
  bytes: number;
  upstream_path: string | null;
  status: string;
}

interface ManifestData {
  source_repo?: string;
  source_rev?: string;
  license?: string;
  dropped?: DroppedComponent[];
  files?: ManifestEntry[];
}

const VALID_STATUSES: Record<string, true> = {
  "as-is": true,
  "tuned": true,
  "flattened": true,
  "support": true,
};
const UPDATE_MODE = process.argv.includes("--update");

const results: ValidationResult[] = [];
let totalErrors = 0;

function sha256File(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}


// ---------------------------------------------------------------------------
// Check (a) Single-level directory structure for all SKILL.md
// ---------------------------------------------------------------------------
const checkADetails: string[] = [];
let checkAPassed = true;

function findSkillFiles(dir: string): string[] {
  const skillFiles: string[] = [];
  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "SKILL.md") {
        skillFiles.push(full);
      }
    }
  }
  walk(dir);
  return skillFiles;
}

const allSkillFiles = findSkillFiles(SKILLS_DIR);
if (allSkillFiles.length === 0) {
  checkAPassed = false;
  checkADetails.push("No SKILL.md files found in skills directory!");
  totalErrors++;
} else {
  for (const sPath of allSkillFiles) {
    const rel = path.relative(SKILLS_DIR, sPath);
    const parts = rel.split(path.sep);
    if (parts.length !== 2) {
      checkAPassed = false;
      checkADetails.push(`Invalid depth (expected 1 level): skills/${rel}`);
      totalErrors++;
    }
  }
  if (checkAPassed) {
    checkADetails.push(`All ${allSkillFiles.length} skills are located at exactly 1 level: skills/<dir>/SKILL.md`);
  }
}
results.push({ check: "(a) Skill directory depth (exactly 1 level)", passed: checkAPassed, details: checkADetails });

// ---------------------------------------------------------------------------
// Check (b) Name == dir and matches ^[a-z0-9][a-z0-9-]{0,63}$
// Check (c) Description exists, is single-line, >= 40 chars
// Check (d) License and metadata.upstream exist
// ---------------------------------------------------------------------------
const checkBDetails: string[] = [];
let checkBPassed = true;
const checkCDetails: string[] = [];
let checkCPassed = true;
const checkDDetails: string[] = [];
let checkDPassed = true;

const NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
let skillPassCount = 0;
let skillFailCount = 0;

for (const sPath of allSkillFiles) {
  const dirName = path.basename(path.dirname(sPath));
  const content = fs.readFileSync(sPath, "utf-8");
  const fm = parseSkillFrontmatter(content);
  let currentSkillOk = true;

  if (!fm) {
    checkBPassed = false;
    checkBDetails.push(`[${dirName}] Missing or malformed YAML frontmatter`);
    totalErrors++;
    skillFailCount++;
    continue;
  }

  // Check (b)
  const name = typeof fm.name === "string" ? fm.name : undefined;
  if (!name) {
    checkBPassed = false;
    checkBDetails.push(`[${dirName}] Missing 'name' in frontmatter`);
    currentSkillOk = false;
    totalErrors++;
  } else if (name !== dirName) {
    checkBPassed = false;
    checkBDetails.push(`[${dirName}] Name '${name}' does not match directory '${dirName}'`);
    currentSkillOk = false;
    totalErrors++;
  } else if (!NAME_REGEX.test(name)) {
    checkBPassed = false;
    checkBDetails.push(`[${dirName}] Name '${name}' does not match regex ^[a-z0-9][a-z0-9-]{0,63}$`);
    currentSkillOk = false;
    totalErrors++;
  }

  // Check (c)
  const desc = typeof fm.description === "string" ? fm.description : undefined;
  if (!desc) {
    checkCPassed = false;
    checkCDetails.push(`[${dirName}] Missing 'description' in frontmatter`);
    currentSkillOk = false;
    totalErrors++;
  } else if (desc === "|" || desc === ">" || desc.startsWith("|") || desc.startsWith(">")) {
    checkCPassed = false;
    checkCDetails.push(`[${dirName}] Description uses YAML block scalar (not single-line)`);
    currentSkillOk = false;
    totalErrors++;
  } else if (desc.includes("\n") || desc.includes("\r")) {
    checkCPassed = false;
    checkCDetails.push(`[${dirName}] Description spans multiple lines`);
  } else if (desc.length < 40) {
    checkCPassed = false;
    checkCDetails.push(`[${dirName}] Description too short (${desc.length} chars < 40)`);
    currentSkillOk = false;
    totalErrors++;
  }

  // Check (d)
  const license = typeof fm.license === "string" ? fm.license : undefined;
  const upstream = typeof fm.metadata?.upstream === "string" ? fm.metadata.upstream : undefined;
  if (!license) {
    checkDPassed = false;
    checkDDetails.push(`[${dirName}] Missing 'license' in frontmatter`);
    currentSkillOk = false;
    totalErrors++;
  }
  if (!upstream) {
    checkDPassed = false;
    checkDDetails.push(`[${dirName}] Missing 'metadata.upstream' in frontmatter`);
    currentSkillOk = false;
    totalErrors++;
  }

  if (currentSkillOk) {
    skillPassCount++;
  } else {
    skillFailCount++;
  }
}

if (checkBPassed) checkBDetails.push(`All ${allSkillFiles.length} skills have name == directory matching ^[a-z0-9][a-z0-9-]{0,63}$`);
if (checkCPassed) checkCDetails.push(`All ${allSkillFiles.length} skills have single-line description >= 40 chars`);
if (checkDPassed) checkDDetails.push(`All ${allSkillFiles.length} skills contain valid license and metadata.upstream`);

results.push({ check: "(b) Skill name matches directory and regex format", passed: checkBPassed, details: checkBDetails });
results.push({ check: "(c) Description is single-line scalar >= 40 characters", passed: checkCPassed, details: checkCDetails });
results.push({ check: "(d) License and metadata.upstream existence", passed: checkDPassed, details: checkDDetails });

// ---------------------------------------------------------------------------
// Check (e) No .ps1 outside data/ and NOTICE.md
// ---------------------------------------------------------------------------
const checkEDetails: string[] = [];
let checkEPassed = true;

function scanForPs1(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(VENDOR_ROOT, full);
    // Exemptions: data/ directory, NOTICE.md, and MANIFEST.json
    if (rel === "data" || rel.startsWith("data" + path.sep)) continue;
    if (rel === "NOTICE.md" || rel === "MANIFEST.json") continue;

    if (entry.isDirectory()) {
      scanForPs1(full);
    } else {
      // Check file name
      if (entry.name.endsWith(".ps1")) {
        checkEPassed = false;
        checkEDetails.push(`Disallowed .ps1 file found: ${rel}`);
        totalErrors++;
      }
      // Check file contents (for text files)
      try {
        const buffer = fs.readFileSync(full);
        // If no null bytes in first 1024 bytes, scan text
        const sample = buffer.subarray(0, Math.min(1024, buffer.length));
        if (!sample.includes(0)) {
          const text = buffer.toString("utf-8");
          if (text.includes(".ps1")) {
            checkEPassed = false;
            checkEDetails.push(`Disallowed '.ps1' string reference in file: ${rel}`);
            totalErrors++;
          }
        }
      } catch {
        // Ignore read errors for unreadable files
      }
    }
  }
}

scanForPs1(VENDOR_ROOT);
if (checkEPassed) {
  checkEDetails.push("Zero .ps1 files and zero '.ps1' mentions found outside data/ and NOTICE.md");
}
results.push({ check: "(e) No .ps1 files/references outside data/ and NOTICE.md", passed: checkEPassed, details: checkEDetails });

// ---------------------------------------------------------------------------
// Check (f) MANIFEST.json integrity (SHA-256 and byte count)
// ---------------------------------------------------------------------------
const checkFDetails: string[] = [];
let checkFPassed = true;

if (!fs.existsSync(MANIFEST_PATH)) {
  checkFPassed = false;
  checkFDetails.push(`MANIFEST.json missing at ${MANIFEST_PATH}`);
  totalErrors++;
} else {
  let manifest: ManifestData | null = null;
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, "utf-8");
    manifest = JSON.parse(raw) as ManifestData;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    checkFPassed = false;
    checkFDetails.push(`Failed to parse MANIFEST.json: ${message}`);
    totalErrors++;
  }

  if (manifest) {
    if (!manifest.source_repo || !manifest.source_rev || !manifest.license || !Array.isArray(manifest.dropped)) {
      checkFPassed = false;
      checkFDetails.push("MANIFEST.json missing required top-level metadata (source_repo, source_rev, license, dropped)");
      totalErrors++;
    }

    const files = manifest.files;
    if (!Array.isArray(files) || files.length === 0) {
      checkFPassed = false;
      checkFDetails.push("MANIFEST.json 'files' array is missing or empty");
      totalErrors++;
    } else {
      const manifestPathSet = new Set<string>();
      let updatedCount = 0;
      for (const entry of files) {
        manifestPathSet.add(entry.path);
        const diskPath = path.join(VENDOR_ROOT, entry.path);
        if (!fs.existsSync(diskPath)) {
          checkFPassed = false;
          checkFDetails.push(`Manifest entry not found on disk: ${entry.path}`);
          totalErrors++;
          continue;
        }

        const stat = fs.statSync(diskPath);
        const actualSha = sha256File(diskPath);
        const byteMismatch = stat.size !== entry.bytes;
        const shaMismatch = actualSha !== entry.sha256;

        if (byteMismatch || shaMismatch) {
          if (UPDATE_MODE) {
            const oldBytes = entry.bytes;
            const oldSha = entry.sha256;
            entry.bytes = stat.size;
            entry.sha256 = actualSha;
            updatedCount++;
            console.log(`[UPDATE] Updated manifest for ${entry.path}:`);
            console.log(`         bytes:  ${oldBytes} -> ${stat.size}`);
            console.log(`         sha256: ${oldSha} -> ${actualSha}`);
          } else {
            if (byteMismatch) {
              checkFPassed = false;
              checkFDetails.push(`Byte mismatch for ${entry.path}: manifest=${entry.bytes}, disk=${stat.size}`);
              totalErrors++;
            }
            if (shaMismatch) {
              checkFPassed = false;
              checkFDetails.push(`SHA-256 mismatch for ${entry.path}: manifest=${entry.sha256}, disk=${actualSha}`);
              totalErrors++;
            }
          }
        }

        if (!VALID_STATUSES[entry.status]) {
          checkFPassed = false;
          checkFDetails.push(`Invalid status '${entry.status}' for ${entry.path}`);
          totalErrors++;
        }
      }

      if (UPDATE_MODE && updatedCount > 0) {
        fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
        console.log(`[UPDATE] Successfully updated ${updatedCount} entry(ies) in ${MANIFEST_PATH}\n`);
      }

      // Verify no untracked files on disk (excluding MANIFEST.json itself)
      function walkAll(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          const rel = path.relative(VENDOR_ROOT, full);
          if (entry.isDirectory()) {
            walkAll(full);
          } else {
            if (rel === "MANIFEST.json") continue;
            if (!manifestPathSet.has(rel)) {
              checkFPassed = false;
              checkFDetails.push(`Untracked file on disk not in manifest: ${rel}`);
              totalErrors++;
            }
          }
        }
      }
      walkAll(VENDOR_ROOT);

      if (checkFPassed) {
        checkFDetails.push(`All ${files.length} vendored files verified: SHA-256 and byte counts match disk exactly (0 mismatches, 0 untracked files)`);
      }
    }
  }
}
results.push({ check: "(f) MANIFEST.json SHA-256 and byte count integrity", passed: checkFPassed, details: checkFDetails });

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------
console.log("================================================================================");
console.log("            ARSENAL VENDORED SKILLS VERIFICATION REPORT                        ");
console.log("================================================================================");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Vendor Root: ${VENDOR_ROOT}`);
console.log(`Total Skills Inspected: ${allSkillFiles.length} (PASS: ${skillPassCount}, FAIL: ${skillFailCount})`);
console.log("--------------------------------------------------------------------------------");

for (const r of results) {
  const statusStr = r.passed ? "[PASS]" : "[FAIL]";
  console.log(`${statusStr} ${r.check}`);
  for (const d of r.details) {
    console.log(`       - ${d}`);
  }
}

console.log("================================================================================");
if (totalErrors === 0) {
  console.log("OVERALL RESULT: ALL CHECKS PASSED (exit code 0)");
  process.exit(0);
} else {
  console.error(`OVERALL RESULT: FAILED with ${totalErrors} issue(s) (exit code 1)`);
  process.exit(1);
}
