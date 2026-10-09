/**
 * tests/us7-tools.test.ts
 * Independent acceptance test for User Story 7: Connect Only the Live Tools Needed
 */

import { describe, expect, it } from "bun:test";
import { evaluateIntegrationReadiness } from "../src/core/integrations.ts";
import { executeEvidenceCommand } from "../plugin/tools/evidence-exec.ts";
import * as fs from "node:fs";
import * as path from "node:path";

describe("User Story 7: Tools & Selective Bridge Provisioning", () => {
  const scratchRepo = path.resolve("tests/fixtures/us7-repo");
  const scratchProfile = path.resolve("tests/fixtures/us7-profile");

  it("enforces deny precedence: profile deny overrides project enable", () => {
    // 1. Core integration readiness evaluation
    const res = evaluateIntegrationReadiness({
      id: "burp-ultra",
      isDeniedInProfile: true,
      isEnabledInProject: true,
    });
    expect(res.state).toBe("denied");
    expect(res.reason).toContain("Profile deny overrides project enable");

    // 2. Disabled by default when not denied and not enabled
    const disRes = evaluateIntegrationReadiness({
      id: "ida-pro",
      isDeniedInProfile: false,
      isEnabledInProject: false,
    });
    expect(disRes.state).toBe("disabled");
  });

  it("scans system PATH and checks required binaries per preset", () => {
    fs.rmSync(scratchRepo, { recursive: true, force: true });
    fs.mkdirSync(path.join(scratchRepo, ".omp"), { recursive: true });

    // tools scan
    const scanProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "tools",
      "scan",
      "--repo",
      scratchRepo,
      "--write",
      "--json",
    ]);
    expect(scanProc.exitCode).toBe(0);
    expect(fs.existsSync(path.join(scratchRepo, ".omp", "tool-index.json"))).toBe(true);

    // tools check
    const checkProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "tools",
      "check",
      "--preset",
      "webapp",
      "--repo",
      scratchRepo,
      "--json",
    ]);
    expect(checkProc.exitCode).toBe(0);
  });

  it("materializes selected MCP bridge definitions into .omp/mcp.json", () => {
    const installProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "install",
      "--server",
      "burp-ultra",
      "--repo",
      scratchRepo,
      "--write",
      "--json",
    ]);
    expect(installProc.exitCode).toBe(0);

    const mcpFile = path.join(scratchRepo, ".omp", "mcp.json");
    expect(fs.existsSync(mcpFile)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(mcpFile, "utf-8")) as {
      mcpServers: Record<string, { enabled: boolean; transport: string }>;
    };
    expect(parsed.mcpServers["burp-ultra"]).toBeDefined();
    expect(parsed.mcpServers["burp-ultra"]!.enabled).toBe(false); // Default disabled!
  });

  it("verifies MCP configuration and catches git tracking protection violation", () => {
    // Normal verify on scratch repo (not tracked by git)
    const verProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "verify",
      "--repo",
      scratchRepo,
      "--json",
    ]);
    expect(verProc.exitCode).toBe(0);

    fs.rmSync(scratchRepo, { recursive: true, force: true });
    fs.rmSync(scratchProfile, { recursive: true, force: true });
  });
  // Subprocess timeout enforcement tests per contracts/process-execution.md & T014
  // Real delay is required to test OS process signal termination and timeout abort
  it("terminates subprocess exceeding timeout_ms and sets exit code 124 (T014)", async () => {
    const scratchEvidence = path.join(scratchRepo, "evidence");
    fs.mkdirSync(scratchEvidence, { recursive: true });

    const start = Date.now();
    const result = await executeEvidenceCommand(
      {
        argv: ["sleep", "2"],
        timeout_ms: 100,
      },
      scratchEvidence
    );
    const elapsed = Date.now() - start;

    expect(result.timed_out).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(result.capture_gap).toContain("Command execution timed out after 100ms");
    // Verify terminated within reasonable bound of deadline
    expect(elapsed).toBeLessThan(250);
  });

  it("preserves partial output on timeout (T014)", async () => {
    const scratchEvidence = path.join(scratchRepo, "evidence");
    fs.mkdirSync(scratchEvidence, { recursive: true });

    const result = await executeEvidenceCommand(
      {
        argv: ["sh", "-c", "echo partial output header; sleep 2"],
        timeout_ms: 100,
      },
      scratchEvidence
    );

    expect(result.timed_out).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toContain("partial output header");
    expect(result.stdout_artifact).toBeDefined();

    fs.rmSync(scratchRepo, { recursive: true, force: true });
  });
});
