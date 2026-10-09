/**
 * Authorization Matrix Verification Oracle
 * Implements contracts/evidence-reporting.md §3.3 & T046
 * Replays identical requests across multiple privilege identities to detect BOLA / IDOR
 */

export interface AuthzIdentityObservation {
  identity: "authorized" | "unauthorized" | "anonymous";
  statusCode: number;
  body: string;
  isBusinessDataPresent: boolean;
}

export interface AuthzMatrixInput {
  endpoint: string;
  observations: AuthzIdentityObservation[];
  hasTransportError?: boolean;
}

export interface AuthzMatrixOracleResult {
  outcome: "validated" | "unvalidated" | "rejected" | "partial" | "error";
  vulnerableIdentities: string[];
  rationale: string;
}

export function verifyAuthorizationMatrix(input: AuthzMatrixInput): AuthzMatrixOracleResult {
  if (input.hasTransportError) {
    return {
      outcome: "error",
      vulnerableIdentities: [],
      rationale: "Transport or network socket failure during authorization matrix replay.",
    };
  }

  const { observations } = input;
  if (!observations || observations.length === 0) {
    return {
      outcome: "partial",
      vulnerableIdentities: [],
      rationale: "No identity observations provided for authorization matrix comparison.",
    };
  }

  const vulnerable: string[] = [];

  for (const obs of observations) {
    if (obs.identity === "unauthorized" || obs.identity === "anonymous") {
      // If lower-privileged identity receives 200 OK and confidential business data -> BOLA confirmed
      if (obs.statusCode === 200 && obs.isBusinessDataPresent) {
        vulnerable.push(obs.identity);
      }
    }
  }

  if (vulnerable.length > 0) {
    return {
      outcome: "validated",
      vulnerableIdentities: vulnerable,
      rationale: `Broken access control confirmed: unprivileged identity(ies) [${vulnerable.join(", ")}] accessed protected resource with 200 OK and business data payload.`,
    };
  }

  // Check if all unprivileged attempts were cleanly rejected (401 / 403)
  const unprivileged = observations.filter(
    (o) => o.identity === "unauthorized" || o.identity === "anonymous"
  );
  const allRejected =
    unprivileged.length > 0 &&
    unprivileged.every((o) => o.statusCode === 401 || o.statusCode === 403);

  if (allRejected) {
    return {
      outcome: "rejected",
      vulnerableIdentities: [],
      rationale: "Affirmative counterevidence: all unprivileged identities correctly blocked with 401/403 status codes.",
    };
  }

  return {
    outcome: "partial",
    vulnerableIdentities: [],
    rationale: "Ambiguous response: target returned inconclusive status codes without confidential business payload.",
  };
}
