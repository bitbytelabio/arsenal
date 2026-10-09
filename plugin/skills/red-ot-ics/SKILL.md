---
name: red-ot-ics
description: Operational technology and ICS/SCADA security assessment across industrial protocols.
domain: red
category: network
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/red-ot-ics/SKILL.md
---
# OT / ICS Security

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://red-ot-ics/support/field-journal/precedent-pentest.md` — **Mishandling industrial control environments can cause physical harm**
2. `NOW`: Written authorization must explicitly define: sites, subnets, and whether active scanning/register writing is permitted
3. `NOW`: case-init; default to **passive-first**; PLC write operations are forbidden prior to `ready_for_act`
4. `NEXT`: tool-index; most ICS tools require manual operation and an isolated lab network
5. `ACT`: Asset and zone identification → Exposure surface → Read-only verification

## Applicable Scenarios

- ICS/SCADA/DCS security assessments (authorized)
- Purdue model zoning and cross-zone conduit analysis
- Protocol exposure for Modbus/DNP3/S7/EtherNet/IP, etc.
- Engineering workstations, HMIs, historians, jump hosts
- IT/OT convergence boundaries (firewall rules, data diodes)

## Ironclad Safety Rules (MUST)

```text
MUST NOT without explicit written permission:
- Write to coils/registers on PLCs
- Conduct high-rate scans across production OT networks
- Disrupt paths related to Safety Instrumented Systems (SIS)
Priority: Read-only identification, traffic mirroring, offline firmware/configuration analysis
```

## Workflow

### Phase 1 — Zoning and Assets

```text
□ Purdue L0–L5 draft: Field devices → Control → Supervisory → Site DMZ → Enterprise
□ Asset inventory: PLC/RTU/HMI/Engineering workstations/Historian/Jump host
□ Protocol and port baselining (authorized subnets only)
```

### Phase 2 — Passive and Read-Only

```text
□ SPAN/Mirrored PCAP → protocol-reverse / Wireshark industrial dissectors
□ Offline configuration and project file audits (TIA/RSLogix exports, etc.)
□ Default passwords and plaintext protocols (unauthenticated Modbus) documented as Findings; do not alter values or write to disk
```

### Phase 3 — Constrained Active (Authorized Only)

```text
□ Low-rate identification during maintenance windows
□ Read-only function codes prioritized
□ Evidence collected at every step; halt immediately and report upon any anomaly
```

### Phase 4 — Firmware and Patch Surface

```text
□ Controller firmware version → CVE mapping (never flash firmware blindly)
□ Collaborate with firmware-pentest for offline image analysis
```

## Toolchain

| Tool | Purpose | Notes |
|------|---------|-------|
| Wireshark industrial dissectors | Passive parsing | Mirrored traffic |
| Nmap NSE (restricted) | Identification | Rate limits and maintenance windows |
| Claroty/Nozomi, etc. | Asset discovery | Commercial/on-site |
| PLC vendor engineering software | Configuration audit | Offline-first |
| binwalk / Ghidra | Firmware | Offline |

## References

- `skill://red-ot-ics/references/ot-safe-assessment.md`
- `../firmware-pentest/` `../protocol-reverse/` network assessment via pentest-tools

## Routing Context

**Upstream**: MASTER R28  
**Downstream**: Firmware deep-dive `firmware-pentest`; Protocol `protocol-reverse`; IT lateral movement `windows-ad`/`attack-chain`  
**Peer**: Never target OT using standard web scanners with default parameters

## Task Completion Self-Check

- [ ] Was the assessment passive/read-only by default, with authorization boundaries documented?
- [ ] Were write operations against control loops avoided (unless explicitly permitted)?
- [ ] Do findings include notes on physical/process impact?
- [ ] Checklist / journal updated?
