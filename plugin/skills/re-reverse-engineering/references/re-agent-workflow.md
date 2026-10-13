# RE Agent Workflow Gates (Static ↔ Dynamic)

> Source inspiration: binary-re phase division, community RE skills (Frida/r2/Ghidra/IDA loop), Cerberus tri-head loop (static/dynamic/instrumentation)  
> Issue #65 increment: Iron rule of IAT repair, six-phase mapping, .NET/DLL·SYS equivalent paths; User instruction feasibility gate; Bypass patches 6–10; Anti-debugging/obfuscation recipes A–T; Non-PE multi-format recipes U–AV (2026-08-12)  
> Applicable to: `reverse-engineering/`, `ida-reverse/`, `radare2/`, `malware-analysis/`, handoff with cre roles

## 0. Initialization

```text
□ scope.md: offline sample path OR authorized target device/VM
□ tool-index: actual paths for file/strings/r2/ida/frida etc.
□ Role: cre (ops/role-map)
```

## 0.1 Transition handoff (decision delta)

Do not re-inject full case context between phases. `scope.md` / `workitems.md` / Evidence remain authoritative; `timeline.md` only carries the transition delta:

1. At the end of a stage/turn, write only the `decision_delta` that genuinely changes subsequent actions; write `[]` if there are no changes.
2. Unchanged route/auth/scope/network profile/tool state/hypothesis must only be placed in `carry_forward_refs`. Consumers read according to references without re-serializing / re-emitting.
3. `decision_delta` is not the complete state; consumers must inherit refs first before applying the delta.
4. Halt at the next-step menu only when two or more evidence-supported branches would lead to different subsequent actions; deterministic gates advance directly.

Example: When Triage is completed and the only valid next step is Static, the transition only requires `decision_delta: [phase=triage->static]` + `carry_forward_refs: [scope.md, evidence/E-triage.md]`.

## 0.5 User Instruction Feasibility Gate (Issue #65)

**Principle**: Obey the user's **objective**, do not blindly follow the user's **step sequence**. Before skipping steps, explain the prerequisites and request confirmation; mandatory steps after confirmation must be executed, and the Evidence quality must be honestly labeled.

| Condition | Agent MUST |
|-----------|------------|
| User wants to do X, and current state can yield **valid** Evidence | Execute X, update Evidence |
| User wants to do X, but there is a **known blocking prerequisite** (e.g., confirmed packed and static IAT is unreadable) | **FORBIDDEN** to pretend meaningful IAT is completed; ① State the blocker in one sentence; ② Provide the recommended sequence (unpack/repair IAT first, or capture APIs directly via dynamic analysis); ③ **Request user confirmation** on whether to "still force viewing current junk table" or "follow recommended sequence" |
| User explicitly **forces** the current step (e.g., view IAT even without unpacking) | Execute and record Evidence, MUST label `quality=unreadable` / `packed` (or equivalent); **FORBIDDEN** to deduce conclusions like "no network capability" based on this |
| User accepts recommended sequence | Perform prerequisite step first; automatically or upon request do X after completion; **FORBIDDEN** to use prerequisite steps (such as unpacking) to **impersonate** "completed import table inspection" |

**Relation to "Redo X"**: Redoing X still = redoing the named step (or its negotiated valid prerequisite result after confirmation), strictly forbidding replacement with irrelevant steps. Unpacking is a **prerequisite** to the import table, not an **alternative** to the import table.

Typical conflict: User says "Do not unpack first, look at import table first" on a packed sample → The packer often tampers with the import directory/encrypts descriptors, rendering the static table junk and meaningless → Follow the "blocking prerequisite" row in this table; do not silently unpack to impersonate, nor silently hand over the junk table as completed.

## 1. Triage (5–15 minutes · Mandatory Starting Point)

```text
□ Calculate sample Hash (MD5/SHA256) → Unique ID
□ Identify file type: EXE / DLL / SYS / ELF / Mach-O / .NET / Script (bat/ps1/vba) / JS / APK etc.
□ Non-PE / Script / APK / Driver specifics: see §3.4 and `references/nonpe-format-cookbook.md` (U–AV)
□ file / DIE / entropy / packer signatures (PEiD / DIE / Exeinfo etc.)
□ Architecture: x86 / x64 / ARM; compiler language clues (VC++ / Delphi / .NET / Go / Rust)
□ Packer type clues: UPX / ASPack / VMProtect / Themida / unknown obfuscation
□ strings / rabin2 -z low-hanging fruit
□ MUST import/export anchors (see "Import Table Hard Gate and Equivalent Paths" below); if user rushes ahead and sample is packed → proceed through §0.5 first
□ Output: E-triage (MUST contain imports or equivalent anchor classification summary, including quality labeling if applicable) + hypothesis checklist
```

**Phase Gate (Triage → Static/Dynamic)**: MUST NOT enter Dynamic before imports **or** a valid equivalent anchor summary is recorded in E-triage (unless IAT repair failure is recorded and dynamic bypass is selected, see §1.2), and MUST NOT claim "basic triage completed". When parsing fails, the failure output MUST still be written to Evidence, not skipped. When the user requests to "redo import table inspection", the agent MUST redo imports/equivalent steps themselves (or complete prerequisites negotiated under §0.5 first); replacing with other analysis steps to impersonate is forbidden.

### 1.1 Import Table Hard Gate and Equivalent Paths

| Sample Type | MUST Anchor (Evidence) | Description |
|-------------|------------------------|-------------|
| Native PE/ELF/Mach-O (IAT readable) | `E-imports` / `E-triage-imports`: Import classification summary | `rabin2 -i` / IDA imports / equivalent |
| DLL / SYS / Shared library | **Concurrent** `E-imports` + `E-exports` (`rabin2 -i` + `rabin2 -E`) | Export table priority equals import table (external entry points) |
| .NET Managed (No traditional IAT) | **Equivalent path**: dnSpy/IL/metadata/assembly references and sensitive API summary → still written into `E-imports` or `E-triage-imports` semantic slot | **FORBIDDEN** to bypass hard gate citing "no IAT"; viewing via dnSpy = native "check import table" |
| Import table parsing failed / empty / packed junk table | Still record failure or junk table output as Evidence, and tag `quality` | Must not skip silently; junk table must not support capability negation conclusions |

**Clean Import Table Warning (MUST alert)**: If the import table is "too clean" (only basic DLLs like kernel32/ntdll, almost no business APIs), strongly suspect dynamic loading via `LoadLibrary` + `GetProcAddress` → Note suspicion in Evidence, and **SHOULD** transition to Dynamic to capture in-memory APIs; must not declare "no network/no file capability" solely based on static IAT.

**High-Risk API Combinations (Patch 8 · SHOULD)**: When the import table is excessively long, prioritize outputting **malicious combination clusters**, filtering pure basic system calls. Examples (non-exhaustive):

- High-risk cluster: `FindWindowA/W` + `WriteProcessMemory` + `CreateRemoteThread` (Injection)
- High-risk cluster: `CryptEncrypt` / `CryptAcquireContext` + extensive `FindFirstFile` / `DeleteFile` (Ransomware tendency)
- High-risk cluster: `InternetOpen` / `WinHttp` / `URLDownloadToFile` + persistence APIs (`RegSetValue` / `CreateService`)
- Standalone `CreateFile` / `ReadFile` etc. are mostly benign noise unless co-occurring with the clusters above

### 1.2 Unpacking and IAT Handling (High-Risk Fork · Issue #65)

```text
Branch A: Unpacked / .NET Managed
  → Directly proceed to §2 Static (.NET follows equivalent anchors)

Branch B: Packed / Strongly Obfuscated
  Step 1: Attempt unpacking (automated unpacker / manual OEP hunting) — must be in authorized and isolated environment
  Step 2: Attempt IAT repair
    Tools: x86 → ImportREC (or equivalent); x64 → Scylla (or equivalent). Strictly forbidden to persist with ImportREC on 64-bit samples.
    Case B1: Repair successful and parseable → Record E-imports (post-repair) → §2 Static
    Case B2: ImportREC/Scylla throws error, fails to execute post-repair, or IAT is complete gibberish (VMP/encrypted packer)
      → [Iron Rule of IAT Repair] Immediately terminate further static IAT repair attempts
      → MUST record E-iat-repair-fail (command, tool, failure symptom, decision to pivot to dynamic)
      → Directly proceed to §3 Dynamic: API breakpoints / hardware execution breakpoints / memory search to capture imports
      → This does not count as "skipping import table": import table path was attempted and recorded in Evidence
    Case B3 (Patch 6): Crash on double-click / BSOD after unpacking and repairing IAT (suspected file CRC/size self-check)
      → Abandon further static file patching; record E-self-check-crash or merge into E-iat-repair-fail
      → Proceed to §3 Dynamic: Set breakpoints on CreateFile / GetFileSize / hash-related APIs to locate check bypass point
```

**Iron Rule of IAT Repair (MUST)**: Prioritize automated/semi-automated repair attempts; once repair tools error out or the program fails to run post-repair, **immediately stop** grinding on the static import table, switch to dynamic debugging, and capture imported functions at runtime using API breakpoints (e.g., `bp CreateFile` / critical network APIs).

## 2. Static (Basic Static Anchors → Deep Dive)

| Tool | When |
|------|------|
| radare2 / rabin2 | Fast functions/imports/strings (imports MUST be completed in Triage or failure bypass recorded) |
| IDA / Ghidra (MCP or headless) | Deep dive, cross-references, types; review imports classification during survey phase |
| jadx / dnSpy | Android / .NET |
| OLLVM documentation | Control flow flattening suspicion |

```text
□ Confirm E-imports / E-triage already contains import table or equivalent anchor Evidence (if missing, supply first; postponing is forbidden)
□ If DLL/SYS: confirm E-exports is recorded
□ Sensitive API grouping + high-risk combination clustering (Patch 8)
□ Hardcoded domain/IP/URL strings; whether payload is hidden in resource sections
□ Locate critical functions (encryption/verification/network/authorization) → record addresses/symbols in Evidence
□ One path blocked → switch tools (IDA ↔ r2 ↔ Ghidra)
□ Timebox (Patch 9 · SHOULD default): forced pivot to §3 Dynamic if no critical path found after ~15 minutes of static deep dive (user/task can override duration)
```

**When MCP is unavailable**: Analyze by exporting decompiled text (referencing P4nda0s reverse-skills / IDA-NO-MCP concepts), still recording the Evidence path.

## 3. Dynamic (Cross-Verification Loop Zone)

Core concept: **Static provides clues → Dynamic verifies → Verification gets stuck → Return to static re-examination** (No fixed single sequence).

### 3.0 Breakpoint Opening Sequence (Patches 7 + 10 · MUST Order)

Before launching the sample in a user-mode debugger (x64dbg, etc.), preset breakpoints according to the "Four-Stage Rocket" (names may vary slightly across architectures/tools, but the order remains unchanged):

1. **TLS Callback** breakpoint (May have already executed before the debugger EP)
2. **Entry Point (EP)** breakpoint
3. **Sensitive API** breakpoints (e.g., `CreateRemoteThread` / network / file writes)
4. **Failsafe**: `ExitProcess` / Process termination path breakpoint (Patch 10)—Once an abrupt exit occurs due to anti-debugging, **do not rush to restart**; immediately dump memory and write the pre-crash image path into Evidence for string/data recovery.

```text
□ Frida / x64dbg / gdb / emulator: Verify static hypotheses
□ Preset breakpoints per §3.0 before execution; single-step trace stack/registers (White box)
□ Behavioral monitoring: Sandbox / Procmon / RegShot (Black box)
□ IAT repair failure / Self-checksum crash sample: Hardware execution breakpoints or memory search to forcefully capture APIs; CreateFile/GetFileSize to check CRC
□ Anti-debugging / Anti-Frida → reverse-engineering/anti-analysis
□ Android: Generate root detection / SSL pinning bypass scripts on demand, **MUST be on authorized devices**
□ Crash-log-driven next-round hooking (Adaptive loop)
□ Timeboxing (Patch 9 · SHOULD default): Single-step tracing of ~200 instructions with no malicious behavior clues → Force return to static search for strings/switch anchor points (Overridable)
```

### 3.1 Sandbox / Dynamic Inactivity Contingency Branch (MUST)

```text
No behavior or immediate exit / Infinite sleep
  → Check anti-debugging / anti-VM routines (CPUID, high-precision timing, sandbox artifacts, etc.)
  → Attempt hardware breakpoint bypass, patch detection points, or switch to physical machine/higher fidelity environment
  → Record "No behavior + Suspected anti-VM" into Evidence; writing "Sample is harmless" without qualification is FORBIDDEN
```

### 3.2 Timeboxing Strategy (Patch 9 · SHOULD)

| Phase | Default Threshold (Overridable by user/task) | Action |
|-------|----------------------------------------------|--------|
| Static deep-dive yields no critical path | ~15 minutes | Transition to Dynamic |
| Dynamic single-stepping makes no progress | ~200 instructions | Return to Static strings/cross-references to re-anchor |
| Any path repeatedly fails | Record Evidence, then switch tools or take side channels | Idling on the same failed technique is FORBIDDEN |

### 3.3 Anti-Debugging / Obfuscation Bypass Quick Reference (Issue #65 Patches A–T · High Frequency)

For full index and action details, see `skill://re-reverse-engineering/anti-analysis.md` "Agent Response Cookbook A–T". Only **P0 must-check + common transitions** are listed here. Default to **authorized isolated lab**; patching/modifying flag bits does not constitute unauthorized production actions.

| Trigger Feature | Preferred Action (Summary) | Evidence |
|-----------------|----------------------------|----------|
| `cpuid` followed by jz/jnz (A) | Lab: Modify flag bits or patch to follow the real branch; record detection point address | `E-anti-debug-cpuid` |
| `rdtsc` + sub/cmp (B) | bp rdtsc or hook time source; treating infinite spinning/sandbox timeouts as "harmless" is FORBIDDEN | `E-anti-debug-rdtsc` |
| PEB BeingDebugged / NtGlobalFlag (K) | ScyllaHide or manually edit PEB; patch conditional jumps | `E-anti-debug-peb` |
| `NtQueryInformationProcess` DebugPort/Flags/Object (P) | ScyllaHide / hook return values; record class parameters | `E-anti-debug-ntqip` |
| Minimal imports but rich behavior → API Hashing (N) | bp GetProcAddress; reverse hash lookups and re-inject to IDA | `E-api-hash` |
| Empty strings but has net/file behavior → String encryption (I) | Find xrefs to decode routines; dump and re-inject post-decryption | `E-string-decrypt` |
| Signed but suspicious origin (F) | SigCheck: Valid/revoked/timestamp; **invalid does not downgrade** threat severity | `E-sig-forge` |
| Standard strings show no IOCs → Try wide characters (T) | `strings -el` / UTF-16LE; Alt+A unicode | `E-wide-strings` |
| Debugger name strings / Toolhelp scanning (C) | bp CreateToolhelp32Snapshot chain | `E-anti-debug-procscan` |
| AddVectoredExceptionHandler + intentional exception (D) | bp VEH registration; analyze handler | `E-anti-debug-veh` |
| int3 / DR0–DR7 (M) | Patch int3; software breakpoints or ScyllaHide to hide hardware BPs | `E-anti-debug-bp` |
| Multiple PE headers / Overlapping sections (G) | Section table true mapping + entropy; do not trust section names | `E-pe-anomaly` |
| End of file > sum of sections (Overlay) (J) | Extract overlay; file/entropy; locate loading offset xrefs | `E-overlay` |
| .rsrc abnormally large / high-entropy RT_RCDATA (Q) | Extract resource; FindResource chain + decrypt dump | `E-rsrc-payload` |
| DLL loaded only at runtime (R) | Check Delay Import; bp delay-load helper | `E-delay-import` |
| while+switch star-shaped CFG (H) | **See** `skill://re-reverse-engineering/references/ollvm-deobfuscation.md`; dynamic path if plugins fail | `E-cff` |
| Always-true / Always-false branches (S) | **See** ollvm / symbolic execution; dynamic ground truth prevails | `E-opaque-pred` |
| `/proc/self/status` TracerPid (L) | **Linux/ELF**; hook or patch; not mandatory for Windows main path | `E-anti-debug-tracerpid` |

**Constraints**: Record Evidence even if bypass fails; classifying "Anti-debug triggered exit" as "Sample is harmless" is FORBIDDEN. For full A–T and P2 (E compile timestamp, O junk code), see the anti-analysis cookbook section.

### 3.4 Non-PE / Multi-Format Side Channels (Issue #65 Patches U–AV · Routing)

Full index: `skill://re-reverse-engineering/references/nonpe-format-cookbook.md`. Only **Type → Entry** listed here; action details reside in cookbook / corresponding skill.

| Type | Jump | P0 Evidence Anchor (Example) |
|------|------|------------------------------|
| BAT/CMD | cookbook §1 + malware | `E-batch-deobf` |
| PowerShell | cookbook §2 + malware | `E-ps-decode-layer-N` |
| VBA Macro | cookbook §3 + malware | `E-vba-pcode` |
| Heavy JS Obfuscation / JSVMP | **js-reverse** + cookbook §4 | `E-js-vmp` / `E-js-deobf` |
| SYS Driver | kernel-driver-reverse + cookbook §5 | `E-driver-irp-handlers` / `E-driver-ioctl` |
| DLL Focus Areas | cookbook §6 (AM≡A–T **R**) | `E-dll-tls-dllmain` / `E-exports` |
| Android Device Wipe / Hidden Icon | **apk-reverse** + cookbook §7–8 | `E-android-wiper-*` / `E-android-hidden-icon-*` |

**Constraints**: Do not initiate a separate "Non-PE Six Phases"; maintain division of labor with §3.3 A–T (PE anti-debug vs. multi-format). Authorized lab; device wipe/BYOVD/reflective injection = detection and forensics terminology.

## 4. Synthesis (IOC / Attack Chain / Reporting)

### Decision quality overlay (Issue #77)

Before closing Synthesis, apply [analysis-decision-framework.md](skill://re-reverse-engineering/support/ops/analysis-decision-framework.md) **P0 checklist**: R41 grounded claims, R4* validated sufficiency, R1 confidence->dynamic, R2 hypothesis exit, R43 deadlock replan (under feasibility gate), R8/R23 no default malice/IOC. Multi-module -> R50; anti-analysis effort -> R51 + A-T cookbook.

Blindspots (Rust/Go/VMP/injection/OLE/PDF/agent-meta): [analysis-blindspot-cookbook.md](skill://re-reverse-engineering/support/ops/analysis-blindspot-cookbook.md) R52-R81 — detection-oriented; not a parallel master flow.

```text
□ Finding: Algorithm / Validation logic / Exploitable primitives / Behavioral conclusions
□ Path: callflow or solve steps mapped to E-*
□ IOC: Network artifacts + Host artifacts (Table if present; n/a + reason if absent)
□ Report docs-generator (malware/apt/null/vuln overlay selected per task) + Optional diagrams
□ Optional: YARA / Snort·Suricata rule formalization
□ field-journal sanitization
```

## 5. Six-Phase Practical Mapping (Issue #65 Mind Map → This Document)

| Practical Phase | Document Section | Hard Gate / Ironclad Rule |
|-----------------|------------------|---------------------------|
| 1 Initial Rapid Triage | §0–§1 Triage | Hash, architecture, file type, packer check; imports/equivalent anchors; §0.5 instruction latch |
| 2 Unpacking & IAT | §1.2 | IAT ironclad rule; failure/self-checksum crash → Evidence → Dynamic |
| 3 Basic Static Anchors | §2 Static | High-risk API combinations; timebox SHOULD |
| 4 Deep Cross-Verification | §3 Dynamic | Breakpoint Four-Stage Rocket; inactivity contingency; timebox; §3.3 A–T; §3.4 U–AV type routing |
| 5 IoC & Attack Chain Extraction | §4 Synthesis | IOC + Kill Chain / Path |
| 6 Archiving & Rule Generation | §4 + docs-generator / YARA | Structured reporting; rules optional |

## 6. Differences from "Stacking RE Skill Plugins"

- This package uses **phase gates + tool-index** and does not enable Hex-Rays "unsafe fully automated execution" style plugins by default  
- Dynamic instrumentation defaults to the **offline/lab** `network_profile`  
- IAT / Import Table: **Attempt + Record** takes priority over "infinite static brute-forcing" or "silent skipping"  
- User Instructions: **Goal-oriented + Prerequisite negotiation**; substituting designated steps with unrelated steps is prohibited