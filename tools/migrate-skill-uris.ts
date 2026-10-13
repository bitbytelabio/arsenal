/**
 * tools/migrate-skill-uris.ts
 * Batch converts relative reference and support citations in src/corpus to canonical skill:// URIs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Root } from "mdast";

export function migrateSkillContent(skillId: string, content: string): { updated: string; count: number } {
  let tree: Root;
  try {
    tree = fromMarkdown(content);
  } catch {
    return { updated: content, count: 0 };
  }

  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  function normalizeRef(rawUrl: string): string | null {
    let u = rawUrl.trim();
    if (u.includes("://")) return null;
    u = u.replace(/^<SKILL_ROOT>\/?/i, "").replace(/^\.\//, "");
    if (u.startsWith("references/") || u.startsWith("support/")) {
      return `skill://${skillId}/${u}`;
    }
    return null;
  }

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as {
      type?: string;
      url?: string;
      value?: string;
      position?: {
        start: { line: number; column: number; offset?: number };
        end: { line: number; column: number; offset?: number };
      };
      children?: unknown[];
    };

    if (n.type === "code") return;

    if ((n.type === "link" || n.type === "image") && typeof n.url === "string" && n.position) {
      const start = n.position.start.offset;
      const end = n.position.end.offset;
      if (start !== undefined && end !== undefined) {
        const canonical = normalizeRef(n.url);
        if (canonical) {
          const raw = content.slice(start, end);
          let searchFrom = 0;
          if (Array.isArray(n.children) && n.children.length > 0) {
            const lastChild = n.children[n.children.length - 1] as {
              position?: { end?: { offset?: number } };
            };
            if (lastChild.position?.end?.offset !== undefined) {
              searchFrom = Math.max(0, lastChild.position.end.offset - start);
            }
          } else {
            let depth = 0;
            for (let i = 0; i < raw.length; i++) {
              if (raw[i] === "\\") {
                i++;
                continue;
              }
              if (raw[i] === "[") depth++;
              else if (raw[i] === "]") {
                depth--;
                if (depth === 0 && raw[i + 1] === "(") {
                  searchFrom = i;
                  break;
                }
              }
            }
          }
          const openParenIdx = raw.indexOf("](", searchFrom);
          if (openParenIdx !== -1) {
            const urlIdx = raw.indexOf(n.url, openParenIdx + 2);
            if (urlIdx !== -1) {
              const newRaw = raw.slice(0, urlIdx) + canonical + raw.slice(urlIdx + n.url.length);
              edits.push({ start, end, replacement: newRaw });
            }
          }
        }
      }
      return;
    }

    if (n.type === "definition" && typeof n.url === "string" && n.position) {
      const start = n.position.start.offset;
      const end = n.position.end.offset;
      if (start !== undefined && end !== undefined) {
        const canonical = normalizeRef(n.url);
        if (canonical) {
          const raw = content.slice(start, end);
          const colonIdx = raw.indexOf("]:");
          if (colonIdx !== -1) {
            const urlIdx = raw.indexOf(n.url, colonIdx + 2);
            if (urlIdx !== -1) {
              const newRaw = raw.slice(0, urlIdx) + canonical + raw.slice(urlIdx + n.url.length);
              edits.push({ start, end, replacement: newRaw });
            }
          }
        }
      }
      return;
    }

    if (n.type === "inlineCode" && typeof n.value === "string" && n.position) {
      const start = n.position.start.offset;
      const end = n.position.end.offset;
      const val = n.value.trim();
      if (start !== undefined && end !== undefined && !/\s/.test(val)) {
        const preceding = content.slice(Math.max(0, start - 25), start);
        if (!/(?:python3?|bash|sh|pwsh|powershell|node|exec|cat|cp|mv)\s+$/i.test(preceding)) {
          const canonical = normalizeRef(val);
          if (canonical) {
            const raw = content.slice(start, end);
            const ticks = raw.match(/^`+/)?.[0] ?? "`";
            edits.push({ start, end, replacement: `${ticks}${canonical}${ticks}` });
          }
        }
      }
      return;
    }

    if (n.type === "text" && typeof n.value === "string" && n.position) {
      const start = n.position.start.offset;
      const end = n.position.end.offset;
      if (start !== undefined && end !== undefined) {
        const raw = content.slice(start, end);
        const regex = /(?<=\s|^)(?:<SKILL_ROOT>\/|\.\/*)?((?:references|support)\/[a-zA-Z0-9_./-]+\.md(?:#[a-zA-Z0-9_-]+)?)/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(raw)) !== null) {
          const fullMatch = match[0];
          if (fullMatch.includes("://")) continue;
          const matchStart = start + match.index;
          const preceding = content.slice(Math.max(0, matchStart - 25), matchStart);
          if (/(?:python3?|bash|sh|pwsh|powershell|node|exec|cat|cp|mv)\s+$/i.test(preceding)) continue;
          const canonical = normalizeRef(fullMatch);
          if (canonical) {
            edits.push({
              start: matchStart,
              end: matchStart + fullMatch.length,
              replacement: canonical,
            });
          }
        }
      }
      return;
    }

    if (Array.isArray(n.children)) {
      for (const child of n.children) walk(child);
    }
  }

  walk(tree);

  edits.sort((a, b) => b.start - a.start);
  let updated = content;
  for (const edit of edits) {
    updated = updated.slice(0, edit.start) + edit.replacement + updated.slice(edit.end);
  }
  return { updated, count: edits.length };
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
