---
name: red-radio-sdr
description: Software-defined radio security research covering signal capture and replay attacks.
domain: red
category: wireless
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/red-radio-sdr/SKILL.md
---
# RF / SDR Security Research

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: **Spectrum and transmission are strictly regulated by law**; restricted to authorized frequency bands/shielded chambers/lab targets only.
2. `NOW`: Explicitly specify the devices, frequency bands, and whether transmission is permitted in the scope (receive-only by default).
3. `ACT`: Receive-only identification → Demodulation analysis → Lab reproduction and evaluation.

## Applicable Scenarios

- Wireless remote controls/sensors and other non-Wi-Fi RF targets (authorized).
- Protocol research on ADS-B/remote controls, etc. (lawful reception).
- Division of responsibilities with wifi-wireless: This skill focuses on **general RF via SDR**; use R29 for Wi-Fi offensive and defensive operations.

## Workflow

```text
□ Confirm regulations and authorization
□ Receive-only: Identify center frequency and modulation
□ Analyze using GNU Radio / URH
□ Replay attacks only inside a shielded chamber and with written authorization
□ Focus findings on: Feasibility of unauthorized control / Hardening recommendations
```

## Toolchain

| Tool | Purpose |
|------|---------|
| RTL-SDR / HackRF (compliant) | Transceiver hardware |
| URH / GNU Radio | Analysis |
| Inspectrum | Signal inspection |

## References

- `skill://red-radio-sdr/references/sdr-lab-rules.md`
- `../wifi-wireless/` `../ot-ics/` `../hardware-security/`

## Routing Context

**Upstream**: MASTER R38  
**MUST NOT**: Interfere with public communications; transmit without authorization.

## Task Completion Checklist

- [ ] Default to receive-only and document regulatory boundaries?
- [ ] Checklist completed?
