---
name: red-windows-ad
description: Active Directory and Windows enterprise identity assessment and privilege escalation.
domain: red
category: active-directory
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/red-windows-ad/SKILL.md
---
# Windows / Active Directory Security

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://red-windows-ad/support/field-journal/precedent-pentest.md`
2. `NOW`: **Domain/AD testing must have an explicitly defined authorized scope** (including DCs, whether poisoning/relaying is permitted)
3. `NOW`: Execute case-init; explicitly document network_profile and prohibited actions
4. `NEXT`: Consult tool-index (impacket/certipy/bloodhound, etc., often executed manually)
5. `ACT`: Begin with identity enumeration and BloodHound graphs; do not launch destructive exploits first

## Applicable Scenarios

- Domain penetration testing, Kerberoasting, AS-REP Roasting, delegation
- AD CS (ESC1–ESC8, etc.) certificate attacks
- BloodHound / SharpHound attack paths
- NTLM Relay / Coercer forced authentication
- Local privilege escalation pivoting into domain attack paths (Potato exploits, etc., as stepping stones)

## Relationship with attack-chain

- **Multi-stage attacks from external network to Domain Controller** → PRIMARY can remain `attack-chain/`; this skill serves as the **AD Specialist**
- **Already inside the domain focusing on identity** → PRIMARY = this skill

## Workflow

### 1. Enumeration

```bash
# Example Impacket / built-in (requires credentials and authorization)
nxc smb <range> -u user -p pass
bloodhound-python -d domain.local -u user -p pass -c All -ns <DC>
```

### 2. Common Paths (Graph First, Exploit Second)

```text
□ Kerberoast / AS-REP → Offline cracking
□ ACL abuse (GenericAll/WriteDacl)
□ Delegation (Unconstrained / Constrained / Resource-Based)
□ AD CS template misconfigurations → Certipy
□ Relay: LLMNR/NBT-NS + ntlmrelayx (confirm authorization)
```

### 3. Credentials and Lateral Movement

```text
□ secretsdump / lsassy / mimikatz (strict authorization and cleanup)
□ PtH / PtT / Golden Ticket restricted to authorized red team scope only
□ Record Evidence for every step; await user confirmation for high-risk actions
```

## Toolchain

| Tool | Purpose |
|------|---------|
| BloodHound / SharpHound | Attack path graphing |
| Certipy | AD CS |
| Impacket / NetExec | Lateral movement and enumeration |
| Rubeus / Mimikatz | Tickets and credentials (authorized) |
| Coercer / Responder | Forced authentication / Poisoning |

## References

- `skill://red-windows-ad/references/ad-attack-paths.md`
- `skill://red-windows-ad/support/pentest-tools/references/network-attack-defense.md`
- `../attack-chain/`
- seeds: `skill://red-windows-ad/support/field-journal/seed-005_ad-certipy-esc1.md` `skill://red-windows-ad/support/field-journal/seed-007_ntlm-relay-coercer.md` `skill://red-windows-ad/support/field-journal/seed-013_kerberoasting-spn.md`

## Routing Context

**Upstream**: MASTER R24  
**Downstream**: Reporting via `docs-generator`; EDR research requires `edr-bypass-re`  
**MUST NOT**: Execute unauthorized DCSync / Golden Ticket attacks against production environments

## Task Completion Self-Check

- [ ] Was graph/enumeration established prior to exploitation?
- [ ] Were reproducible commands recorded and sanitized?
- [ ] Were all scoped prohibitions strictly observed?
- [ ] Completed Checklist?
