/**
 * tests/us1-init.test.ts
 * Independent acceptance test for User Story 1: Prepare an Authorized Engagement
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("User Story 1: Engagement Preparation & Inspection", () => {
  const scratchBase = path.resolve("tests/fixtures/us1-scratch");

  it("initializes engagement for all 4 domains", () => {
    fs.rmSync(scratchBase, { recursive: true, force: true });
    fs.mkdirSync(scratchBase, { recursive: true });

    for (const preset of ["re", "webapp", "mobile", "red"]) {
      const targetDir = path.join(scratchBase, `target-${preset}`);
      const proc = Bun.spawnSync([
        "bun",
        "--no-env-file",
        "run",
        "bin/arsenal.ts",
        "init",
        targetDir,
        "--preset",
        preset,
        "--name",
        `Test-${preset}`,
        "--write",
        "--json",
      ]);

      expect(proc.exitCode).toBe(0);
      const res = JSON.parse(proc.stdout.toString()) as { status: string; data: { preset: string } };
      expect(res.status).toBe("success");
      expect(res.data.preset).toBe(preset);

      // Verify files created on disk
      expect(fs.existsSync(path.join(targetDir, ".omp", "engagement.json"))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, ".omp", "scope.json"))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, ".omp", "environment.json"))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, ".omp", "charter.md"))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, ".omp", "manifest.json"))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, "evidence", ".gitignore"))).toBe(true);
    }
  });

  it("validates engagement integrity and detects drift via init --check", () => {
    const webTarget = path.join(scratchBase, "target-webapp");

    // Clean check
    const checkClean = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "init",
      webTarget,
      "--check",
      "--json",
    ]);
    expect(checkClean.exitCode).toBe(0);

    // Alter a managed file (drift)
    const scopePath = path.join(webTarget, ".omp", "scope.json");
    fs.appendFileSync(scopePath, "\n// Drift comment\n", "utf-8");

    const checkDrift = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "init",
      webTarget,
      "--check",
      "--json",
    ]);
    expect(checkDrift.exitCode).toBe(1);
    const driftJson = JSON.parse(checkDrift.stdout.toString()) as { status: string };
    expect(driftJson.status).toBe("failure");
  });

  it("inspects authorization record via scope show", () => {
    const reTarget = path.join(scratchBase, "target-re");
    const scopeShow = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "scope",
      "show",
      "--repo",
      reTarget,
      "--json",
    ]);
    expect(scopeShow.exitCode).toBe(0);
    const scopeData = JSON.parse(scopeShow.stdout.toString()) as {
      data: { domain: string; auth_status: string; ready_for_act: boolean };
    };
    expect(scopeData.data.domain).toBe("re");
    expect(scopeData.data.auth_status).toBe("incomplete");
    expect(scopeData.data.ready_for_act).toBe(false);
  });

  it("runs context verify on target repository", () => {
    const reTarget = path.join(scratchBase, "target-re");
    const ctxVerify = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "context",
      "verify",
      "--repo",
      reTarget,
      "--json",
    ]);
    expect(ctxVerify.exitCode).toBe(0);
  });

  it("runs doctor checks", () => {
    const reTarget = path.join(scratchBase, "target-re");
    const docProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "doctor",
      "--repo",
      reTarget,
      "--schema",
      "--json",
    ]);
    expect(docProc.exitCode).toBe(0);

    fs.rmSync(scratchBase, { recursive: true, force: true });
  });
});
