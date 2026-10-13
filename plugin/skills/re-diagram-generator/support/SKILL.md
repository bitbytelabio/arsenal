---
name: reverse-skill-router
description: Routes reverse engineering, exploitation, penetration testing, malware, mobile, firmware, browser automation, documentation, and security tasks to the appropriate specialist skill. Use when a task spans modules or the correct reverse-skill entrypoint is unclear.
---
# Reverse Engineering Skills Master Control

This directory contains a collection of reverse engineering skill modules. Each subdirectory represents an independent module containing a `SKILL.md` that describes its applicable scenarios, toolchains, and workflows.

## CRITICAL: Routing Execution Contract (MUST Execute Immediately)

After reading this file, responding with only "read/understood" is NOT allowed. You MUST execute the following sequence in order:

1. `NOW`: Run the platform-native router (Windows `arsenal scripts master-route`; Linux/macOS/Kali `arsenal scripts master-route`), determine the PRIMARY module from `skill://re-reverse-engineering/support/config/routing.json`; read the 3-axis appendix in `skill://re-reverse-engineering/support/routing.md` only for complex edge cases.
2. `NOW`: Run platform-native `case-init` (`arsenal scripts case-init` or `arsenal scripts case-init`) to generate `work/<case>/scope.md` for the current target project; **ACT on targets is strictly FORBIDDEN before auth is granted**. For local offline samples, use the `offline-sample` preset + explicit sample; Force MUST NOT bypass hard gates.
3. `ACT`: Immediately open the PRIMARY `SKILL.md` and execute ACTION REQUIRED.
4. `NEXT`: Tool paths are recognized strictly from `tool-index`; missing tools → use platform-native bootstrap (manifest only).
5. Conclusions MUST follow Evidence→Finding→Path. Reports/journals are SHOULD, unless deliverables are explicitly requested by the user.

**Identity**: See `skill://webapp-pentest-tools/support/ops/IDENTITY.md` (lightweight routing pack + tool bootstrapping + journal; **NOT** a Z3r0-style platform).

If routing fails to find a match, you MUST first search the web to augment methodologies and propose creating a new skill; shoehorning tasks into non-matching modules is strictly forbidden.

## Requirement Levels (RFC 2119)

- `MUST`: Mandatory action; violation means task failure.
- `MUST NOT`: Absolute prohibition; violation constitutes a security breach.
- `SHOULD`: Recommended practice; any deviation MUST be justified with reasons.
- `MAY`: Optional action.

## Current Modules

| Module | Directory | Applicable Scenarios |
|--------|-----------|----------------------|
| **General Reverse Engineering** | `skill://re-reverse-engineering/SKILL.md` | GDB / Frida / angr / Unicorn / Qiling / Anti-analysis countermeasures / Multi-language platform reversing / CTF pattern library |
| **APK Reverse Engineering** | `skill://re-apk-reverse/SKILL.md` | Android APK unpacking, jadx decompilation, smali patching, Frida hooking, repackaging, signing, and installation |
| **.NET / C# Reverse Engineering** | `skill://re-dotnet-reverse/SKILL.md` | Managed PE reversing, dnSpyEx + de4dot deobfuscation (ConfuserEx/SmartAssembly/Babel), IL patching, Sharp* red team tool analysis, dnSpy MCP integration |
| **IDA Pro Reverse Engineering** | `skill://re-ida-reverse/SKILL.md` | IDA Pro MCP HTTP server (72 tools): decompilation, disassembly, data flow tracking, cross-references |
| **Frontend JS Reverse Engineering** | `skill://webapp-js-reverse/SKILL.md` | Browser-side signature location, encrypted parameter analysis, runtime sampling, Node.js environment polyfilling; prioritize existing `js-reverse_*`, connect jshookmcp when deeper browser/CDP/hooking surfaces are required (prerequisite: download/register and enable the MCP server first) |
| **radare2 Analysis** | `skill://re-radare2/SKILL.md` | CLI binary reconnaissance, disassembly, patching: r2 / rabin2 / rasm2 / radiff2 |
| **CTF Entry Point** | `skill://re-reverse-engineering/patterns-ctf.md` | Single PRIMARY; downstream logic remains in sidecar CTF orchestrator |
| **Technical Documentation Generation** | `skill://re-docs-generator/SKILL.md` | Automatically generate reversing reports, pentest reports, CTF writeups, and signature reversing reports upon task completion |
| **Evidence Graph Review** | `skill://re-case-review/SKILL.md` | Verify scope, Evidence→Finding→Path traceability, work items, timelines, and artifact hashes |
| **Browser and Desktop Automation** | `skill://webapp-browser-automation/SKILL.md` | Browser automation (Playwright) + Windows desktop application automation (OpenReverse UIA/CUA) + network traffic monitoring |
| **Cross-Version Symbol Migration** | `skill://re-binary-diff/SKILL.md` | Port symbols from legacy versions to new versions, deduce missing PDBs, batch-migrate function names across program updates |
| **N-day Patch Diffing → Exploitation** | `skill://re-patch-diff-exploit/SKILL.md` | Pinpoint vulnerability root causes from vendor patches, develop PoCs, weaponize N-day exploits (Division of work with binary-diff: this skill focuses on the offensive side) |
| **RE → Exploit Chain** | `skill://re-pwn-chain/SKILL.md` | Transition from reversing to working exploits: stack/heap/kernel pwn, pwntools, libc-database, CTF to realistic remote stabilization |
| **Firmware Pentesting Chain** | `skill://re-firmware-pentest/SKILL.md` | OWASP FSTM 9-stage methodology: extraction → EMBA automation → Firmadyne/QEMU emulation → AFL++ fuzzing → physical hardware exploitation |
| **EDR Bypass Reversing** | `skill://red-edr-bypass-re/SKILL.md` | Red team scenarios: reverse engineering EDR hook tables/ETW/AMSI → direct syscalls / Hell's Gate / hardware breakpoints / call stack spoofing |
| **Penetration Testing Toolchain** | `skill://webapp-pentest-tools/SKILL.md` | 20+ pentesting tools (Nmap/Nuclei/SQLMap/FFUF/Hashcat/Pentest Swarm) exposed to AI via MCP |
| **Diagram Generation** | `skill://re-diagram-generator/SKILL.md` | Generate Mermaid/Graphviz/PlantUML diagrams from natural language (attack path graphs, data flow graphs, architecture diagrams, state machines) |
| **Attack Chain Orchestration** | `skill://red-attack-chain/SKILL.md` | Master conductor for multi-stage attack path planning and execution; entrypoint for full-scope pentests, red-teaming/drills, and pivoting from external networks to domain controllers |
| **LLM / AI Security Testing** | `skill://red-llm-security/SKILL.md` | OWASP LLM + ASI Top 10: Prompt injection, tool abuse, memory poisoning, Agent hijacking, system prompt extraction, **Agent compliance engineering** |
| **API Security Testing** | `skill://webapp-api-security/SKILL.md` | Comprehensive protocol coverage (REST/GraphQL/WebSocket): BOLA/IDOR, JWT/OAuth attacks, 10-stage methodology |
| **Supply Chain Security** | `skill://red-supply-chain-security/SKILL.md` | SBOM/SCA/CI-CD pipelines: dependency scanning, container security, build integrity, vulnerability reachability verification |
| **Mobile Reverse Engineering** | `skill://mobile-reverse/SKILL.md` | Android + iOS: Frida/Objection dynamic instrumentation, SSL Pinning/Root/Jailbreak detection bypasses, OWASP MASTG |
| **Malware Analysis** | `skill://re-malware-analysis/SKILL.md` | 6-stage sample analysis, YARA/Sigma rule development, anti-analysis detection, sandbox orchestration |
| **DSL Virtual Machine Reversing** | `skill://re-reverse-engineering/dsl-vm-reverse/SKILL.md` | JS custom instruction set VMs (IIFE + switch-case opcode dispatchers); anti-fraud/CAPTCHA engines, etc. |
| **Operations Contract ops** | `skill://webapp-pentest-tools/support/ops/scope-contract.md` | Scope / evidence chain / roles / timeline / identity / skill supply chain security |
| **Community Skill Cross-Reference** | `skill://re-apk-reverse/references/community-security-skills.md` | External security skills index and adaptation rules (blind installation is prohibited) |
| **Skill Supply Chain** | `skill://re-apk-reverse/support/ops/skill-supply-chain.md` | Installation gating for external skills/MCPs (AST10 streamlined) |
| **RE Phase Gates** | `skill://re-reverse-engineering/references/re-agent-workflow.md` | triage → static → dynamic → synthesis |
| **Authorized Recon Pipeline** | `skill://webapp-pentest-tools/references/recon-pipeline.md` | Scope gate + match ≠ verified |
| **Protocol Reversing** | `skill://re-protocol-reverse/SKILL.md` | Custom binary protocols / Protobuf / gRPC / PCAP packet layout analysis |
| **Ghidra Reversing** | `skill://re-ghidra-reverse/SKILL.md` | Open-source decompilation, headless analysis, Ghidra MCP (primary entrypoint when IDA is unavailable) |
| **Binary Ninja Reversing** | `skill://re-binary-ninja-reverse/SKILL.md` | HLIL/MLIL/LLIL, Python API, and optional community MCP/localhost HTTP integrations |
| **Cloud / Containers / K8s** | `skill://red-cloud-k8s/SKILL.md` | IMDS/IAM, container escape attack surfaces, Kubernetes RBAC |
| **Windows / Active Directory** | `skill://red-windows-ad/SKILL.md` | Kerberos, AD CS, BloodHound, relay attacks, and domain escalation paths |
| **Digital Forensics** | `skill://re-digital-forensics/SKILL.md` | Memory/disk timelines, PCAP attribution, incident response preservation |
| **Code Auditing / SAST** | `skill://webapp-code-audit/SKILL.md` | Semgrep/CodeQL, white-box testing, dangerous API and authentication/authorization reviews |
| **Threat Intelligence / OSINT** | `skill://red-threat-intelligence/SKILL.md` | Open-source IOC correlation, campaign tracking, independent verification, and intelligence handoff |
| **Threat Hunting** | `skill://red-threat-hunting/SKILL.md` | Hypothesis-driven hunting, Sigma detection engineering, blue team validation |
| **OT / ICS Industrial Systems** | `skill://red-ot-ics/SKILL.md` | Purdue model zones, PLC/SCADA, passive-first security assessments |
| **Wi-Fi / Wireless** | `skill://red-wifi-wireless/SKILL.md` | Authorized wireless security assessments, handshakes/PMKID, lab testing constraints |
| **Browser Extension Reversing** | `skill://webapp-browser-extension-reverse/SKILL.md` | Chrome/Firefox extensions, MV3 background workers, permission attack surfaces |
| **macOS / Mach-O** | `skill://re-macos-reverse/SKILL.md` | Code signing, ObjC/Swift analysis, LaunchAgents, macOS malware samples |
| **Thick Client Security** | `skill://webapp-thick-client/SKILL.md` | Desktop C/S architectures, local storage, IPC mechanisms, updater security |
| **Go / Rust Reversing** | `skill://re-go-rust-reverse/SKILL.md` | Stripped Go/Rust binaries, pclntab parsing, panic string extraction |
| **Hardware Debug Interfaces** | `skill://re-hardware-security/SKILL.md` | UART/JTAG/SWD, read-only firmware extraction, firmware handoff |
| **Database Security** | `skill://webapp-database-security/SKILL.md` | MySQL/PG/MSSQL/Mongo/Redis exposure checks and misconfiguration auditing |
| **Email Security** | `skill://webapp-email-security/SKILL.md` | Phishing disassembly, SPF/DKIM/DMARC analysis, BEC attack modeling |
| **Identity Federation** | `skill://webapp-identity-federation/SKILL.md` | SAML/OIDC/OAuth SSO flow attacks and misconfiguration analysis |
| **RF / SDR** | `skill://red-radio-sdr/SKILL.md` | Authorized radio frequency analysis, receive-only by default |

## Unified Entry Point

When encountering reverse engineering, CTF, traffic interception, frontend signature analysis, APK patching, or binary analysis tasks, navigate sequentially:

1. Run platform-native router (Windows `arsenal scripts master-route`; Linux/macOS/Kali `arsenal scripts master-route`) → determine PRIMARY (`skill://re-reverse-engineering/support/config/routing.json`)
2. Run platform-native `case-init` (`arsenal scripts case-init` or `arsenal scripts case-init`) → initialize `scope.md`
3. Open PRIMARY `SKILL.md`
4. Consult `skill://re-reverse-engineering/support/routing.md` for ambiguous scenarios, and consult `tool-index` for local machine tool paths

## Operational Workflow

Combine these modules flexibly as needed:

1. **Target Received** → Inspect file type first, select corresponding analysis tools
2. **Quick Wins** → Run strings / rabin2 -z / ltrace to identify obvious low-hanging fruit
3. **Deep Analysis** → Decompilation needed → IDA; dynamic hooking needed → Frida; symbolic execution needed → angr
4. **Pivot When Stuck** → Pivot to dynamic when static fails, check native .so libraries when Java layer is obfuscated, set dynamic breakpoints when page observation is insufficient

## Next-Step Menu Pattern

A sub-skill `MUST` provide 3-6 numbered choices only when arriving at a **genuine decision boundary** (where two or more materially different, evidence-supported paths exist, and the user's choice alters the subsequent action). If the next step is deterministically governed by a gate or Evidence, the agent `MUST` continue directly and record only `decision_delta` + `carry_forward_refs` per `skill://webapp-pentest-tools/support/ops/timeline-workitem.md`; you `MUST NOT` re-output unchanged route/scope/auth/context simply to manufacture a menu.

Format requirements:
- Number each option sequentially (range 1-6)
- Describe a concrete, actionable task for each option (avoid abstract high-level directions)
- Include at least one "Export report / Write writeup" option
- Include at least one "Continue deep analysis" or "Pivot to an alternative method" option
- Include an exit option such as "Stop / Pause / Ask clarifying questions" when appropriate

Example:
```
## Recommended Next Steps (Select a number)

1. Perform deep decompilation on sub_140001000 to recover the algorithm
2. Use Frida dynamic hooks to validate parameter hypotheses
3. Export currently named functions and generate a symbol migration YAML
4. Generate the current phase analysis report
5. Switch to radare2 for lightweight reconnaissance and comparison
6. Pause execution for review of preceding evidence
```

## Dynamic Directory Expansion

This repository expands continuously. When encountering new subdirectories, read their `SKILL.md` to quickly identify their purpose.

When introducing a new skill, follow the standard contributor workflow to ensure:
- The routing matrix correctly classifies and dispatches it
- The bootstrap system automatically resolves its dependencies
- The tool-index accurately reflects the state of the new tool

## Related Resources

- Local **anything-analyzer** MCP server (Port 23816), providing browser automation, HTTP capture, and AI analysis capabilities
- `tool-index` records local reverse engineering tool availability, actual file paths, versions, and script references
- The package root installation guide provides universal setup instructions for Claude Code, Codex CLI, and other coding AI clients

## On-Demand Bootstrapping

When the workflow detects a missing tool, do not throw an error immediately. Call the platform-native bootstrap script uniformly:

Windows:
```powershell
# Run reverse engineering bootstrap tool via Arsenal CLI:
arsenal scripts bootstrap-reverse 'tool-name' --start-services
```

Linux / macOS:
```bash
# Run reverse engineering bootstrap tool via Arsenal CLI:
arsenal scripts bootstrap-reverse tool-name --start-services
```

Kali:
```bash
# Run reverse engineering bootstrap tool via Arsenal CLI:
arsenal scripts bootstrap-reverse tool-name --start-services
```

> The bootstrap helper scripts live at `arsenal scripts bootstrap-reverse` and `arsenal scripts bootstrap-reverse`. Copy the complete script (and `lib/` helpers on Windows) to your local environment before executing.

Supported capabilities (defined in `skill://re-reverse-engineering/support/scripts/bootstrap-manifest.json`): jadx, apktool, jeb-pro, binaryninja, frida, frida-ps, idalib-mcp, reqable-mcp, jshookmcp, xquik-mcp, anything-analyzer, idapro, r2, rabin2, adb, agent-browser, ghidra-mcp, seclists, proxycat, burpsuite-mcp, nmap, pentestswarm, binwalk, yara, pwntools, bkcrack

> JEB Pro is registered as a **manual license installation** capability: bootstrap outputs guidance only and will NEVER download or circumvent commercial licensing. Reqable MCP registers only a pinned version of the official runtime; users MUST install the Reqable desktop client manually.
>
> Unregistered tools (such as unblob/EMBA, etc.) `MUST` follow manual installation steps documented in the respective skill documentation; claiming bootstrap support for them is strictly prohibited.

The `tool-index` is refreshed automatically upon successful bootstrap completion.

## Precedent Files

Before executing any reverse engineering or penetration testing operations, you MUST read the following files in order:

| Reading Order | File | Trigger Condition |
|---------------|------|-------------------|
| **#1** | `skill://webapp-pentest-tools/support/ops/scope-contract.md` + `arsenal scripts case-init` | Executable authorization gate. Authorization is never considered granted in `skill://webapp-pentest-tools/support/field-journal/precedent-auth.md` |
| **#2** | `skill://re-reverse-engineering/support/field-journal/precedent-reverse.md` or `skill://webapp-pentest-tools/support/field-journal/precedent-pentest.md` | On-demand — Load only when the AI encounters ambiguity |

**#1 is prerequisite; #2 is lazily loaded.**

## Autonomous Knowledge Evolution

After completing any reverse engineering or penetration testing task, lessons learned MUST be committed back to the `field-journal/` directory. Refer to the mandatory post-task checklist in the engagement rules for details.

- Template: `skill://re-reverse-engineering/support/field-journal/_template.md`
- Index: `skill://re-reverse-engineering/support/field-journal/_index.md`
- Precedents: `skill://webapp-pentest-tools/support/field-journal/precedent-auth.md` → `skill://re-reverse-engineering/support/field-journal/precedent-reverse.md` → `skill://webapp-pentest-tools/support/field-journal/precedent-pentest.md`
- Always check the index and precedents before starting a new task to leverage established tradecraft

## Task Completion Self-Check (MUST Pass Before Declaring Completion)

- [ ] Have I completed the 3-axis routing match (Target Type + User Intent + Toolchain)?
- [ ] Did I read the target skill's SKILL.md immediately after successful routing?
- [ ] When routing yielded no match, did I propose creating a new skill instead of forcing a misfit?
- [ ] Did I resolve and use real, verified tool paths based on `tool-index`?