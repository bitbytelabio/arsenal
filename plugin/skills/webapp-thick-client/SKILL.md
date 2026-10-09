---
name: webapp-thick-client
description: Security testing for desktop thick-client applications and local IPC communication.
domain: webapp
category: client-side
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/webapp-thick-client/SKILL.md
---
# Thick Client Security Testing

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `support/field-journal/precedent-pentest.md`
2. `NOW`: Confirm the target is a **desktop thick client** (Win/macOS/Linux GUI or companion service), not pure Web
3. `NOW`: case-init; write the installer package source and test accounts into scope
4. `NEXT`: Tools (Burp upstream proxy, process monitoring, reverse engineering tools)
5. `ACT`: Trust boundary diagram → Local surface → Network surface → Update/supply chain

## Applicable Scenarios

- C/S architecture clients, Electron/Qt/.NET WinForms/WPF
- Local configuration/credential storage, IPC, named pipes
- Client-side enforced validation bypass research (authorized)
- Auto-update channels and code signature verification

## Workflow

### 1. Establish Boundaries

```text
□ Process tree, child processes, drivers/services
□ Listening ports and outbound domains
□ Local sensitive paths: %APPDATA%, Keychain, Registry
```

### 2. Local Attack Surface

```text
□ Plaintext configurations, hardcoded keys, debug switches
□ DLL hijacking / search order (Windows)
□ Database files (SQLite) permissions and encryption
□ IPC: Who can connect? Is there authentication?
```

### 3. Network Surface

```text
□ System proxy / application custom TLS
□ Certificate pinning → Combine with mobile/js methodologies or Frida
□ API authorization bypass: Administrative interfaces hidden inside the client
```

### 4. Reverse Engineering Verification

```text
□ .NET → dotnet-reverse; Native → ida/ghidra; Electron → asar + js-reverse
```

## Toolchain

| Tool | Purpose |
|------|---------|
| Process Monitor / API Monitor | Behavioral analysis |
| Burp / mitmproxy | Traffic interception |
| dnSpy / IDA / Ghidra | Reverse engineering |
| Sysinternals | Windows surface |
| asar / nexe detection | Electron |

## References

- `references/thick-client-checklist.md`
- `../dotnet-reverse/` `../ida-reverse/` `../js-reverse/` `../api-security/`

## Routing Context

**Upstream**: MASTER R32  
**Downstream**: Pure protocol `protocol-reverse`; supply chain updates `supply-chain-security`

## Task Completion Checklist

- [ ] Has the trust boundary been mapped out?
- [ ] Are both local + network attack surfaces covered?
- [ ] Checklist completed?
