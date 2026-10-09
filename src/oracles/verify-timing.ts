/**
 * Timing Differential Verification Oracle
 * Implements contracts/evidence-reporting.md §3.1 & T044
 * Verifies time-based injection vulnerabilities using statistical separation:
 * median(probe_durations) - median(baseline_durations) >= max(750ms, 0.6 * expected_delay)
 * AND at least n-1 paired differences >= max(500ms, 0.4 * expected_delay)
 */

export interface TimingPairObservation {
  baselineMs: number;
  probeMs: number;
}

export interface TimingVerificationInput {
  expectedDelayMs: number;
  pairs: TimingPairObservation[];
  hasTransportError?: boolean;
  hasAffirmativeCounterevidence?: boolean;
}

export interface TimingOracleResult {
  outcome: "validated" | "unvalidated" | "rejected" | "partial" | "error";
  medianBaselineMs: number;
  medianProbeMs: number;
  medianSeparationMs: number;
  pairedDifferences: number[];
  rationale: string;
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function verifyTimingDifferential(input: TimingVerificationInput): TimingOracleResult {
  if (input.hasTransportError) {
    return {
      outcome: "error",
      medianBaselineMs: 0,
      medianProbeMs: 0,
      medianSeparationMs: 0,
      pairedDifferences: [],
      rationale: "Transport error or connection reset encountered during timing probe execution.",
    };
  }

  if (input.hasAffirmativeCounterevidence) {
    return {
      outcome: "rejected",
      medianBaselineMs: 0,
      medianProbeMs: 0,
      medianSeparationMs: 0,
      pairedDifferences: [],
      rationale: "Affirmative counterevidence observed: target explicitly processed probe with immediate benign response.",
    };
  }

  const { pairs, expectedDelayMs } = input;
  if (!pairs || pairs.length < 3) {
    return {
      outcome: "partial",
      medianBaselineMs: 0,
      medianProbeMs: 0,
      medianSeparationMs: 0,
      pairedDifferences: [],
      rationale: "Insufficient sample size: at least 3 alternating baseline/probe pairs required.",
    };
  }

  // Validate finite durations
  for (const p of pairs) {
    if (!Number.isFinite(p.baselineMs) || !Number.isFinite(p.probeMs) || p.baselineMs < 0 || p.probeMs < 0) {
      return {
        outcome: "error",
        medianBaselineMs: 0,
        medianProbeMs: 0,
        medianSeparationMs: 0,
        pairedDifferences: [],
        rationale: "Invalid observation durations: all baseline and probe values must be finite non-negative numbers.",
      };
    }
  }

  const baselines = pairs.map((p) => p.baselineMs);
  const probes = pairs.map((p) => p.probeMs);
  const pairedDiffs = pairs.map((p) => p.probeMs - p.baselineMs);

  const medianBaseline = calculateMedian(baselines);
  const medianProbe = calculateMedian(probes);
  const medianSeparation = medianProbe - medianBaseline;

  const minMedianSeparation = Math.max(750, 0.6 * expectedDelayMs);
  const minPairedSeparation = Math.max(500, 0.4 * expectedDelayMs);

  const qualifyingPairs = pairedDiffs.filter((d) => d >= minPairedSeparation).length;
  const nMinusOne = pairs.length - 1;

  if (medianSeparation >= minMedianSeparation && qualifyingPairs >= nMinusOne) {
    return {
      outcome: "validated",
      medianBaselineMs: medianBaseline,
      medianProbeMs: medianProbe,
      medianSeparationMs: medianSeparation,
      pairedDifferences: pairedDiffs,
      rationale: `Statistical separation confirmed: median probe (${medianProbe}ms) - median baseline (${medianBaseline}ms) = ${medianSeparation}ms >= threshold ${minMedianSeparation}ms; ${qualifyingPairs}/${pairs.length} pairs >= ${minPairedSeparation}ms.`,
    };
  }

  return {
    outcome: "partial",
    medianBaselineMs: medianBaseline,
    medianProbeMs: medianProbe,
    medianSeparationMs: medianSeparation,
    pairedDifferences: pairedDiffs,
    rationale: `Insufficient timing separation: median difference ${medianSeparation}ms (required >= ${minMedianSeparation}ms), qualifying pairs ${qualifyingPairs}/${pairs.length} (required >= ${nMinusOne}). Mapped to partial (never rejected without counterevidence).`,
  };
}
