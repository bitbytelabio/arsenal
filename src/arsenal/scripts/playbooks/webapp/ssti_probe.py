#!/usr/bin/env python3
# For authorized penetration testing and educational environments only.
# Usage against targets without prior mutual consent is illegal.
# It is the end user's responsibility to obey all applicable local, state and federal laws.
"""Playbook agent for Server-Side Template Injection (SSTI) identification and mathematical verification."""

from __future__ import annotations

import argparse
import json
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
class SSTITestVector:
    engine: str
    syntax_family: str
    probe_expr: str
    expected_eval: str
    differential_expr: str
    differential_eval: str


SSTI_VECTORS: list[SSTITestVector] = [
    SSTITestVector(
        engine="Jinja2 / Python",
        syntax_family="{{...}}",
        probe_expr="{{7*7}}",
        expected_eval="49",
        differential_expr="{{8*8}}",
        differential_eval="64",
    ),
    SSTITestVector(
        engine="Jinja2 String Multiply",
        syntax_family="{{...}}",
        probe_expr="{{7*'7'}}",
        expected_eval="7777777",
        differential_expr="{{3*'x'}}",
        differential_eval="xxx",
    ),
    SSTITestVector(
        engine="Twig / PHP",
        syntax_family="{{...}}",
        probe_expr="{{7*'7'}}",
        expected_eval="49",
        differential_expr="{{8*'8'}}",
        differential_eval="64",
    ),
    SSTITestVector(
        engine="Smarty / PHP",
        syntax_family="{...}",
        probe_expr="{7*7}",
        expected_eval="49",
        differential_expr="{8*8}",
        differential_eval="64",
    ),
    SSTITestVector(
        engine="Freemarker / Java",
        syntax_family="${...}",
        probe_expr="${7*7}",
        expected_eval="49",
        differential_expr="${8*8}",
        differential_eval="64",
    ),
    SSTITestVector(
        engine="Velocity / Java",
        syntax_family="#set",
        probe_expr="#set($x=7*7)$x",
        expected_eval="49",
        differential_expr="#set($y=8*8)$y",
        differential_eval="64",
    ),
    SSTITestVector(
        engine="Ruby ERB",
        syntax_family="<%= ... %>",
        probe_expr="<%= 7*7 %>",
        expected_eval="49",
        differential_expr="<%= 8*8 %>",
        differential_eval="64",
    ),
    SSTITestVector(
        engine="Spring EL (SpEL)",
        syntax_family="${...}",
        probe_expr="${T(java.lang.Math).multiplyExact(7,7)}",
        expected_eval="49",
        differential_expr="${T(java.lang.Math).multiplyExact(8,8)}",
        differential_eval="64",
    ),
]


def run_ssti_audit(
    base_target: str,
    param_name: str = "q",
    rate_limit: float = 10.0,
    timeout: float = 10.0,
    proxy: str | None = None,
    auth_header: str | None = None,
) -> dict[str, Any]:
    """Execute tripartite SSTI audit probing template expression evaluation across multiple engines."""
    if httpx is None:
        return {"error": "httpx package is required for SSTI probing. Install with 'pip install httpx'."}

    request_headers: dict[str, str] = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Arsenal/4.0 SSTI-Probe",
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

    # Step 1: Negative Baseline Control Probe
    rate_limit_sleep()
    control_marker = "__ssti_ctrl_baseline_9f21__"
    query_params[param_name] = control_marker
    control_url = urllib.parse.urlunparse(parsed_base._replace(query=urllib.parse.urlencode(query_params)))

    baseline_status = None
    baseline_body = ""
    try:
        resp = client.get(control_url)
        baseline_status = resp.status_code
        baseline_body = resp.text
    except Exception as exc:
        baseline_status = f"error: {exc}"

    # Step 2: Active Evaluation Probes
    confirmed_findings: list[dict[str, Any]] = []
    probe_results: list[dict[str, Any]] = []

    for vec in SSTI_VECTORS:
        rate_limit_sleep()
        query_params[param_name] = vec.probe_expr
        probe_url = urllib.parse.urlunparse(parsed_base._replace(query=urllib.parse.urlencode(query_params)))

        record: dict[str, Any] = {
            "engine": vec.engine,
            "syntax_family": vec.syntax_family,
            "injected_expr": vec.probe_expr,
            "expected_eval": vec.expected_eval,
            "status_code": None,
            "eval_confirmed": False,
            "differential_confirmed": False,
            "tripartite_verified": False,
        }

        try:
            resp = client.get(probe_url)
            body = resp.text
            record["status_code"] = resp.status_code

            # Check if evaluated result is present in body while literal probe is NOT reflected
            has_eval = vec.expected_eval in body
            has_literal = vec.probe_expr in body

            if has_eval and not has_literal and (vec.expected_eval not in baseline_body):
                record["eval_confirmed"] = True

                # Step 3: Differential Verification to eliminate coincidental number matches
                rate_limit_sleep()
                query_params[param_name] = vec.differential_expr
                diff_url = urllib.parse.urlunparse(parsed_base._replace(query=urllib.parse.urlencode(query_params)))
                diff_resp = client.get(diff_url)

                if (
                    vec.differential_eval in diff_resp.text
                    and vec.differential_expr not in diff_resp.text
                    and vec.differential_eval not in baseline_body
                ):
                    record["differential_confirmed"] = True
                    record["tripartite_verified"] = True
                    confirmed_findings.append(record)

        except Exception as exc:
            record["error"] = str(exc)

        probe_results.append(record)

    client.close()

    return {
        "verified_vulnerable": len(confirmed_findings) > 0,
        "confirmed_count": len(confirmed_findings),
        "baseline_control": {
            "marker": control_marker,
            "status": baseline_status,
            "reflected": control_marker in baseline_body,
        },
        "confirmed_findings": confirmed_findings,
        "all_probes": probe_results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Automated Server-Side Template Injection (SSTI) and Arithmetic Verification Agent."
    )
    parser.add_argument("--target", required=True, help="Target URL with injectable parameter (e.g. https://app.example.com/search)")
    parser.add_argument("--param", default="q", help="Query parameter name to inject SSTI payloads into (default: q)")
    parser.add_argument("--rate-limit", type=float, default=10.0, help="Maximum requests per second (default: 10.0)")
    parser.add_argument("--timeout", type=float, default=10.0, help="HTTP request timeout in seconds (default: 10.0)")
    parser.add_argument("--proxy", help="Optional HTTP/HTTPS proxy URL (e.g. http://127.0.0.1:8080)")
    parser.add_argument("--auth-header", help="Optional Authorization header value (e.g. 'Bearer <token>')")

    args = parser.parse_args()

    in_scope, out_of_scope = resolve_scope_rules()

    result = run_ssti_audit(
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
