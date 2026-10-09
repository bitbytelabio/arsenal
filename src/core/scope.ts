/**
 * Scope loader, validator, and attribution engine
 * Implements data-model.md & contracts/evidence-reporting.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { SCOPE_SCHEMA, validateSchema } from "../schemas/validator.ts";
import type { ValidationResult } from "../schemas/validator.ts";
import { sha256String } from "./hash.ts";

export type Domain = "re" | "webapp" | "mobile" | "red";
export type AuthStatus = "incomplete" | "granted" | "expired" | "revoked";

export interface ScopeAuth {
  status: AuthStatus;
  basis: string | null;
  reference: string | null;
  ready_for_act: boolean;
}

export interface ScopeWindow {
  start: string;
  end: string;
  timezone: string;
  allowed_hours?: string[];
}

export interface ScopeDocument {
  schema_version: 1;
  engagement_id: string;
  name: string;
  created_at: string;
  domain: Domain;
  auth: ScopeAuth;
  in_scope: string[];
  out_of_scope: string[];
  disallowed_actions: string[];
  window: ScopeWindow;
  environment_id?: string | null;
  charter_path?: string | null;
  charter_sha256?: string | null;
  budget_usd?: string | number | null;
}

export interface ScopeAttribution {
  status: "in_scope" | "out_of_scope" | "unknown";
  matchingSelector?: string;
  reason: string;
}

export function parseScope(jsonOrPath: string): ScopeDocument {
  let content = jsonOrPath;
  if (fs.existsSync(jsonOrPath)) {
    content = fs.readFileSync(path.resolve(jsonOrPath), "utf-8");
  }
  const parsed = JSON.parse(content) as unknown;
  const result: ValidationResult<ScopeDocument> = validateSchema<ScopeDocument>(
    SCOPE_SCHEMA.$id,
    parsed
  );
  if (!result.valid) {
    throw new Error(`Scope validation failed: ${result.errors.join(", ")}`);
  }

  const doc = result.data;

  // Semantic checks: start < end
  const startTime = new Date(doc.window.start).getTime();
  const endTime = new Date(doc.window.end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || startTime >= endTime) {
    throw new Error("Scope window invalid: start time must precede end time.");
  }

  // Budget checks: positive if provided
  if (doc.budget_usd !== null && doc.budget_usd !== undefined) {
    const num = Number(doc.budget_usd);
    if (Number.isNaN(num) || num <= 0) {
      throw new Error("Scope budget_usd invalid: must be a positive decimal number or null.");
    }
  }

  return doc;
}

function matchesSelector(target: string, selector: string): boolean {
  if (selector === "*" || selector === target) return true;

  // Handle URL or path wildcard: https://example.com/* or /api/*
  if (selector.endsWith("/*")) {
    const prefix = selector.slice(0, -1);
    if (target.startsWith(prefix) || target === selector.slice(0, -2)) return true;
  }

  if (selector.endsWith("*")) {
    const prefix = selector.slice(0, -1);
    if (target.startsWith(prefix)) return true;
  }

  if (selector.startsWith("*.")) {
    const suffix = selector.slice(1);
    if (target.endsWith(suffix) || target === selector.slice(2)) return true;
  }

  // URL-aware hostname matching:
  // e.g. target="https://api.example.com/v1/users" matching selector="api.example.com" or "*.example.com"
  try {
    const url = new URL(target);
    if (url.hostname === selector || url.host === selector) return true;
    if (selector.startsWith("*.")) {
      const suffix = selector.slice(1);
      if (url.hostname.endsWith(suffix) || url.hostname === selector.slice(2)) return true;
    }
  } catch {
    // not a valid URL
  }

  // Exact match
  return target === selector;
}

export function attributeTarget(target: string, scope: ScopeDocument): ScopeAttribution {
  const normalizedTarget = target.trim();
  if (normalizedTarget.length === 0) {
    return {
      status: "unknown",
      reason: "Target is empty or undefined.",
    };
  }

  // Exclusions win first
  for (const exclusion of scope.out_of_scope) {
    if (matchesSelector(normalizedTarget, exclusion)) {
      return {
        status: "out_of_scope",
        matchingSelector: exclusion,
        reason: `Target explicitly matches out-of-scope selector: '${exclusion}'`,
      };
    }
  }

  // Empty inclusion is incomplete scope, not universal permission
  if (scope.in_scope.length === 0) {
    return {
      status: "unknown",
      reason: "Scope has no defined in-scope selectors; empty inclusion is incomplete scope.",
    };
  }

  // Check inclusions
  for (const inclusion of scope.in_scope) {
    if (matchesSelector(normalizedTarget, inclusion)) {
      return {
        status: "in_scope",
        matchingSelector: inclusion,
        reason: `Target matches in-scope selector: '${inclusion}'`,
      };
    }
  }

  return {
    status: "unknown",
    reason: "Target did not match any in-scope or out-of-scope selectors.",
  };
}

export interface ActiveScopeResolution {
  scope: ScopeDocument | null;
  scopeSha256: string | null;
  scopePath: string | null;
}

export function resolveActiveScope(workspaceDir: string = process.cwd()): ActiveScopeResolution {
  const candidatePaths: string[] = [];

  if (process.env.ARSENAL_SCOPE_FILE) {
    candidatePaths.push(path.resolve(process.env.ARSENAL_SCOPE_FILE));
  }
  candidatePaths.push(path.resolve(workspaceDir, ".omp/scope.json"));
  candidatePaths.push(path.resolve(workspaceDir, ".omp/arsenal/scope.json"));

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, "utf-8");
        const doc = parseScope(raw);
        const hash = sha256String(raw);
        return { scope: doc, scopeSha256: hash, scopePath: candidate };
      } catch {
        // continue probing next candidate
      }
    }
  }

  return { scope: null, scopeSha256: null, scopePath: null };
}
