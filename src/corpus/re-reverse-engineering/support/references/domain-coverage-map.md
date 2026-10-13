# Package Domain Coverage Map (Depth-First)

> Contrasted with community repositories containing hundreds of micro-skills: this package covers core operational domains using **deep specialist skills + structured routing + operational contracts**.  
> Date: 2026-07-18

## Domain -> Canonical Skill Entrypoint

| Domain | PRIMARY / Module | Notes |
|--------|------------------|-------|
| Mobile Android | `skill://re-apk-reverse/SKILL.md`, `skill://mobile-reverse/SKILL.md` | Static unpack/decompile + dynamic hooking |
| Mobile iOS | `skill://mobile-reverse/SKILL.md` | class-dump / Hopper / Frida / Objection |
| Deep Binary Reversing | `skill://re-ida-reverse/SKILL.md`, `skill://re-radare2/SKILL.md`, `skill://re-ghidra-reverse/SKILL.md` | Ghidra = primary open-source decompilation path |
| General RE / Anti-Debug / OLLVM | `skill://re-reverse-engineering/SKILL.md` | Multi-platform patterns and deobfuscation |
| .NET / Managed PE | `skill://re-dotnet-reverse/SKILL.md` | dnSpyEx / de4dot / IL patching |
| Frontend JS / Signature Analysis | `skill://webapp-js-reverse/SKILL.md` | Observe -> Capture -> Rebuild |
| Browser Extensions | `skill://webapp-browser-extension-reverse/SKILL.md` | Chrome/Firefox MV3 extension analysis |
| DSL / Risk-Control VM | `skill://re-reverse-engineering/dsl-vm-reverse/SKILL.md` | Custom JS switch-case opcode interpreters |
| Custom Protocols / PCAP | `skill://re-protocol-reverse/SKILL.md` | Binary framing / Protobuf / gRPC |
| Firmware / IoT | `skill://re-firmware-pentest/SKILL.md` | Extraction -> EMBA -> emulation -> fuzzing |
| Malware Analysis | `skill://re-malware-analysis/SKILL.md` | Six-stage triage, YARA/Sigma, sandbox analysis |
| Digital Forensics / IR | `skill://re-digital-forensics/SKILL.md` | Memory dumps, disk timelines, PCAP attribution |
| Threat Hunting / Blue Team | `skill://red-threat-hunting/SKILL.md` | Hypothesis-driven hunting and Sigma rules |
| Threat Intelligence / OSINT | `skill://red-threat-intelligence/SKILL.md` | Public IOC enrichment and corroboration |
| Penetration Testing Toolchain | `skill://webapp-pentest-tools/SKILL.md`, `skill://webapp-pentest-tools/src-hunter/SKILL.md` | 20+ tools + SRC bug bounty playbooks |
| Windows / Active Directory | `skill://red-windows-ad/SKILL.md` | Kerberos, AD CS, BloodHound, relay paths |
| Cloud / Containers / K8s | `skill://red-cloud-k8s/SKILL.md` | IMDS/IAM, container escape, Kubernetes RBAC |
| Source Code Audit / SAST | `skill://webapp-code-audit/SKILL.md` | Semgrep/CodeQL and white-box review |
| Wi-Fi / Wireless | `skill://red-wifi-wireless/SKILL.md` | Authorized wireless assessment |
| OT / ICS | `skill://red-ot-ics/SKILL.md` | Passive-first industrial control assessment |
| macOS / Mach-O | `skill://re-macos-reverse/SKILL.md` | Mach-O / ObjC / Swift desktop binaries |
| Binary Ninja | `skill://re-binary-ninja-reverse/SKILL.md` | Commercial GUI/Python API + loopback MCP |
| Thick Desktop Clients | `skill://webapp-thick-client/SKILL.md` | Desktop C/S, Electron, local storage, IPC |
| Go / Rust Binaries | `skill://re-go-rust-reverse/SKILL.md` | Stripped Go pclntab and Rust symbols |
| Hardware Debug Interfaces | `skill://re-hardware-security/SKILL.md` | UART/JTAG/SWD extraction -> `skill://re-firmware-pentest/SKILL.md` |
| Database Security | `skill://webapp-database-security/SKILL.md` | MySQL/PostgreSQL/MSSQL/MongoDB/Redis |
| Email / Phishing Security | `skill://webapp-email-security/SKILL.md` | SPF/DKIM/DMARC and phishing analysis |
| Identity Federation / SSO | `skill://webapp-identity-federation/SKILL.md` | SAML/OIDC/OAuth flows (complements `skill://webapp-api-security/SKILL.md`) |
| RF / SDR | `skill://red-radio-sdr/SKILL.md` | Receive-only default radio research |
| Multi-Stage Attack Chain | `skill://red-attack-chain/SKILL.md` | End-to-end red team orchestration |
| Binary Exploitation (Pwn) | `skill://re-pwn-chain/SKILL.md` | Stack/heap/kernel exploitation |
| N-Day Patch Diffing | `skill://re-patch-diff-exploit/SKILL.md` | Vendor patch diff -> root cause -> PoC |
| EDR Evasion Reversing | `skill://red-edr-bypass-re/SKILL.md` | Hook analysis, syscalls, ETW/AMSI |
| API Security | `skill://webapp-api-security/SKILL.md` | REST/GraphQL/JWT/BOLA |
| Supply Chain / SBOM | `skill://red-supply-chain-security/SKILL.md` | Trivy/Syft/Gitleaks/CI-CD |
| LLM / Agent Security | `skill://red-llm-security/SKILL.md` | OWASP LLM + ASI Top 10 + `skill://re-apk-reverse/support/ops/skill-supply-chain.md` |
| Browser & Desktop Automation | `skill://webapp-browser-automation/SKILL.md` | Playwright + OpenReverse UIA |
| Reports & Diagrams | `skill://re-docs-generator/SKILL.md`, `skill://re-diagram-generator/SKILL.md` | Technical reports and Mermaid/Graphviz diagrams |
| Cross-Version Symbol Migration | `skill://re-binary-diff/SKILL.md` | BinDiff / Diaphora / LLM symbol porting |
| Case Evidence Review | `skill://re-case-review/SKILL.md` | Read-only Evidence -> Finding -> Path validation |
| Operational Contracts (ops) | `skill://webapp-pentest-tools/support/ops/scope-contract.md` | Scope, evidence chains, roles, timelines |
| CTF Challenge Patterns | `skill://re-reverse-engineering/patterns-ctf.md` | CTF reverse engineering and archive attacks |
| Cryptographic Pattern Recognition | `skill://re-reverse-engineering/patterns.md` | Shared with reverse engineering workflows |

## Domains Not Merged Wholesale (Unmatched Route Strategy)

| Domain | Strategy |
|--------|----------|
| Pure Game Cheat Development | Out of scope as a product direction; Unity analysis uses `skill://re-reverse-engineering/SKILL.md` + `skill://re-dotnet-reverse/support/field-journal/seed-014_unity-il2cpp-reverse.md` |
| Deep Automotive / Avionics Certification | Link to external standards; this package provides entry-level RF/OT coverage via `skill://red-radio-sdr/SKILL.md` and `skill://red-ot-ics/SKILL.md` |
| Long-Form GRC / Compliance | Does not replace dedicated GRC platforms; reference via report templates |
| 800+ ATT&CK Micro-Skills | Covered via this table + optional ATT&CK tags in Finding records |

## MITRE ATT&CK Integration (Optional)

Finding templates support `optional_attack: Txxxx` (see `skill://re-case-review/support/ops/evidence-finding-path.md`) without forcing a heavyweight ATT&CK engine.
