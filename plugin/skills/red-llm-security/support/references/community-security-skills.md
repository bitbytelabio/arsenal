# Community Security Skill Ecosystem Comparison (2026-07)

> Source Retrieval Date: **2026-07-17**  
> Objective: Provide reverse-skill with **visibility into external resources** to adopt best practices on demand, **without** integrating massive external repositories wholesale into this package.  
> Package Identity: Routing + Tool bootstrapping + Evidence/Scope contracts + Field journals (see IDENTITY contract).

## 1. High-Value External Repositories (Learn, Do Not Blindly Install)

| Repository | Scale / Positioning | Value to This Package | Risks |
|------------|---------------------|-----------------------|-------|
| [trailofbits/skills](https://github.com/trailofbits/skills) | ToB security research Claude plugin marketplace | Quality benchmark for audit / vulnerability analysis / RE plugins | Must be installed per ToB marketplace; do not implicitly trust non-curated copies |
| [trailofbits/skills-curated](https://github.com/trailofbits/skills-curated) | Vetted plugin list | Takes precedence over arbitrary community skills | Same as above |
| [Orizon-eu/claude-code-pentest](https://github.com/Orizon-eu/claude-code-pentest) | 6 pentest lifecycle skills + pure Python scripts | Recon → Exploit → Report pipeline can serve as a benchmark for our `attack-chain` + `pentest-tools` | Authorization boundaries require self-checks; scripts require sandboxing |
| [trilwu/secskills](https://github.com/trilwu/secskills) | 16 skills + 6 expert subagents | Multi-role division of labor maps to role-map contract | Plugin format; differs from this package's monorepo architecture |
| [Masriyan/Claude-Code-CyberSecurity-Skill](https://github.com/Masriyan/Claude-Code-CyberSecurity-Skill) | ~15–19 domain skills (incl. RE/OT/CSOC) | Domain coverage checklist | Lacks the depth of this package's single-domain skills |
| [mukul975/Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills) | **800+** skills · ATT&CK/NIST mappings | Useful for **framework mapping** and domain directories; whole-repo dependency is discouraged | Excessive footprint; massive maintenance overhead and poisoning surface |
| [Eyadkelleh/awesome-skills-security](https://github.com/Eyadkelleh/awesome-claude-skills-security) | SecLists packaged as agent skills | Entry point for wordlists / payloads | Overlaps with seclists bootstrap |
| [securityfortech/awesome-security-skills](https://github.com/securityfortech/awesome-security-skills) | Curated list of security skills | Index for discovering new skills | List format; requires individual auditing |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | Index of 1000+ cross-vendor skills | Discovering official and community skills | Not security-specific |
| [anthropics/claude-code-security-review](https://github.com/anthropics/claude-code-security-review) | PR security review GitHub Action | Can benchmark our documentation/reporting side for "change audit" scenarios | CI product, not an RE router |
| [agentskills.io](https://agentskills.io) | Agent Skills open standard | Frontmatter / directory convention alignment | The standard itself contains no offensive or defensive content |

### 1.1 Round 2 Retrieval Additions (Re-searched 2026-07-17)

| Repository / Resource | Positioning | Application in This Package |
|-----------------------|-------------|-----------------------------|
| [trailofbits/skills](https://github.com/trailofbits/skills) plugins: `audit-context-building` `differential-review` `semgrep-rule-creator` `sharp-edges` `dwarf-expert` `burpsuite-project-parser` | Audit context, differential security review, dangerous APIs, DWARF, Burp project parsing | Benchmark against `ida-reverse` / `docs-generator` / audit workflows; **do not** merge the entire repo |
| [HexRaysSA/ida-claude-code-plugins](https://github.com/HexRaysSA/ida-claude-code-plugins) | Official IDA Claude plugins (includes domain automation, marked unsafe) | Reference for `ida-reverse` MCP paths; unsafe plugins remain disabled by default |
| [P4nda0s/reverse-skills](https://github.com/P4nda0s/reverse-skills) | IDA-NO-MCP: export decompilation prior to analysis; rev-frida/dex-dump/u3d | Complements "offline exports when MCP is unavailable" |
| [2389-research/binary-re](https://github.com/2389-research/binary-re) | triage → static (r2/Ghidra) → dynamic (QEMU/GDB/Frida) → synthesis | Stage gates for `reverse-engineering` are documented in agent-workflow methodology |
| [incogbyte/android-reverse-engineering-claude-skill](https://github.com/incogbyte/android-reverse-engineering-claude-skill) | APK unpacking, endpoint extraction, adaptive Frida bypasses | Benchmark against `apk-reverse`; dynamic scripts require explicit scope |
| [OwenPawl/cerberus-re-skill](https://github.com/OwenPawl/cerberus-re-skill) | Apple-focused Ghidra + LLDB + Frida tri-loop | Reference for macOS / iOS dynamic loops |
| [ljagiello/ctf-skills](https://github.com/ljagiello/ctf-skills) | CTF reverse / pwn; on-demand tool installation | Benchmark against CTF-Sandbox + `pwn-chain` |
| [shuvonsec/claude-bug-bounty](https://github.com/shuvonsec/claude-bug-bounty) | /recon → /hunt → /validate → /report | Benchmark against recon-pipeline methodology + scope gates |
| [PayloadsAllTheThings](https://github.com/swisskyrepo/PayloadsAllTheThings) | Web payloads + Prompt Injection section | Prioritize `pentest-tools/payloads`; see `llm-security` for LLM topics |
| [HackTricks](https://hacktricks.wiki/) | Pentesting methodology + **AI / MCP abuse** | See skill-supply-chain MCP section |
| [appsecsanta AI pentesting agents 2026](https://appsecsanta.com/research/ai-pentesting-agents-2026) | Architectural classification of 39+ open-source AI pentesting agents | Multi-agent is not strictly required; we utilize role-map |
| Snyk evaluation: "More skills ≠ Better" | Skill stacking can degrade audit quality | Reinforces our "deep skills + routing" strategy |

## 2. Security Standards and Threats (2025–2026)

| Source | Key Takeaways | Application in This Package |
|--------|---------------|-----------------------------|
| [OWASP Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/) | Malicious skills, supply chain, privilege abuse, memory poisoning, etc. | `skill://red-llm-security/support/ops/skill-supply-chain.md` |
| [Anthropic Agent Skills Engineering Post](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) | Only install from trusted sources; audit scripts and dependencies | Same as above + bootstrap prohibits guessing paths |
| ClawHavoc and related poisoning campaigns (documented in AST10) | Batch malicious skills published to registries | Prohibit one-click installations from unknown registries into this package |

## 3. Package Coverage vs. Broad External Coverage

| Domain | reverse-skill | Why We Do Not Merge External Repositories Wholesale |
|--------|---------------|-----------------------------------------------------|
| APK / JS / IDA / r2 / Firmware / Pwn | **Deep** skills + scripts | Preserves depth coupled with tool-index |
| Pentest / Attack Chain / SRC | pentest-tools + attack-chain + src-hunter | Repositories like Orizon serve as methodological benchmarks |
| LLM / Agent Security | llm-security | Leverages AST10 to harden skill self-security |
| Evidence / Scope / Roles | **ops/** (Distinguishing feature) | Most skill packages lack formal case contracts |
| OT / ICS / Pure GRC / Fraud F3 | No standalone skill | Routing misses → propose new additions or link externally, do not force-fit |
| 800+ Micro-skills | Do not duplicate | Replace fragmentation with MASTER routing + domain skills |

## 4. Adoption Rules (MUST)

```text
1. PROHIBITED: Using git submodules to pull down entire 800+ skill repositories as runtime dependencies.
2. When adopting: Extract "stages / checklists / command patterns" and write them into references or existing skills within this package.
3. External scripts: Review dependencies and network behavior in an isolated environment before considering additions to bootstrap-manifest.
4. New scenarios: Follow CONTRIBUTING to introduce new skills, and update routing + RULES keywords.
5. Attribute source URLs + retrieval dates (matching the format in this file).
6. Execute the checklist in ops/skill-supply-chain.md prior to installation or merging.
7. At runtime, load only the PRIMARY skill from MASTER-ROUTING (along with required secondary skills) to prevent skill-stacking overload.
```

## 4.1 Artifacts Adopted into This Package (Not External Dependencies)

| Artifact | Path |
|----------|------|
| Four Stages of RE | reverse-engineering agent workflow |
| Authorized Reconnaissance | pentest-tools recon pipeline |
| Attack Chain Gatechecks | `skill://red-attack-chain/references/lifecycle-checklist.md` |
| Skill Supply Chain | `skill://red-llm-security/support/ops/skill-supply-chain.md` |
| Domain Coverage | domain-coverage-map |

## 5. Recommended Priorities (Subsequent Iterations)

| Priority | Action |
|----------|--------|
| P0 (Completed) | ops contracts, MASTER routing, skill supply chain security documentation |
| P1 | Supplement pentest stage checklists in attack-chain references against Orizon / ToB |
| P2 | Optional "external skill allowlist" configuration, excluded from default paths |