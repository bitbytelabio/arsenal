/**
 * tests/ida-detector.test.ts
 * Tests IDA Pro & idalib auto-detection engine
 */

import { describe, expect, it } from "bun:test";
import { detectIdaInstallation } from "../src/core/ida-detector.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("IDA Pro & idalib Auto-Detection", () => {
  it("detects local IDA Pro installation if present on host", () => {
    const res = detectIdaInstallation();
    if (fs.existsSync("/Applications/IDA Professional 9.4.app/Contents/MacOS")) {
      expect(res.found).toBe(true);
      expect(res.installDir).toContain("IDA");
      expect(res.hasIdalib).toBe(true);
      if (res.python) {
        expect(fs.existsSync(res.python)).toBe(true);
      }
    } else {
      expect(typeof res.found).toBe("boolean");
    }
  });

  it("detects mock IDA directory when customBaseDir is provided", () => {
    const tmpDir = path.join(os.tmpdir(), `ida-mock-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const libName =
      process.platform === "darwin"
        ? "libidalib.dylib"
        : process.platform === "win32"
          ? "idalib.dll"
          : "libidalib.so";
    fs.writeFileSync(path.join(tmpDir, libName), "mock");
    fs.writeFileSync(path.join(tmpDir, "ida"), "mock");

    const res = detectIdaInstallation(tmpDir);
    expect(res.found).toBe(true);
    expect(res.installDir).toBe(tmpDir);
    expect(res.hasIdalib).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
