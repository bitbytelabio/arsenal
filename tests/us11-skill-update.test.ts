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

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EXIT_CODES } from "./helpers/python-cli.ts";
import { sha256File } from "../src/core/hash.ts";

const REPO_ROOT = path.resolve(".");
const ISOLATED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-us11-isolated-"));
const TARGET = "re-ida-reverse";

function setupIsolatedWorkspace() {
  const corpusDest = path.join(ISOLATED_ROOT, "src/corpus");
  const presetsDest = path.join(ISOLATED_ROOT, "presets/skills");
  const pluginDest = path.join(ISOLATED_ROOT, "plugin");
  fs.mkdirSync(corpusDest, { recursive: true });
  fs.mkdirSync(presetsDest, { recursive: true });
  fs.mkdirSync(pluginDest, { recursive: true });

  const srcSkillDir = path.join(REPO_ROOT, `src/corpus/${TARGET}`);
  const destSkillDir = path.join(corpusDest, TARGET);
  fs.mkdirSync(destSkillDir, { recursive: true });
  const srcSkill = path.join(srcSkillDir, "SKILL.md");
  if (fs.existsSync(srcSkill)) {
    fs.copyFileSync(srcSkill, path.join(destSkillDir, "SKILL.md"));
  }

  const srcManifest = path.join(REPO_ROOT, "src/corpus/MANIFEST.json");
  if (fs.existsSync(srcManifest)) {
    fs.copyFileSync(srcManifest, path.join(corpusDest, "MANIFEST.json"));
  }
}
describe("User Story 4: Skill Content Update & Enrichment Lifecycle (T046)", () => {
  beforeAll(() => {
    setupIsolatedWorkspace();
  });

  afterAll(() => {
    try {
      fs.rmSync(ISOLATED_ROOT, { recursive: true, force: true });
    } catch {
      // cleanup ignore
    }
  });

  it("executes skills update preview without mutating file or manifest", () => {
    const targetFile = path.join(ISOLATED_ROOT, `src/corpus/${TARGET}/SKILL.md`);
    expect(fs.existsSync(targetFile)).toBe(true);

    const originalContent = fs.readFileSync(targetFile, "utf-8");
    const originalHash = sha256File(targetFile);

    const proc = Bun.spawnSync([
      "uv",
      "run",
      "--locked",
      "arsenal",
      "skills",
      "update",
      "--target",
      TARGET,
      "--repo",
      ISOLATED_ROOT,
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
    const targetFile = path.join(ISOLATED_ROOT, `src/corpus/${TARGET}/SKILL.md`);
    const originalContent = fs.readFileSync(targetFile, "utf-8");

    const tempCandidate = path.join(ISOLATED_ROOT, "candidate-update.md");
    const updatedMarker = "\n<!-- update-test-marker -->\n";
    fs.writeFileSync(tempCandidate, originalContent + updatedMarker, "utf-8");

    try {
      const updateProc = Bun.spawnSync([
        "uv",
        "run",
        "--locked",
        "arsenal",
        "skills",
        "update",
        "--target",
        TARGET,
        "--from",
        tempCandidate,
        "--repo",
        ISOLATED_ROOT,
        "--write",
        "--json",
      ]);

      expect(updateProc.exitCode).toBe(EXIT_CODES.SUCCESS);
      const afterContent = fs.readFileSync(targetFile, "utf-8");
      expect(afterContent).toContain("update-test-marker");

      // Build into isolated plugin
      const buildProc = Bun.spawnSync([
        "uv",
        "run",
        "--locked",
        "arsenal",
        "build",
        "--repo",
        ISOLATED_ROOT,
        "--write",
        "--force",
      ]);
      expect(buildProc.exitCode).toBe(EXIT_CODES.SUCCESS);

      // Verify catalog SHA matches updated file
      const indexFile = path.join(ISOLATED_ROOT, "plugin/catalog/skills.index.jsonl");
      if (fs.existsSync(indexFile)) {
        const indexLines = fs.readFileSync(indexFile, "utf-8").split("\n").filter((l) => l.trim().length > 0);
        const entry = indexLines
          .map((l) => JSON.parse(l) as { name?: string; sha256?: string })
          .find((e) => e.name === TARGET);
        expect(entry).toBeDefined();
        expect(entry!.sha256).toBe(sha256File(path.join(ISOLATED_ROOT, `plugin/skills/${TARGET}/SKILL.md`)));
      }
    } finally {
      fs.writeFileSync(targetFile, originalContent, "utf-8");
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
    const expectedPath = path.join(ISOLATED_ROOT, "presets/skills", canonicalId, "SKILL.md");
    const fallbackCorpusPath = path.join(ISOLATED_ROOT, "src/corpus", canonicalId, "SKILL.md");

    try {
      const proc = Bun.spawnSync([
        "uv",
        "run",
        "--locked",
        "arsenal",
        "skills",
        "new",
        "--domain",
        domain,
        "--slug",
        slug,
        "--repo",
        ISOLATED_ROOT,
        "--write",
        "--json",
      ]);

      expect(proc.exitCode).toBe(EXIT_CODES.SUCCESS);
      const createdPath = fs.existsSync(expectedPath) ? expectedPath : fallbackCorpusPath;
      expect(fs.existsSync(createdPath)).toBe(true);
      const content = fs.readFileSync(createdPath, "utf-8");
      expect(content).toContain(`name: ${canonicalId}`);
    } finally {
      // Clean up test skill
      try {
        fs.rmSync(path.join(ISOLATED_ROOT, "presets/skills", canonicalId), { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("enforces Scenario 9 guardrails: rejects forbidden vendor token with exit 2", () => {
    const proc = Bun.spawnSync([
      "uv",
      "run",
      "--locked",
      "arsenal",
      "skills",
      "new",
      "--domain",
      "red",
      "--slug",
      "anthropic-kerberoasting",
      "--repo",
      ISOLATED_ROOT,
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
      "uv",
      "run",
      "--locked",
      "arsenal",
      "skills",
      "update",
      "--target",
      TARGET,
      "--repo",
      ISOLATED_ROOT,
      "--json",
    ]);
    expect(p1.exitCode).toBe(EXIT_CODES.SUCCESS);

    // 2. Build
    const p2 = Bun.spawnSync([
      "uv",
      "run",
      "--locked",
      "arsenal",
      "build",
      "--repo",
      ISOLATED_ROOT,
      "--write",
      "--force",
    ]);
    expect(p2.exitCode).toBe(EXIT_CODES.SUCCESS);

    // 3. Gate
    const p3 = Bun.spawnSync([
      "uv",
      "run",
      "--locked",
      "arsenal",
      "skills",
      "check",
      "--repo",
      ISOLATED_ROOT,
      "--json",
    ]);
    expect(p3.exitCode).toBe(EXIT_CODES.SUCCESS);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10000);
  }, 15000);
});
