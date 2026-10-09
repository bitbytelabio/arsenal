/**
 * Finding and Independent Verification Data Model
 * Implements data-model.md §Finding and VerificationResult & T047
 */

import { FINDING_SCHEMA, VERIFICATION_RESULT_SCHEMA, validateSchema } from "../schemas/validator.ts";

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type ValidationStatus = "validated" | "unvalidated" | "rejected" | "partial" | "error";

export interface Finding {
  schema_version: 1;
  finding_id: string; // F-xxxxxx
  engagement_id: string;
  title: string;
  description: string;
  severity: Severity;
  affected_target: string;
  cwe_id: string | null;
  rule_id: string | null;
  discoverer: {
    role: string;
    session_id: string;
  };
  evidence_ids: string[];
  related_propositions?: string[];
  related_unknowns?: string[];
  validation_status: ValidationStatus;
}

export interface VerificationResult {
  schema_version: 1;
  finding_id: string;
  verifier: {
    role: string;
    session_id: string;
  };
  oracle_name: string;
  oracle_version: string;
  input_artifact_refs: string[];
  expected_behavior: string;
  observed_behavior: string;
  reproduction_evidence_ids: string[];
  outcome: ValidationStatus;
  rationale: string;
  counterevidence_ids: string[];
  execution_error: string | null;
  verified_at: string;
}

export interface FindingSuppression {
  finding_id: string;
  reason: string;
  actor: string;
  timestamp: string;
  evidence_refs: string[];
}

export function createFinding(params: {
  finding_id: string;
  engagement_id: string;
  title: string;
  description: string;
  severity: Severity;
  affected_target: string;
  cwe_id?: string | null;
  rule_id?: string | null;
  discoverer_role: string;
  discoverer_session_id: string;
  evidence_ids: string[];
}): Finding {
  if (params.evidence_ids.length === 0) {
    throw new Error("Finding creation rejected: at least one valid evidence ID is required.");
  }

  const finding: Finding = {
    schema_version: 1,
    finding_id: params.finding_id,
    engagement_id: params.engagement_id,
    title: params.title,
    description: params.description,
    severity: params.severity,
    affected_target: params.affected_target,
    cwe_id: params.cwe_id ?? null,
    rule_id: params.rule_id ?? null,
    discoverer: {
      role: params.discoverer_role,
      session_id: params.discoverer_session_id,
    },
    evidence_ids: params.evidence_ids,
    validation_status: "unvalidated",
  };

  const valRes = validateSchema(FINDING_SCHEMA.$id, finding);
  if (!valRes.valid) {
    throw new Error(`Finding schema error: ${valRes.errors.join(", ")}`);
  }

  return finding;
}

export function recordVerification(
  finding: Finding,
  verifier: { role: string; session_id: string },
  oracleName: string,
  oracleVersion: string,
  outcome: ValidationStatus,
  expectedBehavior: string,
  observedBehavior: string,
  reproductionEvidenceIds: string[],
  rationale: string,
  counterevidenceIds: string[] = [],
  executionError: string | null = null
): VerificationResult {
  // Independent verification invariant: verifier cannot be discoverer
  if (
    verifier.role === finding.discoverer.role &&
    verifier.session_id === finding.discoverer.session_id
  ) {
    throw new Error(
      `Independent verification violation: verifier (${verifier.role}/${verifier.session_id}) cannot be the discoverer.`
    );
  }

  const result: VerificationResult = {
    schema_version: 1,
    finding_id: finding.finding_id,
    verifier,
    oracle_name: oracleName,
    oracle_version: oracleVersion,
    input_artifact_refs: [],
    expected_behavior: expectedBehavior,
    observed_behavior: observedBehavior,
    reproduction_evidence_ids: reproductionEvidenceIds,
    outcome,
    rationale,
    counterevidence_ids: counterevidenceIds,
    execution_error: executionError,
    verified_at: new Date().toISOString(),
  };

  const valRes = validateSchema(VERIFICATION_RESULT_SCHEMA.$id, result);
  if (!valRes.valid) {
    throw new Error(`VerificationResult schema error: ${valRes.errors.join(", ")}`);
  }

  // Update finding status
  finding.validation_status = outcome;

  return result;
}
