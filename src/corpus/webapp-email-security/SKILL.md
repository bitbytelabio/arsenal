---
name: webapp-email-security
description: Email security evaluation covering phishing inspection, SPF, DKIM, and DMARC enforcement.
domain: webapp
category: application-security
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/webapp-email-security/SKILL.md
---
# Email Security & Phishing Analysis

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Confirm authorization (sample email analysis / tenant configuration review)
2. `NOW`: Do not redeliver malicious samples to real users
3. `ACT`: Header authentication → Content/URL → Attachment sandbox → Tenant control plane recommendations

## Applicable Scenarios

- Phishing email deconstruction and IOC extraction
- SPF/DKIM/DMARC configuration assessment
- BEC (Business Email Compromise) fraud patterns
- OAuth application phishing / Mailbox token abuse (combined with llm/cloud identity)
- Security awareness training/drill design (authorized)

## Workflow

```text
□ Full raw headers: Received chain, From/Return-Path alignment
□ SPF/DKIM/DMARC alignment results
□ URL sandbox and attachment static analysis (combined with malware-analysis)
□ Brand spoofing and Reply-To discrepancies
□ Tenant: Anti-phishing policies, external tagging, MFA, OAuth app consent
```

## Toolchain

| Tool | Purpose |
|------|---------|
| Mail client "View Source" | Headers |
| dig/nslookup | SPF/DMARC records |
| urlscan / Sandbox | Links and attachments |
| Tenant Admin Center | Policies |

## References

- `skill://webapp-email-security/references/email-auth-checklist.md`
- ``skill://re-malware-analysis`` ``skill://red-attack-chain`` (Phishing stage) ``skill://red-windows-ad`` (Tokens)

## Routing Context

**Upstream**: MASTER R36  
**MUST NOT**: Mass-send test phishing emails to third-party domains without authorization

## Task Completion Checklist

- [ ] Are the header authentication conclusions complete?
- [ ] Are the IOCs actionable for detection (combined with threat-hunting)?
- [ ] Checklist?
