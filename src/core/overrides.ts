/**
 * Override Detection & Collision Engine
 * Implements data-model.md §OperatingProfile, Role and Override
 */

import * as fs from "node:fs";
import { sha256File } from "./hash.ts";

export interface CapabilityOverride {
  capability_kind: "agent" | "skill" | "tool" | "rule";
  name: string;
  source_path: string;
  replaces_path: string;
  reason: string;
  owner?: string;
  approved_hash: string;
}

export interface OverrideCheckResult {
  valid: boolean;
  overrides: CapabilityOverride[];
  undocumentedCollisions: string[];
  tamperedOverrides: string[];
}

export function detectOverrides(
  declaredOverrides: CapabilityOverride[],
  profilePaths: Record<string, string>,
  pluginPaths: Record<string, string>
): OverrideCheckResult {
  const overrides: CapabilityOverride[] = [];
  const undocumentedCollisions: string[] = [];
  const tamperedOverrides: string[] = [];

  const declaredMap: Record<string, CapabilityOverride> = {};
  for (const o of declaredOverrides) {
    declaredMap[`${o.capability_kind}:${o.name}`] = o;
  }

  // Scan profile paths against plugin paths
  for (const [name, profPath] of Object.entries(profilePaths)) {
    const plugPath = pluginPaths[name];
    if (plugPath && fs.existsSync(profPath)) {
      const key = `agent:${name}`;
      const dec = declaredMap[key];

      if (!dec) {
        undocumentedCollisions.push(
          `Undocumented shadow: Profile file '${profPath}' replaces plugin file '${plugPath}' without declared override.`
        );
      } else {
        if (!dec.reason || dec.reason.trim().length === 0) {
          undocumentedCollisions.push(
            `Override for '${name}' lacks required justification reason.`
          );
        }
        const currentHash = sha256File(profPath);
        if (currentHash !== dec.approved_hash) {
          tamperedOverrides.push(
            `Tampered override for '${name}': expected approved hash ${dec.approved_hash}, got ${currentHash}`
          );
        } else {
          overrides.push(dec);
        }
      }
    }
  }

  const valid = undocumentedCollisions.length === 0 && tamperedOverrides.length === 0;

  return {
    valid,
    overrides,
    undocumentedCollisions,
    tamperedOverrides,
  };
}
