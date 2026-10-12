/**
 * Integration Readiness Model
 * Implements data-model.md §IntegrationConfiguration and ReadinessObservation & T065
 */

export type CanonicalIntegrationId = "ida-pro" | "ghidra" | "jshook" | "burp-ultra" | "playwright" | "rea";

export type ReadinessState =
  | "disabled"
  | "denied"
  | "invalid_config"
  | "missing_prerequisite"
  | "unreachable"
  | "not_live"
  | "ready"
  | "unchecked";

export interface IntegrationEvaluation {
  id: CanonicalIntegrationId;
  state: ReadinessState;
  reason: string;
}

export function evaluateIntegrationReadiness(params: {
  id: CanonicalIntegrationId;
  isDeniedInProfile: boolean;
  isEnabledInProject: boolean;
  hasInvalidConfig?: boolean;
  missingPrerequisiteBinary?: string | null;
  isLiveCheckRequested?: boolean;
  isEndpointReachable?: boolean;
  isLiveSessionPresent?: boolean;
}): IntegrationEvaluation {
  // 1. Profile deny always takes highest precedence (Principle V / FR-039)
  if (params.isDeniedInProfile) {
    return {
      id: params.id,
      state: "denied",
      reason: "Explicitly denied in operator profile. Profile deny overrides project enable.",
    };
  }

  // 2. Disabled by default
  if (!params.isEnabledInProject) {
    return {
      id: params.id,
      state: "disabled",
      reason: "Integration bridge is configured with enabled: false.",
    };
  }

  // 3. Invalid configuration
  if (params.hasInvalidConfig) {
    return {
      id: params.id,
      state: "invalid_config",
      reason: "Bridge configuration is invalid (malformed JSON or conflicting command/url).",
    };
  }

  // 4. Missing binary prerequisite
  if (params.missingPrerequisiteBinary) {
    return {
      id: params.id,
      state: "missing_prerequisite",
      reason: `Required binary '${params.missingPrerequisiteBinary}' not found in host PATH.`,
    };
  }

  // 5. Live probing
  if (params.isLiveCheckRequested) {
    if (params.isEndpointReachable === false) {
      return {
        id: params.id,
        state: "unreachable",
        reason: "Target endpoint socket connection refused or timed out.",
      };
    }
    if (params.isLiveSessionPresent === false) {
      return {
        id: params.id,
        state: "not_live",
        reason: "Bridge endpoint reachable but live GUI/analysis session is absent.",
      };
    }
    return {
      id: params.id,
      state: "ready",
      reason: "Live protocol handshake and active session verified.",
    };
  }

  return {
    id: params.id,
    state: "unchecked",
    reason: "Static prerequisites verified; live socket probe was not requested.",
  };
}
