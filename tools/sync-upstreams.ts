#!/usr/bin/env bun
/**
 * Synchronize pinned upstream repositories and regenerate the corpus manifest.
 *
 * Default mode is read-only. `--write` is required to clone/fetch/check out
 * pinned revisions and run the corpus ingester. Every process invocation uses
 * an argument array; repository URLs and destinations come from the allowlisted
 * upstream registry, never from shell interpolation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { UPSTREAM_SOURCES, type UpstreamSource } from "../src/core/upstream-sources.ts";

interface SyncResult {
  source: string;
  destination: string;
  revision: string;
  status: "ready" | "updated" | "missing" | "failed";
  message: string;
}

interface Options {
  repoRoot: string;
  write: boolean;
  json: boolean;
}

function parseOptions(argv: string[]): Options {
  let repoRoot = process.cwd();
  let write = false;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--write") write = true;
    else if (arg === "--check") {
      if (write) throw new Error("--check cannot be combined with --write.");
    } else if (arg === "--json") json = true;
    else if (arg === "--repo-root") {
      const value = argv[++i];
      if (!value) throw new Error("--repo-root requires a path.");
      repoRoot = path.resolve(value);
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: bun tools/sync-upstreams.ts [--check|--write] [--json] [--repo-root <path>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown option '${arg}'.`);
    }
  }

  return { repoRoot, write, json };
}

function runGit(args: string[], cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

function isGitRepository(destination: string): boolean {
  return runGit(["rev-parse", "--git-dir"], destination).exitCode === 0;
}

function assertClean(destination: string, source: UpstreamSource): void {
  const status = runGit(["status", "--porcelain", "--untracked-files=all"], destination);
  if (status.exitCode !== 0) {
    throw new Error(`${source.id}: unable to inspect repository status: ${status.stderr || "git status failed"}`);
  }
  if (status.stdout.length > 0) {
    throw new Error(`${source.id}: upstream tree is dirty; refusing to update '${destination}'.`);
  }
}

function assertRemote(destination: string, source: UpstreamSource): void {
  const remote = runGit(["remote", "get-url", "origin"], destination);
  if (remote.exitCode !== 0 || remote.stdout !== source.url) {
    throw new Error(
      `${source.id}: origin mismatch; expected '${source.url}', observed '${remote.stdout || remote.stderr || "missing"}'.`
    );
  }
}

function assertRevisionAndSourceRoot(destination: string, source: UpstreamSource): void {
  const revision = runGit(["rev-parse", "HEAD"], destination);
  if (revision.exitCode !== 0 || revision.stdout !== source.revision) {
    throw new Error(
      `${source.id}: expected detached revision '${source.revision}', observed '${revision.stdout || revision.stderr || "unknown"}'.`
    );
  }
  const sourceRoot = path.join(destination, source.sourceRoot);
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`${source.id}: required source root '${source.sourceRoot}' is missing.`);
  }
}

function checkSource(repoRoot: string, source: UpstreamSource): SyncResult {
  const destination = path.join(repoRoot, "upstream", source.id);
  if (!fs.existsSync(destination)) {
    return {
      source: source.id,
      destination,
      revision: source.revision,
      status: "missing",
      message: "repository is not cloned",
    };
  }

  try {
    if (!isGitRepository(destination)) throw new Error("destination is not a Git repository");
    assertRemote(destination, source);
    assertClean(destination, source);
    assertRevisionAndSourceRoot(destination, source);
    return {
      source: source.id,
      destination,
      revision: source.revision,
      status: "ready",
      message: "pinned revision and source root are ready",
    };
  } catch (error) {
    return {
      source: source.id,
      destination,
      revision: source.revision,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

interface RepositoryState {
  source: UpstreamSource;
  destination: string;
  existed: boolean;
  originalHead: string | null;
}

function captureRepositoryState(repoRoot: string, source: UpstreamSource): RepositoryState {
  const destination = path.join(repoRoot, "upstream", source.id);
  if (!fs.existsSync(destination)) {
    return { source, destination, existed: false, originalHead: null };
  }
  if (!isGitRepository(destination)) throw new Error(`${source.id}: destination is not a Git repository.`);
  assertRemote(destination, source);
  assertClean(destination, source);
  const head = runGit(["rev-parse", "HEAD"], destination);
  if (head.exitCode !== 0 || !head.stdout) throw new Error(`${source.id}: unable to read current revision.`);
  return { source, destination, existed: true, originalHead: head.stdout };
}

function prepareRepository(state: RepositoryState): void {
  const { source, destination } = state;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!state.existed) {
    const clone = Bun.spawnSync(["git", "clone", "--no-checkout", source.url, destination], {
      cwd: path.dirname(destination),
    });
    if (clone.exitCode !== 0) {
      throw new Error(`${source.id}: clone failed: ${clone.stderr.toString().trim()}`);
    }
  }
  if (!isGitRepository(destination)) throw new Error(`${source.id}: destination is not a Git repository.`);
  assertRemote(destination, source);
  assertClean(destination, source);
  const fetch = runGit(["fetch", "--prune", "origin", source.revision], destination);
  if (fetch.exitCode !== 0) {
    throw new Error(`${source.id}: fetch of pinned revision failed: ${fetch.stderr || fetch.stdout}`);
  }
}

function checkoutPrepared(state: RepositoryState): void {
  const checkout = runGit(["checkout", "--detach", state.source.revision], state.destination);
  if (checkout.exitCode !== 0) {
    throw new Error(`${state.source.id}: checkout of pinned revision failed: ${checkout.stderr || checkout.stdout}`);
  }
  assertRevisionAndSourceRoot(state.destination, state.source);
}

function rollbackRepositories(states: readonly RepositoryState[]): void {
  for (const state of states) {
    try {
      if (!state.existed) {
        fs.rmSync(state.destination, { recursive: true, force: true });
      } else if (state.originalHead && isGitRepository(state.destination)) {
        runGit(["checkout", "--detach", state.originalHead], state.destination);
      }
    } catch {
      // Preserve the original failure; rollback is best effort and is reported by the caller.
    }
  }
}


function runIngestion(repoRoot: string): void {
  const result = Bun.spawnSync(["bun", "--no-env-file", "run", "tools/internalize-corpus.ts"], {
    cwd: repoRoot,
  });
  if (result.exitCode !== 0) {
    throw new Error(`corpus ingestion failed:\n${result.stderr.toString().trim() || result.stdout.toString().trim()}`);
  }
}

export function syncUpstreams(options: Options): { results: SyncResult[]; ingested: boolean } {
  if (!options.write) {
    const results = UPSTREAM_SOURCES.map((source) => checkSource(options.repoRoot, source));
    return {
      results,
      ingested: false,
    };
  }

  const states: RepositoryState[] = [];
  try {
    for (const source of UPSTREAM_SOURCES) states.push(captureRepositoryState(options.repoRoot, source));
    for (const state of states) prepareRepository(state);
    for (const state of states) checkoutPrepared(state);
    runIngestion(options.repoRoot);
    return {
      results: states.map((state) => ({
        source: state.source.id,
        destination: state.destination,
        revision: state.source.revision,
        status: "updated",
        message: "cloned/fetched, checked out, ingested, and reconciled manifest revision",
      })),
      ingested: true,
    };
  } catch (error) {
    rollbackRepositories(states);
    const message = error instanceof Error ? error.message : String(error);
    return {
      results: states.map((state) => ({
        source: state.source.id,
        destination: state.destination,
        revision: state.source.revision,
        status: "failed",
        message,
      })),
      ingested: false,
    };
  }
}


if (import.meta.main || process.argv[1]?.endsWith("sync-upstreams.ts")) {
  try {
    const options = parseOptions(process.argv.slice(2));
    const result = syncUpstreams(options);
    const failed = result.results.filter((item) => item.status === "failed" || item.status === "missing");
    if (options.json) {
      console.log(JSON.stringify({ mode: options.write ? "write" : "check", ingested: result.ingested, results: result.results }, null, 2));
    } else {
      for (const item of result.results) console.log(`[${item.status}] ${item.source}: ${item.message}`);
      if (result.ingested) console.log("Corpus ingestion completed; MANIFEST.json was regenerated from the pinned upstream trees.");
    }
    process.exit(failed.length > 0 ? 1 : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
