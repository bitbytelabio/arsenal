/**
 * evidence_exec Registered Tool
 * Implements contracts/evidence-reporting.md §1.2 & contracts/process-execution.md
 * Executes binaries directly without shell, tapping raw stdout/stderr streams with timeout enforcement.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256Bytes } from "../../src/core/hash.ts";
import { boundAndStore } from "../../src/core/bounding.ts";

export interface EvidenceExecInput {
  argv: string[];
  cwd?: string;
  stdin_artifact_id?: string;
  timeout_ms?: number;
  env?: Record<string, string>;
}

export interface EvidenceExecOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdout_artifact?: { path: string; sha256: string; byte_length: number };
  stderr_artifact?: { path: string; sha256: string; byte_length: number };
  timed_out?: boolean;
  timeout_ms?: number;
  duration_ms?: number;
  capture_gap?: string | null;
}

export async function executeEvidenceCommand(
  input: EvidenceExecInput,
  evidenceDir: string
): Promise<EvidenceExecOutput> {
  if (!input.argv || input.argv.length === 0) {
    throw new Error("evidence_exec: 'argv' must be a non-empty array of strings.");
  }

  const timeoutMs = input.timeout_ms && input.timeout_ms > 0 ? input.timeout_ms : 30_000;
  const startTime = Date.now();

  const rawDir = path.join(evidenceDir, "raw");
  fs.mkdirSync(rawDir, { recursive: true, mode: 0o700 });

  let stdinData: Uint8Array | undefined;
  if (input.stdin_artifact_id) {
    // If stdin artifact provided, load it
    const stdinPath = path.join(rawDir, `${input.stdin_artifact_id}.bin`);
    if (fs.existsSync(stdinPath)) {
      stdinData = fs.readFileSync(stdinPath);
    }
  }

  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  const proc = Bun.spawn(input.argv, {
    cwd: input.cwd ? path.resolve(input.cwd) : process.cwd(),
    stdin: stdinData ? new Response(stdinData).body : undefined,
    env: input.env ? { ...process.env, ...input.env } : process.env,
  });

  timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill(15); // SIGTERM
      proc.kill(9);  // SIGKILL
    } catch {
      // process already dead
    }
  }, timeoutMs);

  let stdoutBuf: ArrayBuffer;
  let stderrBuf: ArrayBuffer;
  let rawExitCode: number;

  try {
    const [out, err] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).arrayBuffer(),
    ]);
    stdoutBuf = out;
    stderrBuf = err;
    rawExitCode = await proc.exited;
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startTime;
  const exitCode = timedOut ? 124 : rawExitCode;
  const captureGap = timedOut ? `Command execution timed out after ${timeoutMs}ms` : null;

  const stdoutBytes = new Uint8Array(stdoutBuf);
  const stderrBytes = new Uint8Array(stderrBuf);

  // Compute hashes and persist raw artifacts
  const stdoutHash = sha256Bytes(stdoutBytes);
  const stderrHash = sha256Bytes(stderrBytes);

  const stdoutPath = path.join(rawDir, `${stdoutHash}.txt`);
  const stderrPath = path.join(rawDir, `${stderrHash}.txt`);

  fs.writeFileSync(stdoutPath, stdoutBytes, { mode: 0o600 });
  fs.writeFileSync(stderrPath, stderrBytes, { mode: 0o600 });

  // Pass stdout through bounding logic for LLM conversational context delivery
  const boundStdout = boundAndStore(stdoutBytes, evidenceDir, "txt");
  const boundStderr = boundAndStore(stderrBytes, evidenceDir, "txt");

  return {
    exitCode,
    stdout: boundStdout.content,
    stderr: boundStderr.content,
    stdout_artifact: {
      path: `evidence/raw/${stdoutHash}.txt`,
      sha256: stdoutHash,
      byte_length: stdoutBytes.byteLength,
    },
    stderr_artifact: {
      path: `evidence/raw/${stderrHash}.txt`,
      sha256: stderrHash,
      byte_length: stderrBytes.byteLength,
    },
    timed_out: timedOut,
    timeout_ms: timeoutMs,
    duration_ms: durationMs,
    capture_gap: captureGap,
  };
}
