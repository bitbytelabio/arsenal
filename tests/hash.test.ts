/**
 * tests/hash.test.ts
 * Tests SHA-256 computation and ledger hash chain verification
 */

import { describe, expect, it } from "bun:test";
import {
  GENESIS_PREV_HASH,
  sha256Bytes,
  sha256String,
  verifyArtifactIntegrity,
  verifyHashChain,
} from "../src/core/hash.ts";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Hash & Chain Verification", () => {
  it("computes exact SHA-256 strings", () => {
    const emptyHash = sha256String("");
    expect(emptyHash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );

    const testBytes = new TextEncoder().encode("hello world");
    expect(sha256Bytes(testBytes)).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    );
  });

  it("verifies a valid hash chain", () => {
    // Record 1 (Genesis)
    const rec1Obj = {
      seq: 1,
      prev_hash: GENESIS_PREV_HASH,
      event: "init",
    };
    const rec1Str = JSON.stringify(rec1Obj);
    const rec1Hash = sha256String(`${rec1Str}\n`);

    // Record 2
    const rec2Obj = {
      seq: 2,
      prev_hash: rec1Hash,
      event: "evidence",
    };
    const rec2Str = JSON.stringify(rec2Obj);
    const rec2Hash = sha256String(`${rec2Str}\n`);

    // Record 3
    const rec3Obj = {
      seq: 3,
      prev_hash: rec2Hash,
      event: "finding",
    };
    const rec3Str = JSON.stringify(rec3Obj);

    const chain = [rec1Str, rec2Str, rec3Str];
    const result = verifyHashChain(chain);
    expect(result.valid).toBe(true);
    expect(result.totalRecords).toBe(3);
  });

  it("detects 1-byte alteration in hash chain", () => {
    const rec1Obj = {
      seq: 1,
      prev_hash: GENESIS_PREV_HASH,
      event: "init",
    };
    const rec1Str = JSON.stringify(rec1Obj);
    const rec1Hash = sha256String(`${rec1Str}\n`);

    const rec2Obj = {
      seq: 2,
      prev_hash: rec1Hash,
      event: "tampered_event",
    };
    const rec2Str = JSON.stringify(rec2Obj);

    // Tamper with record 1
    const tamperedRec1 = JSON.stringify({ ...rec1Obj, event: "altered_init" });

    const chain = [tamperedRec1, rec2Str];
    const result = verifyHashChain(chain);
    expect(result.valid).toBe(false);
    expect(result.failedIndex).toBe(1);
    expect(result.error).toContain("Hash chain broken");
  });

  it("verifies artifact integrity", () => {
    const tmpFile = path.resolve("tests/fixtures/test-artifact.txt");
    fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
    fs.writeFileSync(tmpFile, "artifact data", "utf-8");

    const expected = sha256String("artifact data");
    expect(verifyArtifactIntegrity(tmpFile, expected)).toBe(true);
    expect(verifyArtifactIntegrity(tmpFile, "badhash")).toBe(false);

    fs.rmSync(tmpFile, { force: true });
  });
});
