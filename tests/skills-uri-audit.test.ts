import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Corpus Canonical URI Audit", () => {
  test("asserts zero un-migrated relative references remain in SKILL.md files", () => {
    const corpusDir = path.resolve("src/corpus");
    if (!fs.existsSync(corpusDir)) return;

    const entries = fs.readdirSync(corpusDir, { withFileTypes: true });
    const skillFiles = entries
      .filter((ent) => ent.isDirectory())
      .map((ent) => path.join(corpusDir, ent.name, "SKILL.md"))
      .filter((p) => fs.existsSync(p));
    const violatingReferences: string[] = [];

    for (const f of skillFiles) {
      const content = fs.readFileSync(f, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.includes("references/") && !line.includes("skill://")) {
          if (
            !line.includes("Library/Preferences") &&
            !line.includes("SharedPreferences") &&
            /\b(?:\.\/)?references\/[a-zA-Z0-9_.-]+\.(?:md|yar|json|txt|sh)\b/.test(line)
          ) {
            const skillName = path.basename(path.dirname(f));
            violatingReferences.push(`${skillName}: ${line.trim()}`);
          }
        }
      }
    }

    expect(violatingReferences).toEqual([]);
  });
});
