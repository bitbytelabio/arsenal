/**
 * Output Bounding Engine
 * Implements contracts/evidence-reporting.md §1.1 & contracts/character-bounding.md
 * Decouples raw byte persistence from LLM conversational context delivery.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256Bytes } from "./hash.ts";

export interface BoundingResult {
  bounded: boolean;
  content: string;
  artifactPath?: string;
  artifactHash?: string;
  originalBytes: number;
  originalLines: number;
}

export interface BoundOutputResult {
  bounded: string;
  content: string;
  isBounded: boolean;
  artifactPath?: string;
  artifactHash?: string;
  originalBytes: number;
  originalLines: number;
  deliveredBytes: number;
  hasReplacementChars: boolean;
}

export const BOUNDING_LIMITS = {
  MAX_LOGICAL_LINES: 500,
  MAX_RAW_BYTES: 51200, // 50 KiB
  MAX_DELIVERED_BYTES: 4096, // 4 KiB
  HEAD_LINES: 20,
  TAIL_LINES: 20,
} as const;

/**
 * UTF-8 byte length of one code point using TextEncoder semantics
 * (unpaired surrogates encode as U+FFFD, i.e. 3 bytes).
 */
function utf8ByteLength(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Truncates characters from the beginning of string to fit within maxBytes.
 * Guarantees zero partial codepoints and zero \uFFFD replacement characters.
 * Allocation-free: counts UTF-8 bytes by code point, then slices once.
 */
export function truncateHeadToByteBudget(str: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  let usedBytes = 0;
  let index = 0;

  while (index < str.length) {
    const codePoint = str.codePointAt(index)!;
    const bytes = utf8ByteLength(codePoint);
    if (usedBytes + bytes > maxBytes) break;
    usedBytes += bytes;
    index += codePoint > 0xffff ? 2 : 1;
  }

  return index === str.length ? str : str.slice(0, index);
}

/**
 * Truncates characters from the end of string backwards to fit within maxBytes.
 * Guarantees zero partial codepoints and zero \uFFFD replacement characters.
 * Allocation-free: walks code points backwards, then slices once.
 */
export function truncateTailToByteBudget(str: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  let usedBytes = 0;
  let index = str.length;

  while (index > 0) {
    const low = str.charCodeAt(index - 1);
    let codePoint = low;
    let step = 1;
    if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
      const high = str.charCodeAt(index - 2);
      if (high >= 0xd800 && high <= 0xdbff) {
        codePoint = (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        step = 2;
      }
    }
    const bytes = utf8ByteLength(codePoint);
    if (usedBytes + bytes > maxBytes) break;
    usedBytes += bytes;
    index -= step;
  }

  return index === 0 ? str : str.slice(index);
}

export function boundAndStore(
  rawInput: string | Uint8Array,
  evidenceDir: string,
  ext: string = "txt"
): BoundingResult {
  const bytes = typeof rawInput === "string" ? new TextEncoder().encode(rawInput) : rawInput;
  const rawText = typeof rawInput === "string" ? rawInput : new TextDecoder().decode(bytes);
  const lines = rawText.split("\n");

  const byteLength = bytes.byteLength;
  const lineCount = lines.length;

  if (
    lineCount <= BOUNDING_LIMITS.MAX_LOGICAL_LINES &&
    byteLength <= BOUNDING_LIMITS.MAX_RAW_BYTES
  ) {
    return {
      bounded: false,
      content: rawText,
      originalBytes: byteLength,
      originalLines: lineCount,
    };
  }

  // Bounding triggered: persist raw artifact
  const hash = sha256Bytes(bytes);
  const rawDir = path.join(evidenceDir, "raw");
  fs.mkdirSync(rawDir, { recursive: true, mode: 0o700 });

  const artifactRelPath = path.join("evidence", "raw", `${hash}.${ext}`);
  const artifactFullPath = path.join(evidenceDir, "raw", `${hash}.${ext}`);

  fs.writeFileSync(artifactFullPath, bytes, { mode: 0o600 });
  try {
    fs.chmodSync(artifactFullPath, 0o600);
  } catch {
    // Non-POSIX platforms or filesystems ignore chmod
  }

  // Extract head 20 and tail 20
  const headLines = lines.slice(0, BOUNDING_LIMITS.HEAD_LINES);
  const tailLines = lines.slice(-BOUNDING_LIMITS.TAIL_LINES);
  const spilledLineCount = Math.max(
    0,
    lineCount - BOUNDING_LIMITS.HEAD_LINES - BOUNDING_LIMITS.TAIL_LINES
  );

  const marker = `\n[OUTPUT BOUNDED: ${spilledLineCount} lines spilled to ${artifactRelPath} (SHA-256: ${hash})]\n`;

  let headText = headLines.join("\n");
  let tailText = tailLines.join("\n");
  let combined = `${headText}${marker}${tailText}`;

  // Enforce MAX_DELIVERED_BYTES (4096 bytes) using character-safe codepoint truncation
  const encoder = new TextEncoder();
  if (encoder.encode(combined).byteLength > BOUNDING_LIMITS.MAX_DELIVERED_BYTES) {
    const markerBytes = encoder.encode(marker).byteLength;
    const availableForContent = Math.max(0, BOUNDING_LIMITS.MAX_DELIVERED_BYTES - markerBytes);
    const half = Math.floor(availableForContent / 2);

    headText = truncateHeadToByteBudget(headText, half);
    const headBytes = encoder.encode(headText).byteLength;
    tailText = truncateTailToByteBudget(tailText, availableForContent - headBytes);
    combined = `${headText}${marker}${tailText}`;
  }

  return {
    bounded: true,
    content: combined,
    artifactPath: artifactRelPath,
    artifactHash: hash,
    originalBytes: byteLength,
    originalLines: lineCount,
  };
}

/**
 * Character-safe diagnostic output bounding helper.
 * Enforces contracts/character-bounding.md invariants.
 */
export function boundOutput(
  rawInput: string | Uint8Array,
  evidenceDir: string = "evidence",
  ext: string = "txt"
): BoundOutputResult {
  const res = boundAndStore(rawInput, evidenceDir, ext);
  const deliveredBytes = Buffer.byteLength(res.content, "utf-8");
  return {
    bounded: res.content,
    content: res.content,
    isBounded: res.bounded,
    artifactPath: res.artifactPath,
    artifactHash: res.artifactHash,
    originalBytes: res.originalBytes,
    originalLines: res.originalLines,
    deliveredBytes,
    hasReplacementChars: res.content.includes("\uFFFD"),
  };
}
