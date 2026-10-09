import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { inspectApk } from "../plugin/tools/apk-inspect.ts";

describe("Native APK Inspection Tool (apk_inspect)", () => {
  const fixturePath = path.resolve("tests/fixtures/sample.apk");

  test("extracts package name, permissions, and exported components from APK", async () => {
    expect(fs.existsSync(fixturePath)).toBe(true);

    const result = await inspectApk({ apk_path: fixturePath });

    expect(result.packageName).toBe("com.example.vulnerableapp");
    expect(result.versionCode).toBe(100);
    expect(result.permissions).toContain("android.permission.INTERNET");
    expect(result.permissions).toContain("android.permission.ACCESS_FINE_LOCATION");

    // Exported components
    const exportedNames = result.exportedComponents.map((c) => c.name);
    expect(exportedNames).toContain("com.example.vulnerableapp.MainActivity");
    expect(exportedNames).toContain("com.example.vulnerableapp.BackendService");
    expect(exportedNames).toContain("com.example.vulnerableapp.PushReceiver");
    expect(exportedNames).not.toContain("com.example.vulnerableapp.SecretActivity");

    // Dangerous flags
    expect(result.debuggable).toBe(true);
    expect(result.allowBackup).toBe(true);
    expect(result.dangerousFlags).toContain("debuggable");
    expect(result.dangerousFlags).toContain("allowBackup");
  });

  test("handles missing APK file gracefully without unhandled crashes", async () => {
    expect(async () => {
      await inspectApk({ apk_path: "tests/fixtures/non-existent.apk" });
    }).toThrow();
  });

  test("verifies zero unmonitored scripts remain in corpus", () => {
    const corpusDir = path.resolve("src/corpus");
    if (!fs.existsSync(corpusDir)) return;

    const entries = fs.readdirSync(corpusDir);
    const violatingSkills: string[] = [];

    for (const entry of entries) {
      const scriptsDir = path.join(corpusDir, entry, "scripts");
      if (fs.existsSync(scriptsDir)) {
        const files = fs.readdirSync(scriptsDir).filter((f) => !f.startsWith("."));
        if (files.length > 0) {
          violatingSkills.push(`${entry}/scripts: [${files.join(", ")}]`);
        }
      }
    }

    expect(violatingSkills).toEqual([]);
  });
});
