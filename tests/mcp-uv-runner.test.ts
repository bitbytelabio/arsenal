import { describe, expect, test } from "bun:test";
import { CANONICAL_MCP_BRIDGES } from "../src/cli/mcp.ts";

describe("MCP uv Runner & Configuration", () => {
  test("configures uv runner for all python-based bridges", () => {
    expect(CANONICAL_MCP_BRIDGES["ida-pro"]!.runner).toBe("uv");
    expect(CANONICAL_MCP_BRIDGES["ida-pro"]!.command).toBe("uv");

    expect(CANONICAL_MCP_BRIDGES["ghidra"]!.runner).toBe("uv");
    expect(CANONICAL_MCP_BRIDGES["ghidra"]!.command).toBe("uv");

    expect(CANONICAL_MCP_BRIDGES["frida"]!.runner).toBe("uv");
    expect(CANONICAL_MCP_BRIDGES["frida"]!.command).toBe("uv");

    expect(CANONICAL_MCP_BRIDGES["semgrep"]!.runner).toBe("uv");
    expect(CANONICAL_MCP_BRIDGES["semgrep"]!.command).toBe("uv");
  });
  test("configures bunx runner and stdio type for playwright bridge", () => {
    expect(CANONICAL_MCP_BRIDGES["playwright"]!.command).toBe("bunx");
    expect(CANONICAL_MCP_BRIDGES["playwright"]!.type).toBe("stdio");
    expect(CANONICAL_MCP_BRIDGES["playwright"]!.args).toEqual(["-y", "@playwright/mcp-server"]);
  });

  test("contains all 7 canonical bridges in catalog", () => {
    const bridgeKeys = Object.keys(CANONICAL_MCP_BRIDGES).sort();
    expect(bridgeKeys).toEqual([
      "burp-ultra",
      "frida",
      "ghidra",
      "ida-pro",
      "jshook",
      "playwright",
      "semgrep",
    ]);
  });
});
