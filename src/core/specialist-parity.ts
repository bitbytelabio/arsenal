/**
 * src/core/specialist-parity.ts
 *
 * Specialist-definition contract checks and category parity
 * (contracts/specialist-definition.md §1–§2; FR-009, FR-010, SC-007, SC-008).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DOMAINS, loadRoutingTables, type SkillDomain } from "./skill-routing.ts";
import { validateSchema } from "../schemas/validator.ts";
import type { SpecialistHandoff } from "./types.ts";

export interface HandoffValidationResult {
  valid: boolean;
  handoff: SpecialistHandoff | null;
  errors: string[];
  retryPrompt: string | null;
}

export function validateSpecialistHandoff(rawPayload: unknown): HandoffValidationResult {
  const schemaId = "https://github.com/bitbytelabio/arsenal/schemas/specialist-handoff.json";
  const res = validateSchema<SpecialistHandoff>(schemaId, rawPayload);
  if (res.valid) {
    return {
      valid: true,
      handoff: rawPayload as SpecialistHandoff,
      errors: [],
      retryPrompt: null,
    };
  }
  const errorDetails = res.errors.join("; ");
  const retryPrompt = `Your task handoff failed schema validation with the following errors: ${errorDetails}. Please correct the payload and resubmit valid JSON conforming to the Specialist Handoff Schema.`;
  return {
    valid: false,
    handoff: null,
    errors: res.errors,
    retryPrompt,
  };
}

export const SPECIALIST_FILE: Readonly<Record<SkillDomain, string>> = Object.freeze({
  re: "arsenal-reverse.md",
  webapp: "arsenal-web.md",
  mobile: "arsenal-mobile.md",
  red: "arsenal-redteam.md",
});

export const VERIFIER_FILE = "arsenal-verifier.md";

/** Headings required on each domain specialist definition. */
export const REQUIRED_DOMAIN_HEADINGS: readonly string[] = Object.freeze([
  "Owned Categories",
  "Retrieval",
  "Governing Baseline",
  "Handoff",
  "Capability Gap Protocol",
]);

/** Headings required on the verifier definition. */
export const REQUIRED_VERIFIER_HEADINGS: readonly string[] = Object.freeze([
  "Handoff",
  "Capability Gap Protocol",
]);

export interface ParityViolation {
  invariant: string;
  domain: SkillDomain | null;
  subject: string;
  message: string;
}

export function agentsDir(repoRoot = "."): string {
  return path.resolve(repoRoot, "plugin/agents");
}

function readAgent(repoRoot: string, file: string): string | null {
  const p = path.join(agentsDir(repoRoot), file);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null;
}

/** Collects the `## <heading>` phrases present in a definition. */
export function headings(markdown: string): string[] {
  return [...markdown.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]!.trim());
}

export function hasHeading(markdown: string, phrase: string): boolean {
  return headings(markdown).some((h) => h.includes(phrase));
}

/**
 * Parses the categories listed under `## Owned Categories`, one per line as
 * `- \`<category>\``. Returns null when the heading is absent.
 */
export function parseOwnedCategories(markdown: string): string[] | null {
  const lines = markdown.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+.*Owned Categories/.test(lines[i]!)) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s+/.test(line)) break;
    const m = /^-\s+`([^`]+)`\s*$/.exec(line.trim());
    if (m) out.push(m[1]!);
  }
  return out;
}

/**
 * Evaluates P-1..P-4 plus the required-heading assertions.
 * A missing routing table is reported by the caller; here it is skipped.
 */
export function evaluateSpecialistParity(repoRoot = "."): ParityViolation[] {
  const violations: ParityViolation[] = [];
  const tables = loadRoutingTables(repoRoot);

  const declaredByDomain = new Map<SkillDomain, string[]>();
  const declaredUnion = new Set<string>();
  for (const domain of DOMAINS) {
    const table = tables[domain];
    if (!table) continue;
    const cats = [...(table.categories ?? [])];
    declaredByDomain.set(domain, cats);
    for (const c of cats) declaredUnion.add(c);
  }

  const claimedUnion = new Set<string>();
  let sawTable = declaredByDomain.size > 0;

  for (const domain of DOMAINS) {
    const file = SPECIALIST_FILE[domain];
    const md = readAgent(repoRoot, file);
    if (md === null) {
      violations.push({
        invariant: "P-2",
        domain,
        subject: file,
        message: `missing specialist definition 'plugin/agents/${file}'`,
      });
      continue;
    }

    for (const phrase of REQUIRED_DOMAIN_HEADINGS) {
      if (!hasHeading(md, phrase)) {
        violations.push({
          invariant: "P-1",
          domain,
          subject: file,
          message: `specialist '${file}' is missing required heading phrase '${phrase}'`,
        });
      }
    }

    const owned = parseOwnedCategories(md);
    if (owned === null) continue;
    for (const c of owned) claimedUnion.add(c);

    const declared = declaredByDomain.get(domain);
    if (declared) {
      const ownedSet = new Set(owned);
      for (const c of owned) {
        if (!declared.includes(c)) {
          violations.push({
            invariant: "P-2",
            domain,
            subject: `${file}:${c}`,
            message: `specialist '${file}' claims category '${c}' not declared by presets/${domain}/routing.json`,
          });
        }
      }
      for (const c of declared) {
        if (!ownedSet.has(c)) {
          violations.push({
            invariant: "P-2",
            domain,
            subject: `${file}:${c}`,
            message: `specialist '${file}' does not claim declared category '${c}'`,
          });
        }
      }
    }
  }

  // P-1: union equality.
  if (sawTable) {
    for (const c of claimedUnion) {
      if (!declaredUnion.has(c)) {
        violations.push({
          invariant: "P-1",
          domain: null,
          subject: c,
          message: `category '${c}' is claimed by a specialist but declared by no routing table`,
        });
      }
    }
    for (const c of declaredUnion) {
      if (!claimedUnion.has(c)) {
        violations.push({
          invariant: "P-1",
          domain: null,
          subject: c,
          message: `category '${c}' is declared by a routing table but owned by no specialist`,
        });
      }
    }
  }

  // P-4: arsenal-verifier owns no category.
  const verifier = readAgent(repoRoot, VERIFIER_FILE);
  if (verifier !== null) {
    for (const phrase of REQUIRED_VERIFIER_HEADINGS) {
      if (!hasHeading(verifier, phrase)) {
        violations.push({
          invariant: "P-4",
          domain: null,
          subject: VERIFIER_FILE,
          message: `verifier definition '${VERIFIER_FILE}' is missing required heading phrase '${phrase}'`,
        });
      }
    }
    const owned = parseOwnedCategories(verifier);
    if (owned && owned.length > 0) {
      violations.push({
        invariant: "P-4",
        domain: null,
        subject: `${VERIFIER_FILE}:${owned.join(",")}`,
        message: `arsenal-verifier owns no domain category but lists '${owned.join(", ")}'`,
      });
    }
  }

  return violations;
}
