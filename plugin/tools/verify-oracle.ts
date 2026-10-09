/**
 * verify_oracle Registered Tool
 * Implements contracts/verification-oracle.md & data-model.md §6
 * Provides deterministic mathematical and logical verification oracles for sec-verifier.
 */

import {
  verifyTimingDifferential,
  type TimingVerificationInput,
  type TimingOracleResult,
} from "../../src/oracles/verify-timing.ts";
import {
  verifyAuthorizationMatrix,
  type AuthzMatrixInput,
  type AuthzMatrixOracleResult,
  type AuthzIdentityObservation,
} from "../../src/oracles/authz-matrix.ts";
import {
  verifyPathTraversal,
  type PathTraversalInput,
  type PathTraversalOracleResult,
  type PathTraversalObservation,
} from "../../src/oracles/verify-path-traversal.ts";

export type OracleType = "timing_differential" | "authz_matrix" | "path_traversal";

export interface VerifyOracleArgs {
  oracle_type?: string;
  parameters?: Record<string, unknown>;
}

export interface VerifyOracleResult {
  outcome: "validated" | "unvalidated" | "rejected" | "partial" | "error";
  rationale: string;
  details?: Record<string, unknown>;
  error?: string;
}

export async function handleVerifyOracle(args: unknown): Promise<VerifyOracleResult> {
  const input = (args ?? {}) as VerifyOracleArgs;

  if (!input.oracle_type) {
    return {
      outcome: "error",
      rationale: "Missing required 'oracle_type' parameter.",
      error: "INVALID_ARGUMENT",
    };
  }

  const params = input.parameters ?? {};

  switch (input.oracle_type) {
    case "timing_differential": {
      const expectedDelayMs = Number(params.expectedDelayMs ?? params.expected_delay_ms ?? 0);
      const rawPairs = (params.pairs as Array<{ baselineMs?: number; probeMs?: number; baseline_ms?: number; probe_ms?: number }>) ?? [];

      const pairs = rawPairs.map((p) => ({
        baselineMs: Number(p.baselineMs ?? p.baseline_ms ?? 0),
        probeMs: Number(p.probeMs ?? p.probe_ms ?? 0),
      }));

      const timingInput: TimingVerificationInput = {
        expectedDelayMs,
        pairs,
        hasTransportError: Boolean(params.hasTransportError ?? params.has_transport_error),
        hasAffirmativeCounterevidence: Boolean(
          params.hasAffirmativeCounterevidence ?? params.has_affirmative_counterevidence
        ),
      };

      const result: TimingOracleResult = verifyTimingDifferential(timingInput);
      return {
        outcome: result.outcome,
        rationale: result.rationale,
        details: {
          medianBaselineMs: result.medianBaselineMs,
          medianProbeMs: result.medianProbeMs,
          medianSeparationMs: result.medianSeparationMs,
          pairedDifferences: result.pairedDifferences,
        },
      };
    }

    case "authz_matrix": {
      const endpoint = String(params.endpoint ?? (params.endpoints as string[])?.[0] ?? "/api");
      const rawObservations = (params.observations as Array<Record<string, unknown>>) ?? [];

      const observations: AuthzIdentityObservation[] = rawObservations.map((obs) => {
        let identity: "authorized" | "unauthorized" | "anonymous" = "anonymous";
        const rawId = String(obs.identity ?? obs.role ?? "anonymous").toLowerCase();
        if (rawId === "authorized" || rawId === "admin") {
          identity = "authorized";
        } else if (rawId === "unauthorized" || rawId === "user" || rawId === "victim") {
          identity = "unauthorized";
        }

        const statusCode = Number(obs.statusCode ?? obs.status_code ?? obs.observedStatus ?? 200);
        const body = String(obs.body ?? "");
        const isBusinessDataPresent = Boolean(
          obs.isBusinessDataPresent ?? obs.is_business_data_present ?? obs.observedOutcome === "allow"
        );

        return {
          identity,
          statusCode,
          body,
          isBusinessDataPresent,
        };
      });

      const authzInput: AuthzMatrixInput = {
        endpoint,
        observations,
        hasTransportError: Boolean(params.hasTransportError ?? params.has_transport_error),
      };

      const result: AuthzMatrixOracleResult = verifyAuthorizationMatrix(authzInput);
      return {
        outcome: result.outcome,
        rationale: result.rationale,
        details: {
          vulnerableIdentities: result.vulnerableIdentities,
        },
      };
    }

    case "path_traversal": {
      const baselineStatusCode = Number(params.baselineStatusCode ?? params.baseline_status_code ?? 404);
      const baselineBody = String(params.baselineBody ?? params.baseline_body ?? "");

      const rawProbes =
        (params.probeResponses as Array<Record<string, unknown>>) ??
        (params.probe_responses as Array<Record<string, unknown>>) ??
        (params.probes as Array<Record<string, unknown>>) ??
        [];

      const probeResponses: PathTraversalObservation[] = rawProbes.map((p, idx) => ({
        depth: Number(p.depth ?? idx + 1),
        statusCode: Number(p.statusCode ?? p.status_code ?? 200),
        body: String(p.body ?? p.responseBytes ?? p.response_body ?? ""),
      }));

      const traversalInput: PathTraversalInput = {
        baselineStatusCode,
        baselineBody,
        probeResponses,
        hasTransportError: Boolean(params.hasTransportError ?? params.has_transport_error),
      };

      const result: PathTraversalOracleResult = verifyPathTraversal(traversalInput);
      return {
        outcome: result.outcome,
        rationale: result.rationale,
        details: {
          matchedDepth: result.matchedDepth,
        },
      };
    }

    default:
      return {
        outcome: "error",
        rationale: `Unsupported oracle_type '${input.oracle_type}'. Supported: timing_differential, authz_matrix, path_traversal.`,
        error: "UNSUPPORTED_ORACLE_TYPE",
      };
  }
}
