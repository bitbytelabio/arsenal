/**
 * src/core/skill-naming.ts
 *
 * Identifier policy and word-boundary safe slug derivation for Arsenal skills.
 * Conforms to contracts/skill-standard.md §1, research.md R1, and Task T006.
 *
 * Removes the legacy defect where slugs were blindly truncated via `slug.substring(0, 40)`
 * (e.g. `mobile-xalgorix-exploiting-insecure-data-storage-in-mobi`), replacing it with
 * deterministic, word-boundary-safe whole-word pruning and declared abbreviations.
 */

export type SkillDomain = "re" | "webapp" | "mobile" | "red";

export const SKILL_DOMAINS: readonly SkillDomain[] = Object.freeze([
  "re",
  "webapp",
  "mobile",
  "red",
]);

/**
 * Standard skill identifier grammar:
 * ^(re|webapp|mobile|red)-[a-z0-9]+(-[a-z0-9]+)*$
 * Max length: 64 characters.
 */
export const SKILL_ID_PATTERN = /^(re|webapp|mobile|red)-[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_SKILL_ID_LENGTH = 64;

/**
 * Router identifier pattern (exempt from the standard domain prefix format).
 */
export const ROUTER_ID_PATTERN = /^arsenal-(re|webapp|mobile|red)-router$/;

/**
 * Forbidden vendor tokens per contracts/skill-standard.md §1.2.
 * Matched case-insensitively as whole hyphen-delimited segments.
 */
export const FORBIDDEN_VENDOR_SEGMENTS: readonly string[] = Object.freeze([
  "anthropic",
  "xalgorix",
  "claudered",
  "claude-red",
  "revskill",
  "reverse-skill",
  "strix",
]);

/**
 * Declared abbreviation table per contracts/skill-standard.md §1.3 and research.md R1.
 * Only permitted abbreviation source.
 */
export const DECLARED_ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
  "reverse-engineering": "reverse",
  vulnerability: "vuln",
  implementing: "impl",
  assessment: "assess",
  configuration: "config",
});

/**
 * Internal multi-segment and single-segment forbidden tokens breakdown.
 */
const FORBIDDEN_MULTI_SEGMENTS: readonly (readonly string[])[] = [
  ["claude", "red"],
  ["reverse", "skill"],
];

const FORBIDDEN_SINGLE_SEGMENTS: Readonly<Record<string, true>> = Object.freeze({
  anthropic: true,
  xalgorix: true,
  claudered: true,
  revskill: true,
  strix: true,
});

/**
 * Validates whether a domain string is one of the four admitted skill domains.
 */
export function isValidSkillDomain(domain: string): domain is SkillDomain {
  return (SKILL_DOMAINS as readonly string[]).includes(domain);
}

/**
 * Checks whether an identifier is an arsenal router identifier.
 */
export function isRouterSkillId(id: string): boolean {
  return ROUTER_ID_PATTERN.test(id) && id.length <= MAX_SKILL_ID_LENGTH;
}

/**
 * Tests whether an identifier contains any forbidden vendor token
 * as a whole hyphen-delimited segment (case-insensitively).
 */
export function containsForbiddenVendorToken(id: string): boolean {
  const segs = id.toLowerCase().split("-").filter(Boolean);

  for (let i = 0; i < segs.length - 1; i++) {
    for (const [w1, w2] of FORBIDDEN_MULTI_SEGMENTS) {
      if (segs[i] === w1 && segs[i + 1] === w2) {
        return true;
      }
    }
  }

  for (const seg of segs) {
    if (FORBIDDEN_SINGLE_SEGMENTS[seg]) {
      return true;
    }
  }

  return false;
}

/**
 * Removes forbidden vendor segments from a hyphen-separated slug.
 * Operates on whole segments, preserving technique semantics.
 */
export function removeForbiddenVendorSegments(slug: string): string {
  let segs = slug.toLowerCase().split("-").filter(Boolean);
  let changed = true;

  while (changed) {
    changed = false;

    // Check multi-segment tokens first (claude-red, reverse-skill)
    for (let i = 0; i < segs.length - 1; i++) {
      for (const [w1, w2] of FORBIDDEN_MULTI_SEGMENTS) {
        if (segs[i] === w1 && segs[i + 1] === w2) {
          segs.splice(i, 2);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }

    if (changed) continue;

    // Check single segment tokens (anthropic, xalgorix, claudered, revskill, strix)
    for (let i = 0; i < segs.length; i++) {
      if (FORBIDDEN_SINGLE_SEGMENTS[segs[i]!]) {
        segs.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return segs.join("-");
}

/**
 * Substitutes whole words in a slug using the declared abbreviation table.
 */
export function applyDeclaredAbbreviations(slug: string): string {
  const segs = slug.toLowerCase().split("-").filter(Boolean);
  const result: string[] = [];

  for (let i = 0; i < segs.length; i++) {
    const cur = segs[i]!;
    const next = segs[i + 1];

    if (cur === "reverse" && next === "engineering") {
      result.push("reverse");
      i++; // Skip 'engineering'
    } else if (cur in DECLARED_ABBREVIATIONS) {
      result.push(DECLARED_ABBREVIATIONS[cur]!);
    } else {
      result.push(cur);
    }
  }

  return result.join("-");
}

/**
 * Checks whether an identifier conforms strictly to the skill identifier policy.
 */
export function isValidSkillId(id: string): boolean {
  if (isRouterSkillId(id)) {
    return true;
  }
  if (id.length > MAX_SKILL_ID_LENGTH) {
    return false;
  }
  if (!SKILL_ID_PATTERN.test(id)) {
    return false;
  }
  if (containsForbiddenVendorToken(id)) {
    return false;
  }
  return true;
}

/**
 * Validates a skill identifier and returns descriptive violation messages.
 */
export function validateSkillId(id: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (isRouterSkillId(id)) {
    return { valid: true, errors: [] };
  }

  if (id.length > MAX_SKILL_ID_LENGTH) {
    errors.push(`Identifier exceeds maximum length of ${MAX_SKILL_ID_LENGTH} characters (received ${id.length})`);
  }

  if (!SKILL_ID_PATTERN.test(id)) {
    const domainPrefix = id.split("-")[0];
    if (!domainPrefix || !isValidSkillDomain(domainPrefix)) {
      errors.push(`Identifier must start with a valid domain prefix (re, webapp, mobile, red)`);
    } else {
      errors.push(`Identifier does not match grammar ^(re|webapp|mobile|red)-[a-z0-9]+(-[a-z0-9]+)*$`);
    }
  }

  if (containsForbiddenVendorToken(id)) {
    errors.push(`Identifier contains forbidden vendor token(s) as a whole segment`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Parses an identifier into domain and capability slug.
 * Returns null if the identifier does not match standard grammar.
 */
export function parseSkillId(id: string): { domain: SkillDomain; slug: string } | null {
  if (!SKILL_ID_PATTERN.test(id)) {
    return null;
  }
  const dashIndex = id.indexOf("-");
  const domain = id.substring(0, dashIndex) as SkillDomain;
  const slug = id.substring(dashIndex + 1);
  return { domain, slug };
}

/**
 * Derives a normalized capability slug from a raw technique slug according to
 * contracts/skill-standard.md §1.3 steps 1-5.
 *
 * Guarantees:
 * - Truncation inside a word is IMPOSSIBLE.
 * - If the full identifier exceeds 64 characters, whole trailing words are dropped.
 * - If still over limit, words are substituted via the declared abbreviation table.
 * - Upstream slugs that fit are preserved in full without arbitrary cutoff.
 */
export function deriveSkillSlug(techniqueSlug: string, domain?: SkillDomain): string {
  // Step 1 & 2: Lowercase, kebab-case, collapse repeated separators, strip leading/trailing
  let slug = techniqueSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // Strip accidental domain prefix if caller passed full id as technique slug
  if (domain && slug.startsWith(`${domain}-`)) {
    slug = slug.substring(domain.length + 1);
  }

  // Step 3: Remove forbidden vendor segments and redundant separators
  slug = removeForbiddenVendorSegments(slug);

  const domainLen = domain ? domain.length + 1 : 0;
  const maxTotalLen = MAX_SKILL_ID_LENGTH;

  const currentTotalLen = (words: readonly string[]) => domainLen + words.join("-").length;

  let words = slug.split("-").filter(Boolean);
  if (words.length === 0) {
    return "";
  }

  // Step 4: If the full identifier exceeds 64 characters, drop whole trailing words.
  // Never truncate inside a word. Keep at least 1 word.
  while (words.length > 1 && currentTotalLen(words) > maxTotalLen) {
    words.pop();
  }

  // Step 5: If it still exceeds 64 characters, substitute whole words using declared abbreviation table
  if (currentTotalLen(words) > maxTotalLen) {
    const joined = words.join("-");
    const abbreviated = applyDeclaredAbbreviations(joined);
    words = abbreviated.split("-").filter(Boolean);

    // If still over 64 characters after abbreviations, drop whole trailing words again
    while (words.length > 1 && currentTotalLen(words) > maxTotalLen) {
      words.pop();
    }
  }

  return words.join("-");
}

/**
 * Derives a canonical, compliant skill identifier: `<domain>-<capability-slug>`
 * adhering strictly to contracts/skill-standard.md §1.
 */
export function deriveSkillId(domain: SkillDomain, techniqueSlug: string): string {
  if (!isValidSkillDomain(domain)) {
    throw new Error(`Invalid skill domain '${domain}'. Must be one of: ${SKILL_DOMAINS.join(", ")}`);
  }

  const slug = deriveSkillSlug(techniqueSlug, domain);
  if (!slug) {
    throw new Error(`Cannot derive a valid capability slug from '${techniqueSlug}' for domain '${domain}'`);
  }

  const id = `${domain}-${slug}`;

  // Sanity assert invariants
  if (id.length > MAX_SKILL_ID_LENGTH && slug.includes("-")) {
    // Should never happen due to word dropping, but enforce contract
    const words = slug.split("-");
    while (words.length > 1 && `${domain}-${words.join("-")}`.length > MAX_SKILL_ID_LENGTH) {
      words.pop();
    }
    return `${domain}-${words.join("-")}`;
  }

  return id;
}
