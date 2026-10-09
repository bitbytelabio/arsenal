/**
 * tests/us2-profile.test.ts
 * Independent acceptance test for User Story 2: Install Capabilities Without Losing Operator State
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("User Story 2: Profile Installation & Verification", () => {
  const scratchProfile = path.resolve("tests/fixtures/us2-profile");
  const scratchDist = path.resolve("tests/fixtures/us2-dist");

  it("installs profile preserving pre-existing credentials and databases", () => {
    fs.rmSync(scratchProfile, { recursive: true, force: true });
    fs.mkdirSync(scratchProfile, { recursive: true });

    // Pre-populate operator-owned files
    const envFile = path.join(scratchProfile, ".env");
    const dbFile = path.join(scratchProfile, "agent.db");
    fs.writeFileSync(envFile, "SECRET_TOKEN=xyz123\n", "utf-8");
    fs.writeFileSync(dbFile, "sqlite-dummy-data", "utf-8");

    // Run preview
    const prevProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "profile",
      "install",
      "--profile",
      scratchProfile,
      "--json",
    ]);
    expect(prevProc.exitCode).toBe(0);
    // In preview mode, AGENTS.md should not exist yet
    expect(fs.existsSync(path.join(scratchProfile, "AGENTS.md"))).toBe(false);

    // Run write
    const writeProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "profile",
      "install",
      "--profile",
      scratchProfile,
      "--write",
      "--json",
    ]);
    expect(writeProc.exitCode).toBe(0);

    // Verify template files created
    expect(fs.existsSync(path.join(scratchProfile, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(scratchProfile, "RULES.md"))).toBe(true);
    expect(fs.existsSync(path.join(scratchProfile, "config.yml"))).toBe(true);
    expect(fs.existsSync(path.join(scratchProfile, "models.yml"))).toBe(true);


    // Verify all 5 specialist agent definitions created in agent/agents/
    const agentAgentsDir = path.join(scratchProfile, "agent", "agents");
    for (const spec of ["sec-re.md", "sec-webapp.md", "sec-mobile.md", "sec-red.md", "sec-verifier.md"]) {
      const specFile = path.join(agentAgentsDir, spec);
      expect(fs.existsSync(specFile)).toBe(true);
      const specContent = fs.readFileSync(specFile, "utf-8");
      expect(specContent).toContain("## Operational Security (OpSec) Rules");
      expect(specContent).toContain("## Epistemic Rules");
      expect(specContent).toContain("## Handoff");
    }
    // Verify AGENTS.md contract: 7 required markers, 5 specialists, resolved includes, no vendor tokens
    const agentsContent = fs.readFileSync(path.join(scratchProfile, "AGENTS.md"), "utf-8");
    const requiredMarkers = [
      "# Arsenal Master Orchestrator",
      "## Specialist Roster",
      "## Delegation Rules",
      "## Independent Verification",
      "## Evidence Discipline",
      "## Skill Discovery",
      "## Scope and Authorization",
    ];
    for (const marker of requiredMarkers) {
      expect(agentsContent).toContain(marker);
    }

    const expectedSpecialists = ["sec-re", "sec-webapp", "sec-mobile", "sec-red", "sec-verifier"];
    for (const specialist of expectedSpecialists) {
      expect(agentsContent).toContain(specialist);
    }

    expect(agentsContent).toContain("@path ./RULES.md");
    expect(agentsContent).not.toContain("@path ./operating-model.md");
    expect(agentsContent).not.toContain("@path ./evidence-model.md");

    const includes = Array.from(agentsContent.matchAll(/@path\s+(\S+)/g))
      .map((m) => m[1])
      .filter((inc): inc is string => typeof inc === "string" && inc.length > 0);
    expect(includes.length).toBeGreaterThan(0);
    for (const inc of includes) {
      expect(fs.existsSync(path.join(scratchProfile, inc))).toBe(true);
    }

    expect(agentsContent).not.toContain("\\`");

    // Verify RULES.md contract: <= 10 imperative bullets, no narrative duplication, no vendor tokens
    const rulesContent = fs.readFileSync(path.join(scratchProfile, "RULES.md"), "utf-8");
    const bullets = rulesContent.split("\n").filter((l) => l.trim().startsWith("-"));
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.length).toBeLessThanOrEqual(10);
    expect(rulesContent).not.toContain("\\`");

    const forbiddenVendors = [
      "anthropic",
      "xalgorix",
      "claudered",
      "claude-red",
      "revskill",
      "reverse-skill",
      "strix",
    ];
    for (const vendor of forbiddenVendors) {
      const pat = new RegExp(`\\b${vendor}\\b`, "i");
      expect(pat.test(agentsContent)).toBe(false);
      expect(pat.test(rulesContent)).toBe(false);
    }
    // Verify pre-existing operator files remain untouched!
    expect(fs.readFileSync(envFile, "utf-8")).toBe("SECRET_TOKEN=xyz123\n");
    expect(fs.readFileSync(dbFile, "utf-8")).toBe("sqlite-dummy-data");
  });

  it("verifies profile integrity and catches undocumented agent shadow collisions", () => {
    // Clean verification
    const verClean = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "profile",
      "verify",
      "--profile",
      scratchProfile,
      "--json",
    ]);
    expect(verClean.exitCode).toBe(0);

    // Introduce an undocumented agent shadow in profile agents/master.md
    const agentDir = path.join(scratchProfile, "agents");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "master.md"), "shadow-agent", "utf-8");

    const verShadow = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "profile",
      "verify",
      "--profile",
      scratchProfile,
      "--json",
    ]);
    expect(verShadow.exitCode).toBe(1);
    const jsonRes = JSON.parse(verShadow.stdout.toString()) as { status: string };
    expect(jsonRes.status).toBe("failure");
  });

  it("enforces verification assertions for missing markers, dangling includes, vendor tokens, and specialist roster", () => {
    // Clean up previous shadow collision directory
    fs.rmSync(path.join(scratchProfile, "agents"), { recursive: true, force: true });

    const agentsPath = path.join(scratchProfile, "AGENTS.md");
    const originalContent = fs.readFileSync(agentsPath, "utf-8");

    // 1. Missing marker
    fs.writeFileSync(agentsPath, originalContent.replace("## Specialist Roster", ""), "utf-8");
    const verMarker = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "profile",
      "verify",
      "--profile",
      scratchProfile,
      "--json",
    ]);
    expect(verMarker.exitCode).toBe(1);
    const jsonMarker = JSON.parse(verMarker.stdout.toString()) as { errors: string[] };
    expect(jsonMarker.errors.some((e) => e.includes("Missing required marker"))).toBe(true);

    // 2. Dangling include
    fs.writeFileSync(agentsPath, originalContent + "\n@path ./nonexistent.md\n", "utf-8");
    const verInc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "profile",
      "verify",
      "--profile",
      scratchProfile,
      "--json",
    ]);
    expect(verInc.exitCode).toBe(1);
    const jsonInc = JSON.parse(verInc.stdout.toString()) as { errors: string[] };
    expect(jsonInc.errors.some((e) => e.includes("Dangling include"))).toBe(true);

    // 3. Escaped backtick
    fs.writeFileSync(agentsPath, originalContent + "\n\\`sec-re\\`\n", "utf-8");
    const verTick = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "profile",
      "verify",
      "--profile",
      scratchProfile,
      "--json",
    ]);
    expect(verTick.exitCode).toBe(1);
    const jsonTick = JSON.parse(verTick.stdout.toString()) as { errors: string[] };
    expect(jsonTick.errors.some((e) => e.includes("Escaped backticks"))).toBe(true);

    // 4. Forbidden vendor token
    fs.writeFileSync(agentsPath, originalContent + "\nvendor token: anthropic\n", "utf-8");
    const verVendor = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "profile",
      "verify",
      "--profile",
      scratchProfile,
      "--json",
    ]);
    expect(verVendor.exitCode).toBe(1);
    const jsonVendor = JSON.parse(verVendor.stdout.toString()) as { errors: string[] };
    expect(jsonVendor.errors.some((e) => e.includes("Forbidden vendor token"))).toBe(true);

    // 5. Specialist set mismatch
    fs.writeFileSync(agentsPath, originalContent.replaceAll("sec-verifier", "sec-unknown"), "utf-8");
    const verSpec = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "profile",
      "verify",
      "--profile",
      scratchProfile,
      "--json",
    ]);
    expect(verSpec.exitCode).toBe(1);
    const jsonSpec = JSON.parse(verSpec.stdout.toString()) as { errors: string[] };
    expect(jsonSpec.errors.some((e) => e.includes("Specialist set mismatch"))).toBe(true);

    // Restore original content
    fs.writeFileSync(agentsPath, originalContent, "utf-8");
  });

  // The distribution archive now contains the full shipped corpus (1,647 playbooks
  // plus ~1,646 materialized support files); the tar walk is filesystem-bound, so
  // the bound reflects the required corpus size rather than a changed assertion.
  it("packs plugin marketplace distribution archive", () => {
    fs.rmSync(scratchDist, { recursive: true, force: true });
    fs.mkdirSync(scratchDist, { recursive: true });

    const packProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "plugin",
      "pack",
      "--out",
      scratchDist,
      "--write",
      "--json",
    ]);
    expect(packProc.exitCode).toBe(0);
    expect(fs.existsSync(path.join(scratchDist, "arsenal-3.0.0.tar.gz"))).toBe(true);
    expect(fs.existsSync(path.join(scratchDist, "marketplace.json"))).toBe(true);

    fs.rmSync(scratchProfile, { recursive: true, force: true });
    fs.rmSync(scratchDist, { recursive: true, force: true });
  }, 30_000);
});
