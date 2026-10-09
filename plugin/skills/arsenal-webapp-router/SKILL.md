---
name: arsenal-webapp-router
description: "Web application security domain routing table covering injection, traversal, authz, API, client-side, and application security capabilities."
domain: webapp
hide: false
license: MIT
---
# Arsenal Web Application Security Router

## Role & Guidance
Use for authorized web application penetration testing, REST/GraphQL API assessment, SQL injection, SSRF, IDOR, path traversal, and JavaScript reverse engineering.

## On-Demand Playbook Retrieval
Leaf playbooks are hidden from the base prompt. Use runtime tools:
- `skill_search(query: "sql injection differential", domain: "webapp")`
- `skill_route(hint: "sql injection differential", domain: "webapp")`
- `skill_load(name: "webapp-exploiting-sql-injection-vulnerabilities")`

## Declared Categories
- `injection` → `W1` (webapp-exploiting-sql-injection-vulnerabilities)
- `traversal` → `W2` (webapp-performing-directory-traversal-testing)
- `authz` → `W3` (webapp-exploiting-idor-vulnerabilities)
- `api` → `W4` (webapp-api-security)
- `client-side` → `W5` (webapp-js-reverse)
- `application-security` → `W6` (webapp-performing-web-application-penetration-test)
- `container-security` → `W8` (webapp-performing-container-security-scanning-with-trivy)
- `ot-ics` → `W10` (webapp-performing-ot-network-security-assessment)
- `reconnaissance` → `W12` (webapp-performing-osint-with-spiderfoot)
- `devsecops` → `W14` (webapp-implementing-devsecops-security-scanning)
- `vulnerability-management` → `W16` (webapp-performing-vulnerability-scanning-with-nessus)
- `compliance` → `W18` (webapp-performing-nist-csf-maturity-assessment)
- `threat-intelligence` → `W20` (webapp-hunting-advanced-persistent-threats)
- `endpoint-security` → `W22` (webapp-implementing-endpoint-detection-with-wazuh)
- `security-operations` → `W24` (webapp-implementing-siem-use-cases-for-detection)
- `ai-security` → `W26` (webapp-testing-llm-prompt-injection-and-jailbreaks)
