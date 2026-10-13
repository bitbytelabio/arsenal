/**
 * tests/us9-distribution.test.ts
 * Independent acceptance test for User Story 9: Reproducible, License-Audited Distribution
 */

import { describe, expect, it } from "bun:test";
import { generateDistributionManifest } from "../src/core/manifest.ts";
import * as fs from "node:fs";
import * as path from "node:path";

describe("User Story 9: Distribution & Build Determinism", () => {
  it("executes vendor check and asserts clean license compliance", () => {
    const proc = Bun.spawnSync(["uv", "run", "--locked", "arsenal", "vendor",
    "check",
    "--json",]);
    expect(proc.exitCode).toBe(0);
    const data = JSON.parse(proc.stdout.toString()) as {
      status: string;
      data: { clean: boolean; totalValidated: number };
    };
    expect(data.status).toBe("success");
    expect(data.data.clean).toBe(true);
    const manifestPath = path.resolve("src/corpus/MANIFEST.json");
    let expectedAdmitted = 1810;
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
        summary?: { admitted?: number };
      };
      expectedAdmitted = manifest.summary?.admitted ?? 1810;
    }
    expect(data.data.totalValidated).toBe(expectedAdmitted);
  });

  it("generates deterministic manifest with null created_at", () => {
    const files = [
      { path: "plugin/skills/b/SKILL.md", sha256: "0".repeat(64), bytes: 100 },
      { path: "plugin/skills/a/SKILL.md", sha256: "1".repeat(64), bytes: 200 },
    ];
    const manifest = generateDistributionManifest(files);
    expect(manifest.created_at).toBeNull();
    // Invariant: sorted by path
    expect(manifest.files[0]!.path).toBe("plugin/skills/a/SKILL.md");
    expect(manifest.files[1]!.path).toBe("plugin/skills/b/SKILL.md");
  });

  it("produces byte-identical builds across successive runs", () => {
    const b1 = path.resolve("tests/fixtures/b1");
    const b2 = path.resolve("tests/fixtures/b2");
    fs.rmSync(b1, { recursive: true, force: true });
    fs.rmSync(b2, { recursive: true, force: true });

    // Build scoped to mobile preset for fast unit test execution
    const p1 = Bun.spawnSync(["uv", "run", "--locked", "arsenal", "build",
    "--preset",
    "mobile",
    "--out",
    b1,
    "--write",
    "--force",]);
    expect(p1.exitCode).toBe(0);

    const p2 = Bun.spawnSync(["uv", "run", "--locked", "arsenal", "build",
    "--preset",
    "mobile",
    "--out",
    b2,
    "--write",
    "--force",]);
    expect(p2.exitCode).toBe(0);

    // Compare via /usr/bin/diff
    const diffProc = Bun.spawnSync(["/usr/bin/diff", "-r", b1, b2]);
    expect(diffProc.exitCode).toBe(0);

    fs.rmSync(b1, { recursive: true, force: true });
    fs.rmSync(b2, { recursive: true, force: true });
  });

  it("enforces single source of truth for version across package.json and plugin.json", () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf-8"));
    const pluginJson = JSON.parse(fs.readFileSync(path.resolve("plugin.json"), "utf-8"));
    const pluginDistJson = JSON.parse(fs.readFileSync(path.resolve("plugin/plugin.json"), "utf-8"));
    expect(pluginJson.version).toBe(rootPkg.version);
    expect(pluginDistJson.version).toBe(rootPkg.version);
  });
});
