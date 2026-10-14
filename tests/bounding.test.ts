/**
 * tests/bounding.test.ts
 * Behavioral test for output bounding logic per contracts/evidence-reporting.md §1.1
 */

import { describe, expect, it } from "bun:test";
import { boundAndStore, boundOutput, truncateHeadToByteBudget, truncateTailToByteBudget } from "../src/core/bounding.ts";
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

describe("Codepoint-Boundary Truncation Equivalence", () => {
  function referenceHead(str: string, maxBytes: number): string {
    if (maxBytes <= 0) return "";
    const encoder = new TextEncoder();
    let currentBytes = 0;
    let result = "";
    for (const char of str) {
      const charBytes = encoder.encode(char).byteLength;
      if (currentBytes + charBytes > maxBytes) break;
      result += char;
      currentBytes += charBytes;
    }
    return result;
  }

  function referenceTail(str: string, maxBytes: number): string {
    if (maxBytes <= 0) return "";
    const encoder = new TextEncoder();
    const chars = Array.from(str);
    let currentBytes = 0;
    const picked: string[] = [];
    for (let i = chars.length - 1; i >= 0; i--) {
      const char = chars[i]!;
      const charBytes = encoder.encode(char).byteLength;
      if (currentBytes + charBytes > maxBytes) break;
      picked.push(char);
      currentBytes += charBytes;
    }
    picked.reverse();
    return picked.join("");
  }

  function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const budgets = [0, 1, 2, 3, 4, 5, 7, 8, 11, 16, 32, 64, 4096];

  it("matches the per-character reference implementation across mixed scripts", () => {
    const alphabet = ["a", "B", "9", "_", "-", " ", "\n", "ế", "ộ", "安", "全", "🛡", "🚨", "\u0301", "👩"];
    const random = mulberry32(0x5eed);
    for (let sample = 0; sample < 250; sample++) {
      let text = "";
      const length = Math.floor(random() * 40);
      for (let i = 0; i < length; i++) {
        text += alphabet[Math.floor(random() * alphabet.length)]!;
      }
      for (const budget of budgets) {
        expect(truncateHeadToByteBudget(text, budget)).toBe(referenceHead(text, budget));
        expect(truncateTailToByteBudget(text, budget)).toBe(referenceTail(text, budget));
      }
    }
  });

  it("handles lone surrogates exactly like TextEncoder encoding", () => {
    const text = "A\uD800B\uDE00C";
    for (const budget of budgets) {
      expect(truncateHeadToByteBudget(text, budget)).toBe(referenceHead(text, budget));
      expect(truncateTailToByteBudget(text, budget)).toBe(referenceTail(text, budget));
    }
  });

  it("returns the original string when no truncation is required", () => {
    const text = "Tiếng Việt an toàn 🛡";
    expect(truncateHeadToByteBudget(text, 4096)).toBe(text);
    expect(truncateTailToByteBudget(text, 4096)).toBe(text);
    expect(truncateHeadToByteBudget(text, 0)).toBe("");
    expect(truncateTailToByteBudget(text, 0)).toBe("");
  });
});
