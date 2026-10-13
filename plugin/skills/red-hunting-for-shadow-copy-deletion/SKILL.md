---
name: red-hunting-for-shadow-copy-deletion
description: Runs a hypothesis-driven threat hunt for Volume Shadow Copy deletion (T1490) by querying SIEM/EDR telemetry for vssadmin, wmic shadowcopy, and PowerShell shadow-copy-deletion commands.
domain: red
category: active-directory
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/red-hunting-for-shadow-copy-deletion/SKILL.md
---
# Hunting For Shadow Copy Deletion

## When to Use

- When proactively hunting for indicators of hunting for shadow copy deletion in the environment
- After threat intelligence indicates active campaigns using these techniques
- During incident response to scope compromise related to these techniques
- When EDR or SIEM alerts trigger on related indicators
- During periodic security assessments and purple team exercises

## Prerequisites

- EDR platform with process and network telemetry (CrowdStrike, MDE, SentinelOne)
- SIEM with relevant log data ingested (Splunk, Elastic, Sentinel)
- Sysmon deployed with comprehensive configuration
- Windows Security Event Log forwarding enabled
- Threat intelligence feeds for IOC correlation

## Workflow

1. **Formulate Hypothesis**: Define a testable hypothesis based on threat intelligence or ATT&CK gap analysis.
2. **Identify Data Sources**: Determine which logs and telemetry are needed to validate or refute the hypothesis.
3. **Execute Queries**: Run detection queries against SIEM and EDR platforms to collect relevant events.
4. **Analyze Results**: Examine query results for anomalies, correlating across multiple data sources.
5. **Validate Findings**: Distinguish true positives from false positives through contextual analysis.
6. **Correlate Activity**: Link findings to broader attack chains and threat actor TTPs.
7. **Document and Report**: Record findings, update detection rules, and recommend response actions.

## Key Concepts

| Concept | Description |
|---------|-------------|
| T1490 | Inhibit System Recovery |
| T1486 | Data Encrypted for Impact |
| T1485 | Data Destruction |

## Tools & Systems

| Tool | Purpose |
|------|---------|
| CrowdStrike Falcon | EDR telemetry and threat detection |
| Microsoft Defender for Endpoint | Advanced hunting with KQL |
| Splunk Enterprise | SIEM log analysis with SPL queries |
| Elastic Security | Detection rules and investigation timeline |
| Sysmon | Detailed Windows event monitoring |
| Velociraptor | Endpoint artifact collection and hunting |
| Sigma Rules | Cross-platform detection rule format |

## Common Scenarios

1. **Scenario 1**: Ransomware deleting shadow copies before encryption
2. **Scenario 2**: vssadmin delete shadows /all /quiet pre-encryption
3. **Scenario 3**: WMIC shadowcopy delete via PowerShell
4. **Scenario 4**: bcdedit disabling recovery mode before impact

## Output Format

```
Hunt ID: TH-HUNTIN-[DATE]-[SEQ]
Technique: T1490
Host: [Hostname]
User: [Account context]
Evidence: [Log entries, process trees, network data]
Risk Level: [Critical/High/Medium/Low]
Confidence: [High/Medium/Low]
Recommended Action: [Containment, investigation, monitoring]
```

## Shipped Playbook Resources

- `skill://red-hunting-for-shadow-copy-deletion/references/api-reference.md` — API and execution command reference
- `skill://red-hunting-for-shadow-copy-deletion/references/standards.md` — Relevant standards and compliance baselines
- `skill://red-hunting-for-shadow-copy-deletion/references/workflows.md` — Operational procedures and detailed workflows
- `skill://red-hunting-for-shadow-copy-deletion/assets/template.md` — Assessment deliverable and reporting template
