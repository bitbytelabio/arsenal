/**
 * Source & Distribution Manifest Generator
 * Implements data-model.md §ManagedManifest and ReportSet & T077
 * Pure & deterministic output: excludes wall-clock timestamps and machine paths
 */

import { MANIFEST_SCHEMA, validateSchema } from "../schemas/validator.ts";
import { VERSION } from "./version.ts";
import type { CapabilityOverride } from "./overrides.ts";

export interface ManifestFileRecord {
  path: string;
  sha256: string;
  bytes: number;
}

export interface DistributionManifest {
  schema_version: 1;
  generator: string;
  created_at: null; // Strictly null for byte-determinism
  files: ManifestFileRecord[];
  overrides?: CapabilityOverride[];
}

export function generateDistributionManifest(
  files: ManifestFileRecord[],
  overrides?: CapabilityOverride[]
): DistributionManifest {
  // Deterministically sort files by path ascending
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  const manifest: DistributionManifest = {
    schema_version: 1,
    generator: `arsenal-manifest-v${VERSION}`,
    created_at: null,
    files: sortedFiles,
    overrides,
  };

  const valRes = validateSchema(MANIFEST_SCHEMA.$id, manifest);
  if (!valRes.valid) {
    throw new Error(`Manifest schema error: ${valRes.errors.join(", ")}`);
  }

  return manifest;
}
