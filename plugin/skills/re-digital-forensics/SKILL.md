---
name: re-digital-forensics
description: Digital forensics analysis covering memory dumps, disk timelines, and evidence collection.
domain: re
category: forensics
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-digital-forensics/SKILL.md
---
# Digital Forensics & IR Artifacts

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://re-digital-forensics/support/field-journal/precedent-pentest.md` or organizational IR authorization notes
2. `NOW`: Confirm this is **forensics/attribution** rather than offensive scanning
3. `NOW`: Establish case; prioritize read-only evidence copies (write-protect original media)
4. `NEXT`: Consult tool-index; tools like Volatility are frequently manual
5. `ACT`: Preserve hashes → build timeline → extract key artifacts

## Applicable Scenarios

- Memory dump analysis (Volatility 2/3)
- Disk / E01 / dropped file timelines
- PCAP attribution and protocol reassembly (can be combined with `protocol-reverse/`)
- Host artifacts: Prefetch, Shimcache, Event Logs, browser history
- Incident response IOC extraction (combined with `malware-analysis/` / `threat-hunting/`)

## Workflow

### 1. Preservation

```text
□ Calculate SHA256; record time zone and acquisition commands
□ Work on forensic copies; keep originals strictly read-only
□ Document chain of custody notes into the timeline
```

### 2. Memory

```bash
vol -f mem.dmp windows.info
vol -f mem.dmp windows.pslist
vol -f mem.dmp windows.netscan
vol -f mem.dmp windows.cmdline
```

### 3. Host Artifacts

```text
□ Event logs: Security / PowerShell / Sysmon
□ Persistence: Run keys, Services, Scheduled Tasks, WMI
□ Execution traces: Amcache, Prefetch, BAM
```

### 4. Network

```text
□ Use tshark to analyze sessions and DNS traffic
□ Export suspicious streams → route to protocol-reverse or malware C2 analysis
```

## Toolchain

| Tool | Purpose |
|------|---------|
| Volatility 3 | Memory |
| Timeline Explorer / Plaso | Super timeline |
| tshark | PCAP |
| Eric Zimmerman Tools | Windows artifacts |
| Autopsy / FTK Imager | Disk |

## References

- `skill://re-digital-forensics/references/forensics-triage.md`
- `../re-malware-analysis/` `../red-threat-hunting/` `../re-protocol-reverse/`

## Routing Context

**Upstream**: MASTER R25  
**Downstream**: Deep-dive malware sample analysis → re-malware-analysis; detection engineering/rules → red-threat-hunting

## Task Completion Self-Check

- [ ] Were evidence hashes preserved and the working copy policy enforced?
- [ ] Is the timeline verifiable and reproducible?
- [ ] Were IOCs sanitized and classified?
- [ ] Checklist complete?
