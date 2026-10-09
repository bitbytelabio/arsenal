/**
 * tests/us5-verification.test.ts
 * Independent acceptance test for User Story 5: Publish Independently Verified Conclusions
 */

import { describe, expect, it } from "bun:test";
import { verifyTimingDifferential } from "../src/oracles/verify-timing.ts";
import { verifyPathTraversal } from "../src/oracles/verify-path-traversal.ts";
import { verifyAuthorizationMatrix } from "../src/oracles/authz-matrix.ts";
import { createFinding, recordVerification } from "../src/core/findings.ts";
import { exportToSarif } from "../src/core/sarif.ts";
import { generateExecutiveReport } from "../src/core/executive-report.ts";
import { exportFindingsToCsv, sanitizeCsvCell } from "../src/core/csv-export.ts";
import { handleVerifyOracle } from "../plugin/tools/verify-oracle.ts";

describe("User Story 5: Independent Verification & Reporting", () => {
  it("evaluates timing differential oracle correctly across outcomes", () => {
    // Validated case: median probe (5100) - median baseline (100) = 5000ms >= 3000ms; 4 pairs >= 2000ms
    const valResult = verifyTimingDifferential({
      expectedDelayMs: 5000,
      pairs: [
        { baselineMs: 95, probeMs: 5120 },
        { baselineMs: 105, probeMs: 5080 },
        { baselineMs: 100, probeMs: 5100 },
        { baselineMs: 98, probeMs: 5150 },
      ],
    });
    expect(valResult.outcome).toBe("validated");

    // Partial case: insufficient separation
    const partResult = verifyTimingDifferential({
      expectedDelayMs: 5000,
      pairs: [
        { baselineMs: 100, probeMs: 250 },
        { baselineMs: 100, probeMs: 300 },
        { baselineMs: 100, probeMs: 200 },
      ],
    });
    expect(partResult.outcome).toBe("partial");

    // Rejected case: affirmative counterevidence
    const rejResult = verifyTimingDifferential({
      expectedDelayMs: 5000,
      pairs: [{ baselineMs: 100, probeMs: 100 }],
      hasAffirmativeCounterevidence: true,
    });
    expect(rejResult.outcome).toBe("rejected");

    // Error case: transport failure
    const errResult = verifyTimingDifferential({
      expectedDelayMs: 5000,
      pairs: [],
      hasTransportError: true,
    });
    expect(errResult.outcome).toBe("error");
  });

  it("evaluates path traversal oracle across outcomes", () => {
    const valResult = verifyPathTraversal({
      baselineStatusCode: 404,
      baselineBody: "Not Found",
      probeResponses: [
        { depth: 2, statusCode: 404, body: "Not Found" },
        { depth: 4, statusCode: 200, body: "root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:..." },
      ],
    });
    expect(valResult.outcome).toBe("validated");
    expect(valResult.matchedDepth).toBe(4);

    const rejResult = verifyPathTraversal({
      baselineStatusCode: 404,
      baselineBody: "Not Found",
      probeResponses: [
        { depth: 2, statusCode: 403, body: "Access Denied" },
        { depth: 4, statusCode: 403, body: "Access Denied" },
      ],
    });
    expect(rejResult.outcome).toBe("rejected");
  });

  it("evaluates authorization matrix oracle", () => {
    const bolaHit = verifyAuthorizationMatrix({
      endpoint: "/api/v1/orders/123",
      observations: [
        { identity: "authorized", statusCode: 200, body: "{}", isBusinessDataPresent: true },
        { identity: "unauthorized", statusCode: 200, body: '{"order":123}', isBusinessDataPresent: true },
      ],
    });
    expect(bolaHit.outcome).toBe("validated");
    expect(bolaHit.vulnerableIdentities).toContain("unauthorized");

    const properlyBlocked = verifyAuthorizationMatrix({
      endpoint: "/api/v1/orders/123",
      observations: [
        { identity: "authorized", statusCode: 200, body: "{}", isBusinessDataPresent: true },
        { identity: "unauthorized", statusCode: 403, body: "Forbidden", isBusinessDataPresent: false },
        { identity: "anonymous", statusCode: 401, body: "Unauthorized", isBusinessDataPresent: false },
      ],
    });
    expect(properlyBlocked.outcome).toBe("rejected");
  });

  it("enforces independent verification and rejects self-certification", () => {
    const finding = createFinding({
      finding_id: "F-000001",
      engagement_id: "ENG-US5",
      title: "SQL Injection",
      description: "Blind SQLi",
      severity: "high",
      affected_target: "https://target.local",
      discoverer_role: "sec-webapp",
      discoverer_session_id: "sess-01",
      evidence_ids: ["E-000001"],
    });

    // Self-certification attempt: verifier == discoverer
    expect(() =>
      recordVerification(
        finding,
        { role: "sec-webapp", session_id: "sess-01" },
        "verify_timing",
        "1.0.0",
        "validated",
        "expected delay",
        "observed delay",
        ["E-000002"],
        "Confirmed"
      )
    ).toThrow("Independent verification violation");

    // Independent verifier succeeds
    const verRes = recordVerification(
      finding,
      { role: "sec-verifier", session_id: "sess-02" },
      "verify_timing",
      "1.0.0",
      "validated",
      "expected delay",
      "observed delay",
      ["E-000002"],
      "Confirmed"
    );
    expect(verRes.outcome).toBe("validated");
    expect(finding.validation_status).toBe("validated");
  });

  it("exports SARIF v2.1.0 and executive summary with validated-only conclusions", () => {
    const fValidated = createFinding({
      finding_id: "F-000001",
      engagement_id: "ENG-US5",
      title: "Validated SQLi",
      description: "Proven injection",
      severity: "high",
      affected_target: "https://target.local/sqli",
      discoverer_role: "sec-webapp",
      discoverer_session_id: "sess-01",
      evidence_ids: ["E-000001"],
    });
    fValidated.validation_status = "validated";

    const fPartial = createFinding({
      finding_id: "F-000002",
      engagement_id: "ENG-US5",
      title: "Inconclusive Probe",
      description: "Partial timing spike",
      severity: "medium",
      affected_target: "https://target.local/probe",
      discoverer_role: "sec-webapp",
      discoverer_session_id: "sess-01",
      evidence_ids: ["E-000002"],
    });
    fPartial.validation_status = "partial";

    // SARIF export
    const sarif = exportToSarif([fValidated, fPartial]);
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]!.results.length).toBe(2);

    // Executive Report
    const execReport = generateExecutiveReport({
      engagementId: "ENG-US5",
      engagementName: "Test Target",
      headHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      lastSeq: 42,
      findings: [fValidated, fPartial],
    });

    // Invariant: validated in Section 1, partial in Section 2
    expect(execReport).toContain("1. Executive Conclusions (Confirmed Vulnerabilities)");
    expect(execReport).toContain("Validated SQLi");
    expect(execReport).toContain("2.2 Partial / Inconclusive Probes");
    expect(execReport).toContain("Inconclusive Probe");
  });

  it("neutralizes formula triggers in CSV export (CWE-1236)", () => {
    expect(sanitizeCsvCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    expect(sanitizeCsvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(sanitizeCsvCell("-100")).toBe("'-100");
    expect(sanitizeCsvCell("@malicious")).toBe("'@malicious");
    expect(sanitizeCsvCell("\tsecret")).toBe("'\tsecret");
    expect(sanitizeCsvCell("Normal String")).toBe("Normal String");

    const f = createFinding({
      finding_id: "F-000003",
      engagement_id: "ENG-US5",
      title: "=HYPERLINK('http://evil.com', 'Click Me')",
      description: "Malicious payload title",
      severity: "low",
      affected_target: "https://target.local",
      discoverer_role: "sec-webapp",
      discoverer_session_id: "sess-01",
      evidence_ids: ["E-000003"],
    });

    const csv = exportFindingsToCsv([f]);
    expect(csv).toContain("'=HYPERLINK");
  });

  it("executes verify_oracle tool across all supported oracle types (US7 / T031)", async () => {
    // 1. timing_differential
    const timingRes = await handleVerifyOracle({
      oracle_type: "timing_differential",
      parameters: {
        expectedDelayMs: 5000,
        pairs: [
          { baselineMs: 100, probeMs: 5100 },
          { baselineMs: 100, probeMs: 5120 },
          { baselineMs: 100, probeMs: 5090 },
          { baselineMs: 100, probeMs: 5110 },
        ],
      },
    });
    expect(timingRes.outcome).toBe("validated");
    expect(timingRes.details?.medianSeparationMs).toBeGreaterThanOrEqual(4000);

    // 2. authz_matrix
    const authzRes = await handleVerifyOracle({
      oracle_type: "authz_matrix",
      parameters: {
        endpoint: "/api/user/profile",
        observations: [
          { role: "authorized", statusCode: 200, isBusinessDataPresent: true, body: '{"user":"alice"}' },
          { role: "unauthorized", statusCode: 200, isBusinessDataPresent: true, body: '{"user":"alice"}' },
          { role: "anonymous", statusCode: 401, isBusinessDataPresent: false, body: 'Unauthorized' },
        ],
      },
    });
    expect(authzRes.outcome).toBe("validated");
    expect(authzRes.details?.vulnerableIdentities).toContain("unauthorized");

    // 3. path_traversal
    const traversalRes = await handleVerifyOracle({
      oracle_type: "path_traversal",
      parameters: {
        baselineStatusCode: 404,
        baselineBody: "File not found",
        probeResponses: [
          { depth: 1, statusCode: 404, body: "File not found" },
          { depth: 3, statusCode: 200, body: "root:x:0:0:root:/root:/bin/bash\nbin:x:1:1:bin:/bin:/sbin/nologin" },
        ],
      },
    });
    expect(traversalRes.outcome).toBe("validated");
    expect(traversalRes.details?.matchedDepth).toBe(3);

    // 4. Schema rejection / Error handling
    const invalidRes = await handleVerifyOracle({
      oracle_type: "non_existent_oracle",
      parameters: {},
    });
    expect(invalidRes.outcome).toBe("error");
    expect(invalidRes.error).toBe("UNSUPPORTED_ORACLE_TYPE");

    const missingTypeRes = await handleVerifyOracle({});
    expect(missingTypeRes.outcome).toBe("error");
    expect(missingTypeRes.error).toBe("INVALID_ARGUMENT");
  });
});
