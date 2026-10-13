# Generic .NET Reverse Engineering Workflow

Complete workflow details, IL patch reliability, string decryptor extraction, state machine identification, and dnlib scripting.

## Complete Workflow (End-to-End)

```text
1. Identify  → Confirm it is a .NET managed binary (not native)
2. Detect    → DIE / de4dot --detect to identify the obfuscator
3. Deobf     → de4dot deobfuscation (preserve original sample)
4. Static    → dnSpyEx: browse C# view for orientation, IL view for critical logic
5. Dynamic   → dnSpyEx: debugger breakpoints at key methods to inspect runtime plaintext
6. Patch     → Edit via IL editor, Save Module
```

Artifacts from each step must be written to disk: Original sample `target.exe` → Unpacked `target-clean.exe` → Patched `target-patched.exe`.

## Reliability: IL Patch vs. C# Patch

**Core Conclusion: Use the IL Editor for critical modifications; avoid the C# Editor.**

| Dimension | C# Editor (Edit Method C#) | IL Editor (Edit IL) |
|-----------|---------------------------|---------------------|
| Compilation Failure Risk | High (missing references, syntax errors, lambda rewrite failures) | Near zero |
| Information Fidelity | Compiler regenerates IL, which may differ from the original IL | Direct replacement, instruction-by-instruction modification |
| Best Suited For | Changing a string, changing a constant, simple logic | Modifying branches, removing validation, altering control flow |
| async/await/State Machines | Often fails compilation or corrupts logic | Reliable direct modification of state machine fields |

The C# decompiler in dnSpyEx relies on read-only decompilation combined with attempted recompilation. Recompiling compiler-generated code (state machines, closures, `yield`) fails very easily. The IL editor operates instruction by instruction—what you see is what you get.

### Typical IL Patch Patterns

```text
Modify branch (if (check) → always true):
  Original: call bool Foo::Check()
            brfalse.s SKIP
  Modified: ldc.i4.1            ; push true
            brfalse.s SKIP      ; Now never jumps; SKIP will not execute
  Or more directly:
            ldc.i4.1
            ret                 ; Method returns true directly

Modify branch (if (check) → always false):
  ldc.i4.0
  ret

Remove entire validation block:
  Nop out all instructions, or replace with ret + valid return value

Modify string constant:
  Modifying strings via the C# editor is usually fine (ldstr swaps the token directly), but if the string is stored in resources/encrypted, modify the decryption logic instead

Modify numeric constant:
  Modify the operand of ldarg / ldc instructions directly
```

## State Machine Identification (async/await / yield)

C# `async/await` and `IEnumerator` yield compile into **state machines**: the compiler generates a nested class that uses a `state` field inside `MoveNext()` for switch dispatch. The dnSpyEx C# view reconstructs this as async, but decompilation may be distorted; inspecting `MoveNext` in the IL view provides the most accurate view.

```text
MoveNext structure for async/await:
  switch(this.<>1__state) {
    case 0: ... logic before await; this.<>1__state = 1; await MoveNext;
    case 1: ... logic after await;
  }

To patch async logic: Modify the state transitions inside MoveNext or the branch logic within a specific case.
Patching async via the C# editor almost always fails → IL must be used.
```

## String Decryptor Extraction

See `obfuscators.md` for details. Below is an example of batch string decryption via dnlib scripting:

```csharp
// dnlib script: Scans all string decryptor calls, resolves at runtime, and writes back
// Usage: dotnet script decrypt.csproj target.exe 0x06000012
using System;
using System.Reflection;
using dnlib.DotNet;
using dnlib.DotNet.Writer;
using dnlib.DotNet.Emit;

var module = ModuleDefMD.Load(args[0]);
var decryptorToken = uint.Parse(args[1], System.Globalization.NumberStyles.HexNumber);

// Locate decryptor method and invoke via reflection (assembly must be loaded into AppDomain)
// Traverse all methods and replace call Decryptor(token) with ldstr "decrypted_string"
foreach (var type in module.GetTypes())
    foreach (var method in type.Methods)
    {
        if (!method.HasBody) continue;
        var instrs = method.Body.Instructions;
        for (int i = 0; i < instrs.Count; i++)
        {
            // Identify call decryptor pattern, invoke decryptor to retrieve plaintext, replace with ldstr
            // (Boilerplate for reflection invocation omitted here. Core approach: load original assembly →
            //   MethodInfo.Invoke to obtain plaintext → instrs[i] = OpCodes.Ldstr + operand=plaintext)
        }
    }

var opts = new ModuleWriterOptions(module);
module.Write("target-decrypted.exe", opts);
```

dnlib is the de facto standard for .NET metadata programming and is used internally by de4dot. It is the preferred choice when writing custom deobfuscation scripts.

## Dynamic Debugging Key Points

The dnSpyEx debugger is significantly more user-friendly for .NET binaries compared to native applications:

- **Breakpoint at method entry**: Right-click method → Add Breakpoint
- **Inspect object values**: Once paused, inspect object fields and string contents directly in the Locals / Watch windows
- **Memory write**: Modify runtime variable values directly (Edit Value)
- **Exception breakpoints**: Debug → Exceptions, check the exception types to break on — obfuscators frequently use exception-driven control flow; breaking on exceptions reveals the real execution path

### Exception-Driven Control Flow

Some obfuscators place normal logic inside a `try` block and use `throw` + `catch` for branching. Statically, the IL looks like exception handling, but it is actually control flow:

```text
try { throw new CustomException(0x42); }
catch (CustomException e) {
    switch(e.Code) {
        case 0x42: real_logic_A; break;
        case 0x43: real_logic_B; break;
    }
}
```

Setting an exception breakpoint (breaking on `CustomException`) and tracing the flow of the `Code` value is much faster than analyzing the raw IL manually.

## Module Initializer (Module .cctor)

The static constructor of a `.NET` module (`.cctor` of `<module>`) executes first when the assembly is loaded. Obfuscators frequently place anti-tamper and decryption initialization here. Analysis order:

```text
1. Inspect <module>.cctor (Module .cctor) first — Decryption/anti-debugging initialization
2. Inspect Program.Main / Startup next
3. If anti-tamper is in .cctor → Patch .cctor before unpacking
```

## Generic Pattern for Extracting Config / C2 / Keys

Red team tools and loaders often embed encrypted configurations inside resources or fields and decrypt them at runtime:

```text
Locating workflow:
1. Run strings to check for plaintext URLs/IPs (usually absent after obfuscation)
2. Locate byte[] fields + decryption methods (AES/XOR)
3. Set a dynamic breakpoint at the return point of the decryption method; dump the decrypted plaintext
4. Common pattern: AES-256-CBC with Key==IV (Codegate 2013 pattern, see .NET section in reverse-engineering/tools.md)
```

Refer to `skill://re-dotnet-reverse/references/sharp-tools.md` for specific configuration structures of red team tools.

## Scope Boundaries with reverse-engineering

- **IL2CPP / NativeAOT** → Compiled to native code, lacks CLR metadata → Handled by `reverse-engineering/` (IDA/r2); this skill only performs identification
- **Managed .NET** (Standard C# exe/dll, Mono/Unity managed layer, Xamarin) → Handled by this skill
- **Mixed (Native loader + .NET payload)** → Loader component handled by `reverse-engineering/`; switch to this skill once the .NET payload is dumped

## Checklist of Disk Artifacts

Recommended outputs for every .NET reverse engineering task:
- `target-original.exe` (Original sample, unmodified)
- `target-clean.exe` (After de4dot unpacking)
- `analysis-notes.txt` (Identified obfuscator, decryptor tokens, key method addresses, configuration/C2/keys)
- `target-patched.exe` (After patching, if required)
- `il-diff.txt` (IL diff before and after patching, if patching was performed)