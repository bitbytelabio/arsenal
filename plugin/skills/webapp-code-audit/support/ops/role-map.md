# Expert Role → Skill Mapping (No Multi-Agent Server)

> Role codenames are inspired by the Z3r0 expert team; **implementation** relies on reverse-skill routing and handoff protocols, not process orchestration.

## Role Table

| Code | Name (Localizable) | Responsibilities | PRIMARY / Tool Skill |
|------|--------------------|------------------|----------------------|
| **lead** | Lead / Commander | Task breakdown, scope definition, phase gatekeeping, report synthesis | `skill://red-attack-chain` or current PRIMARY hub; completion → `skill://re-docs-generator` |
| **cie** | Intelligence Collection | Asset discovery, attack surface, relationships | `skill://webapp-pentest-tools` (recon); Browser → `skill://webapp-browser-automation`; Cloud surface → `skill://red-cloud-k8s` |
| **cpe** | Penetration Verification | Scanning, exploit validation, impact confirmation | `skill://webapp-pentest-tools`; API → `skill://webapp-api-security`; AD → `skill://red-windows-ad`; Wireless → `skill://red-wifi-wireless`; Database → `skill://webapp-database-security`; SSO → `skill://webapp-identity-federation`; OT → `skill://red-ot-ics` |
| **cre** | Reverse Engineering | Binary/Firmware/Mobile/Frontend logic | `skill://re-ida-reverse` `skill://re-ghidra-reverse` `skill://re-binary-ninja-reverse` `skill://re-radare2` `skill://re-apk-reverse` `skill://mobile-reverse` `skill://re-macos-reverse` `skill://webapp-js-reverse` `skill://webapp-browser-extension-reverse` `skill://re-dotnet-reverse` `skill://re-go-rust-reverse` `skill://re-firmware-pentest` `skill://re-hardware-security` `skill://re-malware-analysis` `skill://re-protocol-reverse` `skill://webapp-thick-client` `skill://re-reverse-engineering` |
| **cae** | Code Audit | Source code/Dependencies/Supply chain | `skill://webapp-code-audit` + `skill://red-supply-chain-security` |
| **cbe** | Blue Team / Forensics | Hunting, detection, IR artifacts | `skill://red-threat-hunting` `skill://re-digital-forensics` |
| **cce** | Cryptography | Algorithms/Protocols/Key misuse | `skill://re-reverse-engineering` schema documentation |
| **llm** | AI Security | Prompt/Agent | `skill://red-llm-security` |
| **doc** | Documentation Officer | Reports/Writeups/Diagrams | `skill://re-docs-generator` + `skill://re-diagram-generator` |

## Lead Mandatory Protocol

```text
1. Output PRIMARY (master-route) + lead_role=lead
2. Write scope.md (skill://webapp-pentest-tools/support/ops/scope-contract.md)
3. Specify specialist_roles[] and handoff conditions
4. At the end of each phase: Update timeline + workitems; decide whether to proceed / switch roles / generate report
5. Strictly prohibited: Skipping scope to perform CPE scans directly against production
```

## Handoff Rules

| From → To | Trigger | Deliverables |
|-----------|---------|--------------|
| lead → cie | Asset attack surface required | scope + known domains/IPs |
| cie → cpe | Live surface/services identified | assets list + ports/URLs |
| cpe → cre | Reverse engineering validation/client-side logic required | Sample path + suspicious vectors |
| cre → cpe | Protocol/Key/Validation reconstructed | Algorithm specifications + reproduction commands |
| any → doc | Phase or task completed | Evidence/Finding/Path drafts |
| any → lead | Blocked/Privilege boundary hit/Path change | timeline notes + reason for block |

## How to Use with a Single Agent (Key Feature)

No need to actually launch 6 separate Agents:

```text
Within the same session:
  [lead] Planning
  [cie] Execute reconnaissance skill
  [cpe] Switch to webapp-pentest-tools
  ...
Prepend role tags in outputs for easy timeline indexing:
  [cpe] nuclei high findings -> E-003
```

## Relationship with master-route

- `master-route` defines the **PRIMARY skill**
- `role-map` defines **who is responsible in the current phase** (can be documented in `scope.md`)
- For multi-phase tasks, PRIMARY is often `skill://red-attack-chain`, which is then dispatched by the lead

## MUST NOT

- Do not assume the existence of a Z3r0 session API
- Do not launch unauthorized target scans for any role
