/**
 * tools/generate-skill-index.ts
 * Generates deterministic catalog index skills.index.jsonl from skills directory
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256File } from "../src/core/hash.ts";
import { parseSkillFrontmatter } from "../src/core/skill-frontmatter.ts";

export interface CatalogRecord {
  name: string;
  domain: string;
  category: string;
  description: string;
  sha256: string;
  bytes: number;
}

export function generateSkillIndex(skillsDir: string, outCatalogFile: string): CatalogRecord[] {
  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Skills directory '${skillsDir}' not found.`);
  }

  const entries: CatalogRecord[] = [];
  const dirs = fs.readdirSync(skillsDir, { withFileTypes: true });

  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const sFile = path.join(skillsDir, d.name, "SKILL.md");
    if (!fs.existsSync(sFile)) continue;

    const raw = fs.readFileSync(sFile, "utf-8");
    const hash = sha256File(sFile);
    const fm = parseSkillFrontmatter(raw);

    entries.push({
      name: d.name,
      domain: typeof fm?.domain === "string" ? fm.domain : "re",
      category: typeof fm?.category === "string" ? fm.category : "general",
      description: typeof fm?.description === "string" ? fm.description : "",
      sha256: hash,
      bytes: Buffer.byteLength(raw, "utf-8"),
    });
  }

  // Deterministic sort by name
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const jsonlContent = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.mkdirSync(path.dirname(outCatalogFile), { recursive: true });
  fs.writeFileSync(outCatalogFile, jsonlContent, "utf-8");

  return entries;
}
