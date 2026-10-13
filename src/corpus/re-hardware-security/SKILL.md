---
name: re-hardware-security
description: Hardware interface exploration covering UART, JTAG, SPI, and bus communication dumping.
domain: re
category: firmware
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-hardware-security/SKILL.md
---
# Hardware / Embedded Interface Security

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Confirm **physical access authorization** and device ownership
2. `NOW`: Ensure ESD/power safety; default to read-only probing
3. `NEXT`: Coordinate with firmware-pentest for image analysis
4. `ACT`: Enclosure and debug interface identification → consoles → extraction

## Applicable Scenarios

- UART / JTAG / SWD debug interface discovery
- Boot logs, root shell access, boot interruption
- Teardown combined with Flash extraction
- Feasibility assessment of secure boot / encrypted Flash (non-destructive methods prioritized)

## Workflow

```text
□ Disassemble authorized device; photograph and label test points
□ Multimeter to identify GND/VCC/TX/RX; verify logic levels 1.8/3.3/5V
□ USB-TTL for read-only logs; record baud rate
□ JTAG: Enumerate IDCODE; assess whether locked
□ Extract image → Hand off to firmware-pentest / ghidra
```

## Toolchain

| Tool | Purpose |
|------|---------|
| USB-TTL / logic analyzer | UART |
| J-Link / CMSIS-DAP | Debugging |
| bus pirate / flipper (lab) | Multi-protocol |
| binwalk / flashrom | Extraction |

## References

- `skill://re-hardware-security/references/debug-interface-triage.md`
- `../re-firmware-pentest/` `../red-ot-ics/`

## Routing Context

**Upstream**: MASTER R34  
**MUST NOT**: Disassemble without authorization / damage third-party devices

## Task Completion Self-Check

- [ ] Are interface voltage levels and pinouts documented?
- [ ] Has the extracted image been hashed for integrity preservation?
- [ ] Checklist completed?
