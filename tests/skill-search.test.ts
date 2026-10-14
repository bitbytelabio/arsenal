/**
 * tests/skill-search.test.ts
 * Behavioral tests for the deterministic BM25 runtime skill search
 * (contracts/guidance-distribution.md §1) and catalog snapshot caching.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import routingExtension, { SkillCatalogManager } from "../plugin/extensions/routing.ts";
import { boundedLevenshtein, tokenize } from "../src/core/skill-search.ts";
import { sha256String } from "../src/core/hash.ts";

const repoRoot = path.resolve(import.meta.dir, "..");

describe("Skill Search Ranking", () => {
  const manager = new SkillCatalogManager(repoRoot);

  it("tokenizes on unicode letter/number boundaries and drops single characters", () => {
    expect(tokenize("Kerberoasting Active-Directory")).toEqual(["kerberoasting", "active", "directory"]);
    expect(tokenize("C2 & XSS")).toEqual(["c2", "xss"]);
    expect(tokenize("lỗ hổng X")).toEqual(["lỗ", "hổng"]);
  });

  it("computes bounded Levenshtein distances", () => {
    expect(boundedLevenshtein("ghidra", "gidra", 1)).toBe(1);
    expect(boundedLevenshtein("sql", "sqli", 1)).toBe(1);
    expect(boundedLevenshtein("ghidra", "ghidra", 2)).toBe(0);
    expect(boundedLevenshtein("abcdef", "zzzzzz", 1)).toBeGreaterThan(1);
  });

  it("tolerates misspellings via the fuzzy fallback", () => {
    const results = manager.search("gidra", "re");
    expect(results.total_matches).toBeGreaterThan(0);
    expect(results.results.some((r) => r.name === "re-ghidra-reverse")).toBe(true);
  });

  it("resolves stem-like variants through long common-prefix overlap", () => {
    const results = manager.search("deserialise", "webapp");
    expect(results.total_matches).toBeGreaterThan(0);
    expect(results.results.some((r) => r.name.includes("deserialization"))).toBe(true);
  });

  it("resolves truncated tokens through prefix expansion", () => {
    const results = manager.search("decompil", "re");
    expect(results.total_matches).toBeGreaterThan(0);
    expect(results.results.some((r) => r.name.includes("ghidra") || r.name.includes("ida"))).toBe(true);
  });

  it("ranks name matches above description-only matches and keeps scores monotonic", () => {
    const results = manager.search("jwt");
    expect(results.total_matches).toBeGreaterThan(0);
    expect(results.results[0]!.name).toContain("jwt");
    for (let i = 1; i < results.results.length; i++) {
      expect(results.results[i - 1]!.score!).toBeGreaterThanOrEqual(results.results[i]!.score!);
    }
  });

  it("keeps router example queries relevant", () => {
    const red = manager.search("kerberoasting active directory", "red");
    expect(red.results.slice(0, 3).some((r) => r.name.includes("kerberoasting"))).toBe(true);

    const mobile = manager.search("frida hook android", "mobile");
    expect(mobile.total_matches).toBeGreaterThan(0);
    expect(mobile.results.some((r) => r.name.includes("frida") || r.name.includes("dynamic-analysis"))).toBe(true);

    const re = manager.search("reverse engineering triage", "re");
    expect(re.total_matches).toBeGreaterThan(0);
  });

  it("returns NO_RELEVANT_GUIDANCE for unrecognized terms and mostly-nonsense queries", () => {
    const singleUnknown = manager.search("zzzzzz");
    expect(singleUnknown.total_matches).toBe(0);
    expect(singleUnknown.results).toEqual([]);
    expect(singleUnknown.note).toContain("NO_RELEVANT_GUIDANCE");
    expect(singleUnknown.note).toContain("Unrecognized query terms: 'zzzzzz'.");

    const nonsense = manager.search("nonexistent-quantum-crypto-teleportation-methodology-xyz");
    expect(nonsense.total_matches).toBe(0);
    expect(nonsense.note).toContain("NO_RELEVANT_GUIDANCE");
  });

  it("keeps strong hits when only a minority of tokens is unknown", () => {
    const results = manager.search("dridex memory forensics");
    expect(results.total_matches).toBeGreaterThan(0);
    expect(results.note).toContain("Unrecognized query terms ignored: 'dridex'.");
  });

  it("accepts natural-language queries with filler words", () => {
    const results = manager.search("how to analyze a suspicious apk");
    expect(results.total_matches).toBeGreaterThan(0);
    expect(
      results.results.some(
        (r) => r.name.includes("apk") || r.name.includes("android") || r.name.includes("mobile")
      )
    ).toBe(true);
  });

  it("revalidates the memoized catalog when the index file changes on disk", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-skill-search-"));
    try {
      const catalogPath = path.join(root, "catalog", "skills.index.jsonl");
      fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
      const alpha = {
        name: "re-sample-alpha",
        domain: "re",
        category: "decompilation",
        description: "Alpha decompilation workflow",
        sha256: "a".repeat(64),
        bytes: 32,
      };
      fs.writeFileSync(catalogPath, `${JSON.stringify(alpha)}\n`);

      const fixtureManager = new SkillCatalogManager(root);
      const first = fixtureManager.search("alpha");
      expect(first.total_matches).toBe(1);
      expect(first.results[0]!.name).toBe("re-sample-alpha");

      const beta = {
        name: "re-sample-beta",
        domain: "re",
        category: "debugging",
        description: "Beta dynamic debugging workflow",
        sha256: "b".repeat(64),
        bytes: 32,
      };
      fs.writeFileSync(catalogPath, `${JSON.stringify(alpha)}\n${JSON.stringify(beta)}\n`);

      const second = fixtureManager.search("beta");
      expect(second.total_matches).toBe(1);
      expect(second.results[0]!.name).toBe("re-sample-beta");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps integrity verification over the memoized catalog snapshot", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-skill-load-"));
    try {
      const skillDir = path.join(root, "skills", "re-sample-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      const body = "# Sample\n\nVerified body.\n";
      const skillPath = path.join(skillDir, "SKILL.md");
      fs.writeFileSync(skillPath, body);

      const catalogPath = path.join(root, "catalog", "skills.index.jsonl");
      fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
      const entry = {
        name: "re-sample-skill",
        domain: "re",
        category: "decompilation",
        description: "Sample skill",
        sha256: sha256String(body),
        bytes: Buffer.byteLength(body),
      };
      fs.writeFileSync(catalogPath, `${JSON.stringify(entry)}\n`);

      const fixtureManager = new SkillCatalogManager(root);
      expect(fixtureManager.load("re-sample-skill").content).toBe(body);

      fs.writeFileSync(skillPath, "# Tampered\n");
      expect(fixtureManager.load("re-sample-skill").error).toBe("INTEGRITY_VERIFICATION_FAILED");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("denies sibling-directory escapes in skill asset loads", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-skill-asset-"));
    try {
      fs.mkdirSync(path.join(root, "skills", "re-sample"), { recursive: true });
      fs.mkdirSync(path.join(root, "skills", "re-sample-evil"), { recursive: true });
      fs.writeFileSync(path.join(root, "skills", "re-sample-evil", "secret.txt"), "secret");

      const fixtureManager = new SkillCatalogManager(root);
      expect(() => fixtureManager.loadAsset("re-sample", "../re-sample-evil/secret.txt")).toThrow(
        "Path traversal denied"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects path traversal in skill identifiers for load and asset loads", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-skill-traversal-"));
    try {
      fs.mkdirSync(path.join(root, "skills", "re-sample"), { recursive: true });
      fs.writeFileSync(path.join(root, "skills", "re-sample", "SKILL.md"), "# Sample\n");
      fs.mkdirSync(path.join(root, "outside"), { recursive: true });
      fs.writeFileSync(path.join(root, "outside", "secret.txt"), "secret");
      fs.writeFileSync(path.join(root, "outside", "SKILL.md"), "# Outside\n");

      const fixtureManager = new SkillCatalogManager(root);
      expect(fixtureManager.load("../../outside").error).toBe("SKILL_NOT_FOUND");
      expect(fixtureManager.load("..-evil").error).toBe("SKILL_NOT_FOUND");
      expect(() => fixtureManager.loadAsset("../../outside", "secret.txt")).toThrow("not found");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects symlinked skills and assets that escape the skills root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-skill-symlink-"));
    try {
      const skillDir = path.join(root, "skills", "re-sample");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Sample\n");
      fs.mkdirSync(path.join(root, "outside"), { recursive: true });
      fs.writeFileSync(path.join(root, "outside", "secret.txt"), "secret");
      fs.writeFileSync(path.join(root, "outside", "SKILL.md"), "# Outside\n");

      const fixtureManager = new SkillCatalogManager(root);

      // A symlinked skill directory pointing outside the skills root is rejected.
      fs.symlinkSync(path.join(root, "outside"), path.join(root, "skills", "evil"));
      expect(fixtureManager.load("evil").error).toBe("SKILL_NOT_FOUND");
      expect(() => fixtureManager.loadAsset("evil", "secret.txt")).toThrow("not found");

      // A symlinked asset escaping its skill directory is rejected.
      fs.symlinkSync(path.join(root, "outside", "secret.txt"), path.join(skillDir, "link.txt"));
      expect(() => fixtureManager.loadAsset("re-sample", "link.txt")).toThrow("Path traversal denied");

      // A symlinked SKILL.md escaping its skill directory is rejected.
      fs.rmSync(path.join(skillDir, "SKILL.md"));
      fs.symlinkSync(path.join(root, "outside", "SKILL.md"), path.join(skillDir, "SKILL.md"));
      expect(fixtureManager.load("re-sample").error).toBe("SKILL_NOT_FOUND");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Routing Extension Surface", () => {
  interface CapturedTool {
    name: string;
    execute: (
      toolCallId: unknown,
      params?: unknown
    ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  }

  it("registers discovery tools and serves ranked search and routing through them", async () => {
    const tools: CapturedTool[] = [];
    routingExtension({ registerTool: (tool: CapturedTool) => tools.push(tool) } as never);
    expect(tools.map((t) => t.name)).toEqual([
      "skill_search",
      "skill_list",
      "skill_load",
      "skill_asset_load",
      "skill_route",
    ]);

    const search = tools.find((t) => t.name === "skill_search")!;
    const searchResponse = await search.execute("call-1", { query: "gidra", domain: "re" });
    expect(searchResponse.isError).toBeUndefined();
    const searchPayload = JSON.parse(searchResponse.content[0]!.text) as {
      total_matches: number;
      results: Array<{ name: string; score: number }>;
    };
    expect(searchPayload.total_matches).toBeGreaterThan(0);
    expect(searchPayload.results.some((r) => r.name === "re-ghidra-reverse")).toBe(true);
    expect(searchPayload.results[0]!.score).toBeGreaterThan(0);

    const route = tools.find((t) => t.name === "skill_route")!;
    const routeResponse = await route.execute("call-2", {
      hint: "kerberoasting active directory",
      domain: "red",
    });
    const routePayload = JSON.parse(routeResponse.content[0]!.text) as {
      domain: string;
      route_id: string | null;
      skill?: string;
    };
    expect(routePayload.domain).toBe("red");
    expect(routePayload.route_id).toBeTruthy();
  });

  it("supports host-injected pi.zod builders when registering tools", () => {
    const capturedTools: Array<{ name: string; parameters?: unknown }> = [];
    interface ChainedBuilder {
      describe: (d: string) => ChainedBuilder;
      optional: () => ChainedBuilder;
      default: (v: unknown) => ChainedBuilder;
      min: (n: number) => ChainedBuilder;
      max: (n: number) => ChainedBuilder;
      int: () => ChainedBuilder;
    }
    const chain: () => ChainedBuilder = () => ({
      describe: () => chain(),
      optional: () => chain(),
      default: () => chain(),
      min: () => chain(),
      max: () => chain(),
      int: () => chain(),
    });
    const dummyZod = {
      object: (shape: Record<string, unknown>) => ({ isZodObject: true, shape }),
      string: chain,
      enum: chain,
      number: chain,
    };

    routingExtension({
      registerTool: (tool: { name: string; parameters?: unknown }) => capturedTools.push(tool),
      zod: dummyZod,
    } as never);

    expect(capturedTools.length).toBe(5);
    for (const tool of capturedTools) {
      expect(typeof tool.parameters).toBe("object");
      expect(tool.parameters !== null).toBe(true);
      if (tool.parameters && typeof tool.parameters === "object" && "isZodObject" in tool.parameters) {
        expect(tool.parameters.isZodObject).toBe(true);
      }
    }
  });
});
