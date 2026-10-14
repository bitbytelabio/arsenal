---
name: webapp-web-surface-discovery
description: Web crawling and attack-surface mapping including links, forms, redirects, sitemap, and browser-derived endpoints.
domain: webapp
category: reconnaissance
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/webapp-web-surface-discovery/SKILL.md
---
# Web Surface Discovery & Crawling (Deep Operational Playbook)

## When to Use
Map all reachable pages, dynamic API routes, form targets, redirect chains, and client-side JavaScript endpoints on the authorized target prior to vulnerability assessment. This playbook generates the authoritative Endpoint Inventory and Form Schema Registry for downstream testing.

---

## 1. Operational Decision Tree

```text
                  [Target Scope Defined]
                            │
                            ▼
              [Preflight Boundary Validation]
       (Check .omp/arsenal/scope.json for Target IP/Domain)
                            │
               ┌────────────┴────────────┐
               │                         │
     [Static / Multi-Page App]     [SPA / JS-Heavy Framework]
               │                         │
               ▼                         ▼
   [Stage 1: Native In-Process]  [Stage 2: Headless Katana Engine]
   arsenal scripts webapp-web-   katana -u https://$TARGET
   surface-discovery --target...    -headless -system-chrome ...
               │                         │
               └────────────┬────────────┘
                            │
                            ▼
           [Stage 3: Passive Archive Reconnaissance]
           gauplus / waymore URL extraction & deduplication
                            │
                            ▼
           [Stage 4: Client-Side JS Route Extraction]
           jsluice / AST regex extraction on discovered .js bundles
                            │
                            ▼
           [Stage 5: Soft-404 & WAF Elimination Oracle]
           Cluster responses by length and title; drop false positives
                            │
                            ▼
           [Stage 6: Evidence & Ledger Registration]
           arsenal append-evidence --case $CASE_ID --file ...
```

---

## 2. Multi-Stage Tooling Pipeline & Execution

### Stage 1: Native In-Process Python Crawler (Fast, Scoped & Proxy-Safe)
Execute Arsenal's built-in async crawler. It validates target boundaries against active engagement scope, parses links and forms using standard HTML DOM tree analysis, and enforces concurrency and rate limits:

```bash
# Execute native crawler with rate limit (10 req/s) and recursion depth 2
arsenal scripts webapp-web-surface-discovery \
  --target https://$TARGET \
  --depth 2 \
  --concurrency 5 \
  --rate-limit 10 \
  --timeout 10 \
  --json > tmp/native_crawl.json

# If routing through an authorized intercepting proxy (Burp / mitmproxy):
arsenal scripts webapp-web-surface-discovery \
  --target https://$TARGET \
  --depth 2 \
  --proxy http://127.0.0.1:8080 \
  --json > tmp/native_crawl.json
```

### Stage 2: Passive Archive Reconnaissance (Zero Target Impact)
Query third-party historical indexes (Wayback Machine, Common Crawl, AlienVault OTX) without sending traffic directly to the target infrastructure:

```bash
# Extract passive historical URLs
gauplus --subs --random-agent -o tmp/passive_gau.txt $TARGET
waymore -i $TARGET -mode U -oU tmp/passive_waymore.txt

# Merge and deduplicate
cat tmp/passive_gau.txt tmp/passive_waymore.txt 2>/dev/null | sort -u > tmp/passive_urls.txt
```

### Stage 3: Active Recursive Crawling (External Toolchain Fallback)
For large-scale active discovery when external Go tools are present:

```bash
katana -u https://$TARGET \
  -depth 3 \
  -concurrency 5 \
  -rate-limit 15 \
  -timeout 10 \
  -known-files all \
  -automatic-form-fill \
  -headers "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Arsenal/4.0" \
  -output tmp/katana_active.txt
```

### Stage 4: Single-Page Application (SPA) Headless Rendering
When targets rely heavily on client-side routing (React, Angular, Vue, Next.js):

```bash
katana -u https://$TARGET \
  -headless \
  -system-chrome \
  -no-sandbox \
  -crawl-duration 3m \
  -xhr \
  -output tmp/katana_headless.txt
```

### Stage 5: Client-Side JavaScript Secret & Route Extraction
Parse discovered JavaScript bundles for API routes and hidden endpoints:

```bash
cat tmp/*.txt tmp/*.json 2>/dev/null | grep -Eo 'https?://[^ ]+\.js(\?[^ ]*)?' | sort -u > tmp/js_files.txt
while read -r js_url; do
  curl -sk -A "Mozilla/5.0" "$js_url" | grep -Eo '["'\''/][a-zA-Z0-9_?&=/.-]{3,}["'\'']' >> tmp/js_raw_strings.txt
done < tmp/js_files.txt
sort -u tmp/js_raw_strings.txt > tmp/js_endpoints.txt
```

---

## 3. Tripartite Verification Oracle

A discovered attack surface is confirmed valid only when three verification controls are satisfied:

1. **Positive Assertion**:
   - Total verified unique HTTP 200/301/302 endpoints $> 0$.
   - Interactive forms captured with explicit `action`, `method`, and named input fields.
2. **Negative Baseline Control**:
   - Probe target with a randomized non-existent path:
     ```bash
     curl -sk -w "%{http_code}:%{size_download}\n" https://$TARGET/rand_baseline_probe_9f82 -o /dev/null
     ```
   - Confirm baseline response size and status code to distinguish genuine endpoints from custom soft-404 catch-alls.
3. **Differential Invariance**:
   - Filter out pages whose response body size or DOM tree structure matches the baseline 404 template within $\pm 2\%$ variance.

---

## 4. False-Positive & Edge-Case Elimination

- **Soft-404 Elimination**: Single-page applications often return HTTP 200 for every route. Verify that the response body contains page-specific content rather than generic `"Page Not Found"` or `"App Loading..."` placeholder markers.
- **WAF Challenge Differentiation**: If multiple requests return identical HTTP 403 / 503 with Cloudflare, Akamai, or AWS WAF signatures (CAPTCHA challenge, block page), immediately pause crawl and throttle rate limit:
  ```bash
  arsenal scripts webapp-web-surface-discovery --target https://$TARGET --rate-limit 1 --concurrency 1
  ```
- **Dangerous Endpoints Avoidance**: Never crawl `/logout`, `/signout`, `/delete`, `/destroy`, or `/deactivate` URLs to avoid premature session invalidation or state corruption.

---

## 5. Evidence Capture & Ledger Registration

Register the synthesized attack surface map into Arsenal's cryptographic evidence pipeline:

```bash
# Capture raw inventory into case evidence repository
arsenal append-evidence \
  --case $CASE_ID \
  --tool webapp-web-surface-discovery \
  --file tmp/native_crawl.json \
  --desc "Validated web attack surface inventory and extracted form definitions"
```

---

## 6. Kill-Chain Chaining & Handoffs

- **Prerequisites**: Target IP or domain must be registered in `.omp/arsenal/scope.json` with active engagement window.
- **Downstream Handoffs**:
  - Feed discovered parameter URLs into `webapp-api-parameter-discovery` (`arjun` / `paramspider`).
  - Feed input forms into `webapp-exploiting-sql-injection-vulnerabilities` and `webapp-testing-for-xss-vulnerabilities`.
  - Feed administrative and backup endpoints into `webapp-discovering-unreferenced-backup-files`.
