---
name: webapp-code-audit
description: Source-code security review and SAST triage for common vulnerability patterns.
domain: webapp
category: compliance
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/webapp-code-audit/SKILL.md
---
# Source Code Security Audit

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `support/field-journal/precedent-pentest.md` or code audit authorization.
2. `NOW`: Confirm **source code/repository access** (binary without source code → redirect to RE skill).
3. `NOW`: Clarify language stack and scope (directories/services/PR diff).
4. `NEXT`: tool-index; semgrep, etc.
5. `ACT`: Threat modeling draft → Automated scanning → Manual verification.

## Applicable Scenarios

- White-box audit, PR/diff security review
- SAST tools such as Semgrep / CodeQL / Bandit / gosec
- Dangerous APIs, injection points, missing authorization, cryptographic misuse
- Division of labor with `supply-chain-security/`: this skill focuses on **proprietary code logic**, while supply chain focuses on dependencies and pipelines

## Workflow

### 1. Scope and Threat Model

```text
□ Trust boundaries: User input, files, deserialization, SSRF, authentication/authorization middleware
□ High-value assets: Authentication, payments, admin consoles, key management
```

### 2. Automated Scanning

```bash
semgrep --config auto .
# Or project-specific rule packs
semgrep --config p/owasp-top-ten .
```

### 3. Manual Verification (MUST)

```text
□ Every SAST hit: Reachability? Exploitability? False positive?
□ Authorization: IDOR/privilege escalation, missing checks, flawed multi-tenant isolation
□ Injection: SQL/command/template/LDAP
□ Cryptography: Hardcoded keys, ECB mode, custom crypto
```

### 4. Deliverables

```text
Finding: Location + Data flow + PoC + Remediation recommendations
Optional ATT&CK / CWE identifiers
```

## Toolchain

| Tool | Language/Scenario |
|------|-------------------|
| Semgrep | Multi-language fast rule engine |
| CodeQL | Deep data flow analysis (GitHub) |
| Bandit | Python |
| gosec / staticcheck | Go |
| SpotBugs / FindSecBugs | Java |

## References

- `references/sast-review-checklist.md`
- `../supply-chain-security/` `../api-security/` `../llm-security/` (Agent code)

## Routing Context

**Upstream**: MASTER R26  
**Role**: `support/ops/role-map.md` cae  
**Downstream**: Dependency vulnerabilities → supply-chain; Runtime verification → pentest-tools

## Task Completion Checklist

- [ ] Manually verified instead of merely pasting scanner outputs?
- [ ] Includes remediation recommendations?
- [ ] Confined strictly within the authorized repository scope?
- [ ] Checklist completed?
