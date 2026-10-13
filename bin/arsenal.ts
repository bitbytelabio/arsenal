#!/usr/bin/env bun
/**
 * Arsenal Security Engagement Harness CLI
 * Entrypoint: bin/arsenal.ts
 */

import * as fs from "node:fs";
import { parseArgs } from "node:util";
import * as path from "node:path";
import * as process from "node:process";
import { dispatch as routeCommand } from "../src/cli/router.ts";
import { VERSION } from "../src/core/version.ts";

export const EXIT_CODES = {
  SUCCESS: 0,
  CHECK_FAILURE: 1,
  CLI_USAGE_ERROR: 2,
  MUTATION_REFUSED: 3,
  INTEGRITY_COMPROMISED: 4,
  ENVIRONMENT_UNAVAILABLE: 5,
} as const;

export interface JsonEnvelope<T = unknown> {
  $schema: string;
  version: string;
  command: string;
  status: "success" | "failure";
  exitCode: number;
  timestamp: string;
  mode: "preview" | "write" | "check";
  data: T;
  warnings: string[];
  errors: string[];
}

export function createJsonEnvelope<T = unknown>(
  command: string,
  exitCode: number,
  mode: "preview" | "write" | "check",
  data: T,
  warnings: string[] = [],
  errors: string[] = []
): JsonEnvelope<T> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    version: VERSION,
    command,
    status: exitCode === 0 ? "success" : "failure",
    exitCode,
    timestamp: new Date().toISOString(),
    mode,
    data,
    warnings,
    errors,
  };
}

export function emitJson(envelope: JsonEnvelope): void {
  console.log(JSON.stringify(envelope, null, 2));
}

// Global flag parsing options
const globalOptions = {
  json: { type: "boolean", default: false },
  write: { type: "boolean", default: false },
  force: { type: "boolean", default: false },
  check: { type: "boolean", default: false },
  scope: { type: "string" },
  profile: { type: "string" },
  repo: { type: "string" },
  preset: { type: "string" },
  name: { type: "string" },
  out: { type: "string" },
  server: { type: "string" },
  file: { type: "string" },
  metadata: { type: "string" },
  source: { type: "string" },
  live: { type: "boolean", default: false },
  fix: { type: "boolean", default: false },
  schema: { type: "boolean", default: false },
  drift: { type: "boolean", default: false },
  mcp: { type: "boolean", default: false },
  tools: { type: "boolean", default: false },
  smoke: { type: "boolean", default: false },
  hint: { type: "string" },
  scenario: { type: "string" },
  workspace: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
  target: { type: "string" },
  from: { type: "string" },
  slug: { type: "string" },
  domain: { type: "string" },
  "prompt-file": { type: "string" },
  "check-determinism": { type: "boolean", default: false },
  language: { type: "boolean", default: false },
  domains: { type: "boolean", default: false },
  "apply-tier-a": { type: "boolean", default: false },
  "apply-alias": { type: "string" },
  map: { type: "string" },
  "case-root": { type: "string" },
  strict: { type: "boolean", default: false },
  "verify-hashes": { type: "boolean", default: false },
  format: { type: "string" },
  apk: { type: "string" },
  uri: { type: "string" },
  dir: { type: "string" },
  "min-severity": { type: "string" },
  exclude: { type: "string" },
  auth: { type: "string" },
  expire: { type: "string" },
  depth: { type: "string" },
  phase: { type: "string" },
  finding: { type: "string" },
  oracle: { type: "string" },
  evidence: { type: "string" },
  title: { type: "string" },
  severity: { type: "string" },
  location: { type: "string" },
  cwe: { type: "string" },
  remediation: { type: "string" },
  output: { type: "string" },
  "safe-mode": { type: "boolean", default: true },
  verbose: { type: "boolean", default: false },
  show: { type: "boolean", default: false },
} as const;

export async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseArgs({
      args: rawArgs,
      options: globalOptions,
      allowPositionals: true,
      strict: false,
    });
  } catch (err: unknown) {
    const isJson = rawArgs.includes("--json");
    const msg = (err instanceof Error ? err.message : String(err)) || "Invalid CLI arguments";
    if (isJson) {
      emitJson(
        createJsonEnvelope(
          rawArgs.join(" "),
          EXIT_CODES.CLI_USAGE_ERROR,
          "preview",
          {},
          [],
          [msg]
        )
      );
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(EXIT_CODES.CLI_USAGE_ERROR);
  }

  const { values, positionals } = parsed;
  const isJson = Boolean(values.json);
  const repoRoot =
    typeof values.repo === "string"
      ? path.resolve(values.repo)
      : fs.existsSync(path.join(process.cwd(), "src/corpus"))
        ? process.cwd()
        : path.resolve(import.meta.dir, "..");
  const profileDir =
    typeof values.profile === "string"
      ? path.resolve(values.profile)
      : typeof values.dir === "string"
        ? path.resolve(values.dir)
        : path.join(process.env.HOME ?? "~", ".omp/profiles/arsenal/agent");
  const mode: "preview" | "write" | "check" = values.check
    ? "check"
    : values.write
      ? "write"
      : "preview";

  if (positionals.length === 0 || values.help) {
    if (isJson) {
      emitJson(
        createJsonEnvelope("arsenal", EXIT_CODES.SUCCESS, mode, {
          families: [
            "build",
            "profile",
            "context",
            "init",
            "scope",
            "plugin",
            "doctor",
            "tools",
            "evidence",
            "skills",
            "mcp",
            "vendor",
            "case",
          ],
        })
      );
    } else {
      console.log(`Arsenal Security Engagement Harness v${VERSION}
Usage: arsenal <family> <command> [options]

Families:
  build      Compile SSOT plugin distribution
  profile    Manage operator profile (install, verify)
  context    Inspect and verify engagement context layers
  init       Scaffold or check target engagement repository
  scope      Inspect engagement authorization and scope
  plugin     Plugin lifecycle commands (link, pack)
  doctor     Run environment and system health diagnostics
  tools      Scan and check security binaries
  evidence   Capture, import, and audit cryptographic evidence
  skills     Route, index, and check guidance playbooks
  mcp        Manage and verify MCP tool bridges
  vendor     Vendor corpus sync and audit
  case       Review and audit case integrity and evidence graph

Global Options:
  --json                  Output in structured JSON envelope
  --write                 Authorize filesystem writes / modifications
  --force                 Force overwrite / clobber unmanaged content
  --check                 Report-only check mode (never mutates)
  --profile <path>        Path to operator profile directory
  --repo <path>           Path to engagement target repository
  --scope <profile|project> Target configuration scope (profile or project; default profile)
  --preset <preset>       Filter/scope by preset or domain
  --target <id>           Target skill identifier or domain:slug group
  --from <path>           Input file path for skill creation/update
  --slug <slug>           Skill technique slug
  --domain <domain>       Skill domain (re, webapp, mobile, red)
  --prompt-file <path>    Prompt instruction input file
  --check-determinism     Verify byte-for-byte build reproducibility
  --language              Run language / non-English residue sweep
  --apply-tier-a          Apply Tier A deduplication merges
  --apply-alias <key>     Apply Tier B deduplication alias group
  --map <path>            Identifier rename map file
  --case-root <path>      Path to case workspace root directory
  --strict                Treat warnings as a failed review
  --verify-hashes         Verify SHA-256 content_hash values against artifact_path
  --format <fmt>          Output format (markdown, json)
  -h, --help              Show usage information
`);
    }
    process.exit(EXIT_CODES.SUCCESS);
  }

  const [family, ...restPositionals] = positionals;
  const subCommand = restPositionals[0];

  try {
    const exitCode = await routeCommand({
      family: family ?? "",
      subCommand,
      positionals: restPositionals.slice(1),
      values: values as Record<string, unknown>,
      rawArgs,
      repoRoot,
      profileDir,
      mode,
      isJson,
    });
    process.exit(exitCode);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isJson) {
      emitJson(
        createJsonEnvelope(
          rawArgs.join(" "),
          EXIT_CODES.CLI_USAGE_ERROR,
          mode,
          {},
          [],
          [msg]
        )
      );
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(EXIT_CODES.CLI_USAGE_ERROR);
  }
}

if (import.meta.main) {
  void main();
}
