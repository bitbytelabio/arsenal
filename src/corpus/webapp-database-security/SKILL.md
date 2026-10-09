---
name: webapp-database-security
description: Database security testing for SQL injection, privilege escalation, and misconfiguration.
domain: webapp
category: application-security
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/webapp-database-security/SKILL.md
---
# Database Security Assessment

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read precedent-pentest; **destructive statements are strictly prohibited on production databases** unless explicitly permitted.
2. `NOW`: Clearly define scope, including instances, account privileges, and whether write/delete operations are allowed.
3. `NEXT`: Client tool paths.
4. `ACT`: Exposure surface → Authentication → Authorization → Configuration → Exploit chain validation (safe).

## Applicable Scenarios

- Database unauthorized access / weak credentials / incorrect binding to 0.0.0.0
- Excessive privileges, dangerous features (xp_cmdshell, COPY PROGRAM, UDF)
- Lateral movement: Escalating from an application account to DBA
- NoSQL injection and Redis file write, etc. (authorized environments)

## Workflow

```text
□ Network exposure and TLS
□ Account roles and grantees
□ Sensitive table access control
□ Dangerous configurations: file_priv, xp_cmdshell, load_file
□ Audit logging status
□ Backup and snapshot permissions
```

## Toolchain

| Tool | Purpose |
|------|---------|
| Official CLI | Connection and enumeration |
| sqlmap | Injection verification (authorized) |
| nuclei | Known exposure templates |
| Cloud RDS console audit | Configuration |

## References

- `references/db-misconfig-checklist.md`
- `../pentest-tools/` `../cloud-k8s/`

## Routing Context

**Upstream**: MASTER R35  
**Downstream**: OS command obtained → attack-chain; Cloud-managed → cloud-k8s

## Task Completion Self-Check

- [ ] Were unauthorized write/delete operations avoided?
- [ ] Are configuration issues differentiated from exploitable chains?
- [ ] Checklist completed?
