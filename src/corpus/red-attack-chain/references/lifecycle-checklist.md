# Penetration / Attack Chain Lifecycle Checklist

> Benchmarked against community pentest skill packages (e.g., Orizon claude-code-pentest six phases) integrated with this package's `attack-chain` + `ops`.  
> Source inspiration: Public Claude pentest lifecycle skills (retrieved 2026-07); **commands and authorizations are subject to this package's scope**.  
> Date: 2026-07-17

## Pre-requisites

- [ ] `case-init` completed, `auth.status=granted`
- [ ] `network_profile` ≠ unrestricted erroneously applied against production
- [ ] `lead` has assigned specialist_roles (`skill://webapp-pentest-tools/support/ops/role-map.md`)

## Phase Gates

| Phase | Role | Package Skill | Completion Criteria |
|-------|------|---------------|---------------------|
| 0 Scope | lead | ops/scope-contract | ready_for_act |
| 1 Recon | cie | pentest-tools | assets list + timeline |
| 2 Enum/Vuln | cpe | pentest-tools / api-security | candidate F-* draft |
| 3 Validate | cpe | pentest-tools | E-* + validated Finding |
| 4 Post-ex (if authorized) | cpe/lead | second half of attack-chain | strictly within out_of_scope limits |
| 5 RE Support | cre | ida/apk/js/… | only when client-side/binary is required |
| 6 Report | doc | docs-generator | Evidence→Finding→Path |
| 7 Journal | lead | field-journal | sanitized |

## Differences from "Fully Automated Compromise Given a Single Domain" Skills (Key Features)

| Common in External Automation Packages | reverse-skill |
|---------------------------------------|---------------|
| Aggressive scanning on domains by default | Strict scoping of asset lists required |
| Directly writing reports with weak evidence | Enforces the E/F/P chain |
| Single session without roles | Handoffs via role-map |
| No tool index | tool-index + bootstrap |

## Minimum of One Timeline Entry per Phase

Refer to `skill://red-attack-chain/support/ops/timeline-workitem.md` for format.