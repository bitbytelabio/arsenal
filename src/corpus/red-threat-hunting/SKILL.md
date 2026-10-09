---
name: red-threat-hunting
description: Proactive threat hunting and detection engineering using behavioral analytics.
domain: red
category: threat-intelligence
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/red-threat-hunting/SKILL.md
---
# Threat Hunting & Detection Engineering

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Confirm blue team/hunting authorization and data source scope (SIEM, EDR exports)
2. `NOW`: Define a clear hypothesis before querying data to avoid blindly triaging alerts
3. `NEXT`: Determine tools and data ingestion methods
4. `ACT`: Hypothesis → Query → Validate → Codify into rules

## Applicable Scenarios

- Threat hunting (hypothesis-driven)
- Sigma / YARA detection engineering
- Alert tuning and false-positive analysis
- With `malware-analysis/`: Sample-side IOCs → implement detection in this skill
- With `digital-forensics/`: Incident artifacts → lateral hunting

## Workflow

### 1. Formulate Hypothesis

```text
Example: Attacker using living-off-the-land techniques for lateral movement
→ Data sources: Sysmon 1/3/10, Windows Security 4624/4648
→ Success criteria: Discover abnormal parent processes or rare account log sources
```

### 2. Query and Stack

```text
□ Baseline: Normal administrator behavior timeframes and hosts
□ Anomalies: New services, encoded PowerShell, abnormal outbound connections
□ Correlation: Multiple host logins using the same account within a short timeframe
```

### 3. Codify Rules

```yaml
# Sigma skeleton can be found in malware-analysis; this skill emphasizes:
# - False positive surface
# - Data source field mapping
# - Response playbook links
```

### 4. Validation

```text
□ Atomic testing (Atomic Red Team) strictly in authorized lab environments
□ Replay historical logs to verify detection recall
```

## Toolchain

| Tool | Purpose |
|------|---------|
| Sigma CLI / sigmac | Rule conversion |
| YARA | File / memory |
| SIEM (ELK/Splunk, etc.) | Querying |
| osquery | Endpoint hunting |
| Atomic Red Team | Detection validation (lab only) |

## References

- `skill://red-threat-hunting/references/hunting-loop.md`
- `skill://red-threat-hunting/support/malware-analysis/references/yara-sigma-rules.md`
- `../digital-forensics/`

## Routing Context

**Upstream**: MASTER R27  
**Downstream**: Intrusion confirmed → forensics; Malicious sample → malware-analysis  
**MUST NOT**: Run attack simulations in unauthorized production environments

## Task Completion Checklist

- [ ] Is there a clear hypothesis and conclusion?
- [ ] Do rules clearly document false positives and data sources?
- [ ] Checklist verified?
