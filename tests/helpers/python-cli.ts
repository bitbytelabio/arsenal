import * as path from "node:path";

/** Published CLI exit-code contract, not an imported implementation detail. */
export const EXIT_CODES = {
  SUCCESS: 0,
  CHECK_FAILURE: 1,
  CLI_USAGE_ERROR: 2,
  MUTATION_REFUSED: 3,
  INTEGRITY_COMPROMISED: 4,
  ENVIRONMENT_UNAVAILABLE: 5,
} as const;

/** Drive the installed Python CLI from existing consumer scenarios. */
export async function runCommandContext(ctx: {
  rawArgs: string[];
  [key: string]: unknown;
  repoRoot: string;
  profileDir: string;
  mode: string;
  isJson: boolean;
}): Promise<number> {
  const args = [...ctx.rawArgs, "--repo", ctx.repoRoot, "--profile", ctx.profileDir];
  if (ctx.mode === "write" && !args.includes("--write")) args.push("--write");
  if (ctx.mode === "check" && !args.includes("--check")) args.push("--check");
  if (ctx.isJson && !args.includes("--json")) args.push("--json");
  const proc = Bun.spawnSync(["uv", "run", "--locked", "arsenal", ...args], {
    cwd: path.resolve(import.meta.dir, "../.."),
  });
  if (proc.stdout.length) console.log(proc.stdout.toString().trimEnd());
  if (proc.stderr.length) console.error(proc.stderr.toString().trimEnd());
  return proc.exitCode;
}
