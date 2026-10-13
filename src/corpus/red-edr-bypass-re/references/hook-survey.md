# EDR Hook Research Quick Reference

> For authorized red team / adversarial exercises / testing your own products only; prohibited for unauthorized targets.

This document summarizes the monitoring points of mainstream EDR / AV in user mode and kernel mode, to help quickly identify "what to handle" during the red team reconnaissance phase.

## 1. Mainstream EDR Fingerprints and Hook Patterns Quick Reference

| Vendor / Product | User-Mode Components | Kernel Driver | Main Monitoring Surface |
|------------|-----------|---------|-----------|
| CrowdStrike Falcon | `CSFalconService.exe`, `CSAgent.sys` injected into target process | `CSAgent.sys`, `CSBoot.sys` | Heavy kernel callbacks + ETW-TI; fewer user-mode hooks (cloud lookup) |
| Microsoft Defender for Endpoint (MDE) | `MsMpEng.exe`, `MpClient.dll` | `WdFilter.sys`, `WdBoot.sys`, `WdNisDrv.sys` | Comprehensive AMSI + ETW-TI + ntdll inline hook + kernel callback |
| SentinelOne | `SentinelAgent.exe`, `SentinelHelperService.exe` | `SentinelMonitor.sys`, `SentinelDeviceControl.sys` | Heavy ntdll user-mode hooks + kernel callbacks + proprietary ETW provider |
| Elastic Defend (formerly Endpoint Security) | `elastic-endpoint.exe` | `elastic-endpoint-driver.sys` | Mainly ETW + a few ntdll hooks, with Elastic Agent upload |
| ESET | `ekrn.exe`, `eamsi.dll` | `eamonm.sys`, `epfwwfp.sys` | Many user-mode hooks (NtCreateFile / NtOpenProcess, etc.) |
| Sophos Intercept X | `SophosFileScanner.exe`, `SophosNtpService.exe` | `SophosED.sys`, `hmpalert.sys` | ntdll hook + HMPA memory protection + kernel callback |
| Kaspersky | `avp.exe`, `klif.sys` | `klif.sys`, `klhk.sys` | Heavy user-mode hooks + KLIF proprietary minifilter + network filter driver |
| Trend Micro Apex One | `TmListen.exe`, `TmCCSF.dll` | `tmcomm.sys`, `tmactmon.sys` | User-mode hook + behavior monitoring driver |
| Carbon Black | `RepMgr.exe`, `RepWAV.exe` | `ParityDriver.sys` | Leans toward kernel callbacks + ETW |

### Quick Fingerprint Script

```powershell
$edrSigs = @{
    'CSAgent'           = 'CrowdStrike Falcon'
    'SentinelAgent'     = 'SentinelOne'
    'elastic-endpoint'  = 'Elastic Defend'
    'ekrn'              = 'ESET'
    'MsMpEng'           = 'Microsoft Defender'
    'SophosFileScanner' = 'Sophos Intercept X'
    'avp'               = 'Kaspersky'
    'TmListen'          = 'Trend Micro Apex One'
    'cb'                = 'Carbon Black'
}

Get-Process | ForEach-Object {
    foreach ($k in $edrSigs.Keys) {
        if ($_.ProcessName -match $k) {
            "[+] $($edrSigs[$k]) detected: $($_.ProcessName) (PID $($_.Id))"
        }
    }
}

Get-ChildItem 'C:\Windows\System32\drivers\*.sys' |
    Where-Object { $_.Name -match 'CSAgent|Sentinel|elastic|eam|WdFilter|Sophos|klif|tmcomm|Parity' } |
    Select-Object Name, VersionInfo
```

## 2. Key User-Mode ntdll Hook Functions

`ntdll.dll` exports that EDR almost certainly hooks (grouped by ATT&CK behavior):

| Function | Monitored Behavior | ATT&CK |
|------|-----------|--------|
| `NtCreateThreadEx` | Remote thread injection, QueueUserAPC injection | T1055.002 / T1055.004 |
| `NtAllocateVirtualMemory` | Shellcode allocating RWX memory | T1055 |
| `NtAllocateVirtualMemoryEx` | Cross-process memory allocation (new API in Win10+) | T1055 |
| `NtProtectVirtualMemory` | Change page protection RW→RX | T1055 |
| `NtWriteVirtualMemory` | Cross-process write shellcode | T1055.012 |
| `NtMapViewOfSection` | Section-based injection (Process Doppelganging / Ghosting) | T1055.013 |
| `NtCreateSection` | Used with MapViewOfSection | T1055.013 |
| `NtOpenProcess` | Open target process to obtain handle | T1057 |
| `NtQueueApcThread` / `NtQueueApcThreadEx` | APC injection | T1055.004 |
| `NtCreateProcess` / `NtCreateProcessEx` / `NtCreateUserProcess` | Create child process (including PPID spoof) | T1106 |
| `NtSetContextThread` | Modify thread context (thread hijacking injection) | T1055.003 |
| `NtResumeThread` | Resume thread after injection | T1055 |
| `NtQuerySystemInformation` | Enumerate processes / drivers / handles | T1057 / T1082 |
| `NtAdjustPrivilegesToken` | Privilege escalation to obtain SeDebugPrivilege, etc. | T1134 |
| `NtLoadDriver` | Load kernel driver (BYOVD) | T1543.003 |

### Verify Whether a Hook Exists

```powershell
# Simple: diff disassembly of on-disk ntdll and current process ntdll
# 1. Copy on-disk ntdll
copy C:\Windows\System32\ntdll.dll C:\temp\ntdll_clean.dll

# 2. In windbg, attach to any process and dump the .text section of the current ntdll
# .writemem c:\temp\ntdll_live.bin ntdll!.text L?<size>

# 3. Use IDA / radare2 to disassemble NtAllocateVirtualMemory; normally it should be:
#    mov r10, rcx
#    mov eax, <SSN>
#    test byte ptr [...]
#    jne ...
#    syscall
#    ret
# If the first instruction becomes jmp <some address>, it is hooked
```

## 3. Kernel Callback Monitoring Points

Common kernel callbacks registered by EDR (all can be unregistered via the BYOVD path in `attack-chain`, but at high cost):

| API | Callback Registration Timing | Defender Purpose |
|-----|--------------|-----------|
| `PsSetCreateProcessNotifyRoutineEx` | Process creation / exit | Intercept suspicious child processes |
| `PsSetCreateThreadNotifyRoutine` | Thread creation / exit | Detect remote thread injection |
| `PsSetLoadImageNotifyRoutine` | DLL / EXE loaded into any process | Module integrity / unsigned blocking |
| `CmRegisterCallback` / `CmRegisterCallbackEx` | Registry operations | Persistence detection |
| `ObRegisterCallbacks` | `OpenProcess` / `OpenThread` handle requests | Prevent LSASS handle acquisition (T1003.001) |
| `MmRegisterPhysicalMemoryCallback` | Physical memory mapping | Prevent DMA / memory forensics |
| `IoRegisterFsRegistrationChange` | File system registration | Minifilter coordination |
| `KeRegisterNmiCallback` | NMI (rarely used by EDR) | Exception monitoring |
| `EtwRegister` (kernel side) | Kernel ETW reporting | Coexists with ETW-TI |

### Enumerate Registered Callbacks with windbg

```text
0: kd> dx -r1 nt!PspCreateProcessNotifyRoutine
0: kd> dx -r1 nt!PspCreateThreadNotifyRoutine
0: kd> dx -r1 nt!PspLoadImageNotifyRoutine

0: kd> !object \Callback
0: kd> !object \Callback\ProcessObject
```

Or use tools such as PChunter / DRVHV to view the callback list visually as a normal user.

## 4. Static Dump of Hook Tables (IDA + windbg Workflow)

### Workflow A: Single-Process Comparison

```text
1. Find a process that has been injected with user-mode components by EDR (any live process)
2. windbg attach (-pn target.exe)
3. lm m ntdll  → get module base address
4. .writemem c:\temp\ntdll_live.bin ntdll+0x0 L?<image size>
5. Copy C:\Windows\System32\ntdll.dll to c:\temp\ntdll_disk.dll
6. Load both files in IDA, jump to NtAllocateVirtualMemory:
     - disk: standard prologue
     - live: first instruction jmp <0x7FFE000000xx>
7. Follow the jmp target address → that is the EDR trampoline; dump it
8. Enter the trampoline and see which DLL it ultimately lands in, to confirm the EDR module name
```

### Workflow B: Batch Hook Table Generation

Use `HookHunter` or a custom script:

```powershell
# pseudo workflow; see the scripts mentioned in references
$disk = Get-Content C:\Windows\System32\ntdll.dll -Encoding Byte
$live = # obtained via OpenProcess + ReadProcessMemory
# Compare the first 16 bytes of each export in the .text section
```

## 5. pe-sieve Automated Detection

`pe-sieve` is the preferred choice for reconnaissance of EDR hooks and implant self-checks:

```powershell
# Basic scan
pe-sieve64.exe /pid 1234

# Recommended combination (includes shellcode and hook detection)
pe-sieve64.exe /pid 1234 /shellc 3 /modules 3 /imp 3 /data 3 /dir hooks_dump

# Key parameters:
#   /shellc N    shellcode scan level (0-3)
#   /modules N   module integrity check (0-3)
#   /imp N       IAT hook check
#   /data N      data section scan
#   /dir <path>  dump output directory
```

The output will produce `*.tag` files under `hooks_dump/<pid>.<name>/`, listing hook addresses:

```text
modified_modules.tag example:
71f10000;ntdll.dll
71f1a3b0;hook;jmp_far
71f1c020;hook;jmp_near
```

It can be fed directly to IDA to jump to the corresponding RVA for further analysis.

### Embedding pe-sieve in an Implant (Self-Check)

In practice, `pe-sieve` is often compiled as a lib (`libpe-sieve`) so the implant performs a self-check on startup: if ntdll has hooks, trigger the unhook process; if it finds itself hooked, be careful, as it may be in a sandbox.

## 6. Dynamic Observation with API Monitor v2

API Monitor v2 (Rohitab) is suitable for observing in a lab when and where EDR inserts hooks:

```text
1. Launch API Monitor v2 (as administrator)
2. Check in API Filter:
     - NT Native API → Memory Management
     - NT Native API → Process and Thread
     - Windows Defender / AMSI (if visible)
3. Monitor New Process → select implant test sample
4. Observe:
     - NtAllocateVirtualMemory call order
     - Whether it is relayed by an EDR DLL
5. In the Modules tab, see which EDR DLLs are injected via LoadLibrary
```

## 7. Common EDR DLLs (User-Mode) Quick Reference

| DLL | Vendor | Notes |
|-----|------|------|
| `umppc*.dll` | Microsoft Defender | MpClient userland |
| `mpoav.dll` | Microsoft Defender | AMSI provider |
| `aswAMSI.dll` | Avast | AMSI provider |
| `eamsi.dll` | ESET | AMSI provider |
| `IDPMServiceClient.dll` | Sophos | HMPA injection |
| `klsihk64.dll` | Kaspersky | Injected into target process |
| `CrowdStrike.Sensor.dll` | CrowdStrike | Older versions; newer versions mainly rely on kernel |
| `SentinelInjection64.dll` | SentinelOne | User-mode injection |
| `TmUmEvt64.dll` | Trend Micro | Behavior monitoring |

After identifying the target EDR, decide which DLL to reverse engineer to extract the hook table.

## Reference Links

- pe-sieve: <https://github.com/hasherezade/pe-sieve>
- HollowsHunter: <https://github.com/hasherezade/hollows_hunter>
- API Monitor v2: <http://www.rohitab.com/apimonitor>
- MITRE ATT&CK T1562: <https://attack.mitre.org/techniques/T1562/>
- MITRE ATT&CK T1055: <https://attack.mitre.org/techniques/T1055/>
- ired.team EDR notes: <https://www.ired.team/offensive-security/defense-evasion>

## Routing Callback

After completing hook reconnaissance, return to Step 3 in `SKILL.md` to select a bypass technique combination, then execute according to `skill://red-edr-bypass-re/references/unhook-techniques.md` and `skill://red-edr-bypass-re/references/telemetry-blinding.md`.