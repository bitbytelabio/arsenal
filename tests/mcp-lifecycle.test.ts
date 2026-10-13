import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handleMcp } from "../src/cli/mcp.ts";

describe("MCP Lifecycle Management (Scoped enable / disable / install / verify)", () => {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-mcp-repo-"));
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-mcp-prof-"));
  const tmpProfileWithSpaces = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal mcp prof with spaces-"));

  test("meaningful path isolation: fresh profile with spaces gets mcp.json while repo is untouched", () => {
    const installProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "install",
      "--profile",
      tmpProfileWithSpaces,
      "--write",
      "--json",
    ]);
    expect(installProc.exitCode).toBe(0);

    const profMcp = path.join(tmpProfileWithSpaces, "mcp.json");
    expect(fs.existsSync(profMcp)).toBe(true);

    const repoOmp = path.join(tmpRepo, ".omp", "mcp.json");
    expect(fs.existsSync(repoOmp)).toBe(false); // Repo bytes untouched!
  });

  test("meaningful path isolation: profile toggle mutates only profile and leaves repo untouched", () => {
    // Enable playwright in profile
    const enableProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "enable",
      "playwright",
      "--profile",
      tmpProfile,
      "--repo",
      tmpRepo,
      "--json",
    ]);
    expect(enableProc.exitCode).toBe(0);

    const profMcp = path.join(tmpProfile, "mcp.json");
    expect(fs.existsSync(profMcp)).toBe(true);
    const profCfg = JSON.parse(fs.readFileSync(profMcp, "utf-8"));
    expect(profCfg.mcpServers["playwright"].enabled).toBe(true);

    // Repo .omp/mcp.json must NOT exist or be mutated
    const repoMcp = path.join(tmpRepo, ".omp", "mcp.json");
    expect(fs.existsSync(repoMcp)).toBe(false);
  });

  test("meaningful path isolation: project opt-in mutates only project repo and leaves profile untouched", () => {
    const ompDir = path.join(tmpRepo, ".omp");
    fs.mkdirSync(ompDir, { recursive: true });

    const enableProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "enable",
      "playwright",
      "--scope",
      "project",
      "--repo",
      tmpRepo,
      "--profile",
      tmpProfile,
      "--json",
    ]);
    expect(enableProc.exitCode).toBe(0);

    const repoMcp = path.join(ompDir, "mcp.json");
    expect(fs.existsSync(repoMcp)).toBe(true);
    const repoCfg = JSON.parse(fs.readFileSync(repoMcp, "utf-8"));
    expect(repoCfg.mcpServers["playwright"].enabled).toBe(true);

    // Disable in project
    const disableProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "disable",
      "playwright",
      "--scope",
      "project",
      "--repo",
      tmpRepo,
      "--profile",
      tmpProfile,
      "--json",
    ]);
    expect(disableProc.exitCode).toBe(0);
    const repoCfgDisabled = JSON.parse(fs.readFileSync(repoMcp, "utf-8"));
    expect(repoCfgDisabled.mcpServers["playwright"].enabled).toBe(false);

    // Profile playwright remains enabled: true!
    const profMcp = path.join(tmpProfile, "mcp.json");
    const profCfg = JSON.parse(fs.readFileSync(profMcp, "utf-8"));
    expect(profCfg.mcpServers["playwright"].enabled).toBe(true);
  });

  test("--check flag causes zero filesystem mutations", () => {
    const profMcp = path.join(tmpProfile, "mcp.json");
    const initialBytes = fs.readFileSync(profMcp);

    const checkProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "enable",
      "rea",
      "--profile",
      tmpProfile,
      "--check",
      "--json",
    ]);
    expect(checkProc.exitCode).toBe(0);

    const postBytes = fs.readFileSync(profMcp);
    expect(Buffer.from(postBytes).equals(Buffer.from(initialBytes))).toBe(true);
  });

  test("--check flag suppresses writes even when --write is also provided", () => {
    const profMcp = path.join(tmpProfile, "mcp.json");
    const initialBytes = fs.readFileSync(profMcp);

    const installCheckProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "install",
      "--profile",
      tmpProfile,
      "--write",
      "--check",
      "--json",
    ]);
    expect(installCheckProc.exitCode).toBe(0);

    const postBytes = fs.readFileSync(profMcp);
    expect(Buffer.from(postBytes).equals(Buffer.from(initialBytes))).toBe(true);
  });

  test("effective state evaluation: allowlist overrides explicit false, absent enabled is true, and denylist wins", () => {
    const profMcp = path.join(tmpProfile, "mcp.json");
    const evalConfig = {
      $schema: "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
      enabledServers: ["playwright"], // Explicitly allowed
      disabledServers: ["ida-pro"],   // Explicitly denied
      mcpServers: {
        playwright: { type: "stdio", command: "bunx", enabled: false }, // Explicit false overridden by allowlist
        jshook: { type: "stdio", command: "node", args: ["jshookmcp.js"] }, // Absent enabled property -> true
        "ida-pro": { type: "stdio", command: "uvx", enabled: true }, // Denied in disabledServers -> denied
      },
    };
    fs.writeFileSync(profMcp, JSON.stringify(evalConfig, null, 2), "utf-8");

    const listProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "list",
      "--profile",
      tmpProfile,
      "--json",
    ]);
    expect(listProc.exitCode).toBe(0);
    const listJson = JSON.parse(listProc.stdout.toString()) as {
      data: { bridges: Array<{ id: string; effectiveState: string }> };
    };
    const bridgeMap = Object.fromEntries(listJson.data.bridges.map((b) => [b.id, b.effectiveState]));

    expect(bridgeMap["playwright"]).toBe("enabled"); // Overridden by enabledServers
    expect(bridgeMap["jshook"]).toBe("enabled");     // Absent enabled = enabled
    expect(bridgeMap["ida-pro"]).toBe("denied");     // Denylist wins over enabled: true
  });

  test("preserves custom remote burp URL across reinstall and toggle", async () => {
    const profMcp = path.join(tmpProfile, "mcp.json");
    const customBurpUrl = "http://remote-burp.internal:8443/";
    const customConfig = {
      mcpServers: {
        "burp-ultra": {
          type: "sse",
          url: customBurpUrl,
          headers: {
            Authorization: "Bearer remote-secret-token",
          },
          enabled: false,
        },
      },
    };
    fs.writeFileSync(profMcp, JSON.stringify(customConfig, null, 2), "utf-8");

    // Reinstall canonical bridges in-process via handleMcp
    const installExit = await handleMcp({
      family: "mcp",
      subCommand: "install",
      positionals: [],
      values: { write: true, profile: tmpProfile },
      rawArgs: ["mcp", "install", "--profile", tmpProfile, "--write"],
      repoRoot: tmpRepo,
      profileDir: tmpProfile,
      mode: "write",
      isJson: true,
    });
    expect(installExit).toBe(0);

    let cfg = JSON.parse(fs.readFileSync(profMcp, "utf-8"));
    expect(cfg.mcpServers["burp-ultra"].url).toBe(customBurpUrl);

    // Toggle enable burp-ultra in-process via handleMcp
    const enableExit = await handleMcp({
      family: "mcp",
      subCommand: "enable",
      positionals: ["burp-ultra"],
      values: { profile: tmpProfile },
      rawArgs: ["mcp", "enable", "burp-ultra", "--profile", tmpProfile],
      repoRoot: tmpRepo,
      profileDir: tmpProfile,
      mode: "write",
      isJson: true,
    });
    expect(enableExit).toBe(0);

    cfg = JSON.parse(fs.readFileSync(profMcp, "utf-8"));
    expect(cfg.mcpServers["burp-ultra"].url).toBe(customBurpUrl);
    expect(cfg.mcpServers["burp-ultra"].enabled).toBe(true);
    expect(cfg.mcpServers["burp-ultra"].headers.Authorization).toBe("Bearer remote-secret-token");
  });

  test("toggle allow/deny list agreement", async () => {
    const profMcp = path.join(tmpProfile, "mcp.json");
    const seed = {
      $schema: "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
      disabledServers: ["playwright"],
      denied: ["playwright"],
      mcpServers: {
        playwright: { type: "stdio", command: "bunx", enabled: false },
      },
    };
    fs.writeFileSync(profMcp, JSON.stringify(seed, null, 2), "utf-8");

    // Enable playwright in-process: must remove from disabledServers and denied
    const enableExit = await handleMcp({
      family: "mcp",
      subCommand: "enable",
      positionals: ["playwright"],
      values: { profile: tmpProfile },
      rawArgs: ["mcp", "enable", "playwright", "--profile", tmpProfile],
      repoRoot: tmpRepo,
      profileDir: tmpProfile,
      mode: "write",
      isJson: true,
    });
    expect(enableExit).toBe(0);

    const enabledCfg = JSON.parse(fs.readFileSync(profMcp, "utf-8"));
    expect(enabledCfg.mcpServers["playwright"].enabled).toBe(true);
    expect(enabledCfg.disabledServers).not.toContain("playwright");
    expect(enabledCfg.denied).not.toContain("playwright");

    // Disable playwright in-process: must add back to disabledServers and denied
    const disableExit = await handleMcp({
      family: "mcp",
      subCommand: "disable",
      positionals: ["playwright"],
      values: { profile: tmpProfile },
      rawArgs: ["mcp", "disable", "playwright", "--profile", tmpProfile],
      repoRoot: tmpRepo,
      profileDir: tmpProfile,
      mode: "write",
      isJson: true,
    });
    expect(disableExit).toBe(0);

    const disabledCfg = JSON.parse(fs.readFileSync(profMcp, "utf-8"));
    expect(disabledCfg.mcpServers["playwright"].enabled).toBe(false);
    expect(disabledCfg.disabledServers).toContain("playwright");
    expect(disabledCfg.denied).toContain("playwright");
  }, 15000);

  test("idempotent merges and operator preservation: keeps frida, semgrep, custom burp, metadata and returns identical", () => {
    const profMcp = path.join(tmpProfile, "mcp.json");
    const customOperatorConfig = {
      customOperatorMeta: "keep-this-metadata",
      mcpServers: {
        frida: {
          type: "stdio",
          command: "uv",
          args: ["run", "frida-mcp"],
          enabled: true,
        },
        semgrep: {
          type: "stdio",
          command: "uv",
          args: ["run", "semgrep-mcp"],
          // no enabled property: operator HTTP/custom server
        },
        "burp-ultra": {
          type: "sse",
          url: "http://custom-burp:9999/custom",
          headers: {
            Authorization: "Bearer operator-token",
          },
          enabled: true,
        },
      },
    };
    fs.writeFileSync(profMcp, JSON.stringify(customOperatorConfig, null, 2), "utf-8");

    // Reinstall canonical bridges
    const installProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "install",
      "--profile",
      tmpProfile,
      "--write",
      "--json",
    ]);
    expect(installProc.exitCode).toBe(0);

    const mergedCfg = JSON.parse(fs.readFileSync(profMcp, "utf-8"));
    expect(mergedCfg.customOperatorMeta).toBe("keep-this-metadata");
    // Operator servers preserved
    expect(mergedCfg.mcpServers["frida"]).toBeDefined();
    expect(mergedCfg.mcpServers["frida"].enabled).toBe(true);
    expect(mergedCfg.mcpServers["semgrep"]).toBeDefined();
    expect(mergedCfg.mcpServers["semgrep"].command).toBe("uv");
    // Custom burp preserved
    expect(mergedCfg.mcpServers["burp-ultra"].url).toBe("http://custom-burp:9999/custom");
    expect(mergedCfg.mcpServers["burp-ultra"].headers.Authorization).toBe("Bearer operator-token");
    expect(mergedCfg.mcpServers["burp-ultra"].enabled).toBe(true);
    // Missing canonical servers added with enabled: false
    expect(mergedCfg.mcpServers["ida-pro"]).toBeDefined();
    expect(mergedCfg.mcpServers["ida-pro"].enabled).toBe(false);

    // Reinstall when unchanged returns identical action
    const reinstallProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "install",
      "--profile",
      tmpProfile,
      "--write",
      "--json",
    ]);
    expect(reinstallProc.exitCode).toBe(0);
    const reinstallJson = JSON.parse(reinstallProc.stdout.toString());
    expect(reinstallJson.data.action).toBe("identical");
  }, 15000);

  test("malformed or scalar config fails without writes even with --force", () => {
    const corruptFile = path.join(tmpProfile, "mcp.json");
    const corruptContent = "scalar-string-not-an-object";
    fs.writeFileSync(corruptFile, corruptContent, "utf-8");

    const installProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "install",
      "--profile",
      tmpProfile,
      "--write",
      "--force",
      "--json",
    ]);
    expect(installProc.exitCode).not.toBe(0);
    expect(fs.readFileSync(corruptFile, "utf-8")).toBe(corruptContent);

    const enableProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "enable",
      "playwright",
      "--profile",
      tmpProfile,
      "--force",
      "--json",
    ]);
    expect(enableProc.exitCode).not.toBe(0);
    expect(fs.readFileSync(corruptFile, "utf-8")).toBe(corruptContent);
  });

  test("rejects invalid scope argument", () => {
    const proc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "list",
      "--scope",
      "invalid-scope",
      "--json",
    ]);
    expect(proc.exitCode).toBe(2);
    const json = JSON.parse(proc.stdout.toString());
    expect(json.errors[0]).toContain("Invalid scope 'invalid-scope'");
  });

  test("rejects enabling unknown tool bridge", () => {
    const proc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "mcp",
      "enable",
      "non-existent-bridge",
      "--profile",
      tmpProfileWithSpaces,
      "--json",
    ]);
    expect(proc.exitCode).toBe(2);
    const json = JSON.parse(proc.stdout.toString());
    expect(json.errors[0]).toContain("Unknown tool bridge 'non-existent-bridge'");
  });
});
