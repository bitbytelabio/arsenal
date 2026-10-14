---
name: arsenal-re-router
description: "Reverse engineering domain routing table for binary analysis, decompilation, exploitation, forensics, firmware, and cryptography."
domain: re
hide: false
license: MIT
---
# Arsenal Reverse Engineering Router

## Role & Guidance
Use for binary analysis, decompilation (IDA Pro, Ghidra, radare2, Binary Ninja), disassembly, protocol reverse engineering, patch differential analysis, and format string / buffer overflow exploit engineering.

## On-Demand Playbook Retrieval
Leaf playbooks are hidden from the base prompt. Use runtime tools:
- `skill_search(query: "ida decompilation", domain: "re")`
- `skill_route(hint: "ida decompilation", domain: "re")`
- `skill_load(name: "re-ida-reverse")`

## Declared Categories
- `decompilation` → `R1` (re-ida-reverse)
- `binary-analysis` → `R3` (re-radare2)
- `exploitation` → `R5` (re-pwn-chain)
- `forensics` → `R6` (re-performing-memory-forensics-with-volatility3)
- `firmware` → `R8` (re-auditing-uefi-firmware-with-chipsec)
- `cryptography` → `R9` (re-crypto-offensive-crypto-attacks)
