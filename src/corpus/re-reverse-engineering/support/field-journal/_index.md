# Field Journal Experience Index

> Use this index before starting a new engagement or reverse engineering task to locate relevant historical precedents and seed playbooks.
> Entries marked `[Seed]` are curated reference cases shipped in the corpus; dated entries (`YYYY-MM-DD_*`) record completed historical engagements from the upstream reverse-skill knowledge base.

## Statistics

- Shipped seed reference cases: 6
- Upstream historical reference cases: 38
- Last updated: 2026-09-03

## Shipped Seed Cases in Canonical Corpus

### Binary / Go / Game Reverse Engineering

- `[Seed]` [Stripped Go Malware Structural Recovery & String Decryption](skill://re-go-rust-reverse/support/field-journal/seed-002_go-malware-stripped.md)
- `[Seed]` [Unity IL2CPP Metadata Recovery & Function Reconstruction](skill://re-dotnet-reverse/support/field-journal/seed-014_unity-il2cpp-reverse.md)

### Enterprise Active Directory & Windows Security

- `[Seed]` [Active Directory Certipy ESC1 Certificate Template Abuse](skill://red-windows-ad/support/field-journal/seed-005_ad-certipy-esc1.md)
- `[Seed]` [NTLM Relay & Coercer Authentication Coercion](skill://red-windows-ad/support/field-journal/seed-007_ntlm-relay-coercer.md)
- `[Seed]` [Kerberoasting SPN Discovery, Ticket Extraction & Hash Cracking](skill://red-windows-ad/support/field-journal/seed-013_kerberoasting-spn.md)

### Precedent & Sanitization Policies

- [Authorization Precedent Policy](skill://webapp-pentest-tools/support/field-journal/precedent-auth.md)
- [Reverse Engineering Precedent Policy](skill://re-reverse-engineering/support/field-journal/precedent-reverse.md)
- [Penetration Testing Precedent Policy](skill://webapp-pentest-tools/support/field-journal/precedent-pentest.md)
- [Field Journal Anonymization & Sanitization Specification](skill://re-reverse-engineering/support/field-journal/anonymization.md)
- [Field Journal Entry Template](skill://re-reverse-engineering/support/field-journal/_template.md)

## Upstream Historical Case Index (Reference Catalog)

- [Flutter AOT Banner Removal (2026-08-20)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-08-20_apk-flutter-banner-ad-removal.md) — Flutter AOT server-driven banner removal (Blutter + fixed-length string replacement)
- [Android Fragment Hook & SDK Crash Bypass (2026-05-15)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-05-15-cellular-pro-mumu-ksad-fragment-fix.md) — Android fragment hook & SDK crash bypass
- [Seed 008: Android OkHttp SSL Pinning Bypass](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/seed-008_apk-okhttp-ssl-pin-bypass.md) — Android OkHttp SSL pinning bypass
- [Cortex-M USB MSC Firmware Unpacking (2026-08-06)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-08-06_cortex-m-msc-firmware-self-keyed-rotate-xor.md) — Cortex-M USB MSC firmware self-keyed ROR/XOR unpacking
- [Electron Bytenode Privileged Updater Chain (2026-07-22)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-07-22_electron-bytenode-privileged-update-chain.md) — Electron Bytenode privileged updater chain analysis
- [Android ARM64 Self-Extracting Payload Recovery (2026-07-14)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-07-14_android-arm64-self-extract-source-recovery.md) — Android ARM64 self-extracting payload recovery
- [Go Binary Symbol & Algorithm Recovery (2026-05-15)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-05-15_lumine-go-reverse.md) — Go binary symbol & algorithm recovery
- [Seed 001: Packed ELF Loader Unpacking](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/seed-001_elf-packed-loader.md) — Packed ELF loader unpacking workflow
- [Seed 010: Linux x86_64 ROP Exploitation](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/seed-010_ctf-pwn-rop-x64.md) — Linux x86_64 ROP exploitation chain
- [Seed 011: PCAP Protocol Frame Recovery](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/seed-011_pcap-protocol-reverse.md) — Custom binary protocol frame recovery from PCAP
- [Seed 015: IoT Firmware UART Shell Analysis](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/seed-015_iot-firmware-uart.md) — IoT firmware extraction and UART shell analysis
- [Next.js CDK Local Reconstruction (2026-08-01)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-08-01_nextjs-cdk-contract-faithful-local-reconstruction.md) — Next.js CDK contract-faithful local reconstruction
- [.NET CMS Encryption Oracle & SQLi Chain (2026-08-01)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-08-01_pentest-encryption-oracle-public-template-sql-admin-takeover.md) — .NET CMS encryption oracle & template SQL injection chain
- [Gin & Juice Client-Side Friction (2026-07-18)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-07-18_gin-juice-client-friction.md) — Modern web client-side friction & lab validation
- [DSL VM Captcha Reverse Engineering (2026-07-05)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-07-05_dsl-vm-captcha-reverse.md) — Custom JS DSL virtual machine opcode recovery
- [Burp MCP Bridge Verification (2026-06-29)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-06-29_burp-mcp-full-test-and-fix.md) — Burp MCP bridge verification
- [API Rate-Limit Bypass Verification (2026-05-26)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-05-26_pentest-newapi-rate-limit-bypass.md) — API rate-limit bypass verification
- [Cloudflare Access Sibling Subdomain Cookie Poisoning (2026-05-25)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-05-25_pentest-cf-access-sibling-subdomain-cookie-poisoning.md) — Sibling subdomain cookie poisoning analysis
- [Vue SPA Route & Actuator Leak Analysis (2026-05-17)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-05-17_pentest-vue-spa-actuator-leak.md) — Vue SPA route & Spring Actuator exposure analysis
- [Mass Assignment Privilege Escalation (2026-05-16)](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/2026-05-16_pentest-personalblog-fun-mass-assignment.md) — Mass assignment privilege escalation
- [Seed 003: Web API Authentication Bypass](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/seed-003_web-api-auth-bypass.md) — Web API authentication bypass patterns
- [Seed 004: Webpack Request Signing Extraction](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/seed-004_js-sign-webpack.md) — Webpack request signing extraction
- [Seed 006: SSRF to Cloud Metadata Service](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/seed-006_ssrf-cloud-metadata.md) — SSRF to cloud metadata service
- [Seed 017: Out-of-Band XXE Data Exfiltration](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/seed-017_xxe-oob-exfil.md) — Out-of-band XXE data exfiltration
- [Seed 016: Kubernetes Privileged Pod Container Escape](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/seed-016_k8s-container-escape.md) — Kubernetes privileged pod container escape
- [Seed 009: iOS Jailbreak Detection Bypass](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/seed-009_ios-jailbr%65ak-detect-bypass.md) — iOS jailbreak detection bypass with Frida/Objection
- [Seed 012: Log4Shell JNDI RCE Analysis](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/skills/field-journal/seed-012_log4shell-jndi-rce.md) — JNDI lookup injection analysis

## Usage Instructions

1. Before starting a task, check the relevant scenario category above for matching seed cases or precedents.
2. When recording a new engagement journal entry in your case workspace, copy `skill://re-reverse-engineering/support/field-journal/_template.md` and sanitize all target identifiers using `skill://re-reverse-engineering/support/field-journal/anonymization.md`.
