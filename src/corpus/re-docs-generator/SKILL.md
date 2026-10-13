---
name: re-docs-generator
description: Produces task-oriented technical reports and documentation with structured findings.
domain: re
category: binary-analysis
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-docs-generator/SKILL.md
---
# Technical Documentation

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Confirm whether the current task falls within the scope of this skill.
2. `NOW`: Read `tool-index` (workstation tool inventory) to verify tool availability and actual paths.
3. `NEXT`: Invoke bootstrap when tools are missing; do not guess paths.
4. `ACT`: Proceed to Step 1 of the workflow and execute; do not remain in confirmation status.

For writing style, tone, and voice guidance, use `Skill(ce:writer)` with **The Engineer** persona.

## Security and Reverse Engineering Task Documentation Output

When a reverse engineering, penetration testing, CTF, or security analysis task is completed, this skill is responsible for generating formal technical documentation in the **user's project directory**.

### Trigger Timing

1. Reverse engineering task is completed, having produced core conclusions (algorithm reconstructed, signature cracked, bypass method identified, etc.).
2. Penetration test is completed, having discovered and verified vulnerabilities.
3. CTF challenge is solved, having obtained the flag.
4. The user explicitly requests "write a report/documentation/writeup".

### Template Selection

| Task Type | Template to Use |
|-----------|-----------------|
| APK / Binary / SO Reverse Engineering | `skill://re-docs-generator/references/security-report-templates.md` → Reverse Engineering Report |
| Penetration Testing / Vulnerability Hunting | `skill://re-docs-generator/references/security-report-templates.md` → Penetration Testing Report |
| CTF Solution | `skill://re-docs-generator/references/security-report-templates.md` → CTF Writeup |
| JS / Web Signature Reverse Engineering | `skill://re-docs-generator/references/security-report-templates.md` → Signature Reverse Engineering Report |
| Malware / APT / Virus Analysis Report | `skill://re-docs-generator/references/security-report-templates.md` + **`skill://re-docs-generator/references/vendor-report-rules.md`** |
| General Technical Documentation | `skill://re-docs-generator/references/templates.md` → README / API Documentation |

### Vendor Report Structure (Issue #65)

Formal security reports **MUST** read `skill://re-docs-generator/references/vendor-report-rules.md` (adopt the structure only; do not copy vendor text). Select a vendor flavor only when task evidence supports it or when explicitly requested by the user; for general reverse engineering and other tasks, use `flavor = null`.

| Flavor / Overlay | When to Use | Primary Reference Skeleton |
|------------------|-------------|----------------------------|
| `malware` | Confirmed malicious sample, Trojan, DLL side-loading, phishing poisoning | Huorong-style: Overview → Flow → Sample Analysis → Emergency Response → IOC |
| `apt` | APT / Campaign / Threat Actor / Multi-stage infection chain / Industry targeted | Kaspersky Securelist-style: Executive Summary → Infection Chain → Investigative Narrative → Interesting Findings → Technical Analysis → Detection & Mitigation → IOC |
| `flavor = null` | General APK/ELF/PE/Mach-O reverse engineering, algorithm/firmware analysis, Penetration Testing / CTF / JS signature | Original task template + Base common elements; do not apply malware/APT specific sections |
| thin `vuln` | User explicitly requests technical analysis of a vulnerability/patch/CVE | Overview → Impact/Reproduction → Crash & Patch Analysis → Remediation Recommendations (overlaid on top of null, not a 3rd default full-text flavor) |

Principle: **Quality over quantity in templates** — Only 2 vendor full-text flavors; `vuln` serves solely as an optional thin overlay, without introducing a third default full-text template.
Takes effect **concurrently** with §0 Evidence→Finding→Path; in case of conflict, the Evidence contract takes precedence.

### Output Specifications

- **Output Location**: User's current project directory (not the skill package directory)
- **File Name Format**: `YYYY-MM-DD_[type]-[target-abbreviation]-report.md`
- **If the project contains a `docs/` directory**: Place under `docs/` preferentially
- **Encoding**: UTF-8
- **Language**: Follow the user's conversation language (generate Chinese report for Chinese conversation, English report for English conversation)

### Quality Requirements

- All code blocks must be directly executable or have clear context.
- No placeholder/TODO items.
- Key findings must be supported by evidence.
- Reproduction steps must allow third parties to independently reproduce results.
- Replace sensitive information (real tokens, passwords, internal URLs) with placeholders.
- **MUST** include an Evidence → Finding → Path chain (see `skill://re-docs-generator/support/ops/evidence-finding-path.md` and template §0).
- **MUST** read `skill://re-docs-generator/references/vendor-report-rules.md`: Select `malware` / `apt` or `flavor = null` (thin `vuln` can be overlaid for vulnerability tasks); when no flavor is set, only output the original task template and applicable Base elements without forcing IOC/ATT&CK.
- **SHOULD** reference case `scope.md` / `timeline.md` (`arsenal scripts case-init`).

### Diagram Integration

When generating reports, invoke the `diagram-generator` skill at appropriate sections to generate visual diagrams:

| Report Type | Recommended Diagram | Diagram Type |
|-------------|---------------------|--------------|
| Reverse Engineering Report | Function call hierarchy, data flow diagram | Mermaid flowchart / sequenceDiagram |
| Penetration Testing Report | Attack path diagram, network topology diagram | Mermaid flowchart / Graphviz |
| CTF Writeup | Problem-solving thought process flow | Mermaid flowchart |
| JS Signature Reverse Engineering Report | Request execution sequence diagram, algorithm flow | Mermaid sequenceDiagram / flowchart |

Embed diagrams directly into the markdown report as Mermaid code blocks to ensure native rendering on GitHub/GitLab.

---

## Core Principles

### 1. Progressive Disclosure

Reveal information in layers:

| Layer | Content | User Question |
|-------|---------|---------------|
| 1 | One-sentence description | What is it? |
| 2 | Quick start code block | How do I use it? |
| 3 | Full API reference | What are my options? |
| 4 | Architecture deep dive | How does it work? |

**Warnings, breaking changes, and prerequisites go at the TOP.**

### 2. Task-Oriented Writing

```markdown
<!-- Bad: Feature-oriented -->
## AuthService Class
The AuthService class provides authentication methods...

<!-- Good: Task-oriented -->
## Authenticating Users
To authenticate a user, call login() with credentials:
```

### 3. Show, Don't Tell

Every concept needs a concrete example.

## Formatting Standards

- **Sentence case headings**: "Getting started" not "Getting Started"
- **Max 3 heading levels**: Deeper means split the doc
- **Always specify language** in code blocks
- **Relative paths** for internal links
- **Tables** for structured data with 3+ attributes

## Quality Checklist

- [ ] Code examples tested and runnable
- [ ] No placeholder text or TODOs
- [ ] Matches actual code behavior
- [ ] Scannable without reading everything
- [ ] Reader knows what to do next

## Anti-Patterns

| Problem | Fix |
|---------|-----|
| Wall of text | Break up with headings, bullets, code, tables |
| Buried critical info | Warnings/breaking changes at TOP |
| Missing error docs | Always document what can go wrong |

## Templates

For README, API endpoint, and file organization templates, see [references/templates.md](skill://re-docs-generator/references/templates.md).

## Related Skills

- `Skill(ce:writer)` - Writing style, tone, and voice (load The Engineer persona)
- `Skill(ce:visualizing-with-mermaid)` - Architecture and flow diagrams


---

## On-Demand Bootstrap

This skill has no external tool dependencies and relies entirely on pure text generation. No bootstrap required.

If rendering diagrams to embed in reports is required, invoke the `diagram-generator/` skill.

---

## Routing Context

**Upstream Entry**: Automatically invoked by all security and reverse engineering skills upon task completion.
**Trigger Mode**:
- Automatic: Executed as step 9 in the behavior chain following task completion
- Manual: Triggered when user states "write a report", "produce documentation", or "writeup"

**Related Sibling Modules**:
- `re-apk-reverse/` — Generates reverse engineering report after APK reversing is complete
- `re-ida-reverse/` — Generates reverse engineering report after binary analysis is complete
- `re-radare2/` — Generates reverse engineering report after CLI analysis is complete
- `webapp-js-reverse/` — Generates signature report after JS signature reversing is complete
- `re-reverse-engineering/` — Generates reverse engineering report after general reverse engineering is complete
- `field-journal/` — Report content simultaneously serves as a data source for the evolution journal

**Security Report Templates**: `skill://re-docs-generator/references/security-report-templates.md`
**Vendor Report Rules**: `skill://re-docs-generator/references/vendor-report-rules.md` (flavor: malware | apt | null; optional overlay: vuln)
**General Documentation Templates**: `skill://re-docs-generator/references/templates.md`


## Task Completion Self-Check (MUST pass before claiming completion)

- [ ] Did I execute each step in the workflow (rather than only reading)?
- [ ] Did I use verified tool paths based on `tool-index`?
- [ ] Did I produce reproducible evidence (commands/templates/screenshots/reports)?
- [ ] Does the report contain Evidence / Finding / Path (ops contract)?
- [ ] Were the Checklist items required by RULES completed and written back?
