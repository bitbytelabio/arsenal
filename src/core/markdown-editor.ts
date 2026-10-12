/**
 * Non-Destructive Markdown Editor & Merger
 * Implements tag-based block updates (e.g. <!-- arsenal:start --> ... <!-- arsenal:end -->)
 * and non-destructive markdown section/bullet merging for OMP profiles.
 */

export interface MarkdownSection {
  heading: string | null;
  normalizedHeading: string | null;
  level: number;
  rawContent: string;
}

/**
 * Checks if a tagged block exists for a given tag identifier.
 */
export function hasTaggedBlock(content: string, tagId: string): boolean {
  const pattern = new RegExp(`<!--\\s*${tagId}:start\\s*-->[\\s\\S]*?<!--\\s*${tagId}:end\\s*-->`, "i");
  return pattern.test(content);
}

/**
 * Replaces or extracts a tagged block in markdown.
 */
export function replaceTaggedBlock(
  content: string,
  tagId: string,
  newBlock: string
): { replaced: boolean; content: string } {
  const pattern = new RegExp(`<!--\\s*${tagId}:start\\s*-->[\\s\\S]*?<!--\\s*${tagId}:end\\s*-->`, "i");
  if (pattern.test(content)) {
    return {
      replaced: true,
      content: content.replace(pattern, newBlock.trim()),
    };
  }
  return { replaced: false, content };
}

/**
 * Extracts tagged block content (including the start/end comments).
 */
export function extractTaggedBlock(content: string, tagId: string): string | null {
  const pattern = new RegExp(`<!--\\s*${tagId}:start\\s*-->[\\s\\S]*?<!--\\s*${tagId}:end\\s*-->`, "i");
  const match = content.match(pattern);
  return match ? match[0] : null;
}

/**
 * Parses markdown into sequential sections by heading, ignoring headings inside code fences.
 */
export function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];

  let currentHeading: string | null = null;
  let currentLevel = 0;
  let currentLines: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      currentLines.push(line);
      continue;
    }

    if (!inCodeBlock) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch && headingMatch[1] && headingMatch[2]) {
        if (currentLines.length > 0 || currentHeading !== null) {
          sections.push({
            heading: currentHeading,
            normalizedHeading: currentHeading ? currentHeading.trim().toLowerCase() : null,
            level: currentLevel,
            rawContent: currentLines.join("\n"),
          });
          currentLines = [];
        }
        currentHeading = line.trim();
        currentLevel = headingMatch[1].length;
        currentLines.push(line);
        continue;
      }
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0 || currentHeading !== null) {
    sections.push({
      heading: currentHeading,
      normalizedHeading: currentHeading ? currentHeading.trim().toLowerCase() : null,
      level: currentLevel,
      rawContent: currentLines.join("\n"),
    });
  }

  return sections;
}


/**
 * Merges AGENTS.md using tag-based blocks (<!-- arsenal:start --> ... <!-- arsenal:end -->)
 * so that Arsenal's managed content is updated in-place without blindly appending or
 * clobbering third-party tags like <!-- codebase-memory-mcp:start --> or custom user sections.
 */
export function mergeAgentsMarkdown(existing: string, template: string): string {
  if (!existing.trim()) return template.trimEnd() + "\n";
  if (!template.trim()) return existing.trimEnd() + "\n";

  // Ensure template itself has tags
  let normalizedTemplate = template.trim();
  if (!hasTaggedBlock(normalizedTemplate, "arsenal")) {
    normalizedTemplate = `<!-- arsenal:start -->\n${normalizedTemplate}\n<!-- arsenal:end -->`;
  }
  const templateArsenalBlock = extractTaggedBlock(normalizedTemplate, "arsenal") ?? normalizedTemplate;

  // Case 1: Existing document already has <!-- arsenal:start --> ... <!-- arsenal:end -->
  if (hasTaggedBlock(existing, "arsenal")) {
    const { content } = replaceTaggedBlock(existing, "arsenal", templateArsenalBlock);
    return content.trimEnd() + "\n";
  }

  // Also check for legacy or alternate tag <!-- arsenal-orchestrator:start -->
  if (hasTaggedBlock(existing, "arsenal-orchestrator")) {
    const { content } = replaceTaggedBlock(existing, "arsenal-orchestrator", templateArsenalBlock);
    return content.trimEnd() + "\n";
  }

  // Case 2: Untagged existing document containing Arsenal sections.
  // We locate where Arsenal's content begins and where foreign blocks (e.g. codebase-memory-mcp) begin.
  const lowerExisting = existing.toLowerCase();
  const orchestratorIdx = lowerExisting.indexOf("# arsenal master orchestrator");

  if (orchestratorIdx !== -1) {
    // Find where foreign tags or next non-arsenal sections begin after orchestratorIdx
    const foreignTagMatch = existing.slice(orchestratorIdx).match(/<!--\s*([a-zA-Z0-9_-]+):start\s*-->/);
    let arsenalEndIdx = existing.length;

    if (foreignTagMatch && foreignTagMatch.index !== undefined && foreignTagMatch.index > 0) {
      arsenalEndIdx = orchestratorIdx + foreignTagMatch.index;
    }

    const beforeArsenal = existing.slice(0, orchestratorIdx);
    const afterArsenal = existing.slice(arsenalEndIdx);

    const merged = [
      beforeArsenal.trimEnd(),
      templateArsenalBlock,
      afterArsenal.trimStart(),
    ].filter(Boolean).join("\n\n");

    return merged.trimEnd() + "\n";
  }

  // Case 3: Existing document with completely custom content; prepend Arsenal block
  return `${templateArsenalBlock}\n\n${existing.trimStart()}`.trimEnd() + "\n";
}

/**
 * Normalizes rule bullet text for deduplication.
 */
function normalizeRuleText(line: string): string {
  return line
    .replace(/^\s*[-*]\s+/, "")
    .trim()
    .toLowerCase()
    .replace(/[`"'.:;,]/g, "");
}

/**
 * Merges RULES.md preserving verbatim line order, custom headings, comments, and sub-bullets.
 * Only appends missing template rules at the appropriate insertion point.
 */
export function mergeRulesMarkdown(existing: string, template: string): string {
  if (!existing.trim()) return template.trimEnd() + "\n";
  if (!template.trim()) return existing.trimEnd() + "\n";

  const existingLines = existing.split(/\r?\n/);
  const templateLines = template.split(/\r?\n/);

  // Extract all rule bullets present in existing content (respecting code fences)
  const existingBulletNormalized = new Set<string>();
  let inCode = false;

  for (const line of existingLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCode = !inCode;
      continue;
    }
    if (!inCode && (trimmed.startsWith("-") || trimmed.startsWith("*"))) {
      existingBulletNormalized.add(normalizeRuleText(trimmed));
    }
  }

  // Find template bullets that are genuinely missing
  const missingTemplateBullets: string[] = [];
  inCode = false;
  for (const line of templateLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCode = !inCode;
      continue;
    }
    if (!inCode && (trimmed.startsWith("-") || trimmed.startsWith("*"))) {
      const norm = normalizeRuleText(trimmed);
      if (!existingBulletNormalized.has(norm)) {
        missingTemplateBullets.push(line);
        existingBulletNormalized.add(norm);
      }
    }
  }

  // If no missing bullets, keep existing verbatim
  if (missingTemplateBullets.length === 0) {
    return existing.trimEnd() + "\n";
  }

  // Append missing bullets at the end of the existing content
  const result = existing.trimEnd() + "\n" + missingTemplateBullets.join("\n") + "\n";
  return result;
}
