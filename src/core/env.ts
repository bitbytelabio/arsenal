/**
 * Environment Allowlist & Isolation Engine
 * Implements contracts/cli.md §1.1 & Constitution §Principle I
 */

import * as process from "node:process";

const ALLOWED_ENV_VARS: Record<string, true> = {
  PATH: true,
  HOME: true,
  TMPDIR: true,
  USER: true,
  LANG: true,
  TERM: true,
};

export function getCleanBuildEnv(
  sourceEnv: Record<string, string | undefined> = process.env
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(sourceEnv)) {
    if (ALLOWED_ENV_VARS[key] && typeof val === "string") {
      clean[key] = val;
    }
  }
  return clean;
}

export function isAllowedEnvVar(key: string): boolean {
  return Boolean(ALLOWED_ENV_VARS[key]);
}
