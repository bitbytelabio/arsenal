/**
 * Cryptographic Hash Verifier & Chain Validator
 * Implements SHA-256 hashing and ledger chain integrity checks per contracts/evidence-reporting.md §2.2
 */

import * as fs from "node:fs";
import * as crypto from "node:crypto";

export const GENESIS_PREV_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

export function sha256Bytes(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex").toLowerCase();
}

export function sha256String(text: string): string {
  return crypto.createHash("sha256").update(text, "utf-8").digest("hex").toLowerCase();
}

export function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex").toLowerCase();
}

export interface ChainVerificationResult {
  valid: boolean;
  totalRecords: number;
  failedIndex?: number;
  error?: string;
}

export function verifyHashChain(lines: string[]): ChainVerificationResult {
  if (lines.length === 0) {
    return { valid: true, totalRecords: 0 };
  }

  let expectedPrevHash = GENESIS_PREV_HASH;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    if (rawLine.trim().length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      return {
        valid: false,
        totalRecords: lines.length,
        failedIndex: i,
        error: `Record at line ${i + 1} is not valid JSON.`,
      };
    }

    if (!parsed || typeof parsed !== "object" || !("prev_hash" in parsed)) {
      return {
        valid: false,
        totalRecords: lines.length,
        failedIndex: i,
        error: `Record at line ${i + 1} is missing prev_hash.`,
      };
    }

    const prevHash = parsed.prev_hash;
    if (typeof prevHash !== "string" || prevHash.toLowerCase() !== expectedPrevHash) {
      return {
        valid: false,
        totalRecords: lines.length,
        failedIndex: i,
        error: `Hash chain broken at line ${i + 1}: expected prev_hash '${expectedPrevHash}', observed '${String(prevHash)}'.`,
      };
    }

    // Successive lines must chain to SHA-256 of the current line including \n
    const lineWithLf = rawLine.endsWith("\n") ? rawLine : `${rawLine}\n`;
    expectedPrevHash = sha256String(lineWithLf);
  }

  return {
    valid: true,
    totalRecords: lines.length,
  };
}

export function verifyArtifactIntegrity(filePath: string, expectedHash: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const actualHash = sha256File(filePath);
  return actualHash === expectedHash.toLowerCase();
}
