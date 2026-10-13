# Agent Skill Supply Chain Security (Package Feature)

> Consolidated Sources: OWASP Agentic Skills Top 10 (AST10), Anthropic Agent Skills Security Best Practices, Public Poisoning Incidents (e.g., ClawHavoc; see AST10 timeline)  
> Retrieved: 2026-07-17  
> Scope: Applicable when installing, authoring, or merging **any** skill, MCP, or bootstrap script

Static audit of this package's **executable script surface** (backdoors / destructive deletion / piped execution): PACKAGE-SECURITY-AUDIT.md.

## 1. Why reverse-skill Manages This Independently

This package will:

- Guide the AI to **execute commands and bootstrap downloads**
- Access local systems and networks via MCP  
- Write to field-journal / reports  

Malicious skills can cause credential theft, persistent prompt poisoning, and supply chain backdoors.  
We implement a **documentation latch + single source of truth for tools** rather than building another skill marketplace.

## 2. Threat Matrix (Condensed AST10 Approach)

| Risk Category | Manifestation | Package Controls |
|---|---|---|
| Malicious / Poisoned Skill | Induces exfiltration, writes to memory / backdoors | Trust only this repository + explicitly authorized external sources; external sources require manual review of SKILL.md and scripts |
| Excessive Permissions | Indiscriminate `curl \| bash`, full-disk read | Bootstrap restricted to manifest capabilities; scoped via `network_profile` |
| Dependency Poisoning | Malicious pip/npm packages | Prioritize official releases; pin and record versions in tool-index |
| Blind MCP Trust | Unaudited MCP servers | tool-index registration status + port probing; do not trust remote MCPs by default |
| MCP/CLI Auto-Execution Poisoning | Repository `.env` modifying `CODEX_HOME`, etc., causing malicious MCP execution on launch (HackTricks / CVE patterns) | Do not trust default MCP configurations within repositories; inspect env and MCP lists prior to launching Agent |
| Prompt Injection into Skills | Hidden directives concealed inside SKILL body | Review diffs; forbid "execution directives hidden in HTML comments" without user approval |
| Scope Creep | Skill induces scope expansion / "fully automatic single-domain takeover" | ops/scope-contract: out_of_scope + auth; forbid wide-scale scanning without in_scope definitions |
| Skill Stacking Overload | Mounting too many skills simultaneously increases false negatives (observed in public benchmarks) | Load only PRIMARY + strictly necessary secondary skills (MASTER-ROUTING) |

## 3. External Skill Installation MUST Checklist

```text
□ Source: Official organization / audited list (e.g., ToB curated) / user-owned
□ Read entire SKILL.md + scripts/* + package dependencies
□ No unexplained outbound connections, no default read operations on ~/.ssh / browser profile databases
□ Conflict with this package's routing: Defer strictly to this package's MASTER-ROUTING + scope
□ Do not copy into monorepo unless passing CONTRIBUTING guidelines and data sanitization
□ Update skills/references/community-security-skills.md to record source and retrieval date
```

## 4. Boundaries with Bootstrap / MCP

| Action | Allowed | Prohibited |
|---|---|---|
| `bootstrap-reverse.ps1 -Capability X` | X ∈ bootstrap-manifest.json | Any new capability name without updating manifest |
| Register MCP | User confirmation + tool-index refresh | Silently writing to global MCP pointing to unknown URLs |
| Run community Python one-click pentest | Authorized lab + after source code review | Pointing directly at production targets + uninspected scripts |

## 5. Guidelines for Package Authors / Contributors

- New skills: Follow CONTRIBUTING + ACTION REQUIRED + complete self-audit  
- Referencing community content: Attribute URL + date (in this file / community-security-skills.md)  
- Suspicious behavior detected: Halt execution immediately, notify the user, do not autonomously "attempt bypass"

## 6. Quick Self-Check (Before Merging External Material)

```powershell
# List script extensions to be introduced
Get-ChildItem -Recurse -Include *.ps1,*.sh,*.py,*.js | Select-Object FullName
# Broad search for dangerous patterns (manual review required, non-exhaustive)
# Execute in external directory: Select-String -Pattern 'Invoke-WebRequest|curl .\||wget .\||~/.ssh|exfil'
```

## 7. Related References

- Identity: IDENTITY contract  
- External Directory: `../references/community-security-skills.md`  
- Authorization: scope-contract + precedent-auth journal