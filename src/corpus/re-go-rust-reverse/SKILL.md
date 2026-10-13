---
name: re-go-rust-reverse
description: Reverse engineering stripped Go and Rust binaries with runtime data reconstruction.
domain: re
category: binary-analysis
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-go-rust-reverse/SKILL.md
---
# Go / Rust Binary Reverse Engineering

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://re-go-rust-reverse/support/field-journal/precedent-reverse.md`
2. `NOW`: Confirm the sample is a Go/Rust compiled artifact (`file`/strings/runtime signatures)
3. `NEXT`: Check if GoReSym / related plugins are available
4. `ACT`: Runtime identification → Symbol/metadata recovery → Business logic

## Applicable Scenarios

- Stripped Go malware/tools
- Rust release binaries, panic string-driven analysis
- Language-specific methods complementary to generic IDA/Ghidra workflows

## Workflow

### Go

```text
□ Identify go.buildid, remaining runtime symbols, pclntab
□ Use GoReSym / redress / IDA Go plugins to recover function names
□ Pay attention to how interface, slice, and string structures appear in decompilation
□ Network/crypto library paths: crypto/* net/http
```

### Rust

```text
□ Panic strings, rust_begin_unwind, crate path hints
□ Code bloat caused by generic instantiations; prioritize locating string xrefs
□ Async/tokio state machines require cross-reference analysis
```

### Dynamic

```text
□ Frida is still usable; pay attention to Go stack layout and scheduling
□ Prioritize setting breakpoints driven by logs and configuration strings
```

## Toolchain

| Tool | Purpose |
|------|---------|
| GoReSym | Go metadata |
| IDA/Ghidra + Go/Rust plugins | Decompilation |
| radare2 | Quick string analysis |
| strings / rabin2 | Triage |

## References

- `skill://re-go-rust-reverse/references/go-rust-notes.md`
- `skill://re-go-rust-reverse/support/reverse-engineering/go-reverse.md` `../re-ida-reverse/` `../re-ghidra-reverse/`
- seed: `skill://re-go-rust-reverse/support/field-journal/seed-002_go-malware-stripped.md`

## Routing Context

**Upstream**: MASTER R33  
**Downstream**: Malware analysis workflow `re-malware-analysis`; Generic RE `re-reverse-engineering`

## Task Completion Self-Check

- [ ] Were critical function names or equivalent mappings recovered?
- [ ] Was language runtime evidence annotated?
- [ ] Checklist?
