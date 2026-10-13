---
name: re-macos-reverse
description: macOS Mach-O reverse engineering, code signing analysis, and Objective-C runtime inspection.
domain: re
category: binary-analysis
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-macos-reverse/SKILL.md
---
# macOS / Mach-O Reverse Engineering

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://re-macos-reverse/support/field-journal/precedent-reverse.md`
2. `NOW`: Confirm target is macOS/Mach-O/App bundle (iOS IPA → `mobile-reverse/`)
3. `NEXT`: Consult tool-index; jtool2/lldb, etc.
4. `ACT`: Signature and loading information → Static analysis → Dynamic analysis (lldb/Frida)

## Applicable Scenarios

- Mach-O executables / dylibs / frameworks
- .app bundles, LaunchAgents / LaunchDaemons
- Objective-C / Swift symbols and runtime
- Notarization/signature, Hardened Runtime, and TCC-related behavior analysis
- macOS malware static/dynamic analysis (combined with malware-analysis)

## Workflow

### 1. Package Inspection and Signatures

```bash
file target
codesign -dv --verbose=4 target
spctl -a -vv target 2>&1
otool -L target
```

### 2. Static Analysis

```text
□ class-dump / swift-demangle / Hopper / Ghidra / IDA
□ Strings, XPC service names, and TCC-sensitive APIs
□ LC_LOAD_DYLIB dependencies and rpath
```

### 3. Dynamic Analysis

```text
□ lldb / Frida
□ Monitoring with fs_usage / log stream
□ Network: combined with protocol-reverse or proxies
```

## Toolchain

| Tool | Purpose |
|------|---------|
| otool / nm / codesign | System built-in |
| Hopper / Ghidra / IDA | Decompilation |
| class-dump / dsdump | ObjC |
| Frida / lldb | Dynamic analysis |
| jtool2 | Mach-O analysis |

## References

- `skill://re-macos-reverse/references/macho-triage.md`
- `../mobile-reverse/` (iOS) `../re-ghidra-reverse/` `../re-malware-analysis/`

## Routing Context

**Upstream**: MASTER R31  
**Downstream**: iOS → mobile-reverse; General samples → re-malware-analysis

## Task Completion Checklist

- [ ] Recorded signature and Hardened Runtime status?
- [ ] Reached address-level or symbol-level conclusions?
- [ ] Checklist completed?
