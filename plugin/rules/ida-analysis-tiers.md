---
name: ida-analysis-tiers
description: Enforce tiered reverse-engineering discipline (Tier 1 Triage, Tier 2 Verify, Tier 3 Auditor) for IDA Pro and idalib (xd://ida).
---

# IDA Pro & idalib Analysis Tiers

Apply this rule whenever inspecting, decompiling, or scripting compiled binaries (ELF, PE, Mach-O, firmware images, shared libraries) using IDA Pro, `idalib`, or the `xd://ida` native device.

## Operating Principles

- **Isolated State**: Target binaries are immutable. All reverse-engineering annotations, function boundaries, and type definitions are stored exclusively in the session IDB database under `~/.omp/agent/idbs/<sha16>-<name>/`.
- **Epistemic Discipline**: Distinguish direct disassembly/pseudocode observations (`E-*`) from analyst hypotheses (`P-*`). Never assert vulnerability, malicious intent, or algorithmic function from symbol names or import presence alone.
- **Worker Resource Budget**: Respect host worker constraints (`ida.maxOpen` $\le 4$, idle cleanup `ida.idleCloseSec` = 900s). Save changes with `ida(action: "save")` before yielding or switching targets.

---

## Tier 1 — Triage & Surface Recon (Scout)

**Goal**: Rapid orientation, binary architecture identification, entry points, and initial surface mapping without prolonged worker locks.

### Methods & Tools
- Binary headers, architecture, and sections: `read <bin>`
- Exported and imported symbols: `read <bin>:exports`, `read <bin>:imports`
- String literals and patterns: `read <bin>:strings` or `ida(action: "exec", code: "strings('pattern')")`
- Database discovery and active workers: `ida(action: "list")`

### Rules & Constraints
- **Bounded Queries**: Do not dump entire string or function tables into context. Always filter strings and symbols with case-insensitive regex patterns (`strings(pattern)`, `functions(pattern)`).
- **Provisional Scope**: All findings in Tier 1 are provisional (`P-*`). Do not make negative or exhaustive claims (e.g. "binary has no encryption" merely because standard crypto APIs are not in imports).
- **No Long-Lived Locks**: Do not keep idle IDA workers active during non-reverse-engineering tasks.

---

## Tier 2 — Targeted Decompilation & Structuring (Verify — Default)

**Goal**: Function-level decompilation, control flow analysis, parameter recovery, and data-flow tracing from sources to sinks.

### Methods & Tools
- Decompiled C pseudocode: `read <bin>:<func|0xaddr>` or `ida(action: "exec", code: "pseudocode('sub_...')")`
- Assembly instruction review: `read <bin>:<func>:asm` or `ida(action: "exec", code: "asm('sub_...')")`
- Reference & call tracing: `xrefs_to(t)`, `xrefs_from(t)`, `callers(t)`, `callees(t)`
- Persistent semantic updates:
  - Rename subroutines and globals: `ida(action: "rename", target: "sub_140001000", name: "crypto_init")`
  - Apply C function declarations and type signatures: `ida(action: "set_type", target: "crypto_init", decl: "int __fastcall crypto_init(uint8_t *key, size_t len)")`
  - Add structured comments: `ida(action: "comment", target: "0x140001050", text: "AES-256-GCM S-box setup")`
  - Define function boundaries on unresolved code: `ida(action: "make_function", target: "0x140001200")`

### Rules & Constraints
- **Address Anchoring**: Anchor every observation to an exact hexadecimal virtual address (`0x...`) or verified mangled/demangled symbol.
- **Decompiler Verification**: If pseudocode is ambiguous or optimizer artifacts obscure semantics, cross-reference against assembly (`:<func>:asm` or `asm(t)`).
- **Persistent Save**: Always issue `ida(action: "save", db: "<bin>")` after renaming, commenting, or setting types to ensure durability across compaction and session handoffs.

---

## Tier 3 — Headless Scripting & Daemon Automation (Auditor)

**Goal**: Automated unpacking, custom struct reconstruction, batch deobfuscation, algorithmic analysis, and deep coverage auditing.

### Methods & Tools
- Headless Python execution via `idalib` worker: `ida(action: "exec", db: "<bin>", code: "...")`
- Built-in worker helpers: `resolve(t)`, `func(t)`, `name_of(ea)`, `hexdump(t, size=64)`, `read_bytes(t, size)`
- IDAPython standard libraries: `idapro`, `ida_domain`, `ida_bytes`, `ida_funcs`, `ida_name`, `ida_typeinf`, `idautils`
- Multi-architecture universal slices: address slice explicitly as `<bin>:@<arch>` (e.g. `bin:@arm64`)
- Remote debugging bridges (when configured): `remoteDebug` guest execution (`ubuntu`, `winbase`, `macos` stubs via `dbgsrv`). Multi-guest definitions reside in user-owned `config.yml`/`config.yaml`; `IDA_DIR`, `IDA_INSTALL_DIR`, and `IDA_PYTHON` in `.env` serve only as optional local path overrides.

### Rules & Constraints
- **Worker Daemon Lifecycle**:
  - Maximum 4 concurrent databases (`ida.maxOpen`). Opening a 5th database automatically saves and closes the least recently used idle worker.
  - Idle timeout: Workers idle for 15 minutes (`ida.idleCloseSec = 900`) automatically save and terminate.
  - Close completed targets: Issue `ida(action: "close", db: "<bin>", save: true)` when finishing batch operations to free worker slots.
- **Execution Deadlines**: Script execution in worker has a default deadline of 120 seconds. Avoid blocking network calls, infinite while loops, or unbounded scans.
- **Deterministic Repetition**: Save custom unpacker or extraction scripts to reproducibility receipts or evidence artifacts rather than running transient, unrecorded ad-hoc snippets.
