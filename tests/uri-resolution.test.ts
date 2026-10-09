import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { parseSkillUri, resolveSkillUri } from "../src/core/reference-resolver.ts";

describe("Canonical skill:// URI Resolution", () => {
  const corpusDir = path.resolve("src/corpus");

  test("parses root skill URIs correctly", () => {
    const parsed = parseSkillUri("skill://webapp-thick-client");
    expect(parsed.valid).toBe(true);
    expect(parsed.skillId).toBe("webapp-thick-client");
    expect(parsed.subpath).toBe("");
  });

  test("parses subpath skill URIs correctly", () => {
    const parsed = parseSkillUri("skill://webapp-thick-client/references/thick-client-checklist.md");
    expect(parsed.valid).toBe(true);
    expect(parsed.skillId).toBe("webapp-thick-client");
    expect(parsed.subpath).toBe("references/thick-client-checklist.md");
  });

  test("resolves canonical asset path to disk regardless of working directory", () => {
    const res = resolveSkillUri(
      "skill://webapp-thick-client/references/thick-client-checklist.md",
      corpusDir
    );
    expect(res.exists).toBe(true);
    expect(res.resolvedPath).not.toBeNull();
    expect(res.resolvedPath?.endsWith("references/thick-client-checklist.md")).toBe(true);
  });

  test("returns error for invalid URI schemes or non-existent assets", () => {
    const invalidScheme = parseSkillUri("http://example.com/asset.md");
    expect(invalidScheme.valid).toBe(false);

    const missingAsset = resolveSkillUri(
      "skill://webapp-thick-client/references/non-existent-file.md",
      corpusDir
    );
    expect(missingAsset.exists).toBe(false);
    expect(missingAsset.error).toBeDefined();
  });
});
