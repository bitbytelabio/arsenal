"""Deterministic mathematical and logical verification oracles for Arsenal.

Implements contracts/evidence-reporting.md §3, contracts/verification-oracle.md,
and data-model.md §6.
"""

from __future__ import annotations

import math
import re
import statistics
from typing import Any, Literal

OracleOutcome = Literal["validated", "unvalidated", "rejected", "partial", "error"]

PASSWD_REGEX = re.compile(r"root:[^:]*:[0-9]+:[0-9]+:[^:]*:[^:]*:[^\n\r]*")


def calculate_median(values: list[float]) -> float:
    """Calculate median using stdlib statistics."""
    if not values:
        return 0.0
    return float(statistics.median(values))


def verify_timing_differential(
    expected_delay_ms: float,
    pairs: list[dict[str, Any]],
    has_transport_error: bool = False,
    has_affirmative_counterevidence: bool = False,
) -> dict[str, Any]:
    """Verify time-based injection vulnerabilities using statistical separation.

    Criteria:
    median(probe) - median(baseline) >= max(750ms, 0.6 * expected_delay)
    AND at least n-1 paired differences >= max(500ms, 0.4 * expected_delay)
    """
    if has_transport_error:
        return {
            "outcome": "error",
            "medianBaselineMs": 0.0,
            "medianProbeMs": 0.0,
            "medianSeparationMs": 0.0,
            "pairedDifferences": [],
            "rationale": "Transport error or connection reset encountered during timing probe execution.",
        }

    if has_affirmative_counterevidence:
        return {
            "outcome": "rejected",
            "medianBaselineMs": 0.0,
            "medianProbeMs": 0.0,
            "medianSeparationMs": 0.0,
            "pairedDifferences": [],
            "rationale": "Affirmative counterevidence observed: target explicitly processed probe with immediate benign response.",
        }

    if not pairs or len(pairs) < 3:
        return {
            "outcome": "partial",
            "medianBaselineMs": 0.0,
            "medianProbeMs": 0.0,
            "medianSeparationMs": 0.0,
            "pairedDifferences": [],
            "rationale": "Insufficient sample size: at least 3 alternating baseline/probe pairs required.",
        }

    # Validate finite non-negative durations
    baselines: list[float] = []
    probes: list[float] = []
    paired_diffs: list[float] = []

    for p in pairs:
        b = float(p.get("baselineMs", p.get("baseline_ms", 0.0)))
        pr = float(p.get("probeMs", p.get("probe_ms", 0.0)))

        if not math.isfinite(b) or not math.isfinite(pr) or b < 0 or pr < 0:
            return {
                "outcome": "error",
                "medianBaselineMs": 0.0,
                "medianProbeMs": 0.0,
                "medianSeparationMs": 0.0,
                "pairedDifferences": [],
                "rationale": "Invalid observation durations: all baseline and probe values must be finite non-negative numbers.",
            }

        baselines.append(b)
        probes.append(pr)
        paired_diffs.append(pr - b)

    median_baseline = calculate_median(baselines)
    median_probe = calculate_median(probes)
    median_separation = median_probe - median_baseline

    min_median_separation = max(750.0, 0.6 * expected_delay_ms)
    min_paired_separation = max(500.0, 0.4 * expected_delay_ms)

    qualifying_pairs = sum(1 for d in paired_diffs if d >= min_paired_separation)
    n_minus_one = len(pairs) - 1

    if median_separation >= min_median_separation and qualifying_pairs >= n_minus_one:
        return {
            "outcome": "validated",
            "medianBaselineMs": median_baseline,
            "medianProbeMs": median_probe,
            "medianSeparationMs": median_separation,
            "pairedDifferences": paired_diffs,
            "rationale": (
                f"Statistical separation confirmed: median probe ({median_probe}ms) - "
                f"median baseline ({median_baseline}ms) = {median_separation}ms >= "
                f"threshold {min_median_separation}ms; {qualifying_pairs}/{len(pairs)} "
                f"pairs >= {min_paired_separation}ms."
            ),
        }

    return {
        "outcome": "partial",
        "medianBaselineMs": median_baseline,
        "medianProbeMs": median_probe,
        "medianSeparationMs": median_separation,
        "pairedDifferences": paired_diffs,
        "rationale": (
            f"Insufficient timing separation: median difference {median_separation}ms "
            f"(required >= {min_median_separation}ms), qualifying pairs "
            f"{qualifying_pairs}/{len(pairs)} (required >= {n_minus_one}). "
            "Mapped to partial (never rejected without counterevidence)."
        ),
    }


def verify_authorization_matrix(
    endpoint: str,
    observations: list[dict[str, Any]],
    has_transport_error: bool = False,
) -> dict[str, Any]:
    """Verify authorization matrix across identities to detect BOLA / IDOR."""
    if has_transport_error:
        return {
            "outcome": "error",
            "vulnerableIdentities": [],
            "rationale": "Transport or network socket failure during authorization matrix replay.",
        }

    if not observations:
        return {
            "outcome": "partial",
            "vulnerableIdentities": [],
            "rationale": "No identity observations provided for authorization matrix comparison.",
        }

    vulnerable: list[str] = []

    for obs in observations:
        raw_id = str(obs.get("identity") or obs.get("role") or "anonymous").lower()
        if raw_id in ("authorized", "admin"):
            identity = "authorized"
        elif raw_id in ("unauthorized", "user", "victim"):
            identity = "unauthorized"
        else:
            identity = "anonymous"

        status_code = int(obs.get("statusCode") or obs.get("status_code") or obs.get("observedStatus") or 200)
        is_business_data = bool(
            obs.get("isBusinessDataPresent")
            if "isBusinessDataPresent" in obs
            else (
                obs.get("is_business_data_present")
                if "is_business_data_present" in obs
                else (obs.get("observedOutcome") == "allow")
            )
        )

        if identity in ("unauthorized", "anonymous"):
            if status_code == 200 and is_business_data:
                if identity not in vulnerable:
                    vulnerable.append(identity)

    if vulnerable:
        return {
            "outcome": "validated",
            "vulnerableIdentities": vulnerable,
            "rationale": (
                f"Broken access control confirmed: unprivileged identity(ies) [{', '.join(vulnerable)}] "
                "accessed protected resource with 200 OK and business data payload."
            ),
        }

    unprivileged = [
        obs
        for obs in observations
        if str(obs.get("identity") or obs.get("role") or "anonymous").lower() not in ("authorized", "admin")
    ]
    all_rejected = bool(
        unprivileged
        and all(
            int(o.get("statusCode") or o.get("status_code") or o.get("observedStatus") or 200) in (401, 403)
            for o in unprivileged
        )
    )

    if all_rejected:
        return {
            "outcome": "rejected",
            "vulnerableIdentities": [],
            "rationale": "Affirmative counterevidence: all unprivileged identities correctly blocked with 401/403 status codes.",
        }

    return {
        "outcome": "partial",
        "vulnerableIdentities": [],
        "rationale": "Ambiguous response: target returned inconclusive status codes without confidential business payload.",
    }


def verify_path_traversal(
    baseline_status_code: int,
    baseline_body: str,
    probe_responses: list[dict[str, Any]],
    has_transport_error: bool = False,
) -> dict[str, Any]:
    """Verify path traversal file disclosure against baseline and depth probes."""
    if has_transport_error:
        return {
            "outcome": "error",
            "rationale": "Transport failure or network socket error during path traversal probe execution.",
        }

    if PASSWD_REGEX.search(baseline_body):
        return {
            "outcome": "error",
            "rationale": "Invalid oracle baseline: baseline response already contained target file signature.",
        }

    for probe in probe_responses:
        status_code = int(probe.get("statusCode", probe.get("status_code", 200)))
        body = str(probe.get("body", probe.get("responseBytes", probe.get("response_body", ""))))
        depth = int(probe.get("depth", 0))

        if status_code == 200 and PASSWD_REGEX.search(body):
            return {
                "outcome": "validated",
                "matchedDepth": depth,
                "rationale": (
                    f"Confirmed path traversal file leak at depth {depth}: response contains "
                    "/etc/passwd root account entry not present in baseline."
                ),
            }

    all_blocked = bool(
        probe_responses
        and all(
            int(p.get("statusCode", p.get("status_code", 200))) in (401, 403)
            or "access denied" in str(p.get("body", p.get("responseBytes", ""))).lower()
            for p in probe_responses
        )
    )

    if all_blocked:
        return {
            "outcome": "rejected",
            "rationale": (
                "Affirmative counterevidence: target explicitly denied or normalized all traversal "
                "probe depths (403/401 Access Denied)."
            ),
        }

    return {
        "outcome": "partial",
        "rationale": (
            "Inconclusive response: target returned benign status (e.g. 404 / 200 without file content). "
            "No proof of file disclosure."
        ),
    }


def verify_oracle(input_data: dict[str, Any]) -> dict[str, Any]:
    """Universal dispatcher for deterministic verification oracles."""
    oracle_type = input_data.get("oracle_type") or input_data.get("oracleType")
    if not oracle_type:
        return {
            "outcome": "error",
            "rationale": "Missing required 'oracle_type' parameter.",
            "error": "INVALID_ARGUMENT",
        }

    params = input_data.get("parameters") or input_data.get("params") or {}
    if not isinstance(params, dict):
        params = {}

    if oracle_type == "timing_differential":
        expected_delay = float(params.get("expectedDelayMs", params.get("expected_delay_ms", 0.0)))
        raw_pairs = params.get("pairs") or []
        has_err = bool(params.get("hasTransportError", params.get("has_transport_error", False)))
        has_counter = bool(
            params.get("hasAffirmativeCounterevidence", params.get("has_affirmative_counterevidence", False))
        )

        res = verify_timing_differential(
            expected_delay_ms=expected_delay,
            pairs=raw_pairs,
            has_transport_error=has_err,
            has_affirmative_counterevidence=has_counter,
        )
        return {
            "outcome": res["outcome"],
            "rationale": res["rationale"],
            "details": {
                "medianBaselineMs": res.get("medianBaselineMs", 0.0),
                "medianProbeMs": res.get("medianProbeMs", 0.0),
                "medianSeparationMs": res.get("medianSeparationMs", 0.0),
                "pairedDifferences": res.get("pairedDifferences", []),
            },
        }

    if oracle_type == "authz_matrix":
        endpoint = str(
            params.get("endpoint")
            or (params.get("endpoints")[0] if isinstance(params.get("endpoints"), list) and params.get("endpoints") else "/api")
        )
        raw_obs = params.get("observations") or []
        has_err = bool(params.get("hasTransportError", params.get("has_transport_error", False)))

        res = verify_authorization_matrix(
            endpoint=endpoint,
            observations=raw_obs,
            has_transport_error=has_err,
        )
        return {
            "outcome": res["outcome"],
            "rationale": res["rationale"],
            "details": {
                "vulnerableIdentities": res.get("vulnerableIdentities", []),
            },
        }

    if oracle_type == "path_traversal":
        base_code = int(params.get("baselineStatusCode", params.get("baseline_status_code", 404)))
        base_body = str(params.get("baselineBody", params.get("baseline_body", "")))
        raw_probes = (
            params.get("probeResponses")
            or params.get("probe_responses")
            or params.get("probes")
            or []
        )
        has_err = bool(params.get("hasTransportError", params.get("has_transport_error", False)))

        res = verify_path_traversal(
            baseline_status_code=base_code,
            baseline_body=base_body,
            probe_responses=raw_probes,
            has_transport_error=has_err,
        )
        details: dict[str, Any] = {}
        if "matchedDepth" in res:
            details["matchedDepth"] = res["matchedDepth"]

        return {
            "outcome": res["outcome"],
            "rationale": res["rationale"],
            "details": details,
        }

    return {
        "outcome": "error",
        "rationale": (
            f"Unsupported oracle_type '{oracle_type}'. Supported: "
            "timing_differential, authz_matrix, path_traversal."
        ),
        "error": "UNSUPPORTED_ORACLE_TYPE",
    }

# TypeScript parity alias
handleVerifyOracle = verify_oracle

__all__ = [
    "calculate_median",
    "verify_timing_differential",
    "verify_authorization_matrix",
    "verify_path_traversal",
    "verify_oracle",
    "handleVerifyOracle",
]
