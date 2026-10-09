# Expert Role → Skill Mapping (No Multi-Agent Server)

> Role codenames are inspired by the Z3r0 expert team; **implementation** relies on reverse-skill routing and handoff protocols, not process orchestration.

## Role Table

| Code | Name (Localizable) | Responsibilities | PRIMARY / Tool Skill |
|------|--------------------|------------------|----------------------|
| **lead** | Lead / Commander | Task breakdown, scope definition, phase gatekeeping, report synthesis | `attack-chain/` or current PRIMARY hub; completion → `docs-generator/` |
| **cie** | Intelligence Collection | Asset discovery, attack surface, relationships | `pentest-tools/` (recon); Browser → `browser-automation/`; Cloud surface → `cloud-k8s/` |
| **cpe** | Penetration Verification | Scanning, exploit validation, impact confirmation | `pentest-tools/`; API → `api-security/`; AD → `windows-ad/`; Wireless → `wifi-wireless/`; Database → `database-security/`; SSO → `identity-federation/`; OT → `ot-ics/` |
| **cre** | Reverse Engineering | Binary/Firmware/Mobile/Frontend logic | `ida-reverse/` `ghidra-reverse/` `binary-ninja-reverse/` `radare2/` `apk-reverse/` `mobile-reverse/` `macos-reverse/` `js-reverse/` `browser-extension-reverse/` `dotnet-reverse/` `go-rust-reverse/` `firmware-pentest/` `hardware-security/` `malware-analysis/` `protocol-reverse/` `thick-client/` `reverse-engineering/` |
| **cae** | Code Audit | Source code/Dependencies/Supply chain | `code-audit/` + `supply-chain-security/` |
| **cbe** | Blue Team / Forensics | Hunting, detection, IR artifacts | `threat-hunting/` `digital-forensics/` |
| **cce** | Cryptography | Algorithms/Protocols/Key misuse | `reverse-engineering` schema documentation |
| **llm** | AI Security | Prompt/Agent | `llm-security/` |
| **doc** | Documentation Officer | Reports/Writeups/Diagrams | `docs-generator/` + `diagram-generator/` |

## Lead Mandatory Protocol

```text
1. Output PRIMARY (master-route) + lead_role=lead
2. Write scope.md (ops/scope-contract)
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
  [cpe] Switch to pentest-tools
  ...
Prepend role tags in outputs for easy timeline indexing:
  [cpe] nuclei high findings -> E-003
```

## Relationship with master-route

- `master-route` defines the **PRIMARY skill**  
- `role-map` defines **who is responsible in the current phase** (can be documented in scope.md)  
- For multi-phase tasks, PRIMARY is often `attack-chain/`, which is then dispatched by the lead  

## MUST NOT

- Do not assume the existence of a Z3r0 session API  
- Do not launch unauthorized target scans for any role