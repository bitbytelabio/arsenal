import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Coverage Map Heading Locator Invariants (Principle III & CM-4)", () => {
  const coverageMapPath = path.resolve("presets/baselines/coverage-map.json");
  const corpusDir = path.resolve("src/corpus");

  test("every mapped technique has a valid skill and heading locator in SKILL.md", () => {
    expect(fs.existsSync(coverageMapPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(coverageMapPath, "utf-8")) as {
      entries: Array<{
        capability_id: string;
        domain: string;
        skills: Array<{
          id: string;
          evidence: { locator: string; note: string };
        }>;
      }>;
    };

    const invalidLocators: string[] = [];

    for (const entry of data.entries) {
      for (const sk of entry.skills) {
        const skillMdPath = path.join(corpusDir, sk.id, "SKILL.md");
        if (!fs.existsSync(skillMdPath)) {
          invalidLocators.push(`${entry.capability_id} -> ${sk.id}: SKILL.md not found`);
          continue;
        }

        const content = fs.readFileSync(skillMdPath, "utf-8");
        const cleanLocator = sk.evidence.locator.trim();

        // Check if heading exists in markdown (e.g. ## Heading or ### Heading)
        if (!content.includes(cleanLocator)) {
          // Normalize heading without leading hashes
          const stripped = cleanLocator.replace(/^#+\s*/, "").trim();
          const hasHeading = content.split("\n").some((l) => {
            const trimmed = l.trim();
            return (
              trimmed.startsWith("#") &&
              trimmed.replace(/^#+\s*/, "").trim().toLowerCase() === stripped.toLowerCase()
            );
          });

          if (!hasHeading) {
            invalidLocators.push(
              `${entry.capability_id} -> ${sk.id}: Locator '${cleanLocator}' not found in SKILL.md`
            );
          }
        }
      }
    }

    expect(invalidLocators).toEqual([]);
  });
});
