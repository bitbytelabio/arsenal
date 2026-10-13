---
name: re-radare2
description: Binary analysis and disassembly workflows using radare2 command-line tooling.
domain: re
category: decompilation
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-radare2/SKILL.md
---
# radare2

Binary analysis skill oriented toward the `radare2` CLI. The focus is performing reconnaissance, analysis, localization, extraction, and lightweight modifications directly from the command line without depending on a GUI.

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://re-radare2/support/field-journal/precedent-reverse.md` — Confirm that operations in this skill are authorized standard procedures.
2. `NOW`: Confirm whether the current task falls within the scope of this skill.
3. `NEXT`: Read `tool-index` (workstation tool inventory) to verify tool availability and actual paths.
4. `NEXT`: Invoke bootstrap when tools are missing; do not guess paths.
5. `ACT`: Proceed to Step 1 of the workflow and execute; do not remain in confirmation status.

## Scope of Application

Prioritize using this skill when the user intends to:

- Analyze files such as `exe`, `dll`, `so`, `elf`, `apk`, `dex`, `wasm`, etc., using `r2` / `radare2`
- Ask how to use `rabin2`, `rasm2`, `radiff2`, `rahash2`, or `rax2`
- Need command-line disassembly, function inspection, string analysis, import/export analysis, cross-reference lookup, or patching
- Write `radare2` batch commands, `-c` automated command strings, or `r2pipe` scripts

If the user explicitly requests GUI reverse engineering, Hex-Rays style pseudocode, or an IDA workflow, prioritize `ida-reverse`. For web JavaScript reverse engineering, prioritize `reverse-engineering`.

## Environment Verification

Do not assume `r2` is available beforehand. First check:

```powershell
r2 -v
rabin2 -v
```

If not installed, check common installation paths or prompt for installation.

Common Windows executables:

- `radare2.exe`
- `rabin2.exe`
- `rasm2.exe`
- `radiff2.exe`
- `rahash2.exe`
- `rax2.exe`
- `r2pm.exe`

## Built-in Resources

This skill includes two built-in resources. Prioritize reusing them instead of assembling duplicate commands ad hoc every time.

### `templates/recon.sh`

Standard reconnaissance script, suitable for performing an initial overview analysis. Outputs:

- Basic information
- Sections
- Imports
- Exports
- Strings
- Optional `r2 -A` automated analysis summary

Usage:

```bash
bash templates/recon.sh "path/to/sample.exe"
```

If automated analysis via `r2` is needed as well:

```bash
bash templates/recon.sh "path/to/sample.exe" --analyze
```

### `skill://re-radare2/references/cheatsheet.md`

Read this cheatsheet when more command details, common scenario templates, or quick syntax references are needed, rather than guessing from memory.

## Known Issues

### Sporadic Missing `.sdb` Warnings on Windows

When inspecting certain PE files with `rabin2`, warnings similar to the following may appear:

```text
ERROR: Cannot find ...\share\format\dll\*.sdb
```

If the primary output returns normally, this usually does not affect basic reconnaissance conclusions; proceed with the analysis. Do not conclude that analysis failed simply because of such warnings.

## Core Principles

### 1. Reconnaissance First, Deep Dive Later

Do not run full automated analysis right away. Use lightweight commands first to confirm file type, architecture, entry point, strings, and import tables before deciding whether to run `aaa`, `aaaa`, or targeted analysis.

### 2. Prioritize Minimum Sufficient Commands

`radare2` has numerous commands; users usually only need the shortest path:

- View file info: `rabin2 -I`
- View strings: `rabin2 -z`
- View imports/exports: `rabin2 -i` / `rabin2 -E`
- Interactive analysis: Run `r2 <file>` and execute localized commands

### 3. Exercise Caution Before Modifying

If the user wants to patch a binary:

- Default to read-only mode: `r2 <file>`
- Only open in write mode when modifications are explicitly requested: `r2 -w <file>` or `oo+` within the session
- Notify the user of risks before modifying to prevent accidental overwrites of the original file

## Common Workflows

## Workflow 1: Quick Reconnaissance

Suitable when first receiving a binary file.

### Hard Gate (MUST — Entering Workflow 2 and subsequent steps is prohibited if unsatisfied)

For binaries containing import tables such as PE/ELF/Mach-O, the import table inspection **MUST** be completed and documented into Evidence before proceeding to function-level analysis or dynamic steps:

1. Execute `rabin2 -i <sample>` (or the imports section in `recon.sh` output); for DLL/SYS, additionally **MUST** execute `rabin2 -E` and log `E-exports`
2. Write complete/categorized import table results into Evidence (recommended id: `E-imports` or `E-triage-imports`), containing at minimum:
   - Reproduction command (`repro_command`)
   - Categorized summary of key imports: Network / File / Crypto / Process Injection / Registry / other suspicious APIs
   - If the import table is empty, parsing fails, or tooling errors: The failure phenomenon and raw output **MUST** still be recorded as Evidence; **do not silently skip**
   - If the import table is "too clean" (only base DLLs): Suspicion of dynamic loading **MUST** be noted, and execution **SHOULD** transition to dynamic API capture
3. For targets without traditional IAT such as .NET: An equivalent anchor (dnSpy/IL/metadata summary) **MUST** be written to the same Evidence semantic slot; skipping is prohibited
4. Packed sample IAT repair: Use ImportREC (or equivalent) for x86, and Scylla (or equivalent) for x64. If repair fails, log `E-iat-repair-fail` and transition to dynamic API breakpoints; obsessing endlessly over static IAT is **PROHIBITED** (see `skill://re-radare2/support/reverse-engineering/references/re-agent-workflow.md` §1.2)
5. When the user explicitly requests to "redo import table check / re-inspect import table / redo IAT": The specified step itself **MUST** be redone (if blocked, proceed with the feasibility latch first: Note prerequisites + request confirmation; if forced, mark quality=unreadable); substituting an unrelated step to fake completion is **PROHIBITED**

Before recording import table (or legitimate equivalent anchor / IAT failure bypass) Evidence: You **MUST NOT** claim that "basic reconnaissance is complete", and you **MUST NOT** advance to Workflow 2+ deep-dive conclusions.

Prioritize directly running the built-in script:

```bash
bash templates/recon.sh "sample.exe"
```

If only minimal manual commands are needed, use:

```powershell
rabin2 -I sample.exe
rabin2 -z sample.exe
rabin2 -i sample.exe
rabin2 -E sample.exe
```

Points of interest:

- File format, bitness, architecture, platform
- Entry point address
- Suspicious strings: URLs, paths, errors, registry keys, command-line arguments
- Imported functions: Network, file, crypto, process injection, registry operations (**MUST be logged to Evidence, see Hard Gate above**)

## Workflow 2: Interactive Function Analysis

```powershell
r2 sample.exe
```

Common commands upon entering:

```text
aaa          # Standard automated analysis
afl          # List functions
iz           # List strings
iS           # List sections
is           # List symbols
s entry0     # Seek to entry point
pdf          # Disassemble current function
VV           # Enter visual graph mode (if terminal allows)
q            # Quit
```

Notes:

- Prioritize `aaa` by default; avoid jumping directly to the heavier `aaaa`
- If the sample is very large or analysis is slow, analyze only the area around the entry point and expand manually

## Workflow 3: Locating main / Critical Logic

```text
afl~main
afl~sym.
iz~http
iz~error
axt <addr>
```

Approach:

- Start from `main`, entry point, or string references
- Use `axt` to find xrefs to a specific string or address
- Once xrefs are found, use `s <addr>` and `pdf`

## Workflow 4: Hex and Memory Inspection

```text
px 64        # Hex dump 64 bytes starting from current address
pd 20        # Disassemble 20 instructions
psz          # Read string at current address
pxa          # Formatted hex visual dump
```

## Workflow 5: Binary Patching

Use only when the user explicitly requests file modification:

```powershell
r2 -w sample.exe
```

Example commands after entering:

```text
s 0x401000
wa nop
wa jmp 0x401050
wq
```

Common write operations:

- `wa <asm>`: Write assembly instructions
- `wx <hex>`: Write raw hex bytes
- `wq`: Write changes and quit

It is best to back up the original file before modifying. If the user did not mention a backup, provide at least one reminder.

## Workflow 6: Non-Interactive Automation

Suitable for one-shot output generation:

```powershell
r2 -A -q -c "afl;iz;ii;q" sample.exe
```

Common flags:

- `-A`: Analyze automatically on startup
- `-q`: Quiet mode
- `-c`: Execute command string

If there are many commands, organize them into a readable sequence rather than stuffing them into an unmaintainable command string.

It is strongly recommended to establish a baseline using the built-in reconnaissance script first before deciding whether to complement it with custom commands.

## Common Sub-Tools

### `rabin2`

Suitable for static information extraction:

```powershell
rabin2 -I sample.exe   # Basic info
rabin2 -S sample.exe   # Sections
rabin2 -s sample.exe   # Symbols
rabin2 -i sample.exe   # Imports
rabin2 -E sample.exe   # Exports
rabin2 -z sample.exe   # Strings
rabin2 -zz sample.exe  # Extended strings
```

### `rasm2`

Suitable for rapid assembly/disassembly:

```powershell
rasm2 -d "9090"
rasm2 -a x86 -b 64 "xor eax, eax"
```

### `radiff2`

Suitable for binary diffing:

```powershell
radiff2 old.exe new.exe
radiff2 -C old.exe new.exe
```

### `rahash2`

Suitable for computing hashes:

```powershell
rahash2 -a md5 sample.exe
rahash2 -a sha256 sample.exe
```

### `rax2`

Suitable for base and encoding conversion:

```powershell
rax2 0x401000
rax2 4198400
rax2 -s hello
```

## Recommended Analysis Sequence

When encountering an unknown sample, follow this sequence:

1. `rabin2 -I` to inspect format, architecture, and entry point
2. `rabin2 -z` to inspect strings
3. `rabin2 -i` to inspect imported functions — **MUST + Evidence (Hard Gate, see Workflow 1)**
4. If interactive analysis is needed, enter `r2` (only after step 3 Evidence is written to disk)
5. Run `aaa` first, then inspect via `afl` / `iz` / `pdf`
6. Locate critical functions iteratively through string references, import calls, and entry point flow

The benefit of this sequence is low noise, helping quickly establish an analytical direction. Step 3 is not an optional optimization; it is a hard gate before entering deep-dive analysis.

## Windows Important Notes

- Paths containing spaces must be properly quoted
- If the current terminal cannot find `r2`, `PATH` may have just been updated; try opening a new terminal
- Some samples require Administrator privileges to read; do not proactively elevate privileges by default unless explicitly requested by the user
- Before performing dynamic debugging on suspicious samples, confirm user intent first to avoid unintended execution

## Output Style

When the user requests actual file analysis rather than just command syntax:

- Provide a summary of the reconnaissance findings first
- List key evidence: strings, imports, functions, and addresses
- Finally, provide next-step recommendations or continue with in-depth analysis

Do not simply enumerate commands without explaining the rationale behind them.

## Typical Request Examples

### Example 1: Analyzing an Executable

User: `Check what this exe does, just use radare2`

Procedure:

1. Run `rabin2 -I/-z/-i` first
2. Determine whether entering `r2` is necessary
3. Deep-dive into entry point and critical string references using `aaa`, `afl`, and `pdf`

### Example 2: Finding Where a String Is Called

User: `Which function triggers this error string?`

Procedure:

1. Find the string address using `iz~keyword`
2. Find references using `axt <addr>`
3. Seek to the reference location `s <addr>` and run `pdf`

### Example 3: Modifying a Jump

User: `Change this jne to je`

Procedure:

1. Confirm the target address first
2. Explicitly notify the user that write mode will be entered
3. Use `wa je <target>` or write raw bytes with `wx`
4. Disassemble again after modification to verify

## Practices to Avoid

- Do not treat `radare2` as a tool with only the `aaa` command
- Do not open user files in write mode without noting risks beforehand
- Do not draw conclusions before completing baseline reconnaissance
- **Skipping import table inspection is PROHIBITED** (`rabin2 -i` / recon imports): Do not proceed to next steps without writing Evidence; substituting other steps when the user requests an import table redo is prohibited
- **Obsessing statically after IAT repair failure is PROHIBITED**: Log `E-iat-repair-fail` and transition to dynamic analysis; using only ImportREC on 64-bit samples is prohibited
- Do not misroute web JavaScript reverse engineering to this skill; that falls under `reverse-engineering`

## References

- Command Cheatsheet: `skill://re-radare2/references/cheatsheet.md`
- Standard Recon Script: `templates/recon.sh`

## radare2-skills Ecosystem

The radare2-skills project (radareorg/radare2-skills) provides a richer ecosystem of tools and workflows:

- **r2xsql**: SQL queries for binary import tables / strings / functions
- **r2mcp / r2http**: MCP tools and HTTP stateful command channels
- **radius2**: Symbolic execution, symbolic dynamic analysis
- **r2pm**: Package management, extensions
- **decompiler plugins**: radare2 plugin mechanism

**Usage Strategy**:
- When the user mentions `r2xsql`, `r2mcp`, `r2http`, `radius2`, `r2pm`, `rabin2`, `rasm2`, `radiff2`, `rahash2`, or `rax2`, prioritize routing to this skill (radare2/SKILL.md)
- These tools are ecosystem accelerators and **cannot bypass**: authorization gates, `tool-index` verification, Evidence logging, or write-mode confirmation
- Provide minimal reproducible command examples:
  - `r2xsql -s <file> -q "SELECT ..."`
  - `curl.exe -sS --data-binary 'aaa' http://127.0.0.1:9393/cmd`
  - `radius2 -p <binary> ...`
  - `r2pm -ci <plugin>`

This skill maintains existing hard gates and evidence chain integrity; skipping any authorization or Evidence steps is not permitted.

---

## Routing Context

**Upstream Entry**: `skill://re-radare2/support/SKILL.md` (Master Controller), `skill://re-radare2/support/routing.md`
**Upstream Alternative**: `re-ida-reverse/` (Escalate to IDA when decompilation/pseudocode is required)
**Downstream Exit**:
- Dynamic analysis needed → `arsenal skill_load re-reverse-engineering/tools-dynamic.md` (Frida/GDB)
- Deep decompilation needed → `re-ida-reverse/`
- Cross-references needed after PAT finds interesting strings → `re-ida-reverse/` (IDA's xrefs are more powerful)

**Related Sibling Modules**: `re-ida-reverse/` (Complementary: r2 provides rapid recon, IDA provides deep decompilation)

## On-Demand Bootstrap

The entry scripts for this skill are integrated into the unified bootstrap system. If radare2 is missing, an error will not be thrown directly; an automatic installation attempt will be made instead.

### Automation Capability Boundaries

| Tool | Auto-installable | Installation Method | Notes |
|------|-----------|---------|------|
| r2 | ✓ | GitHub Release ZIP (w64) | Automatically downloaded and extracted to `%USERPROFILE%\Tools\radare2\` |
| rabin2 | ✓ | Same as above (included in radare2 release package) | — |
| rasm2 | ✓ | Same as above | — |
| radiff2 | ✓ | Same as above | — |
| rahash2 | ✓ | Same as above | — |
| rax2 | ✓ | Same as above | — |

### Bootstrap Trigger Points

- `templates/recon.sh`: Automatically invokes `bootstrap-reverse.ps1` when `rabin2` or `r2` is missing

### On Bootstrap Failure

If automated installation fails (network failure, GitHub API rate limits, etc.), the script raises an explicit error with a link for manual installation.

Manual installation: Download `radare2-*-w64.zip` from https://github.com/radareorg/radare2/releases, extract to `%USERPROFILE%\Tools\radare2\`, and ensure the `bin\` directory is in PATH.

## Task Completion Self-Check (MUST pass before claiming completion)

- [ ] Did I execute each step in the workflow (rather than only reading)?
- [ ] Was the import table check executed and recorded into Evidence (E-imports / E-triage-imports or .NET equivalent)? Does DLL/SYS include E-exports?
- [ ] If IAT repair failed, was E-iat-repair-fail recorded and did execution transition to dynamic analysis? Did redo requests return to the exact same step?
- [ ] Did I use verified tool paths based on `tool-index`?
- [ ] Did I produce reproducible evidence (commands/templates/screenshots/reports)?
- [ ] Did I complete and verify the Checklist items required by RULES?
