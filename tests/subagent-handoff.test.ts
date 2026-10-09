import { describe, expect, test } from "bun:test";
import { validateSchema } from "../src/schemas/validator.ts";
import type { SpecialistHandoff } from "../src/core/types.ts";

describe("Specialist Subagent Handoff Contract Validation", () => {
  const schemaId = "https://arsenal.security/schemas/specialist-handoff.json";

  test("accepts fully compliant specialist handoff payload", () => {
    const validHandoff: SpecialistHandoff = {
      taskId: "task-web-001",
      role: "sec-webapp",
      findings: [
        {
          id: "F-001",
          title: "SQL Injection in User Profile Parameter",
          severity: "high",
          location: "https://target.example.com/api/v1/user?id=1",
          cwe: "CWE-89",
          evidenceReceipts: ["E-001", "E-002"],
          epistemicStatus: "E",
        },
      ],
      coverageJudgement: "covered",
      unresolvedVariables: ["unk-db-version"],
      capabilityGap: null,
    };

    const res = validateSchema(schemaId, validHandoff);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  test("rejects handoff payload missing required evidenceReceipts or fields", () => {
    const invalidHandoff = {
      taskId: "task-002",
      role: "sec-webapp",
      findings: [
        {
          id: "F-002",
          title: "Missing Receipts",
          severity: "medium",
          location: "/api",
          cwe: "CWE-200",
          evidenceReceipts: [], // Violation: minItems: 1
          epistemicStatus: "P",
        },
      ],
      coverageJudgement: "partial",
      unresolvedVariables: [],
      // Missing capabilityGap
    };

    const res = validateSchema(schemaId, invalidHandoff);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  test("rejects invalid role or invalid epistemic status", () => {
    const invalidRole = {
      taskId: "task-003",
      role: "rogue-agent",
      findings: [],
      coverageJudgement: "uncovered",
      unresolvedVariables: [],
      capabilityGap: null,
    };

    const res = validateSchema(schemaId, invalidRole);
    expect(res.valid).toBe(false);
  });
});
