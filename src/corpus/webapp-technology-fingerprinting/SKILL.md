---
name: webapp-technology-fingerprinting
description: Deep technology stack identification including frameworks, CDNs, WAFs, and server-side runtimes.
domain: webapp
category: reconnaissance
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/webapp-technology-fingerprinting/SKILL.md
---
# Deep Technology Stack Fingerprinting & Attack Surface Profiling

## When to Use
Execute this operational playbook during the reconnaissance phase before any active exploitation. Accurate fingerprinting identifies web servers, reverse proxies, programming languages, application frameworks, CDNs, Web Application Firewalls (WAF), and third-party libraries. This intelligence prevents wasted test traffic, avoids generic brute-force attacks, and establishes the precise target attack surface aligned with OWASP WSTG-INFO-02, WSTG-INFO-08, WSTG-INFO-09, and WSTG-CONF-02.

---

## 1. Operational Decision Tree

```text
                     [Target Domain / IP Defined]
                                  │
                                  ▼
                    [Preflight Scope Validation]
              (Confirm target within scope.json bounds)
                                  │
                                  ▼
               [Stage 1: Passive HTTP Response Analysis]
             - Server, X-Powered-By, X-AspNet-Version, Via
             - Set-Cookie session token names (PHPSESSID, JSESSIONID)
             - Security headers & HTTP protocol versions (HTTP/2, HTTP/3)
                                  │
                                  ▼
               [Stage 2: WAF & CDN Perimeter Profiling]
             - wafw00f active heuristics (Cloudflare, AWS WAF, Akamai)
             - Error page signatures & CAPTCHA triggers
                                  │
                                  ▼
             [Stage 3: Automated Engine Stack Probing]
             - httpx -tech-detect -status-code -title
             - whatweb -a 3 aggressive fingerprinting
             - nuclei -tags tech,fingerprint
                                  │
                                  ▼
             [Stage 4: Client-Side Framework Analysis]
             - Next.js __NEXT_DATA__ JSON extraction
             - React, Vue, Angular, Nuxt DOM attributes & dev markers
             - Source map discovery (.js.map) & bundler metadata
                                  │
                                  ▼
             [Stage 5: Favicon MurmurHash3 Profiling]
             - Download /favicon.ico -> Base64 -> MurmurHash3
             - Correlate hash against known tech databases
                                  │
                                  ▼
             [Stage 6: Framework-Specific Debug Endpoints]
             - Spring Boot /actuator/health, /actuator/env
             - Django /admin/, /static/admin/
             - ASP.NET /elmah.axd, /trace.axd
                                  │
                                  ▼
                    [Tripartite Verification Oracle]
         (Correlate 2+ distinct indicators, filter fake headers)
                                  │
                                  ▼
                    [Evidence Ledger Registration]
        arsenal append-evidence --case $CASE_ID --tool fingerprint ...
                                  │
                                  ▼
                    [Kill-Chain Chaining & Handoff]
         - Match version to CVEs -> webapp-vulnerability-scanning
         - Spring / Java -> webapp-web-offensive-deserialization
         - Jinja2 / Node -> webapp-web-offensive-ssti
```

---

## 2. Multi-Stage Tooling Pipeline & Execution

### Stage 1: Passive Header & Cookie Architecture Inspection

Begin with zero-noise passive inspection of HTTP response headers, session cookies, and transport behavior:

```bash
# Inspect complete headers including redirects with follow-location
curl -sk -I -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Arsenal/4.0" \
  --max-time 10 \
  https://$TARGET/ | tee tmp/headers_root.txt

# Inspect response headers on authenticated / internal redirect paths
curl -sk -I -A "Mozilla/5.0" https://$TARGET/login | tee tmp/headers_login.txt
curl -sk -I -A "Mozilla/5.0" https://$TARGET/admin | tee tmp/headers_admin.txt
```

#### Key Header Fingerprint Matrix
Evaluate collected headers against known signature patterns:

| Header Name | Representative Values | Indicated Technology |
| :--- | :--- | :--- |
| `Server` | `nginx/1.24.0`, `Apache/2.4.52`, `Microsoft-IIS/10.0`, `cloudflare`, `gunicorn` | Web server / reverse proxy |
| `X-Powered-By` | `Express`, `PHP/8.2.10`, `ASP.NET`, `Next.js`, `PleskLin` | Application runtime |
| `X-AspNet-Version` | `4.0.30319` | Microsoft .NET Framework runtime |
| `X-Generator` | `WordPress 6.4.2`, `Drupal 10`, `Joomla! 4.2` | Content Management System (CMS) |
| `Via` | `1.1 vegur`, `1.1 varnish`, `1.1 google`, `1.0 traxi` | Upstream proxy / Gateway / Heroku |
| `X-Served-By` | `cache-iad-kiad7000021-IAD` | Fastly CDN node |
| `cf-ray` | `84c01289df...` | Cloudflare CDN edge |
| `X-Amz-Cf-Id` | `a9f2...` | AWS CloudFront CDN distribution |

#### Cookie Session Identifier Matrix
Session cookie names frequently expose the underlying language runtime even when `Server` and `X-Powered-By` are stripped:

| Session Cookie Name | Associated Technology Stack |
| :--- | :--- |
| `PHPSESSID` | PHP (Vanilla, Laravel, WordPress, Symfony) |
| `JSESSIONID` | Java EE (Tomcat, JBoss, WebLogic, Jetty, Spring Boot) |
| `ASP.NET_SessionId` | Microsoft ASP.NET Framework |
| `.AspNetCore.Session` | Microsoft ASP.NET Core |
| `connect.sid` | Node.js (Express session middleware) |
| `rack.session` | Ruby (Sinatra, Rack applications) |
| `_session_id` | Ruby on Rails |
| `csrftoken` / `sessionid` | Python Django |
| `beaker.session.id` | Python TurboGears / Pylons |
| `laravel_session` | PHP Laravel Framework |
| `ci_session` | PHP CodeIgniter |

---

### Stage 2: Web Application Firewall (WAF) & CDN Perimeter Fingerprinting

Identify perimeter filters and reverse proxies before launching active payloads:

```bash
# Execute wafw00f to identify perimeter WAF vendor
wafw00f https://$TARGET -o tmp/waf_profile.json -f json

# Manual WAF challenge probe (triggering generic signature without destructive action)
curl -sk -w "%{http_code}\n" \
  "https://$TARGET/?test_probe=%3Cscript%3Ealert(1)%3C/script%3E" \
  -o tmp/waf_probe_response.html

# Evaluate response signatures:
# HTTP 403 / 503 + "Attention Required! | Cloudflare" -> Cloudflare WAF
# HTTP 403 + "AWS WAF: Access Denied" -> AWS WAF
# HTTP 403 + "Akamai Ghost" -> Akamai Kona Site Defender
# HTTP 403 + "F5 BIG-IP" -> F5 ASM / Advanced WAF
# HTTP 403 + "Imperva Incapsula" -> Imperva WAF
```

---

### Stage 3: Automated Multi-Engine Stack Scanning

Orchestrate high-fidelity active fingerprinting utilities:

#### ProjectDiscovery `httpx` Technology Detection
```bash
# Probe target with built-in Wappalyzer signatures and response metadata
httpx -u https://$TARGET \
  -tech-detect \
  -status-code \
  -title \
  -content-length \
  -web-server \
  -vhost \
  -rate-limit 15 \
  -timeout 10 \
  -json \
  -o tmp/httpx_tech.json
```

#### ProjectDiscovery `wappalyzergo` Standalone Scanner
Execute ProjectDiscovery's standalone Go implementation of Wappalyzer for ultra-fast, offline-capable technology extraction:
```bash
# Probe live URL and stream detected technologies into structured JSON
wappalyzergo -u https://$TARGET -json -o tmp/wappalyzergo_tech.json

# Or pipe local harvested HTML response directly without network transmission
cat tmp/index.html | wappalyzergo -json -o tmp/wappalyzergo_stdin.json
```

#### WhatWeb Comprehensive Fingerprinting
```bash
# Aggressive level 3 scan (identifies plugins, sub-components, and patch versions)
whatweb -a 3 --color=never --log-json=tmp/whatweb_report.json https://$TARGET
```

#### Nuclei Technology & Version Extraction
```bash
# Run lightweight passive and semi-passive tech-detect templates
nuclei -u https://$TARGET \
  -tags tech,fingerprint,waf \
  -severity info,low \
  -rate-limit 20 \
  -jsonl -o tmp/nuclei_tech.jsonl
```

---

### Stage 4: Single-Page Application (SPA) & Frontend Framework Analysis

Extract client-side framework signatures from the DOM and compiled JavaScript bundles:

```bash
# Download main HTML page
curl -sk -A "Mozilla/5.0" https://$TARGET/ -o tmp/index.html

# Check for Next.js hydration payload (leaks buildId, page routes, and initial props)
grep -oP '<script id="__NEXT_DATA__"[^>]*>.*?</script>' tmp/index.html > tmp/next_data.json
if [ -s tmp/next_data.json ]; then
  echo "[+] Confirmed Technology: Next.js (SSR / Hybrid)"
  cat tmp/next_data.json | sed -E 's/<script[^>]*>(.*)<\/script>/\1/' | jq .buildId
fi

# Check for Nuxt.js (Vue SSR)
grep -iE "window\.__NUXT__|__nuxt" tmp/index.html && echo "[+] Confirmed Technology: Nuxt.js (Vue)"

# Check for React root mount
grep -iE 'id="root"|id="app"|data-reactroot' tmp/index.html && echo "[+] Confirmed Technology: React Frontend"

# Check for Angular component tags & ng-version
grep -oP 'ng-version="[^"]+"' tmp/index.html && echo "[+] Confirmed Technology: Angular"

# Check for Svelte markers
grep -iE 'class="svelte-[a-z0-9]+"' tmp/index.html && echo "[+] Confirmed Technology: Svelte"
```

#### Source Map Extraction (.js.map)
Check if developers published unminified source maps, exposing original TypeScript/JavaScript source code:
```bash
# Extract bundle URLs
cat tmp/index.html | grep -Eo 'src="[^"]+\.js"' | cut -d'"' -f2 | while read js_path; do
  FULL_URL="https://$TARGET$js_path"
  # Check if .map exists
  curl -sk -I "$FULL_URL.map" | head -n 1 | grep -q "200" && echo "[!] Leaked Source Map: $FULL_URL.map"
done
```

---

### Stage 5: Favicon MurmurHash3 Profiling

Favicon icons are frequently unchanged from framework defaults. Compute the MurmurHash3 hash of the target favicon and cross-reference with Shodan/Censys databases:

```bash
# Download favicon
curl -sk https://$TARGET/favicon.ico -o tmp/favicon.ico

# Execute Python MurmurHash3 calculator
python3 - << 'EOF'
import codecs
import mmh3

try:
    with open("tmp/favicon.ico", "rb") as f:
        data = f.read()
    b64 = codecs.encode(data, "base64")
    # Shodan murmurhash calculation uses base64 with newlines every 76 chars
    h = mmh3.hash(b64)
    print(f"[*] Favicon MurmurHash3: {h}")
    
    # Reference common framework hashes
    known_hashes = {
        116323821: "Spring Boot Default Favicon",
        -125047437: "Apache Tomcat Default Favicon",
        -1875141203: "WordPress Default Favicon",
        702022363: "Jenkins Default Favicon",
        -305179312: "phpMyAdmin Default Favicon",
        -941102699: "GitLab Default Favicon",
        -2057558656: "pfSense Default Favicon",
    }
    if h in known_hashes:
        print(f"[+] High-Confidence Match: {known_hashes[h]}")
except Exception as e:
    print(f"[-] Favicon hash failed: {e}")
EOF
```

---

### Stage 6: Framework-Specific Debug & Administrative Endpoints

Verify candidate frameworks by probing characteristic non-standard path signatures:

```bash
# 1. Spring Boot Actuators
curl -sk https://$TARGET/actuator -o tmp/spring_actuator.json
curl -sk https://$TARGET/actuator/health | grep -iE "UP|DOWN" && echo "[+] Confirmed: Spring Boot Actuator"

# 2. Django Administrative Portal
curl -sk https://$TARGET/admin/login/?next=/admin/ | grep -i "Django Administration" && echo "[+] Confirmed: Python Django"

# 3. Ruby on Rails Route Leakage
curl -sk https://$TARGET/rails/info/routes | grep -i "Routes" && echo "[+] Confirmed: Ruby on Rails (Development Mode)"

# 4. ASP.NET Trace Handlers
curl -sk https://$TARGET/trace.axd | grep -i "Application Trace" && echo "[+] Confirmed: ASP.NET Trace Handler Enabled"
curl -sk https://$TARGET/elmah.axd | grep -i "Error Log" && echo "[+] Confirmed: ELMAH Error Log Enabled"

# 5. PHP Composer / Git Exposure
curl -sk https://$TARGET/composer.json | grep -i "require" && echo "[!] Leaked composer.json dependency manifest"
curl -sk https://$TARGET/.git/HEAD | grep -i "refs/heads" && echo "[!] Exposed .git directory"
```

---

## 3. Tripartite Verification Oracle

Fingerprinted technology claims must be confirmed via three deterministic assertions:

```text
+---------------------------------------------------------------------------------------+
|                              TRIPARTITE VERIFICATION ORACLE                            |
+---------------------------------------------------------------------------------------+
| 1. POSITIVE ASSERTION       | Dual-Channel Correlation:                               |
|                             | At least TWO independent evidence vectors must agree:   |
|                             | - Channel A: Response header (Server / X-Powered-By)    |
|                             | - Channel B: Session cookie format (e.g. JSESSIONID)    |
|                             | - Channel C: DOM markup attribute (e.g. __NEXT_DATA__)  |
|                             | - Channel D: Favicon MurmurHash3 database match         |
+-----------------------------+---------------------------------------------------------+
| 2. NEGATIVE BASELINE        | Randomized Path Control Probe:                          |
|    CONTROL                  | curl -sk https://$TARGET/nonexistent_rand_7f819a       |
|                             | Confirm default 404 response does NOT inject conflicting|
|                             | headers or spoofed server signatures.                   |
+-----------------------------+---------------------------------------------------------+
| 3. DIFFERENTIAL INVARIANCE  | Verify header reproducibility across 3 requests with    |
|                             | distinct User-Agents; rule out caching anomalies.       |
+---------------------------------------------------------------------------------------+
```

---

## 4. False-Positive & Edge-Case Elimination

- **Deceptive / Spoofed Server Headers**: System administrators frequently configure `Server: Apache` on Nginx reverse proxies, or `Server: Microsoft-IIS/8.5` on Linux hosts. Never accept a standalone `Server` header without validating HTTP response behavior, header ordering, or cookie structures.
- **Multiple Backend Technologies**: Modern microservices often serve `/` via Next.js (Node.js), `/api/` via Spring Boot (Java), and `/auth/` via Go. Fingerprint individual route prefixes rather than assuming a uniform single technology across the entire domain.
- **CDN Stripping**: Cloudflare and Akamai frequently strip `X-Powered-By` and `Server` headers. In such environments, rely on cookie prefixes, favicon hashes, and client-side JavaScript AST extraction.

---

## 5. Evidence Capture & Ledger Registration

Persist the structured technology profile into Arsenal's cryptographic evidence pipeline:

```bash
# 1. Synthesize detected technologies into structured JSON report
cat << 'EOF' > tmp/tech_inventory.json
{
  "target": "TARGET_HOST",
  "web_server": "nginx/1.24.0",
  "runtime": "Java 17 / Spring Boot 3.2.0",
  "frontend": "Next.js 14.1 (React 18)",
  "waf": "Cloudflare",
  "cdn": "Cloudflare",
  "verified_cookies": ["JSESSIONID", "__cf_bm"],
  "favicon_hash": 116323821,
  "confidence": "HIGH (3 independent channels verified)"
}
EOF

# 2. Append evidence entry to cryptographic audit ledger
arsenal append-evidence \
  --case $CASE_ID \
  --tool httpx \
  --file tmp/tech_inventory.json \
  --desc "Verified technology stack fingerprint and framework profile"
```

---

## 6. Kill-Chain Chaining & Downstream Handoffs

- **Prerequisites**: Target root URL or host identified in `scope.json`.
- **Downstream Handoffs**:
  - **Identified Java / Spring Boot**: Route directly to `webapp-web-offensive-deserialization` or Spring Actuator exploit playbooks.
  - **Identified PHP (Laravel / WordPress)**: Route to `webapp-pentesting-wordpress` or PHP object injection.
  - **Identified Node.js / Express**: Route to `webapp-exploiting-prototype-pollution-in-javascript`.
  - **Identified Template Engine (Jinja2, Thymeleaf, Blade)**: Route to `webapp-web-offensive-ssti`.
  - **Identified Specific Outdated Component**: Query NIST NVD or run targeted Nuclei templates:
    ```bash
    nuclei -u https://$TARGET -tags <DETECTED_FRAMEWORK>
    ```
