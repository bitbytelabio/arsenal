import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { SkillCatalogManager } from "../plugin/extensions/routing.ts";

function collectArtifacts(baseDir: string): Set<string> {
  const result = new Set<string>();
  function walk(dir: string, rel: string) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? path.join(rel, ent.name) : ent.name;
      if (ent.isDirectory()) {
        walk(path.join(dir, ent.name), relPath);
      } else {
        result.add(relPath);
      }
    }
  }
  walk(baseDir, "");
  return result;
}

describe("Distribution Bundle & Catalog Portability (US1)", () => {
  const repoRoot = path.resolve(import.meta.dir, "..");
  const corpusDir = path.join(repoRoot, "src/corpus");
  const presetsDir = path.join(repoRoot, "presets/skills");

  it("compiles self-contained extensions without external relative paths", async () => {
    const tmpBase = path.join(repoRoot, "tmp");
    fs.mkdirSync(tmpBase, { recursive: true });
    const tempDir = fs.mkdtempSync(path.join(tmpBase, "bundle-test-"));

    try {
      // Execute plugin build via Python CLI into tempDir
      const buildProc = Bun.spawnSync([
        "uv",
        "run",
        "--locked",
        "arsenal",
        "build",
        "--repo",
        repoRoot,
        "--out",
        tempDir,
        "--preset",
        "re",
        "--write",
        "--force",
        "--json",
      ]);
      expect(buildProc.exitCode).toBe(0);
      const extDir = path.join(tempDir, "dist/extensions");
      expect(fs.existsSync(extDir)).toBe(true);

      const expectedFiles = ["bounding.js", "budget.js", "routing.js"];
      for (const file of expectedFiles) {
        const filePath = path.join(extDir, file);
        expect(fs.existsSync(filePath)).toBe(true);

        const content = fs.readFileSync(filePath, "utf-8");
        expect(content.length).toBeGreaterThan(0);

        // Invariant: No external relative imports escaping the bundle
        expect(content).not.toContain("../../src/core");
        expect(content).not.toContain("../../../src/");
      }

      // Verify collectArtifacts includes dist/extensions/*.js
      const artifacts = collectArtifacts(tempDir);
      for (const file of expectedFiles) {
        expect(artifacts.has(path.join("dist/extensions", file))).toBe(true);
      }
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // cleanup ignore
      }
    }
  }, 30_000);

  it("resolves catalog paths relative to import.meta.dir when called without baseDir", () => {
    // When instantiated without baseDir, SkillCatalogManager probes import.meta.dir
    const manager = new SkillCatalogManager();
    const results = manager.search("reverse engineering", "re");
    expect(results).toBeDefined();
    expect(Array.isArray(results.results)).toBe(true);
  });

  it("resolves catalog paths when instantiated with explicit baseDir", () => {
    const manager = new SkillCatalogManager(repoRoot);
    const results = manager.search("reverse engineering", "re");
    expect(results).toBeDefined();
    expect(Array.isArray(results.results)).toBe(true);
  });
});
