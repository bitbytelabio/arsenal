---
name: re-ghidra-reverse
description: Open-source reverse engineering and decompilation workflows with Ghidra GUI and headless modes.
domain: re
category: decompilation
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-ghidra-reverse/SKILL.md
---
# Ghidra Reverse Engineering

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://re-ghidra-reverse/support/field-journal/precedent-reverse.md`
2. `NOW`: Confirm **Ghidra** is needed (no IDA / open-source preference / batch headless)
3. `NEXT`: Read `tool-index` (workstation tool inventory) to check ghidra / ghidra-mcp paths
4. `NEXT`: Missing tool → bootstrap `ghidra-mcp` (if manifest supports it) or install Ghidra following manual steps
5. `ACT`: Import sample → run auto-analysis → export critical function decompilation

## Applicable Scenarios

- Primary reverse engineering entry point when lacking an IDA license
- Batch headless analysis / decompilation in CI
- Ghidra scripting (Java/Python Jython/PyGhidra) automation
- Interoperability with ghidriff for `binary-diff` / `patch-diff-exploit`

## Division of Responsibilities with IDA

| Requirement | Priority |
|------|------|
| Deep dive with existing IDA MCP | `re-ida-reverse/` |
| Open-source / Batch / Educational | **This skill** |
| CLI-only fast reconnaissance | `re-radare2/` |

## Workflow

### 1. Project & Auto-Analysis

```text
□ Create new Project → Import file → Analyze (default analyzers)
□ Record Language/compiler identification results and base address
□ Mark entry points, export tables, and string xrefs
```

### 2. Critical Functions

```text
□ Trace back from strings / imported APIs
□ Recover algorithms in the Decompile window
□ Rename functions/variables; add Plate comments
□ Hand over to Frida/GDB when dynamic analysis is required (reverse-engineering dynamic section)
```

### 3. Headless (Batch)

```bash
# Example: analyzeHeadless path varies by installation; MUST obtain from tool-index
analyzeHeadless /path/to/project Proj -import sample.bin -postScript ExportDecomp.py
```

### 4. MCP (If Configured)

```text
□ Confirm ghidra MCP port (commonly 8765, refer to tool-index)
□ Fetch decompilation / xrefs using MCP tools; do not guess ports
```

## Toolchain

| Tool | Purpose | Bootstrap |
|------|---------|-----------|
| Ghidra | Primary decompilation tool | Manual release / package manager |
| ghidra-mcp | AI bridge | Bootstrap capability name: `ghidra-mcp` |
| ghidriff | Patch diffing | See `re-patch-diff-exploit` |

## References

- `skill://re-ghidra-reverse/references/ghidra-cheatsheet.md`
- `../re-ida-reverse/` `../re-radare2/` `../re-binary-diff/`

## Routing Context

**Upstream**: MASTER R22  
**Downstream**: Dynamic verification → Frida/GDB; Exploitation → `re-pwn-chain`  
**Peer**: `re-ida-reverse` (commercial deep dive)

## Task Completion Self-Check

- [ ] Is it based on actual Ghidra/tool-index paths?
- [ ] Are function addresses and renames annotated?
- [ ] Are there reproducible steps?
- [ ] Checklist / journal completed?
