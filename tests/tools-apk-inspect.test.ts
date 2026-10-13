import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { inspectApk } from "../plugin/tools/apk-inspect.ts";
import { readCorpusManifest, validateSupportFileIntegrity } from "../src/core/skill-manifest.ts";

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

  test("every shipped corpus script is monitored through manifest provenance records", () => {
    const corpusDir = path.resolve("src/corpus");
    if (!fs.existsSync(corpusDir)) return;

    const manifest = readCorpusManifest(path.join(corpusDir, "MANIFEST.json"));
    const integrityErrors = validateSupportFileIntegrity(manifest, corpusDir);
    expect(integrityErrors).toEqual([]);

    const unrecordedScripts: string[] = [];
    for (const entry of manifest.files) {
      if (entry.status !== "admitted" || !entry.destination_path) continue;
      const skillId = entry.destination_path.slice("src/corpus/".length).split("/")[0]!;
      for (const sf of entry.support_files ?? []) {
        if (!/\.(py|sh|ps1|js)$/.test(sf.path)) continue;
        if (!sf.source_path || sf.bytes === 0) {
          unrecordedScripts.push(`${skillId}: ${sf.path} lacks provenance or is empty`);
        }
      }
    }
    expect(unrecordedScripts).toEqual([]);
  });
});
