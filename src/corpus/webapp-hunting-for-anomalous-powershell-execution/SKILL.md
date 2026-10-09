---
name: webapp-hunting-for-anomalous-powershell-execution
description: Hunt for malicious PowerShell activity by analyzing Script Block Logging (Event 4104), Module Logging (Event 4103), and process creation events.
domain: webapp
category: threat-intelligence
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/webapp-hunting-for-anomalous-powershell-execution/SKILL.md
---
# Hunting for Anomalous PowerShell Execution

## Overview

PowerShell Script Block Logging (Event ID 4104) records the full deobfuscated script text
executed on a Windows endpoint, making it the primary data source for hunting malicious
PowerShell. Combined with Module Logging (4103) and process creation events, analysts can
detect encoded commands, AMSI bypass patterns, download cradles, credential theft tools,
and fileless attack techniques even when the attacker uses obfuscation layers.


## When to Use

- When investigating security incidents that require hunting for anomalous powershell execution
- When building detection rules or threat hunting queries for this domain
- When SOC analysts need structured procedures for this analysis type
- When validating security monitoring coverage for related attack techniques

## Detection Gaps & Validation

- **4104 must be on before the incident:** Script Block Logging (EID 4104) only captures what was logged at execution time — if the GPO (`Turn on PowerShell Script Block Logging`) was off, no amount of EVTX parsing recovers the script. Module Logging (4103) and transcription complement but do not replace it.
- **Multi-part script blocks:** large/obfuscated scripts split across many 4104 records (`MessageNumber`/`MessageTotal`) — reassemble by `ScriptBlock ID` or you key on truncated fragments and miss the malicious section.
- **ETW blinding & downgrade:** `amsiInitFailed`, `[Ref].Assembly` ETW patching, and `-Version 2` downgrade stop 4104 from being written at all — treat a host that *stops* emitting 4104 as suspicious, not clean.
- **Non-powershell.exe hosts:** runspaces hosted in `System.Management.Automation.dll` (C# loaders, `InstallUtil`, custom binaries) bypass powershell.exe — hunt the DLL load, not just the EXE.
- **Validate:** run Atomic Red Team **T1059.001** (encoded command, IEX download cradle, AMSI bypass) on an instrumented host and confirm the parser flags 4104 records for `amsi`, `FromBase64String`, and `DownloadString`.
- **Tune FPs:** Intune/SCCM and admin automation produce long encoded scripts — baseline by initiating parent and signing, not script length alone.

## Prerequisites

- Windows Event Log exports (.evtx) from Microsoft-Windows-PowerShell/Operational
- Python 3.8+ with python-evtx and lxml libraries
- Script Block Logging enabled via Group Policy
- Understanding of common PowerShell attack techniques

## Steps

1. Parse EVTX files extracting Event 4104 script block text and metadata
2. Reassemble multi-part script blocks using ScriptBlock ID correlation
3. Scan script text for AMSI bypass indicators and obfuscation patterns
4. Detect encoded command execution and base64 payloads
5. Identify download cradles, credential dumping, and lateral movement commands
6. Score and prioritize findings by threat severity

## Expected Output

```json
{
  "total_events": 1247,
  "suspicious_events": 23,
  "amsi_bypass_attempts": 2,
  "encoded_commands": 8,
  "download_cradles": 5,
  "credential_access": 3
}
```