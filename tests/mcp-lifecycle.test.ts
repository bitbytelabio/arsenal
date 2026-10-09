import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("MCP Lifecycle Management (enable / disable)", () => {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-mcp-test-"));
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-prof-test-"));
  const ompDir = path.join(tmpRepo, ".omp");
  fs.mkdirSync(ompDir, { recursive: true });

  test("enables and disables canonical bridges dynamically", () => {
    // 1. Enable playwright
    const enableProc = Bun.spawnSync([
      "bun",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "enable",
      "playwright",
      "--repo",
      tmpRepo,
      "--profile",
      tmpProfile,
      "--json",
    ]);
    expect(enableProc.exitCode).toBe(0);

    const mcpFile = path.join(ompDir, "mcp.json");
    expect(fs.existsSync(mcpFile)).toBe(true);
    let cfg = JSON.parse(fs.readFileSync(mcpFile, "utf-8"));
    expect(cfg.mcpServers["playwright"].enabled).toBe(true);

    // 2. Disable playwright
    const disableProc = Bun.spawnSync([
      "bun",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "disable",
      "playwright",
      "--repo",
      tmpRepo,
      "--profile",
      tmpProfile,
      "--json",
    ]);
    expect(disableProc.exitCode).toBe(0);

    cfg = JSON.parse(fs.readFileSync(mcpFile, "utf-8"));
    expect(cfg.mcpServers["playwright"].enabled).toBe(false);
  });

  test("rejects enabling unknown tool bridge", () => {
    const proc = Bun.spawnSync([
      "bun",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "enable",
      "non-existent-bridge",
      "--repo",
      tmpRepo,
      "--json",
    ]);
    expect(proc.exitCode).toBe(2);
  });
});
