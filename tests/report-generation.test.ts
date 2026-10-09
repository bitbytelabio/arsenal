import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Deliverable Report Generation (/sec-report)", () => {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-rep-test-"));

  test("generates Markdown report with default timestamped destination", () => {
    const proc = Bun.spawnSync([
      "bun",
      "run",
      "bin/arsenal.ts",
      "report",
      "--repo",
      tmpRepo,
      "--format",
      "markdown",
      "--json",
    ]);

    expect(proc.exitCode).toBe(0);
    const parsed = JSON.parse(proc.stdout.toString()) as { data: { outPath: string } };
    expect(fs.existsSync(parsed.data.outPath)).toBe(true);

    const content = fs.readFileSync(parsed.data.outPath, "utf-8");
    expect(content).toContain("Executive Report");
    expect(content).toContain("Executive Conclusions");
  });

  test("generates SARIF format report", () => {
    const proc = Bun.spawnSync([
      "bun",
      "run",
      "bin/arsenal.ts",
      "report",
      "--repo",
      tmpRepo,
      "--format",
      "sarif",
      "--json",
    ]);

    expect(proc.exitCode).toBe(0);
    const parsed = JSON.parse(proc.stdout.toString()) as { data: { outPath: string } };
    expect(fs.existsSync(parsed.data.outPath)).toBe(true);

    const sarif = JSON.parse(fs.readFileSync(parsed.data.outPath, "utf-8"));
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs).toBeDefined();
  });
});
