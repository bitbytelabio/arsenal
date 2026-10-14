/**
 * Shared Type Declarations for Arsenal OMP Plugin Harness
 */

export interface ExportedComponent {
  type: "activity" | "service" | "receiver" | "provider";
  name: string;
  permission: string | null;
}

export interface ApkInspectResult {
  packageName: string;
  versionCode?: number;
  versionName?: string;
  minSdkVersion?: number;
  targetSdkVersion?: number;
  debuggable: boolean;
  allowBackup: boolean;
  permissions: string[];
  exportedComponents: ExportedComponent[];
  dangerousFlags: string[];
}

export interface SkillAssetLoadResult {
  skill: string;
  assetPath: string;
  resolvedUri: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
}

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type EpistemicStatus = "E" | "P";

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  location: string;
  cwe: string;
  evidenceReceipts: string[];
  epistemicStatus: EpistemicStatus;
}

export type SpecialistRole = "arsenal-reverse" | "arsenal-web" | "arsenal-mobile" | "arsenal-redteam" | "arsenal-verifier";
export type CoverageJudgement = "covered" | "partial" | "uncovered";

export interface SpecialistHandoff {
  taskId: string;
  role: SpecialistRole;
  findings: Finding[];
  coverageJudgement: CoverageJudgement;
  unresolvedVariables: string[];
  capabilityGap: string | null;
}

export interface McpBridgeConfig {
  name: string;
  type: "stdio" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  runner?: "uv" | "node" | "none";
  enabled: boolean;
  description?: string;
}

export interface EngagementScope {
  scopeId: string;
  targetName: string;
  authorizedBy: string;
  validUntil: string;
  inScope: string[];
  outOfScope: string[];
  maxConcurrency?: number;
  allowedSeverities?: Severity[];
  safeMode?: boolean;
}
