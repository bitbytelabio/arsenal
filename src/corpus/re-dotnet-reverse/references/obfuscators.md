# In-Depth Guide to .NET Obfuscator Deobfuscation

Identification, unpacking, and anti-tamper bypassing for mainstream .NET obfuscators. Core tools: **de4dot** (automatic detection of most packers) + **dnSpyEx** (manual patching) + **dnlib** (scripting).

## Master Decision Table

| Obfuscator | de4dot type | Typical Characteristics | Automated Unpacking | Manual Key Points |
|---|---|---|---|---|
| ConfuserEx 1.x/2.x | `cfze` | Anti-tamper, control flow flattening, string encryption, anti-debugging | ✅ Mostly automated | Newer versions require patching anti-tamper first |
| ConfuserEx 3.x / Modified | `cfze` | Same as above + custom protectors | ⚠️ Partial | Dump runtime / dnlib |
| SmartAssembly | `sa` | String encoding, resource compression, dynamic method invocation | ✅ Automated | Resource decompression |
| Babel.NET | `babel` | Method body encryption, control flow, strings | ✅ Automated | — |
| Eazfuscator.NET | `eaz` | String/resource encryption, expression obfuscation | ⚠️ Partial | String decrypter extraction |
| .NET Reactor | `reactor` | NecroBit (method body encryption) + anti-tamper | ⚠️ Difficult on newer versions | Dump + rebuild metadata |
| Themida .NET | — | Native wrapper + virtualization | ❌ de4dot unsupported | Dump memory, use native reversing methodologies |
| Agile.NET / CliSecure | `agile` | Method body encryption | ✅ Automated | — |

## Standard de4dot Usage

```powershell
# Automatic identification (sufficient for most scenarios)
de4dot target.exe -o target-clean.exe

# Explicitly specify type (when automatic identification fails)
de4dot --type cfze target.exe -o target-clean.exe

# Detect packer type first
de4dot --detect target.exe

# Batch processing
de4dot *.exe

# Decrypt strings only, preserve control flow (minimal intervention)
de4dot --strtyp delegate --strtok METHOD_TOKEN target.exe
```

The `--strtyp` / `--strtok` mode in de4dot: only resolves string decrypters (via specified decryption method token) while preserving original control flow. Useful when only plaintext strings are needed without triggering anti-tamper mechanisms.

---

## ConfuserEx (Most Common)

### Characteristic Identification

- Entry module `<Module>` class contains anti-tamper checks marked with `[MethodImpl(NoInlining)]`
- High volume of string decrypter calls utilizing `Dictionary<string, T>`
- Control flow flattening (switch dispatch + state variable pattern)
- Embedded `.cmp` compressed resources
- dnSpyEx C# view displays obfuscated class/method names (`\uXXXX` or non-printable characters) with method bodies filled with `int num = ...; switch(num)` structures

### Unpacking Workflow

```powershell
# 1. Standard unpacking
de4dot target.exe -o target-clean.exe

# 2. If de4dot reports "unknown" or the unpacked binary fails to execute -> newer/custom ConfuserEx build
#    Verify anti-tamper mechanisms first:
Open in dnSpyEx -> Check Module .cctor or Main entry point for integrity validation
```

### Anti-Tamper Bypass (Common in Newer ConfuserEx Builds)

ConfuserEx `anti tamper` validates method body hashes at runtime; modifications result in application termination. Older versions are handled automatically by de4dot; newer versions require manual remediation:

```text
Method A — Direct validation patching via dnSpyEx:
  1. Locate the anti-tamper validation method (typically invoked inside the static constructor of <Module>)
  2. Edit IL: replace the validation method body with `ret` (immediate return)
  3. Save module -> Pass the modified binary to de4dot

Method B — Runtime memory dumping:
  1. Execute the binary and dump the in-memory assembly using MegaDumper or ExtremeDumper
  2. The dumped assembly is already decrypted; clean remaining obfuscation layers using de4dot
```

### Control Flow Recovery

de4dot reconstructs flattened switch dispatches back to standard `if` / `while` control structures. If residual state machines remain, execute de4dot a second time or analyze the remaining IL instructions manually.

---

## SmartAssembly

```powershell
de4dot --type sa target.exe -o target-clean.exe
```

Characteristics:
- Strings encoded via `SmartAssembly.Runtime.Strong` classes
- Resource compression (`{assembly}.Resources`)
- Method call proxying (`ProcessCaller` / indirect invocations)

SmartAssembly exhibits the highest compatibility with de4dot and is generally resolved automatically.

---

## .NET Reactor (NecroBit)

The **NecroBit** protection in `.NET Reactor` encrypts real method bodies into embedded resources, decrypting and injecting them at runtime while leaving empty method bodies in the compiled binary. de4dot resolves older versions reliably, but frequently fails against modern versions (4.x+).

```text
When de4dot fails:
1. Execute the target (via dotnet target.exe or direct execution)
2. Dump process memory via MegaDumper / ExtremeDumper -> export decrypted assembly
3. Use de4dot to strip remaining obfuscation layers from the dumped artifact
4. If metadata tables are corrupted, rebuild them using dnlib (refer to common-workflow.md)
```

---

## Manual String Decrypter Extraction

When obfuscators encrypt string literals and decrypt them dynamically at runtime, de4dot usually automates extraction. If automated discovery fails, proceed manually:

```text
1. Locate the decryption routine in dnSpyEx (typically consistent signatures: static string Decrypt(int) or Decrypt(string, int))
   - Characteristics: High cross-reference count, numeric constant parameters, returns string
2. Record the method token (e.g., 0x06000012)
3. Pass the decrypter explicitly to de4dot:
   de4dot --strtyp delegate --strtok 0x06000012 target.exe -o target-clean.exe
```

If the decryption method itself is obfuscated with control flow flattening, flatten the control flow prior to isolating the method token.

## Common Anti-Debug Techniques

| Technique | Location | Bypass |
|---|---|---|
| `Debugger.IsAttached` check | Arbitrary methods | Patch IL to `ldc.i4.0; ret` or patch property getter |
| `Debugger.IsLogging` check | — | Same as above |
| Timing checks (`DateTime.Now` delta) | Method entry | Patch out conditional delta evaluation |
| `CheckRemoteDebuggerPresent` P/Invoke | — | Replace call instruction with `nop` |
| Exception-driven control flow (`try`/`catch` branching) | Core logic | Analyze target catch blocks directly; do not blindly `nop` |

> .NET anti-debug implementations are generally simpler to bypass than native counterparts, as most rely on managed API calls that can be patched with single-line IL modifications in dnSpyEx.

## Fallback Strategies When de4dot Fails

1. **`de4dot --detect`**: Analyze detection output against the master decision table.
2. **Runtime Memory Dumping**: Extract loaded modules via MegaDumper, ExtremeDumper, or Process Hacker.
3. **dnlib Scripting**: Write custom deobfuscation passes (refer to the dnlib section in `common-workflow.md`).
4. **Dynamic Analysis**: Set breakpoints on decryption methods during execution to inspect plaintext values in memory directly without full unpacking.

Community references: Washi's blog post *"misconceptions-about-dotnet"* (common pitfalls in IL analysis), Kanxue .NET Reverse Engineering section, Guided Hacking *"Top 5 .NET RE Tools"*.