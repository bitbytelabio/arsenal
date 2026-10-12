import { describe, expect, test } from "bun:test";
import { CANONICAL_MCP_BRIDGES } from "../src/core/mcp.ts";

describe("MCP uv Runner & Configuration", () => {
  test("configures uv runner for all python-based bridges", () => {
    expect(CANONICAL_MCP_BRIDGES["ida-pro"]!.runner).toBe("uv");
    expect(CANONICAL_MCP_BRIDGES["ida-pro"]!.command).toBe("uvx");
    expect(CANONICAL_MCP_BRIDGES["ida-pro"]!.args).toEqual(["ida-pro-mcp"]);

    expect(CANONICAL_MCP_BRIDGES["ghidra"]!.runner).toBe("uv");
    expect(CANONICAL_MCP_BRIDGES["ghidra"]!.command).toBe("uv");
  });
  test("configures bunx runner and stdio type for playwright bridge", () => {
    expect(CANONICAL_MCP_BRIDGES["playwright"]!.command).toBe("bunx");
    expect(CANONICAL_MCP_BRIDGES["playwright"]!.type).toBe("stdio");
    expect(CANONICAL_MCP_BRIDGES["playwright"]!.args).toEqual(["@playwright/mcp@latest"]);
  });
  test("configures burp-ultra endpoint and authorization headers", () => {
    expect(CANONICAL_MCP_BRIDGES["burp-ultra"]!.type).toBe("sse");
    expect(CANONICAL_MCP_BRIDGES["burp-ultra"]!.url).toBe("${BURP_MCP_URL:-http://127.0.0.1:9876/}");
    expect(CANONICAL_MCP_BRIDGES["burp-ultra"]!.headers).toEqual({
      Authorization: "Bearer ${BURP_MCP_TOKEN}",
    });
  });

});
