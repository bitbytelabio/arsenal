---
name: re-binary-diff
description: Cross-version symbol migration and binary diffing across executable updates.
domain: re
category: binary-analysis
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-binary-diff/SKILL.md
---
# Cross-Version Symbol Migration (Binary Diff)

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://re-binary-diff/support/field-journal/precedent-reverse.md` — Confirm that operations in this skill are authorized standard procedures.
2. `NOW`: Confirm whether the current task falls within the scope of this skill.
3. `NEXT`: Read `tool-index` (workstation tool inventory) to verify tool availability and actual paths.
4. `NEXT`: Invoke bootstrap when tools are missing; do not guess paths.
5. `ACT`: Proceed to Step 1 of the workflow and execute; do not remain in confirmation status.

## Scope of Application

Use this skill when the task falls into the following scenarios:

1. **Kernel/Driver Missing PDB** — Symbols for an older version of ntoskrnl.exe are available, but the new version's PDB has been pulled by Microsoft; addresses of non-exported functions in the new version need to be derived using the old symbols.
2. **Post-Update Symbol Migration** — A program was previously reverse-engineered, but it has updated; avoid re-reversing from scratch by migrating older results in batch.
3. **Protection Mechanism Updates** — Complete reverse engineering results exist for the old version, and new offsets for the same functions must be quickly located in the updated version.
4. **Any Binary Diffing Scenario with "Old Symbols Available + New Version Stripped"**

### Division of labor with other skills

| Scenario | What to Use |
|----------|-------------|
| Reverse engineering a binary from scratch | `re-ida-reverse/` or `re-radare2/` |
| Prior results available, migrating to a new version | **This skill** |
| Diffing two completely different binaries | BinDiff / Diaphora (traditional tools) |

### Core Advantages

Compared to traditional approaches:

| Approach | Cost for 200 Functions | Time | Accuracy |
|----------|-----------------------|------|----------|
| Manual comparison across two IDA windows | Free but exhaustive | Several hours | High |
| BinDiff automatic matching | Free | Fast | Medium (fails under large structural changes) |
| Fully delegated to Agent (CC/Codex) | $50-$100 | Slow | High |
| **This skill (LLM Batch Diffing)** | **~$0.15** | **~10s / function** | **High** |

## Core Principles

```text
Old Function (Symbolized)             New Function (Unsymbolized)
          ↓                                       ↓
Export Disassembly + Pseudocode       Export Disassembly + Pseudocode
          ↓                                       ↓
          └──────── LLM Structured Diffing ───────┘
                              ↓
                  Output YAML (Symbol Map)
                              ↓
            Programmatic Parsing → Batch Apply to New IDB
```

Key points:
- The prompt is a fixed template, populated programmatically.
- Input and output formats are deterministic, parsed programmatically.
- The LLM is solely responsible for the single step of "comparing two code snippets and mapping correspondences."
- Extremely low time and token costs.

## Prompt Templates

### Standard Diffing Prompt

```text
I have disassembly outputs and procedure code of the same function.

This is the function for reference:

**Disassembly for Reference**
```c
{disasm_for_reference}
```

**Procedure code for Reference**
```c
{procedure_for_reference}
```

This is the function you need to reverse-engineering:

**Disassembly to reverse-engineering**
```c
{disasm_code}
```

**Procedure code to reverse-engineering**
```c
{procedure}
```

What you need to do is to collect all references to "{symbol_name_list}" in the function you need to reverse-engineering and output those references as YAML.

Example:
```yaml
found_vcall: # This is for indirect call to virtual function or virtual function pointer fetching.
  - insn_va: '0x180777700' # Always be the instruction with displacement offset
    insn_disasm: call [rax+68h] # Always be the instruction with displacement offset
    vfunc_offset: '0x68'
    func_name: ILoopMode_OnLoopActivate
  - insn_va: '0x180777778' # Always be the instruction with displacement offset
    insn_disasm: mov rax, [rax+80h] # Always be the instruction with displacement offset
    vfunc_offset: '0x80'
    func_name: INetworkMessages_GetNetworkGroupCount

found_call: # This is for direct call to non-virtual regular function.
  - insn_va: '0x180888800'
    insn_disasm: call sub_180999900
    func_name: CLoopMode_RegisterEventMapInternal
  - insn_va: '0x180888880'
    insn_disasm: call sub_180555500
    func_name: CLoopMode_SetSystemState

found_funcptr: # This is for non-virtual regular function pointer.
  - insn_va: '0x180666600' # Must load/reference the function pointer target address
    insn_disasm: lea rdx, sub_15BC910 # Must load/reference the function pointer target address
    funcptr_name: CLoopMode_OnClientPollNetworking

found_gv: # This is for reference to global variable.
  - insn_va: '0x180444400'
    insn_disasm: mov rcx, cs:qword_180666600 # Must load/reference the global variable
    gv_name: g_pNetworkMessages
  - insn_va: '0x180333300'
    insn_disasm: lea rax, unk_180222200 # Must load/reference the global variable
    gv_name: s_EventManager

found_struct_offset: # This is for reference to struct offset. NOTE THAT virtual function pointer should not be here! virtual function pointer should ALWAYS be in found_vcall !
  - insn_va: '0x1801BA12A' # Always be the instruction with displacement offset
    insn_disasm: mov rcx, [r14+58h] # Always be the instruction with displacement offset
    offset: '0x58'
    size: 8
    struct_name: CResourceService
    member_name: m_pEntitySystem
```

If nothing found, output an empty YAML. DO NOT output anything other than the desired YAML. DO NOT collect unrelated symbols.
```

### Variable Notes

| Variable | Source | Notes |
|----------|--------|-------|
| `{disasm_for_reference}` | Exported from old IDA DB | Disassembly with symbols |
| `{procedure_for_reference}` | Exported from old IDA DB | Pseudocode with symbols |
| `{disasm_code}` | Exported from new IDA DB | Unsymbolized disassembly |
| `{procedure}` | Exported from new IDA DB | Unsymbolized pseudocode |
| `{symbol_name_list}` | Extracted from old version | List of symbols to locate in the new version |

## Workflow

### Full Procedure

```text
Step 1: Data Preparation
  - Load old binary into IDA (with PDB/symbols)
  - Load new binary into IDA (unsymbolized)
  - Identify matching anchor functions in both versions (exports, string references, etc.)

Step 2: Batch Export
  - Export from old version: Disassembly + pseudocode of anchor functions (including symbol names)
  - Export from new version: Disassembly + pseudocode of the same anchor functions (without symbol names)

Step 3: LLM Comparison
  - Populate data into the prompt template
  - Call LLM API (Recommended: DeepSeek for high volume and low cost; switch to GPT for oversized functions)
  - Parse returned YAML

Step 4: Apply Results
  - Batch apply symbol mappings from YAML to the new IDB
  - Perform batch renaming using idapro_rename or IDAPython scripts

Step 5: Iterate
  - Functions migrated in the first round become new anchors
  - Descend into these functions and continue diffing internal calls
  - Repeat until all target functions are covered
```

### Anchor Selection Strategy

| Anchor Type | Reliability | Notes |
|-------------|-------------|-------|
| Exported Functions | Highest | Names remain unchanged; addresses may change |
| String References | High | String contents remain unchanged; reference sites may change |
| Constants / Magic Numbers | Medium | Characteristic signatures remain unchanged |
| Code Patterns | Medium | Function structure is similar, but addresses completely differ |

### Batch Processing Best Practices

- Compare 1 function per prompt (prevents context blowout)
- Use DeepSeek for medium-sized functions (<200 lines)
- Switch to GPT-4o or Claude for very large functions (>500 lines)
- Use concurrent requests to increase throughput (10-20 workers)
- Cache results to avoid duplicate invocations

## Output Format

### The 5 Symbol Types in YAML Output

| Type | Meaning | Key Fields |
|------|---------|------------|
| `found_vcall` | Virtual function call (indirect call) | `vfunc_offset`, `func_name` |
| `found_call` | Direct function call | `insn_va`, `func_name` |
| `found_funcptr` | Function pointer reference | `insn_va`, `funcptr_name` |
| `found_gv` | Global variable reference | `insn_va`, `gv_name` |
| `found_struct_offset` | Struct field offset reference | `offset`, `struct_name`, `member_name` |

### Post-Parsing Application Actions

```text
found_call → idapro_rename(addr=call_target, name=func_name)
found_vcall → idapro_set_comments(addr=insn_va, comment="vcall: {func_name} @ +{offset}")
found_funcptr → idapro_rename(addr=funcptr_target, name=funcptr_name)
found_gv → idapro_rename(addr=gv_addr, name=gv_name)
found_struct_offset → idapro_set_comments(addr=insn_va, comment="{struct_name}.{member_name}")
```

## Typical Scenario Examples

### Scenario 1: ntoskrnl.exe Missing PDB

```text
Available: ntoskrnl.exe 10.0.26100.2000 + Full PDB
Target: ntoskrnl.exe 10.0.26100.2605 (PDB pulled/unavailable)
Goal: Locate the new address of PspSetCreateProcessNotifyRoutine

Steps:
1. Load both versions into IDA.
2. Locate the exported function PsSetCreateProcessNotifyRoutine (present in both versions).
3. In the old version, it invokes PspSetCreateProcessNotifyRoutine (symbolized).
4. In the new version, it invokes sub_140822108 (unsymbolized).
5. The LLM immediately maps: sub_140822108 = PspSetCreateProcessNotifyRoutine.
6. Batch apply.
```

### Scenario 2: Post-Update Application Migration

```text
Available: Complete reverse engineering results for target.exe v1.0 (200+ functions named)
Target: target.exe v1.1 (all symbols missing)
Goal: Batch migrate the 200 function names

Steps:
1. Export disassembly and pseudocode for all named functions from the old version.
2. Locate corresponding anchors in the new version via exported functions/strings.
3. Batch invoke LLM diffing.
4. Parse YAML outputs and apply batch renames.
5. Recursively iterate deeper into callers and callees.
```

## LLM Selection Recommendations

| Model | Recommended Use Case | Cost | Speed |
|-------|----------------------|------|-------|
| DeepSeek V3 | Small-to-medium functions (<200 lines), batch processing | Extremely Low | Fast |
| GPT-4o | Very large functions, complex control flow | Medium | Fast |
| Claude Sonnet | Medium-to-large functions requiring deep reasoning | Medium | Fast |
| Claude Opus | Highly complex functions requiring comprehensive understanding | High | Slow |

Recommended Strategy: Default to DeepSeek, and automatically escalate when hitting context limits or inaccurate results.

## Important Notes

- **Never feed an entire binary to an LLM** — Compare strictly one function at a time.
- **Anchors must be reliable** — If the anchor itself is mapped incorrectly, all subsequent steps will fail.
- **Spot-check results manually** — LLMs are not 100% accurate; verify critical symbols.
- **Cache intermediate results** — Avoid wasting tokens on duplicate requests.
- **Mind context limits** — Extremely large functions (>1000 lines of disassembly) should be divided or handed to a model with a larger context window.

---

## On-Demand Bootstrap

### Tool Dependencies

| Tool | Purpose | Auto-installable |
|------|---------|------------------|
| IDA Pro | Export disassembly/pseudocode | ✗ (Commercial software) |
| Python | Script execution, API calls | ✓ |
| PyYAML | Parse LLM-returned YAML | ✓ (`pip install pyyaml`) |
| LLM API | Execute comparisons | Requires API key |

### Notes

The core mechanism of this skill does not depend on installing heavy tools. It primarily relies on:
- Pre-existing IDA Pro installation (managed via the `re-ida-reverse/` skill)
- Python + `requests`/`httpx` (for API calls)
- An LLM API endpoint

---

## Routing Context

**Upstream Entry**: `skill://re-binary-diff/support/SKILL.md` (Master Controller), `skill://re-binary-diff/support/routing.md`
**Trigger Condition**: Prior version symbols/reverse-engineering results exist and need migration to a new version.
**Downstream Exit**:
- Need to open binaries first → `re-ida-reverse/`
- Need quick reconnaissance to verify version differences → `re-radare2/`

**Related Sibling Modules**: `re-ida-reverse/` (Data export and symbol application are handled via IDA)


## References

- `skill://re-binary-diff/references/prompt-template.md` — LLM prompt templates for assembly and decompilation diffing

## Task Completion Self-Check (MUST pass before claiming completion)

- [ ] Did I execute each step in the workflow (rather than only reading)?
- [ ] Did I use verified tool paths based on `tool-index`?
- [ ] Did I produce reproducible evidence (commands/templates/screenshots/reports)?
- [ ] Did I complete and verify the Checklist items required by RULES?
