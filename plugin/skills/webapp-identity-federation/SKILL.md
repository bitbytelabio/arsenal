---
name: webapp-identity-federation
description: Security assessment of federated identity and authentication protocols including SAML and OIDC.
domain: webapp
category: authz
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/webapp-identity-federation/SKILL.md
---
# Identity Federation (SAML / OIDC / OAuth)

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Review precedent-pentest; add SSO test accounts and IdP/SP scopes into assessment scope.
2. `NOW`: Prohibit brute-force attempts that could lock out real user accounts.
3. `NEXT`: Prepare traffic interception tools and documentation (metadata URLs).
4. `ACT`: Protocol flow mapping → Common misconfigurations → Verification.

## Applicable Scenarios

- SAML Response signature / assertion tampering attack surface (classic flaw patterns).
- OIDC Implicit / Authorization Code flow missing PKCE.
- `redirect_uri` / `state` / `nonce` issues.
- IdP and SP metadata, multi-tenant issuer confusion.
- Complementary to `api-security` JWT attacks (this skill focuses on federation and SSO flows).

## Workflow

```text
□ Map out clearly: User → SP → IdP → Token → SP
□ Collect: /.well-known/openid-configuration, SAML metadata
□ Inspect: exact redirect_uri matching, state binding, PKCE
□ Inspect: SAML signature coverage scope, algorithm downgrades
□ Session fixation and logout invalidation
```

## Toolchain

| Tool | Purpose |
|------|---------|
| Burp + SAML Raider, etc. | Assertion editing (authorized) |
| jwt_tool | JWT analysis |
| Browser DevTools | Redirect chains |
| IdP Admin Logs | Auditing |

## References

- `references/sso-flow-checklist.md`
- `../api-security/` `../windows-ad/` (Enterprise IdP)

## Routing Context

**Upstream**: MASTER R37  
**Downstream**: Pure API JWT → api-security; Cloud IdP → cloud-k8s

## Task Completion Self-Check

- [ ] Was the full SSO flow mapped completely?
- [ ] Does each finding include reproduction steps and impact?
- [ ] Was the checklist completed?
