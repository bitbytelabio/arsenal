---
name: red-wifi-wireless
description: Wireless network assessment covering WPA handshakes, rogue APs, and protocol security.
domain: red
category: wireless
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/red-wifi-wireless/SKILL.md
---
# Wi-Fi / Wireless Security

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read precedent-pentest; **wireless attacks carry high legal risks**; written authorization and defined physical scope are mandatory.
2. `NOW`: Clearly specify target SSID/BSSID/premises in scope; scanning neighboring networks is strictly prohibited.
3. `NEXT`: Confirm adapter monitor mode capability.
4. `ACT`: Reconnaissance → Capture → Analysis (lab environment prioritized).

## Applicable Scenarios

- Authorized Wi-Fi security assessments
- WPA/WPA2 handshake capture and offline evaluation
- Rogue AP / phishing hotspot detection and research
- Enterprise wireless segmentation and captive portal security

## Workflow

```text
□ iwconfig / airmon-ng to enter monitor mode (authorized environment)
□ airodump-ng lock onto target BSSID and channel
□ Handshake or PMKID capture (target only)
□ hashcat/aircrack offline evaluation of password policy
□ Report: encryption type, segmentation, captive portal bypass, recommendations
```

## Toolchain

| Tool | Purpose |
|------|---------|
| aircrack-ng suite | Capture/assessment |
| hcxdumptool / hcxtools | PMKID |
| hashcat | Password evaluation |
| Wireshark | Management frame analysis |

## References

- `skill://red-wifi-wireless/references/wireless-lab-rules.md`
- `../pentest-tools/` `../attack-chain/` (close-access chapters)

## Routing Context

**Upstream**: MASTER R29  
**MUST NOT**: Unauthorized deauth attacks, operations against non-target client networks

## Task Completion Checklist

- [ ] Is the assessment strictly locked onto the target BSSID?
- [ ] Are hardening recommendations provided in the report?
- [ ] Checklist?
