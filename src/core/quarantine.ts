/**
 * Quarantine and License Validation
 * Enforces legal and OpSec quarantine rules per Constitution & Contracts
 */

export interface QuarantineDecision {
  allowed: boolean;
  status: "admitted" | "quarantined" | "excluded";
  reason?: string;
}

const FORBIDDEN_LICENSES: Record<string, true> = {
  "GPL-3.0": true,
  "GPLv3": true,
  "GPL-3.0-only": true,
  "GPL-3.0-or-later": true,
  "AGPL-3.0": true,
  "AGPLv3": true,
  "AGPL-3.0-only": true,
  "AGPL-3.0-or-later": true,
};

export function evaluateQuarantine(
  filePath: string,
  license?: string,
  content?: string
): QuarantineDecision {
  const normalizedPath = filePath.replace(/\\/g, "/");

  // Check GPLv3 ctf-sandbox
  if (normalizedPath.includes("ctf-sandbox") || normalizedPath.includes("CTF-Sandbox")) {
    return {
      allowed: false,
      status: "quarantined",
      reason: "GPLv3 license incompatibility (CTF-Sandbox-Orchestrator dropped)",
    };
  }

  // Check AGPL jshookmcp
  if (normalizedPath.includes("jshookmcp")) {
    return {
      allowed: false,
      status: "quarantined",
      reason: "AGPL-3.0 copyleft quarantine (external stdio only, zero bytes vendored)",
    };
  }

  // Check PowerShell scripts
  if (normalizedPath.endsWith(".ps1")) {
    return {
      allowed: false,
      status: "quarantined",
      reason: "PowerShell scripts excluded per POSIX/Linux/macOS standard",
    };
  }

  // Check license
  if (license && FORBIDDEN_LICENSES[license.trim()]) {
    return {
      allowed: false,
      status: "quarantined",
      reason: `Prohibited copyleft license: ${license}`,
    };
  }

  // Check raw payloads
  if (
    normalizedPath.includes("/payloads/") ||
    normalizedPath.includes("/data/") ||
    normalizedPath.endsWith(".exe") ||
    normalizedPath.endsWith(".dll")
  ) {
    return {
      allowed: false,
      status: "excluded",
      reason: "Raw payload or binary artifact isolated from guidance bodies",
    };
  }

  // Check content for embedded .ps1 script indicators
  if (content && content.includes("#!powershell")) {
    return {
      allowed: false,
      status: "quarantined",
      reason: "Embedded PowerShell execution content excluded",
    };
  }

  return {
    allowed: true,
    status: "admitted",
  };
}
