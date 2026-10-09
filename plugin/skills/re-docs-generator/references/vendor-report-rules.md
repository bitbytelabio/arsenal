# Vendor Report Rules (Professional Vendor Report Structure Overlay)

> Issue #65 Item 2.  
> **Extract structural and stylistic rules only; verbatim copying of vendor report body text, figures, tables, real IOC instances, or extended passages is strictly prohibited.**  
> This document serves as an **overlay**: it does not replace the task templates in `security-report-templates.md`, nor does it diminish §0 Evidence→Finding→Path requirements.

Structural references (public samples, structural skeleton only):

| Flavor | Primary Reference | Scenario |
|--------|-------------------|----------|
| `malware` | Huorong Security Virus/Technical Analysis Reports | Distinct common trojans, DLL sideloading, phishing lures/poisoning, malicious samples |
| `apt` | Kaspersky Securelist / APT Campaign Reports (e.g., MATA) | APTs, threat group campaigns, multi-stage infection chains, targeted industry attacks |

Principle: **Template quality over quantity** — Only 2 full-text vendor flavors (`malware` / `apt`) + Base common elements + **optional thin overlay** (e.g., `vuln` vulnerability technical analysis). Standard reverse engineering, penetration testing, CTF, and JS reports retain their respective task templates and must not default to masquerading as malware reports; `vuln` is **not** a third default full-text flavor.

---

## 0. When to Enable

When `docs-generator` generates **security-oriented** reports (reverse engineering / malware / penetration testing completion / explicit user requests for "professional reports" or "vendor style"), it **MUST** read this document. Select a vendor flavor only when task evidence or explicit user requirements support it; otherwise, use `flavor = null` and only overlay standard professional elements onto the original task template.

| Signal | Flavor / Overlay |
|--------|------------------|
| APT / Threat group / Campaign / Multi-stage C2 / Industry targeting / ICS / Spear-phishing campaign | `apt` |
| Distinct malicious sample, trojan, stealer, DLL sideloading, spoofed site | `malware` |
| Explicit user request for vulnerability/patch/CVE technical analysis, or task evidence involves OS/component vulnerability research | `flavor = null` + **thin overlay `vuln`** (see §3b) |
| Standard APK/ELF/PE/Mach-O reverse engineering, algorithm analysis, firmware analysis, penetration testing, CTF, JS signatures | `flavor = null`; use original task template and minimal set of standard professional elements |

When a user explicitly specifies "follow Kaspersky/APT style", "follow Huorong/virus report style", or "follow vulnerability technical analysis style", override automatic selection.  
It is **PROHIBITED** to default standard malware/APT/standard reverse engineering reports into the `vuln` directory structure.

---

## 1. General Professional Elements (Base)

The following Base elements apply according to report type. Items marked **MUST** cannot be omitted; elements tied to a specific flavor must not appear in unrelated tasks merely to fill a template. Where no applicable content exists, use `n/a` and state the reason.

| # | Element | Requirement |
|---|---------|-------------|
| G1 | Executive Summary / Overview | **MUST**: 3–8 sentences: what was analyzed, most critical finding, impact scope, recommended actions |
| G2 | Scope & Authorization | **MUST**: Link to case `scope.md` (see template §0.1) |
| G3 | Evidence→Finding→Path | **MUST**: See `security-report-templates.md` §0 and `skills/ops/evidence-finding-path.md` |
| G4 | IOC Table | `malware` / `apt` **MUST**; for other tasks, include only when relevant indicators exist |
| G5 | Recommendations / Remediation | `malware` / `apt` **MUST**: At least 1 actionable recommendation; other tasks follow original task template |
| G6 | Appendix Metadata | **SHOULD**: Tools and versions, sample hashes, complete reproduction commands |
| G7 | ATT&CK Mapping | **MUST** (under `apt`; if no applicable techniques, `n/a` + reason); for other tasks, **SHOULD** |

### 1.1 Minimum IOC Table Columns

```markdown
| Type | Value | Context | First/Last Seen | Source Evidence | Confidence |
|------|-------|---------|-----------------|-----------------|------------|
| file_sha256 / file_md5 / domain / ip:port / url / mutex / path / registry | … | Where discovered | YYYY-MM-DD / n/a | E-id | high/med/low |
```

### 1.2 Copyright and Safety Boundaries

- Do not paste text paragraphs or figure captions from vendor PDFs/web pages to serve as your own analysis.
- Use placeholders for real tokens, internal URLs, and client identifiers.
- For unauthorized targets, do not output actionable, step-by-step exploitation details (comply with case scope / RULES).

---

## 2. Flavor: `malware` (Huorong Style · Explicit Selection)

**Narrative Goal**: Allow the reader to grasp within 5 minutes: "What is it → How did it arrive → What did the sample do → How to remediate → What are the IOCs".

### 2.1 Recommended Section Order

```markdown
# [Title: One-sentence Threat Characterization]

> Analysis Date / Analyst / Sample Identifier (Hash)

## 1. Overview
(G1: Discovery vector, camouflage technique, core technical mechanism, detection/kill capability by security products—state n/a if unknown)

## 2. Attack / Infection Flow
(Flowchart: Mermaid diagram or step-by-step list; corresponds to Path `path_type=attack`)

## 3. Sample Analysis
### 3.1 Sample Provenance
### 3.2 Static Analysis
(**MUST** include import table / baseline identity Evidence: E-imports or equivalent; see radare2/ida/malware hard gates)
### 3.3 Dynamic Analysis / Behavioral Observations
(If no dynamic execution environment exists, state n/a + reason)
### 3.4 Key Findings (Findings table or numbered list linked to evidence_ids)

## 4. Emergency Remediation Procedures
(Execute strictly within authorized scope: first verify scope and preserve evidence such as samples, memory, process trees, network connections, and logs, then isolate the host; terminate processes, isolate/quarantine files, inspect hosts/persistence autostarts, run a full scan, and perform verification only after obtaining approval from the designated lead. Do not directly delete files before evidence preservation is complete.)

## 5. Summary & Guidance
(Risk notices and preventative measures for general users/system administrators)

## 6. IOC Information
(G4 Table)

## 7. Evidence Chain Summary
(§0: E / F / P / Timeline; can be merged with §3.4, but mandatory fields cannot be omitted)

## 8. Appendix
(Tool versions, reproduction commands, script paths)
```

### 2.2 Writing Style

- Default to Chinese for Chinese-speaking users; conclusions first, details second.
- Organize static analysis hierarchically by "Component/Stage"; avoid pasting unstructured, monolithic log output.
- Remediation steps must be independently actionable; generic platitudes such as "enhance security awareness" are prohibited.

---

## 3. Flavor: `apt` (Kaspersky Securelist Style)

**Narrative Goal**: Clearly convey a campaign-level narrative—who attacked whom, when, via what chain; how the investigation unfolded; how components cooperated; and what defenders can use for detection.

### 3.1 Recommended Section Order

```markdown
# [Campaign/Cluster Name]: [One-sentence Impact Summary]

> Date / Team / Industry & Regional Scope (if known)

## 1. Executive Summary
(G1: Timeframe, victim profile, initial access vector, family/cluster attribution, dwell time, most critical finding)

## 2. The Infection Chain
(Broken down by phase: Delivery → exploit/loader → Main payload → Post-exploitation/exfiltration; explicitly note "limited visibility" for unknown segments;
corresponds to Path; chain diagram recommended)

## 3. Incident Investigation
(Investigative narrative: pivotal turning points, internal proxy/C2 characteristics, scope expansion methodology; linked to Timeline)

## 4. Interesting Findings
(3–7 non-obvious points, each linked where possible to E-id / F-id)

## 5. Technical Analysis
### 5.1 Component Overview Table (loader / trojan / stealer / …)
### 5.2 Per-Component Behaviors and Configurations
### 5.3 Static Analysis Highlights (including import tables / packing / persistence Evidence)
### 5.4 Network and C2 Infrastructure
(Optional ATT&CK Table G7 may be appended)

## 6. Detection and Mitigation
(Detection strategies / threat hunting leads / mitigation priorities; avoid hollow slogans)

## 7. Indicators of Compromise (IOC)
(G4; grouped by type)

## 8. Evidence Chain Summary
(§0 Fields)

## 9. Appendix
(Sample list with hashes, tool versions, referenced public advisories/identifiers; no copying of external report text)
```

### 3.2 Writing Style

- Maintain transparency regarding timelines and "visibility limitations".
- Interesting findings ≠ repeating the executive summary; describe genuinely significant anomalies uncovered during investigation.
- Component analysis should utilize structured tables: Role / Persistence / C2 / Dependencies, followed by detailed narrative.

---

## 3b. Thin Overlay: `vuln` (Vulnerability Technical Analysis · Optional)

> Issue #65 supplement. Structure references public "OS/component vulnerability technical analysis" report outlines; **extract structural skeletons only**. Copying PoC payloads, exploitation details, or unauthorized attack procedures from screenshots/body text is strictly prohibited.  
> This is **not** a third default full-text vendor flavor; it is overlaid only during vulnerability research tasks or upon explicit user request.

**Narrative Goal**: Enable the reader to quickly determine "Who is affected → How to verify/reproduce (within authorized scope) → Root cause and patch differences → How to mitigate".

### Recommended Section Order

```markdown
## 1. Vulnerability Overview
### 1.1 Affected Scope (Versions / components / configuration prerequisites)
### 1.2 Vulnerability Reproduction (Authorized environments; steps reproducible by third parties; non-weaponized tutorial tone)

## 2. Vulnerability Analysis
### 2.1 Crash / Exception Analysis (Evidence: crash logs, trigger conditions)
### 2.2 Patch Analysis (diff / guard conditions / remediation points — linked to E-*)
### 2.3 PoC or Trigger Analysis (Limited to materials already within authorized scope; protocol/input construction level descriptions suffice)

## 3. Defense and Mitigation Recommendations
### 3.1 Workarounds & Mitigations (Configuration / mitigation toggles, etc.)
### 3.2 Official Patches and Verification

## 4. Evidence → Finding → Path (Can be integrated into respective sections or formatted as a standalone table)
```

### Hard Constraints

- **MUST** enforce scope/authorization: Reproduction and PoC extensions are prohibited on unauthorized targets.
- **MUST** enforce E/F/P: Reproduction, crash, and patch conclusions must be tagged with evidence_ids.
- **MUST NOT** use `vuln` as a default container for malware/APT analysis.
- **MUST NOT** copy exploit code or full weaponization procedures from external reports/screenshots.
- IOC Table: Include only when network/file indicators exist; otherwise, mark n/a or omit.

---

## 4. Integration with Existing Task Templates

| Task Template (`security-report-templates.md`) | Overlay Approach |
|------------------------------------------------|------------------|
| 1. Reverse Engineering Report | Default `flavor = null`; retain original "Static/Dynamic/Reproduction" skeleton and hard-gate Evidence such as import tables; adopt §2 only for explicit malware samples |
| 2. Penetration Testing Report | `flavor = null`; supplement with applicable Base elements G1–G3; align attack paths with §0 Path; IOCs not mandatory |
| 3. CTF Writeup | `flavor = null`; retain original challenge, methodology, and reproduction structure; IOC/ATT&CK not mandatory |
| 4. JS/Web Signature Reverse Engineering | `flavor = null`; retain original Overview → Localization → Algorithm → Reproduction skeleton; do not apply malware flavor |
| Malware / APT Specialization | Explicitly select full-text skeleton from `malware` or `apt` |

**Conflict Resolution**: §0 Evidence chain fields and scope gate checks **always take precedence**; flavors only modify narrative sequencing and professional presentation framing, and must never remove E/F/P data.

---

## 5. Selection Pseudocode

```
if user_requests_kaspersky or apt or threat_campaign:
    flavor = apt
elif user_requests_huorong or vir_report or explicit_malware:
    flavor = malware
else:
    flavor = null  # Original task template + applicable Base elements
overlay = null
if user_requests_vuln_tech_report or cve_patch_analysis:
    overlay = vuln  # thin only; never a third default full flavor
emit(base_report)
if flavor in (malware, apt):
    emit(report with flavor outline)
elif overlay == vuln:
    emit(report with vuln thin outline)
```

---

## 6. Completion Checklist (Post-Writing Self-Audit)

- [ ] Flavor or explicit "Task Template + Minimal Set" selected
- [ ] G1 Executive Summary present and contains substantive analysis
- [ ] §0 E/F/P fields complete
- [ ] `malware` / `apt` report contains an IOC table (or n/a + rationale)
- [ ] `malware` / `apt` report contains actionable recommendations/remediation steps
- [ ] Tasks without a designated flavor are not forced into malware/APT-specific sections
- [ ] `vuln` enabled exclusively for vulnerability tasks; contains Overview/Analysis/Remediation skeleton and E/F/P; contains no unauthorized weaponized PoCs
- [ ] No verbatim copying of vendor text, no unresolved placeholders/TODO markers
- [ ] Hard-gate Evidence such as import tables are incorporated into static/technical analysis (if binary analysis was performed in this task)

---

## 7. Source Registration

- Kaspersky Securelist, “Updated MATA attacks industrial companies in Eastern Europe”: <https://securelist.com/updated-mata-attacks-industrial-companies-in-eastern-europe/110829> (Structural reference; accessed: 2026-08-11)
- Huorong Security Public Technical Articles Portal: <https://www.huorong.cn/> (Portal entry; accessed: 2026-08-11. Specific article URLs, titles, and access dates must be registered upon actual citation)
- ATT&CK technique IDs serve solely as standardized taxonomy mappings and must be substantiated by current Evidence; external report IOCs must not be automatically ported into the current report.

---

## 8. Non-Goals

- Do not maintain separate full-text templates for Mandiant, CrowdStrike, QiAnXin, etc. (common requirements are already met by the dual flavors + optional thin overlay).
- Do not elevate `vuln` to a third default full-text flavor alongside malware/apt.
- Do not automatically scrape vendor websites to populate reports.
- Do not lower Evidence contract standards or expand authorized scope boundaries on account of a flavor.