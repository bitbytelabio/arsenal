/**
 * Ajv 8 (JSON Schema 2020-12) Schema Validator & Compiler for Arsenal
 * Configured with useDefaults: false, removeAdditional: false, coerceTypes: false
 */

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject } from "ajv";
import * as schemas from "./schema-data.ts";

export interface ValidationResult<T = unknown> {
  valid: boolean;
  data: T;
  errors: string[];
}

export const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  useDefaults: false,
  removeAdditional: false,
  coerceTypes: false,
});

addFormats(ajv);

export const SCOPE_SCHEMA = schemas.SCOPE_SCHEMA

export const ENGAGEMENT_SCHEMA = schemas.ENGAGEMENT_SCHEMA

export const ENVIRONMENT_SCHEMA = schemas.ENVIRONMENT_SCHEMA

export const EVIDENCE_RECEIPT_SCHEMA = schemas.EVIDENCE_RECEIPT_SCHEMA

export const FINDING_SCHEMA = schemas.FINDING_SCHEMA

export const VERIFICATION_RESULT_SCHEMA = schemas.VERIFICATION_RESULT_SCHEMA

export const MANIFEST_SCHEMA = schemas.MANIFEST_SCHEMA

export const BUDGET_RECORD_SCHEMA = schemas.BUDGET_RECORD_SCHEMA

export const CLI_ENVELOPE_SCHEMA = schemas.CLI_ENVELOPE_SCHEMA

export const SKILL_FRONTMATTER_SCHEMA = schemas.SKILL_FRONTMATTER_SCHEMA

export const CORPUS_MANIFEST_SCHEMA = schemas.CORPUS_MANIFEST_SCHEMA

export const ROUTING_TABLE_SCHEMA = schemas.ROUTING_TABLE_SCHEMA

export const COVERAGE_BASELINE_SCHEMA = schemas.COVERAGE_BASELINE_SCHEMA

export interface ExtensionBundleArtifact {
  name: "bounding" | "ledger" | "budget" | "routing";
  entrypoint: string;
  outputPath: string;
  byteLength: number;
  sha256: string;
  externalImports: string[];
}

export const EXTENSION_BUNDLE_ARTIFACT_SCHEMA = schemas.EXTENSION_BUNDLE_ARTIFACT_SCHEMA

export interface VerificationOraclePayload {
  oracle_type: "timing_differential" | "authz_matrix" | "path_traversal";
  parameters: Record<string, unknown>;
}

export const VERIFICATION_ORACLE_SCHEMA = schemas.VERIFICATION_ORACLE_SCHEMA

export const SPECIALIST_HANDOFF_SCHEMA = schemas.SPECIALIST_HANDOFF_SCHEMA

export const APK_INSPECT_TOOL_SCHEMA = schemas.APK_INSPECT_TOOL_SCHEMA

export const SKILL_ASSET_LOAD_SCHEMA = schemas.SKILL_ASSET_LOAD_SCHEMA

// Register schemas with Ajv2020
ajv.addSchema(SCOPE_SCHEMA);
ajv.addSchema(ENGAGEMENT_SCHEMA);
ajv.addSchema(ENVIRONMENT_SCHEMA);
ajv.addSchema(EVIDENCE_RECEIPT_SCHEMA);
ajv.addSchema(FINDING_SCHEMA);
ajv.addSchema(VERIFICATION_RESULT_SCHEMA);
ajv.addSchema(MANIFEST_SCHEMA);
ajv.addSchema(BUDGET_RECORD_SCHEMA);
ajv.addSchema(CLI_ENVELOPE_SCHEMA);
ajv.addSchema(SKILL_FRONTMATTER_SCHEMA);
ajv.addSchema(CORPUS_MANIFEST_SCHEMA);
ajv.addSchema(ROUTING_TABLE_SCHEMA);
ajv.addSchema(COVERAGE_BASELINE_SCHEMA);
ajv.addSchema(EXTENSION_BUNDLE_ARTIFACT_SCHEMA);
ajv.addSchema(VERIFICATION_ORACLE_SCHEMA);
ajv.addSchema(SPECIALIST_HANDOFF_SCHEMA);
ajv.addSchema(APK_INSPECT_TOOL_SCHEMA);
ajv.addSchema(SKILL_ASSET_LOAD_SCHEMA);

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) return [];
  return errors.map((err) => `${err.instancePath || "/"}: ${err.message ?? "validation error"}`);
}

export function validateSchema<T>(schemaId: string, data: unknown): ValidationResult<T> {
  const validator = ajv.getSchema<T>(schemaId);
  if (!validator) {
    return {
      valid: false,
      data: data as T,
      errors: [`Schema not found: ${schemaId}`],
    };
  }
  const valid = validator(data);
  return {
    valid: Boolean(valid),
    data: data as T,
    errors: formatErrors(validator.errors),
  };
}
