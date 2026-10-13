# Security / Reverse Engineering / Penetration Testing Technical Documentation Templates

This document provides documentation templates for security projects including reverse engineering, penetration testing, and vulnerability analysis. Upon task completion, the AI MUST create a new document in the user's project directory and format the output according to the corresponding template.

---

## 0. Evidence Chain (MUST be included in all security reports)

> Full contract text: `skill://webapp-pentest-tools/support/ops/evidence-finding-path.md`  
> Case directory: `work/<case>/` (`arsenal scripts case-init`)

The report body **MUST** contain the following sections (these may be merged into "Key Findings", but no fields may be omitted):

### 0.1 Scope Summary
- Linked to `scope.md`: `auth` / `in_scope` / `network_profile`
- No scope → Task completion MUST NOT be claimed

### 0.2 Evidence
At least 1 item, required fields: `E-id` / `source_ref` / `repro_command` / `content_hash|n/a`

### 0.3 Findings
Each entry: `F-id` / `severity|n/a_re` / `evidence_ids` / `confidence` / `location` / `status`

### 0.4 Path
At least 1 `P-id`: `path_type=attack|callflow|solve`, where steps can reference E/F

### 0.5 Timeline Summary
Linked to `timeline.md` or embedded with 3–10 critical appended records

---

---

## 0.6 Vendor Structure Overlay (Professional Vendor Report Structure)

> Full rules: `skill://re-docs-generator/references/vendor-report-rules.md` (Issue #65)  
> **MUST** be read and selected when generating formal security reports; **adopt structure only, strictly forbid verbatim copying of vendor text or IOC instances**.

| Flavor / Overlay | Scenario | Skeleton in One Sentence |
|------------------|----------|--------------------------|
| `malware` | Confirmed malicious sample / common Trojan / DLL side-loading | Huorong style: Overview → Workflow → Sample Analysis → Incident Response → IOC |
| `apt` | APT / Campaign / Multi-stage kill chain | Kaspersky style: Executive Summary → Infection Chain → Investigation → Interesting Findings → Technical Analysis → Detection & Mitigation → IOC |
| `flavor = null` | Standard reverse engineering / Pentest / CTF / JS signature | Task template from this section + applicable Base common elements |
| thin `vuln` | Vulnerability / Patch / CVE technical analysis (explicit) | Overview → Impact / Reproduction → Crash & Patch Analysis → Remediation Recommendations |

**Common Elements (G1–G7) Summary**: G1 Executive Summary MUST · G2 Scope MUST · G3 E/F/P MUST · G4 IOC MUST only for `malware`/`apt` · G5 Recommendations MUST for `malware`/`apt`/`vuln` · G6 Appendix SHOULD · G7 ATT&CK MUST for `apt`

Template selection and section ordering are governed by `vendor-report-rules.md`; when conflicts arise with §0.1–0.5, the **Evidence contract takes precedence**.

## 1. Reverse Engineering Report Template

```markdown
# [Target Name] Reverse Engineering Analysis Report

> Analysis Date: YYYY-MM-DD
> Analyst: [AI / Human]
> Toolchain: [jadx / IDA / radare2 / Frida / ...]

## 1. Target Overview

| Attribute | Value |
|-----------|-------|
| File Name | |
| File Type | APK / ELF / PE / Mach-O / ... |
| Size | |
| MD5 | |
| SHA256 | |
| Package Name / Entry Point | |

## 2. Analysis Objectives

<!-- Core questions to be answered by this reverse engineering analysis -->

## 3. Static Analysis

### 3.1 Basic Information
<!-- Architecture, compiler, protection mechanisms, string signatures -->

### 3.1.1 Import Table / Dependencies (MUST for binaries)
<!-- Record summary into E-imports / E-triage-imports; record Evidence even upon failure, skipping is forbidden -->

### 3.2 Key Functions / Classes
<!-- List identified critical logic, accompanied by code snippets -->

### 3.3 Encryption / Signature Algorithms
<!-- If encryption is involved, detail algorithm, key provenance, and parameter construction -->

## 4. Dynamic Analysis

### 4.1 Hook Logs
<!-- Frida / Xposed / other hook targets and results -->

### 4.2 Runtime Behavior
<!-- Network requests, file operations, process behaviors -->

## 5. Key Findings

<!-- Enumerate key conclusions -->

1. ...
2. ...
3. ...

## 6. Reproduction Steps

<!-- Allow third parties to reproduce your analysis results -->

```bash
# Critical commands
```

## 7. Open Issues

<!-- Aspects not fully resolved -->

## 8. Attachments

<!-- Hook scripts, decryption code, screenshots, etc. -->
```

---

---

## 1b. Malware / APT Report (Vendor Flavor)

When the task involves malware analysis, virus reporting, or APT/campaign analysis, **DO NOT** merely settle for the "Reverse Engineering" skeleton above; standard reverse engineering tasks retain the original template without automatically adopting vendor flavors:

1. Read `vendor-report-rules.md` and select `malware` or `apt`
2. Generate output following the corresponding section order
3. Still **MUST** include §0 Evidence Chain; `malware` / `apt` flavors **MUST** additionally include an IOC table
4. Static analysis of binary samples **MUST** include Import Table Evidence (aligned with radare2/ida/malware hard gates)

## 1c. Vulnerability Technical Analysis Report (Thin `vuln` Overlay)

When the task involves **OS/component vulnerabilities, patch diffing, CVE technical analysis**, or when the user explicitly requests a "Vulnerability Technical Analysis Report":

1. Read `vendor-report-rules.md` §3b and apply the thin `vuln` section ordering (**NOT** the full-text malware/apt flavor)
2. **MUST** include: Impact scope, authorized reproduction or explicit n/a, crash/root cause or patch diff Evidence, remediation/patch recommendations
3. **MUST** include §0 Evidence → Finding → Path
4. **MUST NOT** expand PoCs on unauthorized targets or transcribe external weaponized exploit details

## 2. Penetration Testing Report Template

```markdown
# [Target] Penetration Testing Report

> Test Date: YYYY-MM-DD
> Target Scope: [URL / IP / Application Name]
> Authorization Status: [Authorized / CTF / Lab Environment]

## 1. Executive Summary

<!-- One-paragraph summary: what was tested, what was discovered, risk level -->

## 2. Scope of Testing

| Item | Details |
|------|---------|
| Target | |
| Test Type | Black-box / Gray-box / White-box |
| Test Schedule | |
| Tools | |

## 3. Findings Summary

| # | Vulnerability Name | Risk Level | Status |
|---|--------------------|------------|--------|
| 1 | | High / Medium / Low / Info | Verified / Pending Confirmation |

## 4. Vulnerability Details

### 4.1 [Vulnerability Name]

**Risk Level**: High / Medium / Low

**Description**:

**Impact**:

**Reproduction Steps**:

1. ...
2. ...
3. ...

**Evidence**:

```
<!-- Request / Response / Screenshot / Payload -->
```

**Remediation Recommendation**:

## 5. Attack Path

<!-- If a full attack chain exists, illustrate the path -->

```
Entry Point → Reconnaissance → Exploitation → Privilege Escalation → Target Compromise
```

## 6. Tools and Environment

| Tool | Version | Purpose |
|------|---------|---------|
| | | |

## 7. Remediation Summary

| Priority | Recommendation |
|----------|----------------|
| P0 | |
| P1 | |
| P2 | |

## 8. Appendix

<!-- Full payloads, scripts, configuration files, etc. -->
```

---

## 3. CTF Writeup Template

```markdown
# [Competition Name] - [Challenge Name] Writeup

> Category: Web / Reverse / Pwn / Crypto / Misc / Forensics
> Difficulty: Easy / Medium / Hard
> Points: N pts
> Solve Time:

## Challenge Description

<!-- Original challenge description -->

## Solution Methodology

### Step 1: Reconnaissance
<!-- Observations made -->

### Step 2: Vulnerability / Breakthrough
<!-- Key leverage points identified -->

### Step 3: Exploitation
<!-- Exploitation process -->

## Key Code / Payload

```python
# exploit code
```

## Flag

```
flag{...}
```

## Pitfalls & Notes

<!-- Detours and dead ends encountered -->

## Knowledge Points

<!-- Concepts and techniques involved for future review -->
```

---

## 4. JS/Web Signature Reverse Engineering Report Template

```markdown
# [Site / Application] Signature Parameter Reverse Engineering Report

> Analysis Date: YYYY-MM-DD
> Target Endpoint: [URL]
> Signature Parameter: [Field Name]

## 1. Target Request

```http
POST /api/xxx HTTP/1.1
Host: example.com

param1=xxx&sign=<target_field>
```

## 2. Tracing Process

### 2.1 Breakpoint / Hook Methodology
<!-- How the signature generation routine was located -->

### 2.2 Call Stack
<!-- Critical execution call chain -->

## 3. Algorithm Reconstruction

### 3.1 Algorithm Type
<!-- HMAC-SHA256 / AES / Custom / ... -->

### 3.2 Parameter Construction
<!-- Fields involved in signing, sorting rules, delimiters -->

### 3.3 Key Provenance
<!-- Hardcoded / API Response / Timestamp-derived / ... -->

## 4. Local Reproduction Code

```javascript
// Node.js reproduction
```

## 5. Verification Results

<!-- Comparison between locally generated signatures and authentic requests -->

## 6. Anti-Bot / Risk Control Considerations

<!-- Rate limits, device fingerprinting, environment detection, etc. -->
```

---

## 5. Document Output Specifications

### Output Location

- Documents MUST default to the **user's current project directory** (not the skill package directory)
- Filename format: `YYYY-MM-DD_[type]-[target_shortname]-report.md`
- If the user's project contains a `docs/` directory, prioritize placing it under `docs/`

### Trigger Conditions

The AI automatically invokes this skill to generate documentation upon the following conditions:

1. Reverse engineering task completed with key conclusions produced
2. Penetration testing completed with vulnerabilities discovered and verified
3. CTF challenge solved with flag retrieved
4. The user explicitly requests to "write a report / document"

### Quality Requirements

- All code blocks MUST be directly executable or contain clear, sufficient context
- No placeholders/TODOs (if a section is genuinely incomplete, mark it as "To Be Supplemented" and state the technical reason)
- Critical findings MUST be backed by evidence (command outputs, screenshot descriptions, code snippets)
- Reproduction steps MUST allow independent reproduction by third parties