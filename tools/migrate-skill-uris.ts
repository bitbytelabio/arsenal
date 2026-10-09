/**
 * tools/migrate-skill-uris.ts
 * Batch converts relative reference and support citations in src/corpus to canonical skill:// URIs
 */

import * as fs from "node:fs";
import * as path from "node:path";

export function migrateSkillContent(skillId: string, content: string): { updated: string; count: number } {
  let count = 0;

  // 1. Markdown links: [text](references/...) -> [text](skill://<skillId>/references/...)
  let updated = content.replace(
    /\[([^\]]+)\]\((?:\.\/)?references\/([^)]+)\)/g,
    (match, text, file) => {
      count++;
      return `[${text}](skill://${skillId}/references/${file})`;
    }
  );

  // 2. Markdown links: [text](support/...) -> [text](skill://<skillId>/support/...)
  updated = updated.replace(
    /\[([^\]]+)\]\((?:\.\/)?support\/([^)]+)\)/g,
    (match, text, file) => {
      count++;
      return `[${text}](skill://${skillId}/support/${file})`;
    }
  );

  // 3. Inline code: `references/...` -> `skill://<skillId>/references/...`
  updated = updated.replace(
    /`(?:\.\/)?references\/([^`]+)`/g,
    (match, file) => {
      count++;
      return `\`skill://${skillId}/references/${file}\``;
    }
  );

  // 4. Inline code: `support/...` -> `skill://<skillId>/support/...`
  updated = updated.replace(
    /`(?:\.\/)?support\/([^`]+)`/g,
    (match, file) => {
      count++;
      return `\`skill://${skillId}/support/${file}\``;
    }
  );

  // 5. Prose citations like "See references/foo.md" or "read references/foo.md"
  updated = updated.replace(
    /(?<=\s)(?:\.\/)?references\/([a-zA-Z0-9_.-]+\.md)/g,
    (match, file) => {
      count++;
      return `skill://${skillId}/references/${file}`;
    }
  );

  return { updated, count };
}

export function runMigration(corpusDir: string): { totalModified: number; totalCitations: number } {
  let totalModified = 0;
  let totalCitations = 0;

  const entries = fs.readdirSync(corpusDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillId = ent.name;
    const skillPath = path.join(corpusDir, skillId, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;

    const raw = fs.readFileSync(skillPath, "utf-8");
    const { updated, count } = migrateSkillContent(skillId, raw);
    if (count > 0 && updated !== raw) {
      fs.writeFileSync(skillPath, updated, "utf-8");
      totalModified++;
      totalCitations += count;
    }
  }

  return { totalModified, totalCitations };
}

if (import.meta.main) {
  const corpusDir = path.resolve("src/corpus");
  const { totalModified, totalCitations } = runMigration(corpusDir);
  console.log(`Migrated ${totalCitations} citations across ${totalModified} skills to canonical skill:// URIs`);
}
