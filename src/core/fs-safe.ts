/**
 * File Mutation Safety Layer
 * Implements contracts/cli.md §1.2 & Constitution §Development Workflow
 * Controls preview mode, --write gate, --force backup, and POSIX permissions
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface SafeWriteOptions {
  write: boolean;
  force: boolean;
  mode?: number;
}

export interface SafeWriteResult {
  written: boolean;
  action: "created" | "updated" | "preview" | "refused" | "identical";
  targetPath: string;
  backupPath?: string;
  conflict: boolean;
  error?: string;
}

export function safeWriteFile(
  targetPath: string,
  content: string | Uint8Array,
  options: SafeWriteOptions
): SafeWriteResult {
  const resolved = path.resolve(targetPath);
  const exists = fs.existsSync(resolved);
  const incomingBytes =
    typeof content === "string" ? new TextEncoder().encode(content) : content;

  if (exists) {
    const existingBytes = fs.readFileSync(resolved);
    const isIdentical =
      existingBytes.byteLength === incomingBytes.byteLength &&
      Buffer.from(existingBytes).equals(Buffer.from(incomingBytes));

    if (isIdentical) {
      return {
        written: false,
        action: "identical",
        targetPath: resolved,
        conflict: false,
      };
    }

    // File exists with differing content
    if (!options.write) {
      return {
        written: false,
        action: "preview",
        targetPath: resolved,
        conflict: true,
      };
    }

    if (!options.force) {
      return {
        written: false,
        action: "refused",
        targetPath: resolved,
        conflict: true,
        error: `Target file '${resolved}' exists with conflicting content. Specify --force to overwrite with backup.`,
      };
    }

    // Overwrite with backup
    const timestamp = Date.now();
    const backupPath = `${resolved}.bak.${timestamp}`;
    fs.copyFileSync(resolved, backupPath);

    fs.writeFileSync(resolved, incomingBytes);
    const fileMode = options.mode ?? 0o600;
    try {
      fs.chmodSync(resolved, fileMode);
    } catch {
      // Non-POSIX fallback
    }

    return {
      written: true,
      action: "updated",
      targetPath: resolved,
      backupPath,
      conflict: false,
    };
  }

  // New file
  if (!options.write) {
    return {
      written: false,
      action: "preview",
      targetPath: resolved,
      conflict: false,
    };
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolved, incomingBytes);
  const fileMode = options.mode ?? 0o600;
  try {
    fs.chmodSync(resolved, fileMode);
  } catch {
    // Non-POSIX fallback
  }

  return {
    written: true,
    action: "created",
    targetPath: resolved,
    conflict: false,
  };
}

export function safeMkdir(dirPath: string, mode: number = 0o700): void {
  const resolved = path.resolve(dirPath);
  fs.mkdirSync(resolved, { recursive: true, mode });
  try {
    fs.chmodSync(resolved, mode);
  } catch {
    // Non-POSIX fallback
  }
}
