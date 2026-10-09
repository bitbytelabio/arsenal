/**
 * tests/bounding.test.ts
 * Behavioral test for output bounding logic per contracts/evidence-reporting.md §1.1
 */

import { describe, expect, it } from "bun:test";
import { boundAndStore, boundOutput } from "../src/core/bounding.ts";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Output Bounding Engine", () => {
  const scratchDir = path.resolve("tests/fixtures/scratch-evidence");

  it("passes small outputs through unmodified", () => {
    const smallText = "Line 1\nLine 2\nLine 3";
    const res = boundAndStore(smallText, scratchDir);
    expect(res.bounded).toBe(false);
    expect(res.content).toBe(smallText);
  });

  it("triggers bounding when line count > 500", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 600; i++) {
      lines.push(`Output row number ${i}`);
    }
    const input = lines.join("\n");
    const res = boundAndStore(input, scratchDir);

    expect(res.bounded).toBe(true);
    expect(res.artifactPath).toBeDefined();
    expect(res.artifactHash).toBeDefined();
    expect(res.content).toContain("[OUTPUT BOUNDED:");
    expect(res.content).toContain("spilled to evidence/raw/");

    // Check delivered byte length <= 4096
    const deliveredBytes = new TextEncoder().encode(res.content).byteLength;
    expect(deliveredBytes).toBeLessThanOrEqual(4096);

    // Verify raw artifact on disk
    const onDiskFile = path.join(scratchDir, "raw", `${res.artifactHash}.txt`);
    expect(fs.existsSync(onDiskFile)).toBe(true);
    const readBack = fs.readFileSync(onDiskFile, "utf-8");
    expect(readBack).toBe(input);

    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it("triggers bounding when byte size > 51,200", () => {
    const largeLine = "A".repeat(60000); // 1 line, but > 50 KiB
    const res = boundAndStore(largeLine, scratchDir);

    expect(res.bounded).toBe(true);
    const deliveredBytes = new TextEncoder().encode(res.content).byteLength;
    expect(deliveredBytes).toBeLessThanOrEqual(4096);

    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it("truncates multi-byte Vietnamese text without replacement characters (T015)", () => {
    const vietnameseText = "Tiếng Việt an toàn bảo mật \n".repeat(500);
    const res = boundOutput(vietnameseText, scratchDir);

    expect(res.isBounded).toBe(true);
    expect(res.deliveredBytes).toBeLessThanOrEqual(4096);
    expect(res.hasReplacementChars).toBe(false);
    expect(res.bounded).not.toContain("\uFFFD");

    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it("truncates 3-byte CJK ideographs without replacement characters (T015)", () => {
    const cjkText = "安全评估和漏洞分析测试\n".repeat(500);
    const res = boundOutput(cjkText, scratchDir);

    expect(res.isBounded).toBe(true);
    expect(res.deliveredBytes).toBeLessThanOrEqual(4096);
    expect(res.hasReplacementChars).toBe(false);
    expect(res.bounded).not.toContain("\uFFFD");

    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it("truncates 4-byte emoji sequences without replacement characters (T015)", () => {
    const emojiText = "🛡️⚡🔍🚨\n".repeat(500);
    const res = boundOutput(emojiText, scratchDir);

    expect(res.isBounded).toBe(true);
    expect(res.deliveredBytes).toBeLessThanOrEqual(4096);
    expect(res.hasReplacementChars).toBe(false);
    expect(res.bounded).not.toContain("\uFFFD");

    fs.rmSync(scratchDir, { recursive: true, force: true });
  });
});
