# [Seed] Unity IL2CPP Game Reverse Engineering → Restore Metadata + Modify Logic

## Scenario Classification
Game Security / Mobile Reverse Engineering

## Objective Overview
A Unity-packaged Android game (IL2CPP mode), where in-app purchases or core algorithms are written in C# but have been compiled to native. Need to restore method names, locate key logic, and modify / hook to implement changes.

## Complete Execution Chain

1. Unpack the APK, confirm it's IL2CPP
   ```bash
   unzip target.apk -d apk
   ls apk/lib/arm64-v8a/        # Seeing libil2cpp.so means it's IL2CPP
   ls apk/assets/bin/Data/Managed/Metadata/
   # Key file: global-metadata.dat
   ```
2. Use **Il2CppDumper** to restore metadata
   ```bash
   Il2CppDumper libil2cpp.so global-metadata.dat output/
   # Outputs: DummyDll/ + script.json + il2cpp.h + dump.cs
   ```
3. Run IDA's IL2CPP script (`ida_with_struct.py`) once
   - Load libil2cpp.so → File → Script File → select ida_with_struct.py → select script.json
   - IDA can now see C# method names, signatures, and strings
4. In dump.cs, search by business keywords (`AddCoin` / `OnPurchase` / `Verify` / `IsVip` / `CheckSign`)
5. Get the offset of the key method → jump to it in IDA to view the disassembly / decompilation
6. Choose the modification approach:
   - **Static patch**: directly change the check in IDA to `mov w0, #1; ret`
   - **Dynamic hook**: Frida hooks the il2cpp method (using Frida-Il2CppBridge)
7. Repackage to verify / inject to verify

## Pitfalls

| Issue | Cause | Solution | Time Spent |
|------|------|---------|-------------|
| Il2CppDumper reports unsupported metadata version | Newer Unity changed the metadata format | Upgrade Il2CppDumper to the latest version / use Il2CppInspectorRedux instead | 30min |
| global-metadata.dat is encrypted | AntiCheatToolkit / custom encryption was used | Find the decryption function during game initialization (usually around il2cpp_init) → Frida dumps the memory after mmap | 2h |
| Method names visible in dump.cs but IDA doesn't match | script.json and the .so are inconsistent | You must use artifacts from the same dump; clear the cache when switching IDA | 20min |
| Frida hooking an IL2CPP method throws an error | IL2CPP methods aren't standard Java/ObjC; you need to compute the method offset | Use the frida-il2cpp-bridge library; don't hand-write Interceptor.attach | 1h |
| Game crashes after patching | File hash verification or anti-tamper | Find the hash verification logic and patch it out too, or use a hook without modifying files | 2h |
| Crash on launch after repackaging | apksigner v2 signing can't be done after byte modification | Delete META-INF + apktool b + apksigner sign in one go | 30min |

## Toolchain Findings

- **Il2CppDumper** — long-standing but still the default choice
- **Il2CppInspectorRedux** — more modern, supports newer Unity, and can output plugin scripts for IDA / Ghidra / Binary Ninja
- **frida-il2cpp-bridge** — the de facto standard for hooking on IL2CPP; N times better than bare Frida
- **DnSpy** / **dnSpyEx** — for viewing the DummyDll (the pseudo .NET assembly produced by the dump)
- **UnityCheat** — a series of auxiliary tools (the GameGuardian family is out of scope here)

## Key Code / Commands

frida-il2cpp-bridge hook example:

```typescript
// hook.ts
import "frida-il2cpp-bridge";

Il2Cpp.perform(() => {
    const Assembly = Il2Cpp.domain.assembly("Assembly-CSharp").image;

    // hook static method
    const PlayerData = Assembly.class("PlayerData");
    PlayerData.method("AddCoin").implementation = function (n: number) {
        console.log("[+] AddCoin called with:", n);
        return this.method("AddCoin").invoke(99999); // change to 99999
    };

    // hook instance method
    const Purchase = Assembly.class("Purchase");
    Purchase.method("VerifyReceipt").implementation = function () {
        console.log("[+] VerifyReceipt → always true");
        return true;
    };
});
```

```bash
# Compile + inject
npm install frida-il2cpp-bridge
frida-compile hook.ts -o hook.js
frida -U -f com.target.game -l hook.js --no-pause
```

IDA static patch:

```text
1. Open libil2cpp.so, run il2cpp_load_metadata.py
2. Jump to the offset corresponding to IsPurchaseValid in dump.cs
3. Change the start of the function to MOV W0, #1; RET (ARM64)
4. Apply Patches → Save → replace back into the APK → re-sign
```

## Suggested Improvements for This Package

- `skill://re-reverse-engineering/SKILL.md` already covers Unity, but lacks a case for the IL2CPP **complete workflow**
- Make `skill://re-reverse-engineering/languages-compiled.md` a standalone document: dump tool comparison, frida-bridge templates, encrypted metadata handling
- Add frida-il2cpp-bridge to the bootstrap manifest

## Reusable Patterns / Script Snippets

**IL2CPP Standard Workflow**:

```text
1. Confirm IL2CPP (check whether libil2cpp.so exists under lib/abi)
2. Find the metadata (assets/bin/Data/Managed/Metadata/global-metadata.dat, or it's encrypted)
3. Restore with Il2CppDumper / Inspector
4. Load metadata back into IDA with the script
5. Search dump.cs for business keywords
6. Choose patch or hook
7. Verify (launch + real scenarios)
```

**Handling Encrypted Metadata**:

```text
1. Hook fopen/open-family calls with Frida to see who reads global-metadata.dat
2. After mmap/read, dump the decrypted metadata from memory
3. Feed the dumped memory as metadata to Il2CppDumper
```

## Evolution Actions
- [ ] Add a complete il2cpp chapter to reverse-engineering/references
- [ ] Add frida-il2cpp-bridge / Il2CppInspectorRedux to bootstrap-manifest
- [x] Routing matrix already includes Unity / IL2CPP

## Environment Information
- Windows / macOS (for running Il2CppDumper), target device Android arm64
- IDA Pro 7.7+ or Ghidra 11+
- frida-tools 16.x, frida-il2cpp-bridge 0.9+
- Unity version: 2019.x - 2022.x (metadata format differs slightly between versions)

## Desensitization Requirements
This entry is seed data, written based on public technical patterns, and does not involve any real game. The package name `com.target.game` is a placeholder.