import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

const pwsh = Bun.which("pwsh");
const helper = path.resolve(import.meta.dir, "../src/corpus/webapp-pentest-tools/support/templates/append-evidence.ps1");

test.skipIf(!pwsh)("evidence helper preserves multiline artifacts and rejects invalid or duplicate records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-evidence-helper-"));
  try {
    const caseRoot = path.join(root, "case with spaces");
    fs.mkdirSync(caseRoot);
    const artifact = path.join(caseRoot, "sample.txt");
    const excerpt = path.join(root, "excerpt.txt");
    const outside = path.join(root, "outside.txt");
    fs.writeFileSync(artifact, "offline artifact\n");
    fs.writeFileSync(excerpt, "first line\nsecond line: preserved\n");
    fs.writeFileSync(outside, "not inside the case");
    const invoke = (args: string[]) => Bun.spawnSync([
      pwsh!, "-NoProfile", "-NonInteractive", "-File", helper,
      "-CaseRoot", caseRoot, "-Title", "Offline evidence",
      "-ReproCommand", "cat sample.txt", ...args,
    ], { cwd: root, timeout: 30_000 });
    const created = invoke(["-Id", "E-001", "-RawExcerptFile", excerpt, "-ArtifactPath", artifact]);
    expect({ exitCode: created.exitCode, error: created.stderr.toString() }).toEqual({ exitCode: 0, error: "" });
    const record = path.join(caseRoot, "evidence/E-001.md");
    const original = fs.readFileSync(record, "utf8");
    expect(original.replaceAll("\r\n", "\n")).toContain("    first line\n    second line: preserved");
    expect(original).toContain("- artifact_path: sample.txt");
    expect(original).toContain(`sha256:${createHash("sha256").update(fs.readFileSync(artifact)).digest("hex")}`);
    const rejected = [
      ["-Id", "E-001"],
      ["-Id", "E-002", "-Severity", "bogus"],
      ["-Id", "E-003", "-Status", "bogus"],
      ["-Id", "E-004", "-ArtifactPath", outside],
    ];
    for (const args of rejected) {
      expect(invoke(args).exitCode).not.toBe(0);
      expect(fs.readFileSync(record, "utf8")).toBe(original);
    }
    for (const id of ["E-002", "E-003", "E-004"]) {
      expect(fs.existsSync(path.join(caseRoot, "evidence", `${id}.md`))).toBe(false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
