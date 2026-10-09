/**
 * Path Traversal Verification Oracle
 * Implements contracts/evidence-reporting.md §3.2 & T045
 */

export interface PathTraversalObservation {
  depth: number;
  statusCode: number;
  body: string;
}

export interface PathTraversalInput {
  baselineStatusCode: number;
  baselineBody: string;
  probeResponses: PathTraversalObservation[];
  hasTransportError?: boolean;
}

export interface PathTraversalOracleResult {
  outcome: "validated" | "unvalidated" | "rejected" | "partial" | "error";
  matchedDepth?: number;
  rationale: string;
}

const PASSWD_REGEX = /root:[^:]*:[0-9]+:[0-9]+:[^:]*:[^:]*:[^\n\r]*/;

export function verifyPathTraversal(input: PathTraversalInput): PathTraversalOracleResult {
  if (input.hasTransportError) {
    return {
      outcome: "error",
      rationale: "Transport failure or network socket error during path traversal probe execution.",
    };
  }

  // Ensure baseline does not contain passwd pattern
  if (PASSWD_REGEX.test(input.baselineBody)) {
    return {
      outcome: "error",
      rationale: "Invalid oracle baseline: baseline response already contained target file signature.",
    };
  }

  // Check for confirmed file leak in any depth probe
  for (const probe of input.probeResponses) {
    if (probe.statusCode === 200 && PASSWD_REGEX.test(probe.body)) {
      return {
        outcome: "validated",
        matchedDepth: probe.depth,
        rationale: `Confirmed path traversal file leak at depth ${probe.depth}: response contains /etc/passwd root account entry not present in baseline.`,
      };
    }
  }

  // Check for explicit access denied / blocking
  const allBlocked = input.probeResponses.every(
    (p) => p.statusCode === 403 || p.statusCode === 401 || p.body.toLowerCase().includes("access denied")
  );
  if (allBlocked && input.probeResponses.length > 0) {
    return {
      outcome: "rejected",
      rationale: "Affirmative counterevidence: target explicitly denied or normalized all traversal probe depths (403/401 Access Denied).",
    };
  }

  // Benign or inconclusive response
  return {
    outcome: "partial",
    rationale: "Inconclusive response: target returned benign status (e.g. 404 / 200 without file content). No proof of file disclosure.",
  };
}
