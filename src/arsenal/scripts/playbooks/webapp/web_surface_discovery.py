#!/usr/bin/env python3
# For authorized penetration testing and educational environments only.
# Usage against targets without prior mutual consent is illegal.
# It is the end user's responsibility to obey all applicable local, state and federal laws.
"""Playbook agent for web attack surface discovery and structured route/form crawling."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from arsenal.crawl import WebCrawler
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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Web surface discovery and crawling agent with scope containment and form extraction."
    )
    parser.add_argument("--target", "--url", dest="target", required=True, help="Target root URL (e.g. https://target.com)")
    parser.add_argument("--depth", type=int, default=2, help="Maximum crawl recursion depth (default: 2)")
    parser.add_argument("--concurrency", type=int, default=5, help="Concurrent request limit (default: 5)")
    parser.add_argument("--rate-limit", type=float, default=10.0, help="Maximum requests per second (default: 10.0)")
    parser.add_argument("--timeout", type=float, default=10.0, help="HTTP request timeout in seconds (default: 10.0)")
    parser.add_argument("--proxy", help="Optional HTTP/HTTPS proxy URL (e.g. http://127.0.0.1:8080)")
    parser.add_argument("--auth-header", help="Optional Authorization header value (e.g. 'Bearer <token>')")

    args = parser.parse_args()

    headers = {}
    if args.auth_header:
        headers["Authorization"] = args.auth_header

    in_scope, out_of_scope = resolve_scope_rules()

    crawler = WebCrawler(
        base_url=args.target,
        max_depth=args.depth,
        concurrency=args.concurrency,
        rate_limit=args.rate_limit,
        timeout=args.timeout,
        proxy=args.proxy,
        headers=headers,
        in_scope=in_scope,
        out_of_scope=out_of_scope,
    )

    try:
        result = asyncio.run(crawler.crawl())
    except Exception as exc:
        print(json.dumps({"error": f"Crawl failed: {exc}"}), file=sys.stderr)
        sys.exit(1)

    output = {
        "target": result.target,
        "endpoints_discovered": result.endpoints_discovered,
        "unique_urls": result.unique_urls,
        "forms": result.forms,
        "redirects": result.redirects,
        "soft_404s": result.soft_404s,
        "status_codes": result.status_codes,
        "errors": result.errors,
        "duration_ms": result.duration_ms,
    }

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
