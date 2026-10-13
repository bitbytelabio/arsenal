# Reverse Engineering Skill Routing Matrix

> **Advisory only.** PRIMARY comes from `config/routing.json` via the master routing helper. This file is a 3-axis disambiguation view. If a row here disagrees with JSON, JSON wins.

Route tasks to the most appropriate skill module by target type, user intent, and toolchain.

## CRITICAL: Routing Execution Protocol

1. **MUST** complete routing BEFORE executing. Do NOT "do first, route later".
2. **MUST** start from the master routing helper (JSON). Use this matrix only when PRIMARY is ambiguous.
3. **MUST** match dimensions (target type + user intent + toolchain) before entering a skill.
4. If route not matched → propose new skill, do NOT force-fit.
5. Cross-module tasks → combine skills per "Path Crossing" section.
6. After routing, read the target skill's SKILL.md BEFORE taking action.
7. **Ops contract** (skill-router form): `skill://webapp-pentest-tools/support/ops/scope-contract.md` before ACT; Evidence→Finding→Path; roles in `skill://webapp-pentest-tools/support/ops/role-map.md`; timeline/workitems under `work/<case>/`. Identity: `skill://webapp-pentest-tools/support/ops/IDENTITY.md`.
8. **External skills**: do NOT bulk-vendor community packs; map + rules in `skill://re-reverse-engineering/support/references/community-security-skills.md` + `skill://re-apk-reverse/support/ops/skill-supply-chain.md`. RE stages: `skill://re-reverse-engineering/references/re-agent-workflow.md`. Recon: `skill://webapp-pentest-tools/references/recon-pipeline.md`.

## By Target Type

| Target Type | Recommended Entry | Alternative |
|-------------|------------------|-------------|
| APK / Android app | `skill://re-apk-reverse` — jadx decompile + apktool unpack | Optional licensed JEB Pro cross-check; if core is in .so → `skill://re-ida-reverse` or `skill://re-radare2` |
| Binary exe/dll/so/elf | `skill://re-ida-reverse` — IDA Pro decompile | `skill://re-radare2` — CLI analysis, or `skill://re-reverse-engineering/tools.md` — GDB/Unicorn |
| JavaScript / Web frontend | `skill://webapp-js-reverse` — 5-stage workflow | anything-analyzer MCP browser tools, or jshookmcp CDP/Hook |
| HTTP capture / browser sampling / request replay | anything-analyzer MCP (23816) | Reqable MCP, `skill://webapp-js-reverse`, jshookmcp, or `competition-web-runtime/` |
| Firmware / IoT | `skill://re-firmware-pentest` — extract → EMBA → emulate → fuzz | `skill://re-reverse-engineering/platforms.md` — static RE only |
| WASM / Python bytecode / .NET / **DSL VM / Custom VM** | `skill://re-reverse-engineering` — IIFE + switch-case opcode JS VM | `skill://re-reverse-engineering/languages.md` — real WASM binaries |
| Malware / virus sample | `skill://re-malware-analysis` — six-stage + YARA/Sigma | `skill://re-ida-reverse` deep dive |
| macOS / iOS | `skill://re-reverse-engineering/platforms.md` — Mach-O/ObjC/Swift | `mobile-reverse/` for iOS-specific |
| Game (Unity) | `skill://re-reverse-engineering` — engine reverse, anti-cheat, IL2CPP/Mono (see seed-014) | `skill://re-ida-reverse` deep analysis |
| Memory dump / PCAP | `skill://re-digital-forensics` — memory/timeline/PCAP IR | `skill://re-protocol-reverse` for protocol recovery |
| Existing case package / evidence handoff | `skill://re-case-review`: Evidence graph and fixity review | `skill://re-docs-generator` for final report writing |
| Custom protocol / Protobuf / gRPC | `skill://re-protocol-reverse` | `skill://webapp-js-reverse` if pure browser WS crypto |
| Cloud / Container / K8s | `skill://red-cloud-k8s` | CTF: `../CTF-Sandbox-Orchestrator/competition-agent-cloud/` |
| Windows AD / Kerberos / AD CS | `skill://red-windows-ad` | multi-stage: `skill://red-attack-chain` |
| Source code / SAST | `skill://webapp-code-audit` | deps/CI: `skill://red-supply-chain-security` |
| Game client (Unity/UE) | `skill://re-reverse-engineering` + seed-014 | `skill://re-dotnet-reverse` for Mono assemblies |
| OT / ICS / SCADA | `skill://red-ot-ics` | `skill://re-firmware-pentest` offline firmware |
| macOS / Mach-O desktop | `skill://re-macos-reverse` | iOS → `mobile-reverse/` |
| Thick desktop client | `skill://webapp-thick-client` | Electron → also `skill://webapp-js-reverse` |
| Go / Rust stripped binary | `skill://re-go-rust-reverse` | `skill://re-ida-reverse` / `skill://re-ghidra-reverse` |
| UART / JTAG / debug pads | `skill://re-hardware-security` | then `skill://re-firmware-pentest` |
| Database instance security | `skill://webapp-database-security` | SQLi web path → `skill://webapp-pentest-tools` |
| Email / phishing / DMARC | `skill://webapp-email-security` | |
| SAML / OIDC / SSO | `skill://webapp-identity-federation` | JWT-only API → `skill://webapp-api-security` |
| RF / SDR (non-Wi-Fi) | `skill://red-radio-sdr` | Wi-Fi → `skill://red-wifi-wireless` |
| Browser extension (crx/xpi) | `skill://webapp-browser-extension-reverse` | page JS only → `skill://webapp-js-reverse` |
| Wi-Fi / wireless | `skill://red-wifi-wireless` | close-range chain → `skill://red-attack-chain` |
| Public-source threat intelligence / OSINT | `skill://red-threat-intelligence` | X/Twitter posts remain leads until independently corroborated |
| Blue team / threat hunt | `skill://red-threat-hunting` | sample IOC → `skill://re-malware-analysis` |
| Ghidra (no IDA) | `skill://re-ghidra-reverse` | `skill://re-ida-reverse` if IDA MCP available |
| Binary Ninja / Binja | `skill://re-binary-ninja-reverse` — HLIL/MLIL/LLIL + Python API | Community Binary Ninja MCP/localhost HTTP adapter when explicitly enabled |
| OLLVM-obfuscated binary (control flow flattening / bogus control flow / MBA) | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — complete deobfuscation workflow | obpo-plugin / d810-ng (IDA) / ollvm-unflattener (Miasm) / ollvm-breaker (Binary Ninja) / angr / deollvm (ARM64) |
| Cryptography / encryption algorithms | `reverse-engineering/patterns*.md` — crypto patterns | `skill://webapp-js-reverse` (if frontend crypto) |
| Protocol reverse / custom protocol | `skill://re-reverse-engineering/platforms.md` — network protocols | `skill://webapp-js-reverse` (if WebSocket/HTTP) |
| Go / Rust binary | `skill://re-reverse-engineering/languages-compiled.md` + `skill://re-go-rust-reverse` | `skill://re-ida-reverse` or `skill://re-radare2` |
| LLM / AI application | `skill://red-llm-security` — OWASP LLM Top 10 + ASI Top 10 | Prompt injection, Agent security |
| API / REST / GraphQL | `skill://webapp-api-security` — BOLA/BFLA/JWT/OAuth | `skill://webapp-pentest-tools` for scanning |
| Supply chain / SBOM / CI-CD | `skill://red-supply-chain-security` — Trivy/Syft/Gitleaks | — |
| iOS app (IPA) | `mobile-reverse/` — class-dump/Hopper/Frida iOS | `skill://re-reverse-engineering/platforms.md` |
| **CTF competition (full stack)** | `skill://re-reverse-engineering/patterns-ctf.md` (CTF Master Entry) — master entry | Route to 40+ sub-skills by evidence |
| **CTF ZIP / PKZIP archive** | `skill://re-reverse-engineering/patterns-ctf.md` (ZIP Archive Attack) — legacy ZipCrypto + `bkcrack` known plaintext | Use before password brute force |
| Web runtime / API | `skill://re-reverse-engineering/patterns-ctf.md` (Web Runtime) | — |
| Cloud / Container / K8s | `skill://red-cloud-k8s` | CTF-only extra: sidecar orchestrator after PRIMARY `skill://re-reverse-engineering/patterns-ctf.md` |
| Windows / AD / Identity | `skill://re-reverse-engineering/patterns-ctf.md` (Identity Windows) | — |
| Forensics / PCAP / Steganography | `skill://re-reverse-engineering/patterns-ctf.md` (Forensic Timeline) | — |
| Prompt injection / Agent | `skill://re-reverse-engineering/patterns-ctf.md` (Prompt Injection) | — |
| Mobile (Android/iOS) | `skill://re-reverse-engineering/patterns-ctf.md` (Android Hooking) | — |
| Firmware / Malware sample | `skill://re-reverse-engineering/patterns-ctf.md` (Firmware Layout) | — |

## By User Intent

| User Says | Route To |
|-----------|----------|
| "DSL VM / custom instruction set / risk control engine reverse engineering" | `skill://re-reverse-engineering` — IIFE + switch-case opcode |
| "fireye / fireyejs / getToken reverse engineering" | `skill://re-reverse-engineering` — runtime capture |
| "582KB JS file not WASM / large JS file reverse engineering" | `skill://re-reverse-engineering` — classify DSL VM first |
| "decompile / IDA analyze" | `skill://re-ida-reverse` — IDA MCP workflow |
| "recover source / disassemble" | `skill://re-reverse-engineering` + `skill://re-ida-reverse` |
| "Frida hook / dynamic inject" | `skill://re-reverse-engineering/tools-dynamic.md` — Frida section |
| "radare2 / r2 analyze" | `skill://re-radare2` — CLI workflow |
| "find frontend signature / encrypted params" | `skill://webapp-js-reverse` — Observe→Capture→Rebuild |
| "jshookmcp / JS hook / CDP debug" | `skill://webapp-js-reverse` — same JS/Web chain |
| "Reqable / Reqable MCP / capture replay" | `skill://webapp-pentest-tools` — authorized local capture and API workflow |
| "JEB / JEB Pro" | `skill://re-apk-reverse` — licensed Android / ARM cross-check; verify local install first |
| "APK unpack / repack / modify smali" | `skill://re-apk-reverse` — decode→rebuild-sign-install |
| "bypass anti-debug / anti-detection" | `skill://re-reverse-engineering/anti-analysis.md` |
| "OLLVM deobfuscate / control flow flattening removal / deflat / deobfuscation" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — complete workflow |
| "obpo / obpo-plugin / d810-ng / d810" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — modern deobfuscation tools |
| "Hikari / Polaris / Pluto / O-MVLL / Arkari / goron obfuscation" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — modern OLLVM variant handling |
| "Tigress / Hodur / Approov obfuscation" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — d810-ng dedicated unflattener |
| "Trap Angr / angr path explosion" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Pluto/Polaris trap handling |
| "BR obfuscation / indirect branch obfuscation removal" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — DeObfBR + read-only data segment |
| "what obfuscation / VM is this" | `reverse-engineering/patterns*.md` — match by pattern |
| "Go/Rust/Swift reverse" | `skill://re-reverse-engineering/languages-compiled.md` + `skill://re-go-rust-reverse` |
| "kernel driver / Rootkit / LKM" | `skill://re-reverse-engineering/references/nonpe-format-cookbook.md` |
| "Python bytecode / pyc" | `skill://re-reverse-engineering/languages.md` — Python section |
| "symbol execution / angr" | `skill://re-reverse-engineering/tools-dynamic.md` — angr section |
| "patch environment / Node reproduce" | `skill://webapp-js-reverse/references/env-patching.md` |
| "CTF challenge / competition reverse" | `skill://re-reverse-engineering/patterns-ctf.md` → sidecar orchestrator |
| "CTF ZIP / PKZIP / bkcrack / archive known-plaintext attack" | `skill://re-reverse-engineering/patterns-ctf.md` (ZIP Archive Attack) |
| "write report / documentation" | `skill://re-docs-generator` — technical documentation |
| "review case / evidence chain / traceability" | `skill://re-case-review`: read-only Evidence Graph Review |
| "write writeup" | `skill://re-docs-generator` — CTF writeup template |
| "open webpage / browser automation / fill form" | `skill://webapp-browser-automation` — Playwright |
| "crawl page / screenshot / auto login" | `skill://webapp-browser-automation` |
| "desktop automation / Windows automation" | `skill://webapp-browser-automation` — OpenReverse |
| "game reverse / anti-cheat / hack analysis" | `skill://re-reverse-engineering` — game reverse (IL2CPP/Unity/Cheat Engine) |
| "Unity / IL2CPP / Mono" | `skill://re-reverse-engineering` — Unity + `skill://re-reverse-engineering` |
| "Cheat Engine / memory scan" | `skill://re-reverse-engineering` — Cheat Engine memory analysis |
| "symbol migration / cross-version compare" | `skill://re-binary-diff` — LLM batch migration |
| "missing PDB / old version symbols" | `skill://re-binary-diff` — cross-version symbol migration |
| "bindiff / function offset migration" | `skill://re-binary-diff` — binary diff |
| "port scan / Nmap" | `skill://webapp-pentest-tools` — information gathering |
| "vulnerability scan / Nuclei" | `skill://webapp-pentest-tools` — vulnerability detection |
| "SQL injection / SQLMap" | `skill://webapp-pentest-tools` — web pentest |
| "directory brute force / FFUF / Gobuster" | `skill://webapp-pentest-tools` — web pentest |
| "password cracking / Hashcat" | `skill://webapp-pentest-tools` — password cracking |
| "penetration testing / active scan" | `skill://webapp-pentest-tools` — pentest toolchain |
| "SRC hunting / Bug Bounty" | `skill://webapp-pentest-tools/src-hunter/SKILL.md` — 19 playbooks + H1 cases |
| "WAF bypass" | `pentest-tools/src-hunter/references/payloader/` — 263 bypass steps |
| "draw diagram / flowchart / architecture" | `skill://re-diagram-generator` |
| "attack path diagram / sequence diagram" | `skill://re-diagram-generator` — Mermaid/Graphviz/PlantUML |
| "malware / virus analysis / sample analysis" | `skill://re-reverse-engineering` + YARA/sandbox |
| "firmware / IoT / binwalk / ARM" | `skill://re-reverse-engineering/platforms-hardware.md` |
| "cryptography / AES / RSA" | `reverse-engineering/patterns*.md` — crypto pattern recognition |
| "protocol reverse / Protobuf / custom protocol" | `skill://re-reverse-engineering/platforms.md` |
| "cloud security / container escape / K8s" | `skill://red-cloud-k8s` |
| "Prompt injection / AI security" | `skill://red-llm-security` — OWASP LLM + ASI Top 10 |
| "internal network / lateral movement" | `skill://webapp-pentest-tools` + `skill://webapp-pentest-tools/references/network-attack-defense.md` |
| "privilege escalation" | `skill://webapp-pentest-tools/references/network-attack-defense.md` — escalation section |
| "Mimikatz / credential extraction / PtH" | `skill://webapp-pentest-tools/references/network-attack-defense.md` |
| "Kerberos / domain pentest / AD" | `skill://webapp-pentest-tools/references/network-attack-defense.md` |
| "C2 / persistence / remote control" | `skill://webapp-pentest-tools/references/network-attack-defense.md` |
| "blue team / detection / defense / IR" | `skill://webapp-pentest-tools/references/network-attack-defense.md` |
| "APK security testing / mobile security" | `skill://re-apk-reverse/references/apk-security-checklist.md` — OWASP MASTG |
| "SSTI / template injection" | `skill://webapp-pentest-tools` — SSTImap |
| "XSS scan / cross-site scripting" | `skill://webapp-pentest-tools` — XSStrike |
| "WordPress pentest / WP enumeration" | `skill://webapp-pentest-tools` — WPProbe |
| "C2 framework / adversary simulation" | `skill://webapp-pentest-tools` — AdaptixC2 |
| "WiFi attack / wireless pentest" | `skill://webapp-pentest-tools` — Fluxion + aircrack-ng |
| "NTLM relay / auth coercion" | `skill://webapp-pentest-tools` — Coercer |
| "NetExec / CrackMapExec / nxc" | `skill://webapp-pentest-tools` — network service enumeration |
| "AI auto pentest / MCP security" | `skill://webapp-pentest-tools` — HexStrike AI / MetasploitMCP |
| "Swarm / swarm pentest / autonomous scan" | `skill://webapp-pentest-tools` — Pentest Swarm AI |
| "red team / HW / attack exercise" | `skill://red-attack-chain` — full attack chain orchestration |
| "initial breach / boundary breach" | `skill://red-attack-chain` — boundary breach phase |
| "close-range pentest / BadUSB / WiFi phishing" | `skill://red-attack-chain` — close-range section |
| "EDR bypass / evasion / AV bypass" | `skill://red-edr-bypass-re` |
| "phishing / social engineering" | `skill://webapp-email-security` |
| "supply chain attack" | `skill://red-attack-chain` — supply chain section |
| "trace cleanup / anti-forensics" | `skill://red-attack-chain` — cleanup section |
| "full pentest / end-to-end" | `skill://red-attack-chain` — full chain planning |
| "from external to domain controller" | `skill://red-attack-chain` — cross-phase path orchestration |
| "attack surface assessment / path planning" | `skill://red-attack-chain` — path planning decision tree |
| "got shell, what next / post-exploitation" | `skill://red-attack-chain` — plan from current foothold |
| "BurpSuite / Burp proxy / intercept" | `skill://webapp-pentest-tools` + `skill://webapp-pentest-tools/references/burpsuite-mcp-guide.md` |
| "Burp MCP / proxy history analysis" | `skill://webapp-pentest-tools/references/burpsuite-mcp-guide.md` — 78 tools |
| "Intruder brute force / Repeater replay" | `skill://webapp-pentest-tools/references/burpsuite-mcp-guide.md` |
| "Collaborator / OOB testing" | `skill://webapp-pentest-tools/references/burpsuite-mcp-guide.md` |
| "API security / GraphQL / JWT attack" | `skill://webapp-api-security` — REST/GraphQL/JWT/OAuth |
| "supply chain security / SBOM / SCA" | `skill://red-supply-chain-security` — Trivy/Syft/Gitleaks |
| "iOS reverse / IPA / Mach-O" | `mobile-reverse/SKILL.md` — class-dump/Hopper/Frida iOS |
| "Objection / SSL Pinning bypass" | `mobile-reverse/SKILL.md` — dynamic instrumentation |
| "YARA / malware detection rules" | `skill://re-malware-analysis` — YARA/Sigma/IOC |
| "N-day / patch diff / CVE reproduction" | `skill://re-patch-diff-exploit` |
| "MBA simplification / mixed boolean-arithmetic / expression simplification" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — SiMBA/D-810 |
| "opaque predicate / opaque predicate removal" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — symbolic execution removal |
| "Hikari deobfuscate / string encryption recovery" | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Hikari variant handling |
| "pwn / stack overflow / ROP / ret2libc" | `skill://re-pwn-chain` |
| "Agent not working / AI lazy / skip steps" | `skill://red-llm-security/references/agent-obedience-engineering.md` |
| "MSF stuck / orphan process / MSF protocol" | `skill://webapp-pentest-tools/references/msf-protocol.md` |
| "anonymize / placeholder / writeup desensitize" | field journal anonymization guide |
| "Hydra / online brute force" | `skill://webapp-pentest-tools` — online password attack |
| "Metasploit / msfconsole / exploit" | `skill://webapp-pentest-tools` — exploitation framework |
| "Wireshark / packet analysis / PCAP" | `skill://re-digital-forensics` or `skill://re-protocol-reverse` |
| "BurpSuite / web proxy / intercept" | `skill://webapp-pentest-tools` — web proxy |
| "protocol reverse / Protobuf / gRPC / custom protocol" | `skill://re-protocol-reverse` |
| "Ghidra / analyzeHeadless / no IDA" | `skill://re-ghidra-reverse` |
| "Binary Ninja / Binja / HLIL / MLIL / binary-ninja-mcp" | `skill://re-binary-ninja-reverse` |
| "Kubernetes / K8s / container escape / cloud IAM" | `skill://red-cloud-k8s` |
| "Active Directory / Kerberoast / Certipy / BloodHound" | `skill://red-windows-ad` |
| "forensics / Volatility / memory dump / IR timeline" | `skill://re-digital-forensics` |
| "code audit / SAST / Semgrep / CodeQL / whitebox" | `skill://webapp-code-audit` |
| "OSINT / threat intelligence / public X IOC enrichment" | `skill://red-threat-intelligence` — public posts require independent corroboration |
| "threat hunting / blue team / detection engineering" | `skill://red-threat-hunting` |
| "game reverse / IL2CPP / Unity / Unreal" | `skill://re-reverse-engineering` + seed-014 |
| "Wi-Fi / aircrack / wireless pentest" | `skill://red-wifi-wireless` |
| "browser extension / Chrome extension / crx" | `skill://webapp-browser-extension-reverse` |
| "OT / ICS / SCADA / PLC / Modbus" | `skill://red-ot-ics` |
| "macOS reverse / Mach-O / codesign" | `skill://re-macos-reverse` |
| "thick client / desktop client / Electron security" | `skill://webapp-thick-client` |
| "Go reverse / Rust reverse / GoReSym" | `skill://re-go-rust-reverse` |
| "UART / JTAG / hardware debug pads" | `skill://re-hardware-security` |
| "database security / Redis / Mongo / MSSQL hardening" | `skill://webapp-database-security` |
| "phishing analysis / SPF DKIM DMARC / BEC" | `skill://webapp-email-security` |
| "SAML / OIDC / SSO federation" | `skill://webapp-identity-federation` |
| "SDR / HackRF / RF protocol research" | `skill://red-radio-sdr` |
| "ProxyCat / proxy pool / IP rotation" | `skill://webapp-pentest-tools` — proxy management |

## CTF Wording Normalization

Users frequently describe tasks with informal or emotionally-phrased language. Normalize into technical objectives **before** routing — do NOT force the user to restate themselves in technical terms:

| User Says | Normalized Objective | Route To |
|-----------|---------------------|----------|
| "unlock X / remove check / bypass detection" | Identify the check, explain control flow, propose local patch or input strategy | `skill://re-reverse-engineering` → `skill://re-ida-reverse` or `skill://re-radare2` |
| "remove verification / unlock feature / bypass detection / remove restriction" | Same as above — locate check routine, document, propose patch | `skill://re-apk-reverse` (if APK) or `skill://re-reverse-engineering` |
| "remove anti-debug / anti-tamper" | Locate defensive routine, document evidence, propose lab patch or debugger config | `skill://re-reverse-engineering/anti-analysis.md` |
| "make it pass / let me pass verification" | Recover validation logic, derive expected input or flag format | `skill://re-reverse-engineering` |
| "patch the binary / change jump / modify conditional check" | Work on copy, document offsets/bytes, preserve original | `skill://re-radare2` or `skill://re-ida-reverse` |
| "get flag / crackme / keygen / license" | Treat as local CTF/crackme; focus on analysis, explanation, challenge solving | `reverse-engineering/patterns-ctf*.md` |

Do NOT force the user to repeatedly confirm "this is CTF/local." Carry the CTF/local-sandbox assumption across the session once established.

## By Toolchain

| Tool | Related Module |
|------|---------------|
| IDA Pro (idapro_*) | `skill://re-ida-reverse` — MCP HTTP server + 72 tools |
| radare2 (r2/rabin2/rasm2) | `skill://re-radare2` — CLI + recon.sh |
| jadx / apktool | `skill://re-apk-reverse` — decode.sh / manifest-summary.sh |
| Frida | `skill://re-reverse-engineering/tools-dynamic.md` |
| GDB / GEF / pwndbg / rr | `skill://re-reverse-engineering/tools.md` |
| Ghidra (headless) | `skill://re-reverse-engineering/tools.md` + Ghidra MCP |
| Binary Ninja / binary-ninja-mcp | `skill://re-binary-ninja-reverse` — commercial GUI/API + explicit community MCP bridge on loopback |
| Python 3 standard library | `skill://re-case-review`: read-only case evidence graph review |
| angr / Qiling / Unicorn | `skill://re-reverse-engineering/tools-dynamic.md` |
| D-810 / d810-ng | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — IDA Pro deobfuscation plugin, OLLVM/Tigress/Hodur/Approov + Z3 SMT |
| obpo-plugin | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Hex-Rays microcode cloud plugin, highest efficacy |
| ollvm-unflattener (Miasm) / ollvm-breaker (Binary Ninja) | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Non-IDA scenarios / BN scenarios |
| DeObfBR | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Specialized for BR indirect branch obfuscation |
| deflat (QuarksLab) / angr symbol | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Control flow flattening removal |
| GOOMBA (Ghidra) | `skill://re-reverse-engineering/references/ollvm-deobfuscation.md` — Ghidra P-Code deobfuscation |
| BinDiff / Diaphora | `skill://re-reverse-engineering/tools-advanced.md` |
| anything-analyzer MCP | Port 23816 MCP server (browser + HTTP capture + AI analysis) |
| jshookmcp | `skill://webapp-js-reverse` enhancement MCP for browser/CDP/Hook/Network/SourceMap/AST |
| agent-browser / Playwright | `skill://webapp-browser-automation` — browser automation |
| OpenReverse (UIA/CUA) | `skill://webapp-browser-automation` — Windows desktop automation |
| Cheat Engine / x64dbg / ReClass | `skill://re-reverse-engineering` — game memory analysis (seed-014) |
| IL2CPP Dumper / dnSpy | `skill://re-reverse-engineering` — Unity/Mono game reverse (seed-014) |
| LLM symbol migration / BinDiff alternative | `skill://re-binary-diff` — cross-version batch migration |
| Nmap / Masscan | `skill://webapp-pentest-tools` — port scan, service identification |
| Nuclei / ZAP / Nikto | `skill://webapp-pentest-tools` — vulnerability scanning |
| SQLMap / FFUF / Gobuster | `skill://webapp-pentest-tools` — web pentest (injection/brute force) |
| SSTImap | `skill://webapp-pentest-tools` — SSTI auto-detection |
| XSStrike | `skill://webapp-pentest-tools` — advanced XSS scanning |
| Hashcat / John / Hydra | `skill://webapp-pentest-tools` — password cracking |
| Metasploit / Impacket | `skill://webapp-pentest-tools` — exploitation framework |
| BurpSuite | `skill://webapp-pentest-tools` — web proxy, interception, vulnerability scanning |
| BurpSuite MCP | `skill://webapp-pentest-tools` — 78-tool AI full control, see `skill://webapp-pentest-tools/references/burpsuite-mcp-guide.md` |
| ProxyCat | `skill://webapp-pentest-tools` — proxy pool management & IP rotation |
| Cobalt Strike / Sliver / Havoc | `skill://red-attack-chain` — C2 framework |
| pentestMCP (Docker) | `skill://webapp-pentest-tools` — 20+ tools one-click MCP |
| Mermaid / Graphviz / PlantUML | `skill://re-diagram-generator` — diagram generation |
| garak / PyRIT / promptfoo | `skill://red-llm-security` — LLM red team testing |
| Trivy / Syft / Gitleaks / OSV-Scanner | `skill://red-supply-chain-security` — supply chain scanning |
| Objection / Frida iOS / class-dump | `mobile-reverse/` — iOS dynamic analysis |

Check tool verification index for actual tool availability, paths, and versions. NEVER guess paths.

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
3. User confirms → execute per contributing guide
4. After creation, update this routing matrix

**AI does NOT need to wait for user to discover the gap. Route failure IS the signal to propose a new skill.**

## Path Crossing (Cross-Module Scenarios)

Some tasks span multiple modules. Common crossings:

```
APK Reverse Path:
  apk-reverse/decode.sh → Java layer analysis
  ↓ If core is in .so
  ida-reverse/ or radare2/ → .so analysis
  ↓ If dynamic verification needed
  apk-reverse/frida-run.sh → Frida Hook

Frontend JS Reverse Path:
  js-reverse/Observe → locate target request
  ↓ Need stronger browser/CDP/Hook/Network capability
  jshookmcp → runtime sampling, breakpoints, interception, SourceMap/AST
  ↓ After confirming entry function
  js-reverse/Rebuild → Node local reproduction
  ↓ Need environment patching
  skill://webapp-js-reverse/references/env-patching.md

DSL VM Reverse Path:
  skill://re-reverse-engineering → identify DSL VM (IIFE + single-letter vars + DG() switch-case)
  ↓ Extract opcode table & constant table
  skill://re-reverse-engineering Phase 2-4 → opcode classification, C[9] constant analysis
  ↓ If runtime capture needed
  browser-automation/ → Playwright/Selenium CDP injection
  ↓ If pure API protocol needed
  js-reverse/ → Observe→Capture→Rebuild (API layer only)

CTF Competition Path (via CTF-Sandbox-Orchestrator):
  skill://re-reverse-engineering/patterns-ctf.md → build sandbox model
  ↓ Route by dominant evidence
  competition-web-runtime/ or competition-reverse-pwn/ or competition-identity-windows/
  ↓ Blocked → return to master
  ctf-sandbox-orchestrator → re-route

Web Pentest + BurpSuite MCP Path:
  browser-automation/ → auto-browse target with Burp proxy
  ↓ Traffic captured
  burpsuite MCP proxy_history → AI analyzes all requests
  ↓ Suspicious endpoints found
  burpsuite MCP intruder_attack → automated enumeration
  ↓ Vulnerability confirmed
  docs-generator/ → generate pentest report
```


## Task Completion Self-Check (MUST pass before claiming completion)

- [ ] Did I complete the three-axis routing match (Target Type + User Intent + Toolchain)?
- [ ] Did I read the target skill's SKILL.md after successful routing?
- [ ] When the route missed, did I propose adding a new skill instead of force-fitting?
- [ ] Did I use real tool paths based on tool verification index?