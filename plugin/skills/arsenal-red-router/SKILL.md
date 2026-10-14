---
name: arsenal-red-router
description: "Red team and network penetration routing table covering Active Directory, cloud, C2 operations, credential access, and evasion."
domain: red
hide: false
license: MIT
---
# Arsenal Red Team & Active Directory Router

## Role & Guidance
Use for authorized red team operations, Active Directory attacks, Kerberoasting, Linux/Windows privilege escalation, EDR bypass analysis, and network assessments.

## On-Demand Playbook Retrieval
Leaf playbooks are hidden from the base prompt. Use runtime tools:
- `skill_search(query: "kerberoasting active directory", domain: "red")`
- `skill_route(hint: "kerberoasting active directory", domain: "red")`
- `skill_load(name: "red-windows-ad")`

## Declared Categories
- `active-directory` → `A1` (red-windows-ad)
- `credential-access` → `A2` (red-performing-kerberoasting-attack)
- `privesc` → `A3` (red-privesc-offensive-linux-privesc)
- `evasion` → `A4` (red-edr-bypass-re)
- `network` → `A5` (red-network-offensive-network-attacks)
- `cloud-security` → `A6` (red-aws-cloud-pentesting)
- `wireless` → `A7` (red-wireless-offensive-wifi)
- `threat-intelligence` → `A8` (red-operationalizing-misp-threat-feeds)
- `c2-operations` → `A9` (red-building-c2-infrastructure-with-sliver-framework)
- `social-engineering` → `A10` (red-conducting-social-engineering-penetration-test)
- `persistence` → `A12` (red-post-exploitation-offensive-persistence)
- `reconnaissance` → `A13` (red-conducting-external-reconnaissance-with-osint)
