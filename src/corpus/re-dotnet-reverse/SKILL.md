---
name: re-dotnet-reverse
description: Reverse engineering workflows for managed .NET assemblies and C# NativeAOT binaries.
domain: re
category: binary-analysis
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-dotnet-reverse/SKILL.md
---
# .NET / C# Reverse Engineering Operational Specification

## ACTION REQUIRED (Execute Immediately After Reading)

1. `NOW`: Confirm the target is a managed .NET assembly using DIE / `file` / CLR headers (otherwise SWITCH to `re-ida-reverse/` / `re-reverse-engineering/`)
2. `NOW`: If obfuscation is suspected → Unpack first using `de4dot`, produce `*-clean.exe`, and preserve the original sample
3. `NEXT`: dnSpyEx (or dnSpy MCP / `ilspycmd`) static analysis: Browse C# + use **IL view** to inspect critical decision logic
4. `ACT`: Perform dynamic debugging when plaintext/C2 extraction is required; when modifying logic, prioritize **IL patching** over C# recompilation
5. Provide the user with a 3–6 item next-steps menu at the end of each phase (including report export)

## Scope of Application

Prioritize using this skill when the task falls into the following scenarios:

- Identifying and reverse engineering .NET / C# compiled artifacts (managed PE / .exe / .dll)
- Analyzing red team Sharp* Toolchains (Rubeus, SharpHound, SharpShell, etc.)
- Deobfuscating protectors like ConfuserEx / SmartAssembly / Babel / Eazfuscator / .NET Reactor
- Reverse engineering decryption and C2 logic in .NET loaders / info-stealers / RATs
- Patching C# applications (modifying checks, constants, keygens)
- Analyzing the Mono/Unity managed layer prior to IL2CPP (Note: IL2CPP-compiled binaries are native; route to `re-reverse-engineering/` + seed-014)

If the target is a purely native binary (compiled with C/C++/Go/Rust without CLR), switch to `re-reverse-engineering/`, `re-ida-reverse/`, or `re-radare2/`.

## Core Principles

- **Identify Before Acting**: Verify that the target is a .NET managed program (PE header CLR + `#~` / `#Strings` streams + mscoree `_CorExeMain`) before opting for dnSpy over IDA.
- **IL Precedes C#**: dnSpyEx's C# decompiler can lose or distort information (compiler-generated state machines, async/await, yield). Critical conditional checks and patches must be performed in the **IL editor**; the C# view is only for quick triage.
- **Run de4dot First**: When encountering obfuscators, perform an initial deobfuscation pass with `de4dot` before static analysis; otherwise, strings and control flow will remain entirely distorted.
- **MCP Integration**: If the dnSpy MCP (`dnspy_*` tools) is registered in the environment, prioritize the MCP interface for decompilation / IL inspection to avoid frequent GUI context switching.
- **Evidentiary Output**: Deobfuscated artifacts, extracted configurations/C2/keys, and patch diffs must be persisted to disk.

## Toolchain Mapping

| Capability | Preferred Choice | Notes |
|------------|------------------|-------|
| Decompilation + Debugging + Patching | **dnSpyEx** | Primary tool; the only GUI with an integrated IL editor. Legacy dnSpy is deprecated; use the Ex fork. |
| Lightweight CLI / Headless Decompilation | **ILSpy** (`ilspycmd`) | Suitable for batch processing, scripting, and Linux/macOS environments. |
| Deobfuscation | **de4dot** | Default solution for ConfuserEx family, SmartAssembly, and other mainstream protectors. |
| Obfuscator Identification | **Detect It Easy (DIE)** / **file** | Determine protector type before selecting de4dot parameters. |
| Programmatic IL Manipulation | **dnlib** | Write C# scripts for bulk metadata manipulation and string decrypters. |
| Direct AI Interaction | **dnSpy MCP** | Tool surfaces such as `dnspy_decompile` / `dnspy_inspect_il`. |

> Prerequisites: Install dnSpyEx + de4dot on Windows hosts (via choco or release archives); use `ilspycmd` + `dotnet runtime` on Linux/macOS. See the installation matrix in `skill://re-dotnet-reverse/references/sharp-tools.md` for details.

## Six-Stage Workflow

### 1. Identify (.NET Identification)

Verify that the target is a managed assembly and avoid analyzing native PEs as .NET:

```powershell
# Windows
file target.exe                       # "PE32 executable ... for MS Windows" is insufficient
# Key verification: Check for the presence of the CLR
powershell -c "[System.Reflection.AssemblyName]::GetAssemblyName('target.exe')"
# Or
Drag directly into dnSpyEx —— If it loads successfully, it is managed

# Generic
strings target.exe | grep -iE "mscoree|_CorExeMain|mscorlib|System\\."
```

**.NET Identification Signatures:**
- PE header `Data Directory[14]` (CLR Runtime Header) is non-zero
- Imports `mscoree.dll` / `_CorExeMain` entry point
- `#~`, `#Strings`, `#US`, `#GUID`, and `#Blob` metadata streams
- `mscorlib` / `System.Private.CoreLib` strings

**NativeAOT Exception:** Compiled to native binary without CLR headers, but contains `System.Private.CoreLib` strings and reconstructed type metadata — route these to `reverse-engineering/` (IDA/r2); this skill only provides identification alerts.

### 2. Detect (Obfuscator Detection)

```powershell
# Rapid identification via DIE
diec target.exe                        # Detect It Easy CLI
# Or drag into dnSpyEx to inspect for heavy class name mangling / control flow flattening
```

Common Obfuscators → Unpacking Strategies (see `skill://re-dotnet-reverse/references/obfuscators.md` for details):

| Obfuscator | Signatures | de4dot Handling |
|------------|------------|-----------------|
| ConfuserEx (1.0.0 / 2.x) | `<module>` anti-tamper, control flow flattening, string encryption | `de4dot target.exe` usually auto-identifies |
| SmartAssembly | `circular`/`string encoding`, resource compression | `de4dot target.exe` |
| Babel.NET | Method body encryption, control flow obfuscation | `de4dot target.exe` |
| Eazfuscator.NET | String / resource encryption | `de4dot`; certain versions require manual intervention |
| .NET Reactor | anti-tamper + necrobit | `de4dot`; newer versions may fail and require manual analysis |

### 3. Deobfuscate

```powershell
# de4dot auto-identifies most protectors by default
de4dot target.exe -o target-clean.exe

# Specify protector type (if auto-detection fails)
de4dot --type cfze target.exe          # ConfuserEx
de4dot --type sa target.exe            # SmartAssembly

# Multi-layered obfuscation / de4dot reports unknown
de4dot --detect target.exe             # Inspect what it recognizes
# May require patching anti-tamper before running de4dot (see skill://re-dotnet-reverse/references/obfuscators.md)
```

Output: `target-clean.exe` to be used for subsequent analysis. **Retain the original sample** for baseline comparison.

### 4. Static Analyze

Load the unpacked sample into dnSpyEx:

- **C# View**: Rapidly review class structures, method signatures, and strings (used for orientation).
- **IL View**: Critical checks, cryptographic routines, and state machines must be inspected in IL (Right-click → Edit IL or IL View).
- Locate entry points: `Main` / `Startup` / Module Initializer (`Module .cctor`).
- Locate key logic: Search for `flag`, `password`, `verify`, `check`, `encrypt`, `http`, `Config`.

```text
Locate string → Find cross-references → Trace calling method → Inspect decision logic in IL view
```

### 5. Dynamic (Dynamic Debugging)

dnSpyEx Debugger: Attach to process / Start debugging, set breakpoints at critical methods, and inspect runtime data:
- Decrypted plaintext strings (many obfuscators resolve strings strictly at runtime)
- C2 addresses and decrypted configuration objects
- Exception-driven control flow (anti-debugging routines frequently use `try/catch` to mask execution flow)

> .NET dynamic debugging is significantly more intuitive than native debugging — object instances and string buffers can be inspected directly. Prioritize dynamic analysis over prolonged static dead-ends.

### 6. Patch (Targeted Modifications)

```text
dnSpyEx → Right-click method → Edit Method (C#) or Edit IL
  - Modify check: ldc.i4.0 → ldc.i4.1 (false → true)
  - Modify constant: Directly edit string / numeric values
  - Strip validation: Replace target block with nop instructions
File → Save Module → Overwrite target file
```

**IL patching reliability > C# patching**: C# recompilation can fail due to missing references or syntax incompatibilities, whereas IL edits introduce minimal distortion. See `skill://re-dotnet-reverse/references/common-workflow.md` for details.

## Trigger Scenarios & Routing

Route to this skill when the user mentions:
- ".NET / C# binary reverse engineering" / "Decompile C# executable"
- "dnSpy analysis" / "dnSpyEx patch"
- "ConfuserEx / SmartAssembly / Babel deobfuscation / unpacking"
- "Sharp* tool analysis" (Rubeus / SharpHound / SharpShell)
- ".NET malware / loader / info-stealer reverse engineering"
- "C# application patch / keygen / logic bypass"

## Exit Routing

- IL2CPP-compiled Unity games → `re-reverse-engineering/` + `skill://re-dotnet-reverse/support/field-journal/seed-014_unity-il2cpp-reverse.md` (IL2CPP is native, bypass dnSpy)
- NativeAOT artifacts → `re-reverse-engineering/` (Native binary)
- Pure native PE (without CLR) → `re-reverse-engineering/` / `re-ida-reverse/`
- Bulk symbol/function porting between binary versions → `re-binary-diff/`
- Attack path modeling / call graph generation → `re-diagram-generator/`

## Routing Context

**Upstream Entry**: `skill://re-dotnet-reverse/support/SKILL.md` (Master Controller), `skill://re-dotnet-reverse/support/routing.md`
**Downstream Exit**:
- IL2CPP / NativeAOT (native) → `re-reverse-engineering/`
- In-depth native .so/.dll segment analysis → `re-ida-reverse/` / `re-radare2/`
- Direct AI control over dnSpy → Register and interface with dnSpy MCP (see `skill://re-dotnet-reverse/references/sharp-tools.md`)

**Related Sibling Modules**:
- `arsenal skill_load re-reverse-engineering/languages-compiled.md` (.NET introduction points to this module)
- `re-apk-reverse/` (Xamarin/MAUI Android reverse engineering can branch back here for C# layer analysis)

## Reference Documents

- [references/obfuscators.md](skill://re-dotnet-reverse/references/obfuscators.md) — ConfuserEx / SmartAssembly / Babel / Eazfuscator / .NET Reactor deobfuscation guide + anti-tamper bypasses
- [references/common-workflow.md](skill://re-dotnet-reverse/references/common-workflow.md) — Complete workflow, IL patch reliability, string decrypter extraction, state machine identification
- [references/sharp-tools.md](skill://re-dotnet-reverse/references/sharp-tools.md) — Red team Sharp* tool analysis, tool installation matrix, dnSpy MCP integration, community resource index

## Completion Checklist

- [ ] Has CLR / managed identity been confirmed (or has execution been SWITCHED out of this skill)?
- [ ] Were obfuscated samples unpacked using de4dot or equivalent tooling prior to deep analysis?
- [ ] Was critical logic validated via the IL view (rather than solely relying on C# decompilation)?
- [ ] Are artifacts (cleaned binaries / configurations / patch diffs) saved to disk and reproducible?
- [ ] Has a next-steps menu or report exit option been presented to the user?
