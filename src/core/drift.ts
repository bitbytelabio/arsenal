/**
 * Engagement Context Drift Detection Engine
 * Compares current files against reference checksum manifest per contracts/cli.md §1.2 & T022
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256File } from "./hash.ts";

export interface DriftReport {
  clean: boolean;
  missingFiles: string[];
  modifiedFiles: string[];
  extraFiles: string[];
}

export function detectDrift(
  targetDir: string,
  manifestFiles: Array<{ path: string; sha256: string }>
): DriftReport {
  const missingFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const extraFiles: string[] = [];

  const manifestMap: Record<string, string> = {};
  for (const item of manifestFiles) {
    manifestMap[item.path] = item.sha256;
    const fullPath = path.join(targetDir, item.path);
    if (!fs.existsSync(fullPath)) {
      missingFiles.push(item.path);
    } else {
      const currentHash = sha256File(fullPath);
      if (currentHash !== item.sha256.toLowerCase()) {
        modifiedFiles.push(item.path);
      }
    }
  }

  const clean = missingFiles.length === 0 && modifiedFiles.length === 0;

  return {
    clean,
    missingFiles,
    modifiedFiles,
    extraFiles,
  };
}
