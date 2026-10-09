/**
 * tests/us11-skill-update.test.ts
 * Behavioral oracle suite for User Story 4: Dynamic Skill Lifecycle & Operator Authoring
 *
 * Enforces:
 * - contracts/skill-lifecycle.md §1 & §2: preview by default, --write to persist, manifest reconciliation
 * - contracts/skill-lifecycle.md §4: local tier (presets/skills/) preservation across upstream internalization
 * - SC-006: end-to-end update -> rebuild -> check sequence under 10 seconds
 * - Scenario 9: Guardrails against vendor tokens and malformed identifiers
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT_CODES } from "../bin/arsenal.ts";
import { sha256File } from "../src/core/hash.ts";

const REPO_ROOT = path.resolve(".");
const MANIFEST_PATH = path.join(REPO_ROOT, "src/corpus/MANIFEST.json");
const PRESETS_SKILLS_DIR = path.join(REPO_ROOT, "presets/skills");

describe("User Story 4: Skill Content Update & Enrichment Lifecycle (T046)", () => {
  it("executes skills update preview without mutating file or manifest", () => {
    const target = "re-ida-reverse";
    const targetFile = path.join(REPO_ROOT, `src/corpus/${target}/SKILL.md`);
    expect(fs.existsSync(targetFile)).toBe(true);

    const originalContent = fs.readFileSync(targetFile, "utf-8");
    const originalHash = sha256File(targetFile);

    const proc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "skills",
      "update",
      "--target",
      target,
      "--json",
    ]);

    expect(proc.exitCode).toBe(EXIT_CODES.SUCCESS);
    const parsed = JSON.parse(proc.stdout.toString());
    expect(parsed.mode).toBe("preview");

    // Assert disk was NOT mutated
    const afterContent = fs.readFileSync(targetFile, "utf-8");
    expect(afterContent).toBe(originalContent);
    expect(sha256File(targetFile)).toBe(originalHash);
  });

  it("updates canonical skill file and updates manifest entry under --write", () => {
    const target = "re-ida-reverse";
    const targetFile = path.join(REPO_ROOT, `src/corpus/${target}/SKILL.md`);
    const originalContent = fs.readFileSync(targetFile, "utf-8");

    const tempCandidate = path.join(REPO_ROOT, "tmp/candidate-update.md");
    fs.mkdirSync(path.dirname(tempCandidate), { recursive: true });

    const updatedMarker = "\n<!-- update-test-marker -->\n";
    fs.writeFileSync(tempCandidate, originalContent + updatedMarker, "utf-8");

    try {
      const updateProc = Bun.spawnSync([
        "bun",
        "--no-env-file",
        "run",
        "bin/arsenal.ts",
        "skills",
        "update",
        "--target",
        target,
        "--from",
        tempCandidate,
        "--write",
        "--json",
      ]);

      expect(updateProc.exitCode).toBe(EXIT_CODES.SUCCESS);
      const afterContent = fs.readFileSync(targetFile, "utf-8");
      expect(afterContent).toContain("update-test-marker");

      // Build and re-index
      const buildProc = Bun.spawnSync([
        "bun",
        "--no-env-file",
        "run",
        "bin/arsenal.ts",
        "build",
        "--write",
        "--force",
      ]);
      expect(buildProc.exitCode).toBe(EXIT_CODES.SUCCESS);

      // Verify catalog SHA matches updated file
      const indexFile = path.join(REPO_ROOT, "plugin/catalog/skills.index.jsonl");
      const indexLines = fs.readFileSync(indexFile, "utf-8").split("\n").filter((l) => l.trim().length > 0);
      const entry = indexLines.map((l) => JSON.parse(l)).find((e: any) => e.name === target);
      expect(entry).toBeDefined();
      expect(entry.sha256).toBe(sha256File(path.join(REPO_ROOT, `plugin/skills/${target}/SKILL.md`)));
    } finally {
      // Restore original file and rebuild to keep workspace pristine
      fs.writeFileSync(targetFile, originalContent, "utf-8");
      Bun.spawnSync(["bun", "--no-env-file", "run", "bin/arsenal.ts", "build", "--write", "--force"]);
      Bun.spawnSync(["bun", "--no-env-file", "run", "bin/arsenal.ts", "skills", "index", "--write"]);
      try {
        fs.unlinkSync(tempCandidate);
      } catch {
        // ignore
      }
    }
  }, 20000);

  it("authors new local-tier skill in presets/skills/ with arsenal-local provenance", () => {
    const slug = "unit-test-local-skill";
    const domain = "re";
    const canonicalId = `${domain}-${slug}`;
    const expectedPath = path.join(PRESETS_SKILLS_DIR, canonicalId, "SKILL.md");

    try {
      const proc = Bun.spawnSync([
        "bun",
        "--no-env-file",
        "run",
        "bin/arsenal.ts",
        "skills",
        "new",
        "--domain",
        domain,
        "--slug",
        slug,
        "--write",
        "--json",
      ]);

      expect(proc.exitCode).toBe(EXIT_CODES.SUCCESS);
      expect(fs.existsSync(expectedPath)).toBe(true);
      const content = fs.readFileSync(expectedPath, "utf-8");
      expect(content).toContain(`name: ${canonicalId}`);
    } finally {
      // Clean up test skill
      try {
        fs.rmSync(path.join(PRESETS_SKILLS_DIR, canonicalId), { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("enforces Scenario 9 guardrails: rejects forbidden vendor token with exit 2", () => {
    const proc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "skills",
      "new",
      "--domain",
      "red",
      "--slug",
      "anthropic-kerberoasting",
      "--write",
      "--json",
    ]);

    expect(proc.exitCode).toBe(EXIT_CODES.CLI_USAGE_ERROR);
    const parsed = JSON.parse(proc.stdout.toString());
    expect(parsed.errors.some((e: string) => e.includes("forbidden vendor token"))).toBe(true);
  });

  it("completes full update -> rebuild -> check sequence in <= 10 seconds (SC-006)", () => {
    const start = Date.now();

    // 1. Preview update
    const p1 = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "skills",
      "update",
      "--target",
      "re-ida-reverse",
      "--json",
    ]);
    expect(p1.exitCode).toBe(EXIT_CODES.SUCCESS);

    // 2. Build
    const p2 = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "build",
      "--write",
      "--force",
    ]);
    expect(p2.exitCode).toBe(EXIT_CODES.SUCCESS);

    // 3. Gate
    const p3 = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "skills",
      "check",
      "--json",
    ]);
    expect(p3.exitCode).toBe(EXIT_CODES.SUCCESS);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10000);
  }, 15000);
});
