/**
 * src/core/skill-frontmatter.ts
 *
 * Single YAML-aware parser and serializer for Arsenal skill playbooks.
 * Built on the yaml@2 AST document parser to eliminate ad-hoc line-regex parsing.
 *
 * Reference Defect (Covered by this module):
 * Upstream skill playbooks frequently declare multiline folded ('>'), block ('|'),
 * or unquoted multiline scalars in YAML frontmatter.
 * In particular, upstream/Anthropic-Cybersecurity-Skills/skills/performing-kerberoasting-attack/SKILL.md
 * contains a folded 5-line description:
 *
 *   description: Perform Kerberoasting, a post-exploitation technique that enumerates
 *     Active Directory service accounts with Service Principal Names (SPNs), requests
 *     their Kerberos TGS tickets, and cracks the NTLM-encrypted tickets offline to recover
 *     service account credentials. Use during authorized red team engagements or penetration
 *     tests to assess AD privilege escalation and credential access risk from weak service
 *     account passwords.
 *
 * Prior naive line-regex parsers (/^description:\s*"?([^"\n\r]+)"?/m) captured only the first line:
 *   "Perform Kerberoasting, a post-exploitation technique that enumerates"
 * producing a truncated mid-sentence clause. This module parses the true YAML AST, joining
 * folded and block scalars, collapsing internal whitespace, stripping surrounding quotes,
 * and maintaining full prose fidelity.
 *
 * Separation of Concerns:
 * - Generic parsing (parseSkillDocument / parseSkillFrontmatter) permits incomplete or legacy
 *   upstream frontmatter without throwing or failing so existing consumers and routers function.
 * - Canonical validation (validateCanonicalSkillFrontmatter / validateSkillFrontmatter)
 *   validates against SKILL_FRONTMATTER_SCHEMA via Ajv 2020.
 */

import { parseDocument, stringify, Document } from "yaml";
import { validateSchema, SKILL_FRONTMATTER_SCHEMA } from "../schemas/validator.ts";
import type { ValidationResult } from "../schemas/validator.ts";

export type SkillDomain = "re" | "webapp" | "mobile" | "red";

export interface SkillFrontmatterMetadata {
  manifest_entry: string;
  [key: string]: unknown;
}

/** Canonical frontmatter representation matching SKILL_FRONTMATTER_SCHEMA */
export interface SkillFrontmatter {
  name: string;
  description: string;
  domain: SkillDomain;
  category: string;
  hide: boolean;
  license: string;
  metadata: SkillFrontmatterMetadata;
  [key: string]: unknown;
}

/** Generic frontmatter allowing partial or legacy fields from upstream sources */
export interface GenericSkillFrontmatter {
  name?: string;
  description?: string;
  domain?: string;
  category?: string;
  hide?: boolean;
  license?: string;
  metadata?: {
    manifest_entry?: string;
    upstream?: string;
    source_path?: string;
    source_sha256?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface FrontmatterSplit {
  /** Raw YAML frontmatter text (between the --- delimiters) */
  rawFrontmatter: string;
  /** Markdown body following the closing delimiter (bytes/characters preserved verbatim) */
  body: string;
}

export interface ParsedSkillDocument<T = GenericSkillFrontmatter> {
  /** Parsed and normalized frontmatter data */
  data: T;
  /** Markdown body following closing delimiter */
  body: string;
  /** Raw unparsed YAML frontmatter text */
  rawFrontmatter: string;
  /** Raw YAML Document instance for AST / node access */
  document: Document;
}

const CANONICAL_KEY_ORDER: readonly string[] = [
  "name",
  "description",
  "domain",
  "category",
  "hide",
  "license",
  "metadata",
];

/**
 * Splits a markdown document into raw frontmatter and body.
 * Preserves exact body bytes following the closing --- delimiter.
 */
export function splitFrontmatter(content: string): FrontmatterSplit | null {
  const normalized = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  if (!normalized.startsWith("---")) {
    return null;
  }

  const firstLineEnd = normalized.indexOf("\n");
  if (firstLineEnd === -1) {
    return null;
  }

  const firstLine = normalized.slice(0, firstLineEnd).trim();
  if (firstLine !== "---") {
    return null;
  }

  const rest = normalized.slice(firstLineEnd + 1);
  const match = rest.match(/(?:^|\r?\n)---\s*(?:\r?\n|$)/);
  if (!match || match.index === undefined) {
    return null;
  }

  const rawFrontmatter = rest.slice(0, match.index);
  const body = rest.slice(match.index + match[0].length);

  return { rawFrontmatter, body };
}

/**
 * Normalizes a description scalar:
 * - Joins folded and block scalar lines
 * - Collapses internal whitespace and newlines to single spaces
 * - Strips surrounding matching quotes
 */
export function normalizeDescription(raw: string): string {
  let s = String(raw).trim();
  while (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/\s+/g, " ");
}

/**
 * Bounds a description to maxLength (default 300).
 * Implements sentence boundary trimming if length > maxLength;
 * falls back to word boundary + explicit ellipsis '…' only when
 * no valid sentence boundary exists before the limit.
 * Does NOT pad with filler if under 40 characters (caller/validator reports errors).
 */
export function boundDescription(description: string, maxLength: number = 300): string {
  const normalized = normalizeDescription(description);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  // Find the last sentence boundary at or before maxLength.
  // Sentence ending punctuation (. ! ? or CJK 。！？) followed by whitespace or end of string.
  const sentenceRegex = /[.!?。！？](?:\s+|$)/g;
  let lastSentenceEnd = -1;
  let match: RegExpExecArray | null;

  while ((match = sentenceRegex.exec(normalized)) !== null) {
    const end = match.index + 1;
    if (end <= maxLength) {
      lastSentenceEnd = end;
    } else {
      break;
    }
  }

  if (lastSentenceEnd >= 40) {
    return normalized.slice(0, lastSentenceEnd).trim();
  }

  // Fall back to word boundary + explicit ellipsis
  const targetLen = maxLength - 1;
  const truncated = normalized.slice(0, targetLen);
  const lastSpace = truncated.lastIndexOf(" ");
  const wordBoundary = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
  const cleaned = wordBoundary.replace(/[,\s;:.-]+$/, "");
  return `${cleaned}…`;
}

/** Alias for boundDescription */
export const boundSkillDescription = boundDescription;

/**
 * Generic parser for a full Markdown skill document.
 * Returns parsed frontmatter data, exact body string, raw frontmatter text,
 * and the raw YAML Document AST.
 * Does not reject legacy or partial frontmatter.
 */
export function parseSkillDocument<T = GenericSkillFrontmatter>(
  content: string
): ParsedSkillDocument<T> | null {
  const split = splitFrontmatter(content);
  if (!split) {
    return null;
  }

  const doc = parseDocument(split.rawFrontmatter);
  let rawData: unknown = null;
  try {
    rawData = doc.toJS();
  } catch {
    return null;
  }

  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return null;
  }

  const data = { ...(rawData as Record<string, unknown>) };
  if (typeof data.description === "string") {
    data.description = normalizeDescription(data.description);
  }

  return {
    data: data as T,
    body: split.body,
    rawFrontmatter: split.rawFrontmatter,
    document: doc,
  };
}

/**
 * Generic parser for frontmatter from either full Markdown content or raw frontmatter YAML.
 */
export function parseSkillFrontmatter<T = GenericSkillFrontmatter>(
  input: string
): T | null {
  const normalized = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (normalized.startsWith("---")) {
    const parsed = parseSkillDocument<T>(normalized);
    return parsed ? parsed.data : null;
  }

  const doc = parseDocument(normalized);
  let rawData: unknown = null;
  try {
    rawData = doc.toJS();
  } catch {
    return null;
  }

  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return null;
  }

  const data = { ...(rawData as Record<string, unknown>) };
  if (typeof data.description === "string") {
    data.description = normalizeDescription(data.description);
  }

  return data as T;
}

function orderFrontmatterKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};

  for (const key of CANONICAL_KEY_ORDER) {
    if (key in obj) {
      if (
        key === "metadata" &&
        obj.metadata !== null &&
        typeof obj.metadata === "object" &&
        !Array.isArray(obj.metadata)
      ) {
        const metaObj = obj.metadata as Record<string, unknown>;
        const orderedMeta: Record<string, unknown> = {};
        if ("manifest_entry" in metaObj) {
          orderedMeta.manifest_entry = metaObj.manifest_entry;
        }
        const remainingMetaKeys = Object.keys(metaObj)
          .filter((k) => k !== "manifest_entry")
          .sort();
        for (const k of remainingMetaKeys) {
          orderedMeta[k] = metaObj[k];
        }
        ordered.metadata = orderedMeta;
      } else {
        ordered[key] = obj[key];
      }
    }
  }

  const remainingKeys = Object.keys(obj)
    .filter((k) => !CANONICAL_KEY_ORDER.includes(k))
    .sort();
  for (const key of remainingKeys) {
    ordered[key] = obj[key];
  }

  return ordered;
}

/**
 * Deterministic YAML frontmatter serializer with stable key ordering.
 * Sets lineWidth: 0 to prevent unintentional line folding.
 */
export function serializeSkillFrontmatter(
  data: SkillFrontmatter | Record<string, unknown>
): string {
  const ordered = orderFrontmatterKeys(data as Record<string, unknown>);
  return stringify(ordered, { lineWidth: 0 });
}

/**
 * Serializes a full Markdown skill document, preserving body bytes.
 */
export function serializeSkillDocument(
  frontmatter: SkillFrontmatter | Record<string, unknown>,
  body: string
): string {
  const yamlContent = serializeSkillFrontmatter(frontmatter);
  const formattedYaml = yamlContent.endsWith("\n") ? yamlContent : `${yamlContent}\n`;
  return `---\n${formattedYaml}---\n${body}`;
}

/**
 * Validates frontmatter against SKILL_FRONTMATTER_SCHEMA via Ajv.
 * Kept separate from generic parsing to allow legacy/upstream sources.
 */
export function validateCanonicalSkillFrontmatter(
  data: unknown
): ValidationResult<SkillFrontmatter> {
  return validateSchema<SkillFrontmatter>(SKILL_FRONTMATTER_SCHEMA.$id, data);
}

/** Alias for validateCanonicalSkillFrontmatter */
export const validateSkillFrontmatter = validateCanonicalSkillFrontmatter;
