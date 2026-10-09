/**
 * tests/schemas.test.ts
 * Behavioral test verifying Ajv 8 / JSON Schema 2020-12 compilation and validation
 */

import { describe, expect, it } from "bun:test";
import {
  SCOPE_SCHEMA,
  ENGAGEMENT_SCHEMA,
  ENVIRONMENT_SCHEMA,
  EVIDENCE_RECEIPT_SCHEMA,
  FINDING_SCHEMA,
  VERIFICATION_RESULT_SCHEMA,
  MANIFEST_SCHEMA,
  BUDGET_RECORD_SCHEMA,
  CLI_ENVELOPE_SCHEMA,
  SKILL_FRONTMATTER_SCHEMA,
  validateSchema,
} from "../src/schemas/validator.ts";

describe("JSON Schema 2020-12 Validation Suite", () => {
  it("compiles and validates scope.json", () => {
    const validScope = {
      schema_version: 1,
      engagement_id: "ENG-2026-TEST",
      name: "Test Engagement",
      created_at: "2026-10-08T12:00:00.000Z",
      domain: "webapp",
      auth: {
        status: "granted",
        basis: "Signed authorization letter #123",
        reference: "AUTH-REF-123",
        ready_for_act: true,
      },
      in_scope: ["https://target.local/*"],
      out_of_scope: ["https://target.local/admin/*"],
      disallowed_actions: ["dos", "brute_force"],
      window: {
        start: "2026-10-08T00:00:00.000Z",
        end: "2026-10-09T00:00:00.000Z",
        timezone: "UTC",
      },
      environment_id: "env-local",
      charter_path: ".omp/arsenal/charter.md",
      charter_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      budget_usd: "50.00",
    };

    const res = validateSchema(SCOPE_SCHEMA.$id, validScope);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);

    const invalidScope = { ...validScope, domain: "invalid-domain" };
    const badRes = validateSchema(SCOPE_SCHEMA.$id, invalidScope);
    expect(badRes.valid).toBe(false);
  });

  it("compiles and validates engagement.json", () => {
    const validEngagement = {
      schema_version: 1,
      engagement_id: "ENG-2026-TEST",
      name: "Test Engagement",
      domain: "re",
      created_at: "2026-10-08T12:00:00.000Z",
      auth: {
        status: "incomplete",
        basis: null,
        reference: null,
        ready_for_act: false,
      },
      status: "prepared",
    };

    const res = validateSchema(ENGAGEMENT_SCHEMA.$id, validEngagement);
    expect(res.valid).toBe(true);
  });

  it("compiles and validates environment.json", () => {
    const validEnv = {
      schema_version: 1,
      id: "env-local-1",
      kind: "local",
      name: "Host Environment",
      address: "127.0.0.1",
      access_method: "direct",
      working_root: "/tmp/workspace",
      proxy_url: null,
      ca_path: null,
      browser_trust_path: null,
      tool_index_path: null,
      path_overrides: null,
      observed_at: "2026-10-08T12:00:00.000Z",
    };

    const res = validateSchema(ENVIRONMENT_SCHEMA.$id, validEnv);
    expect(res.valid).toBe(true);
  });

  it("compiles and validates evidence receipt", () => {
    const validReceipt = {
      schema_version: 1,
      engagement_id: "ENG-2026-TEST",
      seq: 1,
      event_key: "evt-001",
      kind: "evidence_receipt",
      entity_id: "E-000001",
      session_id: "sess-01",
      actor: "sec-webapp",
      recorded_at: "2026-10-08T12:00:00.000Z",
      prev_hash: "0000000000000000000000000000000000000000000000000000000000000000",
      data: {
        tool_name: "evidence_exec",
        requested_target: "https://target.local",
        observed_endpoint: "https://target.local",
        scope_attribution: "in_scope",
        scope_revision_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        artifacts: [
          {
            artifact_id: "art-001",
            path: "evidence/raw/e3b0c442...txt",
            media_type: "text/plain",
            byte_length: 120,
            sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            fidelity: "raw",
          },
        ],
        capture_gap: null,
      },
    };

    const res = validateSchema(EVIDENCE_RECEIPT_SCHEMA.$id, validReceipt);
    expect(res.valid).toBe(true);
  });

  it("compiles and validates finding.json", () => {
    const validFinding = {
      schema_version: 1,
      finding_id: "F-000001",
      engagement_id: "ENG-2026-TEST",
      title: "SQL Injection in User Search",
      description: "Blind time-based SQL injection verified on search endpoint",
      severity: "high",
      affected_target: "https://target.local/api/users",
      cwe_id: "CWE-89",
      rule_id: "rule-sqli-01",
      discoverer: { role: "sec-webapp", session_id: "sess-01" },
      evidence_ids: ["E-000001"],
      validation_status: "unvalidated",
    };

    const res = validateSchema(FINDING_SCHEMA.$id, validFinding);
    expect(res.valid).toBe(true);
  });

  it("compiles and validates verification result", () => {
    const validResult = {
      schema_version: 1,
      finding_id: "F-000001",
      verifier: { role: "sec-verifier", session_id: "sess-02" },
      oracle_name: "verify_timing",
      oracle_version: "1.0.0",
      input_artifact_refs: ["art-001"],
      expected_behavior: "Baseline ~100ms, probe delay ~5000ms",
      observed_behavior: "Median separation 4920ms across 4 pairs",
      reproduction_evidence_ids: ["E-000002"],
      outcome: "validated",
      rationale: "Consistent timing separation satisfies verification oracle",
      counterevidence_ids: [],
      execution_error: null,
      verified_at: "2026-10-08T12:05:00.000Z",
    };

    const res = validateSchema(VERIFICATION_RESULT_SCHEMA.$id, validResult);
    expect(res.valid).toBe(true);
  });

  it("compiles and validates manifest.json", () => {
    const validManifest = {
      schema_version: 1,
      generator: "arsenal-v3.0.0",
      created_at: null,
      files: [
        {
          path: "plugin/skills/re-ida-reverse/SKILL.md",
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          bytes: 1240,
        },
      ],
    };

    const res = validateSchema(MANIFEST_SCHEMA.$id, validManifest);
    expect(res.valid).toBe(true);
  });

  it("compiles and validates budget-record.json", () => {
    const validBudget = {
      schema_version: 1,
      engagement_id: "ENG-2026-TEST",
      allowance_usd: "5.00",
      known_spend_usd: "3.750000000000",
      unknown_usage_count: 0,
      token_totals: {
        input: 12000,
        output: 3000,
        cacheRead: 4000,
        cacheWrite: 1000,
      },
      warned_bands: [70],
      reserve_active: false,
      in_flight_spawns: [],
      ledger_head_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    };

    const res = validateSchema(BUDGET_RECORD_SCHEMA.$id, validBudget);
    expect(res.valid).toBe(true);
  });

  it("compiles and validates cli-envelope.json", () => {
    const validEnvelope = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      version: "3.0.0",
      command: "arsenal init",
      status: "success",
      exitCode: 0,
      timestamp: "2026-10-08T12:00:00.000Z",
      mode: "preview",
      data: { initialized: true },
      warnings: [],
      errors: [],
    };

    const res = validateSchema(CLI_ENVELOPE_SCHEMA.$id, validEnvelope);
    expect(res.valid).toBe(true);
  });

  it("compiles and validates skill-frontmatter.json", () => {
    const validFrontmatter = {
      name: "re-ida-reverse",
      description: "Perform comprehensive IDA Pro reverse engineering and decompilation.",
      domain: "re",
      category: "decompilation",
      hide: true,
      license: "MIT",
      metadata: {
        manifest_entry: "src/corpus/re-ida-reverse/SKILL.md",
      },
    };

    const res = validateSchema(SKILL_FRONTMATTER_SCHEMA.$id, validFrontmatter);
    expect(res.valid).toBe(true);

    const invalidFrontmatter = {
      ...validFrontmatter,
      description: "Too short.",
    };
    const badRes = validateSchema(SKILL_FRONTMATTER_SCHEMA.$id, invalidFrontmatter);
    expect(badRes.valid).toBe(false);
  });
});
