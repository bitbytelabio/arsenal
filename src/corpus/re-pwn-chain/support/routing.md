# Reverse Engineering Skill Routing Matrix

> **Advisory only.** PRIMARY comes from `skill://re-reverse-engineering/support/config/routing.json` via `arsenal scripts master-route` (or `arsenal scripts master-route`). This file is a 3-axis disambiguation view. If a row here disagrees with JSON, JSON wins.

Route tasks to the most appropriate skill module by target type, user intent, and toolchain.

## CRITICAL: Routing Execution Protocol

1. **MUST** complete routing BEFORE executing. Do NOT "do first, route later".
2. **MUST** start from `arsenal scripts master-route` (JSON). Use this matrix only when PRIMARY is ambiguous.
3. **MUST** match dimensions (target type + user intent + toolchain) before entering a skill.
4. If route not matched → propose new skill, do NOT force-fit.
5. Cross-module tasks → combine skills per "Path Crossing" section.
6. After routing, read the target skill's SKILL.md BEFORE taking action.
7. **Ops contract** (skill-router form): `skill://webapp-pentest-tools/support/ops/scope-contract.md` before ACT; Evidence→Finding→Path; roles in `skill://webapp-pentest-tools/support/ops/role-map.md`; timeline/workitems under `work/<case>/`. Identity: `skill://webapp-pentest-tools/support/ops/IDENTITY.md`.
8. **External skills**: do NOT bulk-vendor community packs; map + rules in `skill://re-apk-reverse/references/community-security-skills.md` + `skill://re-apk-reverse/support/ops/skill-supply-chain.md`. RE stages: `skill://re-reverse-engineering/references/re-agent-workflow.md`. Recon: `skill://webapp-pentest-tools/references/recon-pipeline.md`.

## By Target Type

| Target Type | Recommended Entry | Alternative |
|-------------|------------------|-------------|
| APK / Android app | `skill://re-apk-reverse/SKILL.md` — jadx decompile + apktool unpack | Optional licensed JEB Pro cross-check; if core is in .so → `skill://re-ida-reverse/SKILL.md` or `skill://re-radare2/SKILL.md` |
| Binary exe/dll/so/elf | `skill://re-ida-reverse/SKILL.md` — IDA Pro decompile | `skill://re-radare2/SKILL.md` — CLI analysis, or `skill://re-reverse-engineering/tools.md` — GDB/Unicorn |
| JavaScript / Web frontend | `skill://webapp-js-reverse/SKILL.md` — 5-stage workflow | anything-analyzer MCP browser tools, or jshookmcp CDP/Hook |
| HTTP capture / browser sampling / request replay | anything-analyzer MCP (23816) | Reqable MCP, `skill://webapp-js-reverse/SKILL.md`, jshookmcp, or `skill://re-reverse-engineering/patterns-ctf.md` |
| Firmware / IoT | `skill://re-firmware-pentest/SKILL.md` — extract → EMBA → emulate → fuzz | `skill://re-reverse-engineering/platforms.md` — static RE only |
| WASM / Python bytecode / .NET / **DSL VM / Custom VM** | `skill://re-reverse-engineering/dsl-vm-reverse/SKILL.md` — IIFE + switch-case opcode JS VM | `skill://re-reverse-engineering/languages.md` — real WASM binaries |
| Malware / virus sample | `skill://re-malware-analysis/SKILL.md` — six-stage + YARA/Sigma | `skill://re-ida-reverse/SKILL.md` deep dive |
| macOS / iOS | `skill://re-reverse-engineering/platforms.md` — Mach-O/ObjC/Swift | `skill://mobile-reverse/SKILL.md` for iOS-specific |
| Game (Unity) | `skill://re-reverse-engineering/SKILL.md` — engine reverse, anti-cheat, IL2CPP/Mono (see seed-014) | `skill://re-ida-reverse/SKILL.md` deep analysis |
| Memory dump / PCAP | `skill://re-digital-forensics/SKILL.md` — memory/timeline/PCAP IR | `skill://re-protocol-reverse/SKILL.md` for protocol recovery |
| Existing case package / evidence handoff | `skill://re-case-review/SKILL.md`: Evidence graph and fixity review | `skill://re-docs-generator/SKILL.md` for final report writing |
| Custom protocol / Protobuf / gRPC | `skill://re-protocol-reverse/SKILL.md` | `skill://webapp-js-reverse/SKILL.md` if pure browser WS crypto |
| Cloud / Container / K8s | `skill://red-cloud-k8s/SKILL.md` | CTF: `skill://re-reverse-engineering/patterns-ctf.md` |
| Windows AD / Kerberos / AD CS | `skill://red-windows-ad/SKILL.md` | multi-stage: `skill://red-attack-chain/SKILL.md` |
| Source code / SAST | `skill://webapp-code-audit/SKILL.md` | deps/CI: `skill://red-supply-chain-security/SKILL.md` |
| Game client (Unity/UE) | `skill://re-reverse-engineering/SKILL.md` + `skill://re-dotnet-reverse/support/field-journal/seed-014_unity-il2cpp-reverse.md` | `skill://re-dotnet-reverse/SKILL.md` for Mono assemblies |
| OT / ICS / SCADA | `skill://red-ot-ics/SKILL.md` | `skill://re-firmware-pentest/SKILL.md` offline firmware |
| macOS / Mach-O desktop | `skill://re-macos-reverse/SKILL.md` | iOS → `skill://mobile-reverse/SKILL.md` |
| Thick desktop client | `skill://webapp-thick-client/SKILL.md` | Electron → also `skill://webapp-js-reverse/SKILL.md` |
| Go / Rust stripped binary | `skill://re-go-rust-reverse/SKILL.md` | `skill://re-ida-reverse/SKILL.md` / `skill://re-ghidra-reverse/SKILL.md` |
| UART / JTAG / debug pads | `skill://re-hardware-security/SKILL.md` | then `skill://re-firmware-pentest/SKILL.md` |
| Database instance security | `skill://webapp-database-security/SKILL.md` | SQLi web path → `skill://webapp-pentest-tools/SKILL.md` |
| Email / phishing / DMARC | `skill://webapp-email-security/SKILL.md` | |
| SAML / OIDC / SSO | `skill://webapp-identity-federation/SKILL.md` | JWT-only API → `skill://webapp-api-security/SKILL.md` |
| RF / SDR (non-Wi-Fi) | `skill://red-radio-sdr/SKILL.md` | Wi-Fi → `skill://red-wifi-wireless/SKILL.md` |
| Browser extension (crx/xpi) | `skill://webapp-browser-extension-reverse/SKILL.md` | page JS only → `skill://webapp-js-reverse/SKILL.md` |
| Wi-Fi / wireless | `skill://red-wifi-wireless/SKILL.md` | close-range chain → `skill://red-attack-chain/SKILL.md` |
| Public-source threat intelligence / OSINT | `skill://red-threat-intelligence/SKILL.md` | X/Twitter posts remain leads until independently corroborated |
| Blue team / threat hunt | `skill://red-threat-hunting/SKILL.md` | sample IOC → `skill://re-malware-analysis/SKILL.md` |
| Ghidra (no IDA) | `skill://re-ghidra-reverse/SKILL.md` | `skill://re-ida-reverse/SKILL.md` if IDA MCP available |
| Binary Ninja / Binja | `skill://re-binary-ninja-reverse/SKILL.md` — HLIL/MLIL/LLIL + Python API | Community Binary Ninja MCP/localhost HTTP adapter when explicitly enabled |
| OLLVM-obfuscated binary (control flow flattening / bogus control flow / MBA) | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — complete deobfuscation workflow | obpo-plugin / d810-ng (IDA) / ollvm-unflattener (Miasm) / ollvm-breaker (Binary Ninja) / angr / deollvm (ARM64) |
| Cryptography / encryption algorithms | `skill://re-reverse-engineering/patterns.md` — crypto patterns | `skill://webapp-js-reverse/SKILL.md` (if frontend crypto) |
| Protocol reverse / custom protocol | `skill://re-reverse-engineering/platforms.md` — network protocols | `skill://webapp-js-reverse/SKILL.md` (if WebSocket/HTTP) |
| Go / Rust binary | `skill://re-reverse-engineering/languages-compiled.md` + `skill://re-go-rust-reverse/support/reverse-engineering/go-reverse.md` | `skill://re-ida-reverse/SKILL.md` or `skill://re-radare2/SKILL.md` |
| LLM / AI application | `skill://red-llm-security/SKILL.md` — OWASP LLM Top 10 + ASI Top 10 | Prompt injection, Agent security |
| API / REST / GraphQL | `skill://webapp-api-security/SKILL.md` — BOLA/BFLA/JWT/OAuth | `skill://webapp-pentest-tools/SKILL.md` for scanning |
| Supply chain / SBOM / CI-CD | `skill://red-supply-chain-security/SKILL.md` — Trivy/Syft/Gitleaks | — |
| iOS app (IPA) | `skill://mobile-reverse/SKILL.md` — class-dump/Hopper/Frida iOS | `skill://re-reverse-engineering/platforms.md` |
| **CTF competition (full stack)** | `skill://re-reverse-engineering/patterns-ctf.md` — master entry | Route to 40+ sub-skills by evidence |
| **CTF ZIP / PKZIP archive** | `skill://re-reverse-engineering/patterns-ctf.md` — legacy ZipCrypto + `bkcrack` known plaintext | Use before password brute force |
| Web runtime / API | `skill://webapp-pentest-tools/SKILL.md` | — |
| Cloud / Container / K8s | `skill://red-cloud-k8s/SKILL.md` | CTF-only extra: sidecar orchestrator after PRIMARY `skill://re-reverse-engineering/patterns-ctf.md` |
| Windows / AD / Identity | `skill://red-windows-ad/SKILL.md` | — |
| Forensics / PCAP / Steganography | `skill://re-digital-forensics/SKILL.md` | — |
| Prompt injection / Agent | `skill://red-llm-security/SKILL.md` | — |
| Mobile (Android/iOS) | `skill://re-apk-reverse/SKILL.md` | — |
| Firmware / Malware sample | `skill://re-firmware-pentest/SKILL.md` | — |
## By User Intent

| User Says | Route To |
|-----------|----------|
| "DSL VM / custom instruction set / risk control engine reverse engineering" | `skill://re-reverse-engineering/languages.md` — IIFE + switch-case opcode |
| "fireye / fireyejs / getToken reverse engineering" | `skill://re-reverse-engineering/languages.md` — runtime capture |
| "582KB JS file not WASM / large JS file reverse engineering" | `skill://re-reverse-engineering/languages.md` — classify DSL VM first |
| "decompile / IDA analyze" | `skill://re-ida-reverse/SKILL.md` — IDA MCP workflow |
| "recover source / disassemble" | `skill://re-reverse-engineering/SKILL.md` + `skill://re-ida-reverse/SKILL.md` |
| "Frida hook / dynamic inject" | `skill://re-reverse-engineering/tools-dynamic.md` — Frida section |
| "radare2 / r2 analyze" | `skill://re-radare2/SKILL.md` — CLI workflow |
| "find frontend signature / encrypted params" | `skill://webapp-js-reverse/SKILL.md` — Observe→Capture→Rebuild |
| "jshookmcp / JS hook / CDP debug" | `skill://webapp-js-reverse/SKILL.md` — same JS/Web chain |
| "Reqable / Reqable MCP / capture replay" | `skill://webapp-pentest-tools/SKILL.md` — authorized local capture and API workflow |
| "JEB / JEB Pro" | `skill://re-apk-reverse/SKILL.md` — licensed Android / ARM cross-check; verify local install first |
| "APK unpack / repack / modify smali" | `skill://re-apk-reverse/SKILL.md` — decode→rebuild-sign-install |
| "bypass anti-debug / anti-detection" | `skill://re-reverse-engineering/anti-analysis.md` |
| "OLLVM deobfuscate / control flow flattening removal / deflat / deobfuscation" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — complete workflow |
| "obpo / obpo-plugin / d810-ng / d810" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — modern deobfuscation tools |
| "Hikari / Polaris / Pluto / O-MVLL / Arkari / goron obfuscation" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — modern OLLVM variant handling |
| "Tigress / Hodur / Approov obfuscation" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — d810-ng dedicated unflattener |
| "Trap Angr / angr path explosion" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Pluto/Polaris trap handling |
| "BR obfuscation / indirect branch obfuscation removal" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — DeObfBR + read-only data segment |
| "what obfuscation / VM is this" | `skill://re-reverse-engineering/patterns.md` — match by pattern |
| "Go/Rust/Swift reverse" | `skill://re-reverse-engineering/languages-compiled.md` + `skill://re-go-rust-reverse/support/reverse-engineering/go-reverse.md` |
| "kernel driver / Rootkit / LKM" | `skill://re-reverse-engineering/platforms.md` |
| "Python bytecode / pyc" | `skill://re-reverse-engineering/languages.md` — Python section |
| "symbol execution / angr" | `skill://re-reverse-engineering/tools-dynamic.md` — angr section |
| "patch environment / Node reproduce" | `skill://webapp-js-reverse/references/env-patching.md` |
| "CTF challenge / competition reverse" | `skill://re-reverse-engineering/patterns-ctf.md` → sidecar orchestrator |
| "CTF ZIP / PKZIP / bkcrack / archive known-plaintext attack" | `skill://re-reverse-engineering/patterns-ctf.md` |
| "write report / documentation" | `skill://re-docs-generator/SKILL.md` — technical documentation |
| "review case / evidence chain / traceability" | `skill://re-case-review/SKILL.md`: read-only Evidence Graph Review |
| "write writeup" | `skill://re-docs-generator/SKILL.md` — CTF writeup template |
| "open webpage / browser automation / fill form" | `skill://webapp-browser-automation/SKILL.md` — Playwright |
| "crawl page / screenshot / auto login" | `skill://webapp-browser-automation/SKILL.md` |
| "desktop automation / Windows automation" | `skill://webapp-browser-automation/SKILL.md` — OpenReverse |
| "game reverse / anti-cheat / hack analysis" | `skill://re-reverse-engineering/SKILL.md` — game reverse (IL2CPP/Unity/Cheat Engine) |
| "Unity / IL2CPP / Mono" | `skill://re-reverse-engineering/SKILL.md` — Unity + `skill://re-dotnet-reverse/support/field-journal/seed-014_unity-il2cpp-reverse.md` |
| "Cheat Engine / memory scan" | `skill://re-reverse-engineering/SKILL.md` — Cheat Engine memory analysis |
| "symbol migration / cross-version compare" | `skill://re-binary-diff/SKILL.md` — LLM batch migration |
| "missing PDB / old version symbols" | `skill://re-binary-diff/SKILL.md` — cross-version symbol migration |
| "bindiff / function offset migration" | `skill://re-binary-diff/SKILL.md` — binary diff |
| "port scan / Nmap" | `skill://webapp-pentest-tools/SKILL.md` — information gathering |
| "vulnerability scan / Nuclei" | `skill://webapp-pentest-tools/SKILL.md` — vulnerability detection |
| "SQL injection / SQLMap" | `skill://webapp-pentest-tools/SKILL.md` — web pentest |
| "directory brute force / FFUF / Gobuster" | `skill://webapp-pentest-tools/SKILL.md` — web pentest |
| "password cracking / Hashcat" | `skill://webapp-pentest-tools/SKILL.md` — password cracking |
| "penetration testing / active scan" | `skill://webapp-pentest-tools/SKILL.md` — pentest toolchain |
| "SRC hunting / Bug Bounty" | `skill://webapp-pentest-tools/src-hunter/SKILL.md` — 19 playbooks + H1 cases |
| "WAF bypass" | `skill://webapp-web-offensive-waf-bypass/SKILL.md` — bypass methodology & payload encoding |
| "draw diagram / flowchart / architecture" | `skill://re-diagram-generator/SKILL.md` |
| "attack path diagram / sequence diagram" | `skill://re-diagram-generator/SKILL.md` — Mermaid/Graphviz/PlantUML |
| "malware / virus analysis / sample analysis" | `skill://re-reverse-engineering/SKILL.md` + YARA/sandbox |
| "firmware / IoT / binwalk / ARM" | `skill://re-reverse-engineering/platforms-hardware.md` |
| "cryptography / AES / RSA" | `skill://re-reverse-engineering/patterns.md` — crypto pattern recognition |
| "protocol reverse / Protobuf / custom protocol" | `skill://re-reverse-engineering/platforms.md` |
| "cloud security / container escape / K8s" | `skill://red-cloud-k8s/SKILL.md` |
| "Prompt injection / AI security" | `skill://red-llm-security/SKILL.md` — OWASP LLM + ASI Top 10 |
| "internal network / lateral movement" | `skill://webapp-pentest-tools/SKILL.md` + `skill://webapp-pentest-tools/references/network-attack-defense.md` |
| "privilege escalation" | `skill://webapp-pentest-tools/references/network-attack-defense.md` — escalation section |
| "Mimikatz / credential extraction / PtH" | `skill://webapp-pentest-tools/references/network-attack-defense.md` |
| "Kerberos / domain pentest / AD" | `skill://webapp-pentest-tools/references/network-attack-defense.md` |
| "C2 / persistence / remote control" | `skill://webapp-pentest-tools/references/network-attack-defense.md` |
| "blue team / detection / defense / IR" | `skill://webapp-pentest-tools/references/network-attack-defense.md` |
| "APK security testing / mobile security" | `skill://re-apk-reverse/references/apk-security-checklist.md` — OWASP MASTG |
| "SSTI / template injection" | `skill://webapp-pentest-tools/SKILL.md` — SSTImap |
| "XSS scan / cross-site scripting" | `skill://webapp-pentest-tools/SKILL.md` — XSStrike |
| "WordPress pentest / WP enumeration" | `skill://webapp-pentest-tools/SKILL.md` — WPProbe |
| "C2 framework / adversary simulation" | `skill://webapp-pentest-tools/SKILL.md` — AdaptixC2 |
| "WiFi attack / wireless pentest" | `skill://webapp-pentest-tools/SKILL.md` — Fluxion + aircrack-ng |
| "NTLM relay / auth coercion" | `skill://webapp-pentest-tools/SKILL.md` — Coercer |
| "NetExec / CrackMapExec / nxc" | `skill://webapp-pentest-tools/SKILL.md` — network service enumeration |
| "AI auto pentest / MCP security" | `skill://webapp-pentest-tools/SKILL.md` — HexStrike AI / MetasploitMCP |
| "Swarm / swarm pentest / autonomous scan" | `skill://webapp-pentest-tools/SKILL.md` — Pentest Swarm AI |
| "red team / HW / attack exercise" | `skill://red-attack-chain/SKILL.md` — full attack chain orchestration |
| "initial breach / boundary breach" | `skill://red-attack-chain/SKILL.md` — boundary breach phase |
| "close-range pentest / BadUSB / WiFi phishing" | `skill://red-attack-chain/SKILL.md` — close-range section |
| "EDR bypass / evasion / AV bypass" | `skill://red-edr-bypass-re/SKILL.md` |
| "phishing / social engineering" | `skill://webapp-email-security/SKILL.md` |
| "supply chain attack" | `skill://red-attack-chain/SKILL.md` — supply chain section |
| "trace cleanup / anti-forensics" | `skill://red-attack-chain/SKILL.md` — cleanup section |
| "full pentest / end-to-end" | `skill://red-attack-chain/SKILL.md` — full chain planning |
| "from external to domain controller" | `skill://red-attack-chain/SKILL.md` — cross-phase path orchestration |
| "attack surface assessment / path planning" | `skill://red-attack-chain/SKILL.md` — path planning decision tree |
| "got shell, what next / post-exploitation" | `skill://red-attack-chain/SKILL.md` — plan from current foothold |
| "BurpSuite / Burp proxy / intercept" | `skill://webapp-pentest-tools/SKILL.md` + `skill://webapp-pentest-tools/references/burpsuite-mcp-guide.md` |
| "Burp MCP / proxy history analysis" | `skill://webapp-pentest-tools/references/burpsuite-mcp-guide.md` — 78 tools |
| "Intruder brute force / Repeater replay" | `skill://webapp-pentest-tools/references/burpsuite-mcp-guide.md` |
| "Collaborator / OOB testing" | `skill://webapp-pentest-tools/references/burpsuite-mcp-guide.md` |
| "API security / GraphQL / JWT attack" | `skill://webapp-api-security/SKILL.md` — REST/GraphQL/JWT/OAuth |
| "supply chain security / SBOM / SCA" | `skill://red-supply-chain-security/SKILL.md` — Trivy/Syft/Gitleaks |
| "iOS reverse / IPA / Mach-O" | `skill://mobile-reverse/SKILL.md` — class-dump/Hopper/Frida iOS |
| "Objection / SSL Pinning bypass" | `skill://mobile-reverse/SKILL.md` — dynamic instrumentation |
| "YARA / malware detection rules" | `skill://re-malware-analysis/SKILL.md` — YARA/Sigma/IOC |
| "N-day / patch diff / CVE reproduction" | `skill://re-patch-diff-exploit/SKILL.md` |
| "MBA simplification / mixed boolean-arithmetic / expression simplification" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — SiMBA/D-810 |
| "opaque predicate / opaque predicate removal" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — symbolic execution removal |
| "Hikari deobfuscate / string encryption recovery" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Hikari variant handling |
| "pwn / stack overflow / ROP / ret2libc" | `skill://re-pwn-chain/SKILL.md` |
| "Agent not working / AI lazy / skip steps" | `skill://red-llm-security/references/agent-obedience-engineering.md` |
| "MSF stuck / orphan process / MSF protocol" | `skill://webapp-pentest-tools/references/msf-protocol.md` |
| "anonymize / placeholder / writeup desensitize" | `skill://re-reverse-engineering/support/field-journal/precedent-reverse.md` |
| "Hydra / online brute force" | `skill://webapp-pentest-tools/SKILL.md` — online password attack |
| "Metasploit / msfconsole / exploit" | `skill://webapp-pentest-tools/SKILL.md` — exploitation framework |
| "Wireshark / packet analysis / PCAP" | `skill://re-digital-forensics/SKILL.md` or `skill://re-protocol-reverse/SKILL.md` |
| "BurpSuite / web proxy / intercept" | `skill://webapp-pentest-tools/SKILL.md` — web proxy |
| "protocol reverse / Protobuf / gRPC / custom protocol" | `skill://re-protocol-reverse/SKILL.md` |
| "Ghidra / analyzeHeadless / no IDA" | `skill://re-ghidra-reverse/SKILL.md` |
| "Binary Ninja / Binja / HLIL / MLIL / binary-ninja-mcp" | `skill://re-binary-ninja-reverse/SKILL.md` |
| "Kubernetes / K8s / container escape / cloud IAM" | `skill://red-cloud-k8s/SKILL.md` |
| "Active Directory / Kerberoast / Certipy / BloodHound" | `skill://red-windows-ad/SKILL.md` |
| "forensics / Volatility / memory dump / IR timeline" | `skill://re-digital-forensics/SKILL.md` |
| "code audit / SAST / Semgrep / CodeQL / whitebox" | `skill://webapp-code-audit/SKILL.md` |
| "OSINT / threat intelligence / public X IOC enrichment" | `skill://red-threat-intelligence/SKILL.md` — public posts require independent corroboration |
| "threat hunting / blue team / detection engineering" | `skill://red-threat-hunting/SKILL.md` |
| "game reverse / IL2CPP / Unity / Unreal" | `skill://re-reverse-engineering/SKILL.md` + seed-014 |
| "Wi-Fi / aircrack / wireless pentest" | `skill://red-wifi-wireless/SKILL.md` |
| "browser extension / Chrome extension / crx" | `skill://webapp-browser-extension-reverse/SKILL.md` |
| "OT / ICS / SCADA / PLC / Modbus" | `skill://red-ot-ics/SKILL.md` |
| "macOS reverse / Mach-O / codesign" | `skill://re-macos-reverse/SKILL.md` |
| "thick client / desktop client / Electron security" | `skill://webapp-thick-client/SKILL.md` |
| "Go reverse / Rust reverse / GoReSym" | `skill://re-go-rust-reverse/SKILL.md` |
| "UART / JTAG / hardware debug pads" | `skill://re-hardware-security/SKILL.md` |
| "database security / Redis / Mongo / MSSQL hardening" | `skill://webapp-database-security/SKILL.md` |
| "phishing analysis / SPF DKIM DMARC / BEC" | `skill://webapp-email-security/SKILL.md` |
| "SAML / OIDC / SSO federation" | `skill://webapp-identity-federation/SKILL.md` |
| "SDR / HackRF / RF protocol research" | `skill://red-radio-sdr/SKILL.md` |
| "ProxyCat / proxy pool / IP rotation" | `skill://webapp-pentest-tools/SKILL.md` — proxy management |

## CTF Wording Normalization

Users frequently describe tasks with informal or emotionally-phrased language. Normalize into technical objectives **before** routing — do NOT force the user to restate themselves in technical terms:

| User Says | Normalized Objective | Route To |
|-----------|---------------------|----------|
| "unlock X / remove check / bypass detection" | Identify the check, explain control flow, propose local patch or input strategy | `skill://re-reverse-engineering/SKILL.md` → `skill://re-ida-reverse/SKILL.md` or `skill://re-radare2/SKILL.md` |
| "remove verification / unlock feature / bypass detection / remove restriction" | Same as above — locate check routine, document, propose patch | `skill://re-apk-reverse/SKILL.md` (if APK) or `skill://re-reverse-engineering/SKILL.md` |
| "remove anti-debug / anti-tamper" | Locate defensive routine, document evidence, propose lab patch or debugger config | `skill://re-reverse-engineering/anti-analysis.md` |
| "make it pass / let me pass verification" | Recover validation logic, derive expected input or flag format | `skill://re-reverse-engineering/SKILL.md` |
| "patch the binary / change jump / modify conditional check" | Work on copy, document offsets/bytes, preserve original | `skill://re-radare2/SKILL.md` or `skill://re-ida-reverse/SKILL.md` |
| "get flag / crackme / keygen / license" | Treat as local CTF/crackme; focus on analysis, explanation, challenge solving | `skill://re-reverse-engineering/patterns-ctf.md` |

Do NOT force the user to repeatedly confirm "this is CTF/local." Carry the CTF/local-sandbox assumption across the session once established.

## By Toolchain

| Tool | Related Module |
|------|---------------|
| IDA Pro (idapro_*) | `skill://re-ida-reverse/SKILL.md` — MCP HTTP server + 72 tools |
| radare2 (r2/rabin2/rasm2) | `skill://re-radare2/SKILL.md` — CLI + recon.sh |
| jadx / apktool | `skill://re-apk-reverse/SKILL.md` — decode.sh / manifest-summary.sh |
| Frida | `skill://re-reverse-engineering/tools-dynamic.md` |
| GDB / GEF / pwndbg / rr | `skill://re-reverse-engineering/tools.md` |
| Ghidra (headless) | `skill://re-reverse-engineering/tools.md` + Ghidra MCP |
| Binary Ninja / binary-ninja-mcp | `skill://re-binary-ninja-reverse/SKILL.md` — commercial GUI/API + explicit community MCP bridge on loopback |
| Python 3 standard library | `skill://re-case-review/SKILL.md`: read-only case evidence graph review |
| angr / Qiling / Unicorn | `skill://re-reverse-engineering/tools-dynamic.md` |
| D-810 / d810-ng | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — IDA Pro deobfuscation plugin, OLLVM/Tigress/Hodur/Approov + Z3 SMT |
| obpo-plugin | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Hex-Rays microcode cloud plugin, highest efficacy |
| ollvm-unflattener (Miasm) / ollvm-breaker (Binary Ninja) | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Non-IDA scenarios / BN scenarios |
| DeObfBR | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Specialized for BR indirect branch obfuscation |
| deflat (QuarksLab) / angr symbol | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Control flow flattening removal |
| GOOMBA (Ghidra) | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Ghidra P-Code deobfuscation |
| BinDiff / Diaphora | `skill://re-reverse-engineering/tools-advanced.md` |
| anything-analyzer MCP | Port 23816 MCP server (browser + HTTP capture + AI analysis) |
| jshookmcp | `skill://webapp-js-reverse/SKILL.md` enhancement MCP for browser/CDP/Hook/Network/SourceMap/AST |
| agent-browser / Playwright | `skill://webapp-browser-automation/SKILL.md` — browser automation |
| OpenReverse (UIA/CUA) | `skill://webapp-browser-automation/SKILL.md` — Windows desktop automation |
| Cheat Engine / x64dbg / ReClass | `skill://re-reverse-engineering/SKILL.md` — game memory analysis (seed-014) |
| IL2CPP Dumper / dnSpy | `skill://re-reverse-engineering/SKILL.md` — Unity/Mono game reverse (seed-014) |
| LLM symbol migration / BinDiff alternative | `skill://re-binary-diff/SKILL.md` — cross-version batch migration |
| Nmap / Masscan | `skill://webapp-pentest-tools/SKILL.md` — port scan, service identification |
| Nuclei / ZAP / Nikto | `skill://webapp-pentest-tools/SKILL.md` — vulnerability scanning |
| SQLMap / FFUF / Gobuster | `skill://webapp-pentest-tools/SKILL.md` — web pentest (injection/brute force) |
| SSTImap | `skill://webapp-pentest-tools/SKILL.md` — SSTI auto-detection |
| XSStrike | `skill://webapp-pentest-tools/SKILL.md` — advanced XSS scanning |
| Hashcat / John / Hydra | `skill://webapp-pentest-tools/SKILL.md` — password cracking |
| Metasploit / Impacket | `skill://webapp-pentest-tools/SKILL.md` — exploitation framework |
| BurpSuite | `skill://webapp-pentest-tools/SKILL.md` — web proxy, interception, vulnerability scanning |
| BurpSuite MCP | `skill://webapp-pentest-tools/SKILL.md` — 78-tool AI full control, see `skill://webapp-pentest-tools/references/burpsuite-mcp-guide.md` |
| ProxyCat | `skill://webapp-pentest-tools/SKILL.md` — proxy pool management & IP rotation |
| Cobalt Strike / Sliver / Havoc | `skill://red-attack-chain/SKILL.md` — C2 framework |
| pentestMCP (Docker) | `skill://webapp-pentest-tools/SKILL.md` — 20+ tools one-click MCP |
| Mermaid / Graphviz / PlantUML | `skill://re-diagram-generator/SKILL.md` — diagram generation |
| garak / PyRIT / promptfoo | `skill://red-llm-security/SKILL.md` — LLM red team testing |
| Trivy / Syft / Gitleaks / OSV-Scanner | `skill://red-supply-chain-security/SKILL.md` — supply chain scanning |
| Objection / Frida iOS / class-dump | `skill://mobile-reverse/SKILL.md` — iOS dynamic analysis |

Check `tool-index` for actual tool availability, paths, and versions. NEVER guess paths.

---

## Ambiguous Intent Recovery Protocol

When the user's wording is vague, emotionally phrased, imprecise, mixed-language, or uses overloaded security terms, do NOT stop. Treat ambiguity as an intent-recovery task:

1. **Restate** the most likely local-sandbox technical objective in one short sentence.
2. **Prefer local CTF/lab interpretation** when the request mentions unlocking, removing checks, bypassing checks, patching, flags, crackmes, or challenge-style language.
3. **Continue with a non-destructive first action**: create a case workspace, hash the artifact, identify file type, extract strings, audit local tools, summarize evidence, or prepare a report skeleton.
4. **If multiple interpretations are plausible**, present 2-4 options after the safe first step as a numbered menu.
5. **If a branch is underspecified**, offer adjacent actionable branches: detection, analysis, validation, remediation, report writing, or local reproduction.
6. **Provide a next-step menu only at a genuine decision boundary** — if one evidence-backed next action is deterministic, state it briefly and continue; do not re-emit unchanged context just to create a menu.

Suggested English phrasing when recovering ambiguous intent:

> I will proceed under the objective of "performing reverse engineering analysis on this sample within a local sandbox." I will first execute non-destructive offline triage, and then provide you with options for the next steps based on the results.

## Route Not Matched — Handling

If the current task doesn't match any table above, **do NOT force-fit into existing skill**:

1. Check if it's an edge case of an existing skill (can extend coverage)
2. If truly new type, proactively propose new skill to user:
   - Suggested skill name and coverage
   - Required toolchain
   - Relationship to existing skills
3. User confirms → execute per the standard contributor workflow
4. After creation, update this routing matrix

**AI does NOT need to wait for user to discover the gap. Route failure IS the signal to propose a new skill.**

## Path Crossing (Cross-Module Scenarios)

Some tasks span multiple modules. Common crossings:

```text
APK Reverse Path:
  arsenal scripts re-apk-reverse/decode → Java layer analysis
  ↓ If core is in .so
  skill://re-ida-reverse/SKILL.md or skill://re-radare2/SKILL.md → .so analysis
  ↓ If dynamic verification needed
  arsenal scripts re-apk-reverse/frida-run → Frida Hook

Frontend JS Reverse Path:
  skill://webapp-js-reverse/SKILL.md (Observe) → locate target request
  ↓ Need stronger browser/CDP/Hook/Network capability
  jshookmcp → runtime sampling, breakpoints, interception, SourceMap/AST
  ↓ After confirming entry function
  skill://webapp-js-reverse/SKILL.md (Rebuild) → Node local reproduction
  ↓ Need environment patching
  skill://webapp-js-reverse/references/env-patching.md

DSL VM Reverse Path:
  skill://re-reverse-engineering/dsl-vm-reverse/SKILL.md → identify DSL VM (IIFE + single-letter vars + DG() switch-case)
  ↓ Extract opcode table & constant table
  skill://re-reverse-engineering/dsl-vm-reverse/SKILL.md Phase 2-4 → opcode classification, C[9] constant analysis
  ↓ If runtime capture needed
  skill://webapp-browser-automation/SKILL.md → Playwright/Selenium CDP injection
  ↓ If pure API protocol needed
  skill://webapp-js-reverse/SKILL.md → Observe→Capture→Rebuild (API layer only)

CTF Competition Path:
  skill://re-reverse-engineering/patterns-ctf.md → build sandbox model
  ↓ Route by dominant evidence
  skill://webapp-pentest-tools/SKILL.md or skill://re-pwn-chain/SKILL.md or skill://red-windows-ad/SKILL.md
  ↓ Blocked → return to master
  skill://re-reverse-engineering/patterns-ctf.md → re-route

Web Pentest + BurpSuite MCP Path:
  skill://webapp-browser-automation/SKILL.md → auto-browse target with Burp proxy
  ↓ Traffic captured
  burpsuite MCP proxy_history → AI analyzes all requests
  ↓ Suspicious endpoints found
  burpsuite MCP intruder_attack → automated enumeration
  ↓ Vulnerability confirmed
  skill://re-docs-generator/SKILL.md → generate pentest report
```


## Task Completion Self-Check (MUST pass before claiming completion)

- [ ] Did I complete the three-axis routing match (Target Type + User Intent + Toolchain)?
- [ ] Did I read the target skill's SKILL.md after successful routing?
- [ ] When the route missed, did I propose adding a new skill instead of force-fitting?
- [ ] Did I use real tool paths based on `tool-index`?