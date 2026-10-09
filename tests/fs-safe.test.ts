/**
 * tests/fs-safe.test.ts
 * Tests preview mode, --write gate, --force backup, and conflict detection
 */

import { describe, expect, it } from "bun:test";
import { safeWriteFile } from "../src/core/fs-safe.ts";
import * as fs from "node:fs";
import * as path from "node:path";

describe("File Mutation Safety Layer", () => {
  const testFile = path.resolve("tests/fixtures/safe-test.txt");

  it("refuses write in preview mode (default)", () => {
    fs.rmSync(testFile, { force: true });
    const res = safeWriteFile(testFile, "hello", { write: false, force: false });
    expect(res.written).toBe(false);
    expect(res.action).toBe("preview");
    expect(fs.existsSync(testFile)).toBe(false);
  });

  it("creates file when --write is true", () => {
    const res = safeWriteFile(testFile, "hello", { write: true, force: false });
    expect(res.written).toBe(true);
    expect(res.action).toBe("created");
    expect(fs.existsSync(testFile)).toBe(true);
    expect(fs.readFileSync(testFile, "utf-8")).toBe("hello");
  });

  it("refuses overwrite with conflict if --force is false (exit code 3 scenario)", () => {
    const res = safeWriteFile(testFile, "different content", { write: true, force: false });
    expect(res.written).toBe(false);
    expect(res.action).toBe("refused");
    expect(res.conflict).toBe(true);
    expect(res.error).toContain("Specify --force");
  });

  it("creates timestamped backup and overwrites when --force is true", () => {
    const res = safeWriteFile(testFile, "different content", { write: true, force: true });
    expect(res.written).toBe(true);
    expect(res.action).toBe("updated");
    expect(res.backupPath).toBeDefined();
    expect(fs.existsSync(res.backupPath!)).toBe(true);
    expect(fs.readFileSync(res.backupPath!, "utf-8")).toBe("hello");
    expect(fs.readFileSync(testFile, "utf-8")).toBe("different content");

    fs.rmSync(testFile, { force: true });
    fs.rmSync(res.backupPath!, { force: true });
  });
});
