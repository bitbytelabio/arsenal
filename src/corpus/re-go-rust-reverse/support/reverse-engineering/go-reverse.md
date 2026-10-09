# Go Binary Reverse Engineering Guide

> Go-compiled binaries present unique challenges: massive size due to static linking, tens of thousands of functions, non-standard string formats, and difficulty in symbol recovery after stripping.
> This document covers toolchains, recovery techniques, and practical workflows.

---

## Identification of Go Binary Signatures

Quickly determine whether a binary was compiled with Go:

```bash
# String signatures
strings binary | grep -E "runtime\.|go\.buildid|GOROOT"

# rabin2 reconnaissance
rabin2 -z binary | grep -i "runtime"

# Abnormally large file size (statically linked runtime)
# Typical Hello World: C ~20KB, Go ~2MB
```

Common characteristics:
- Large number of functions prefixed with `runtime.`
- Contains the `go.buildid` section
- Contains `GOROOT` and `GOPATH` path strings
- Function count ranges from 5,000 to 50,000+ (includes the entire runtime and standard library)

---

## Core Toolchain

### Symbol Recovery

| Tool | Purpose | Link |
|------|---------|------|
| **GoReSym** | Developed by Mandiant; parses Go symbol information (pclntab/moduledata) | https://github.com/mandiant/GoReSym |
| **GoResolver** | Developed by Volexity; automatically deobfuscates Garble binaries using CFG similarity | https://github.com/volexity/GoResolver |
| **redress** | Analyzes stripped Go binaries to recover types, interfaces, and package structures | https://github.com/goretk/redress |
| **GoStringUngarbler** | Developed by Google; specifically recovers strings obfuscated by Garble | https://github.com/mandiant/GoStringUngarbler |

### IDA Plugins

| Tool | Purpose | Link |
|------|---------|------|
| **go_parser** | IDA plugin; parses moduledata, pclntab, and type information | https://github.com/0xjiayu/go_parser |
| **IDAGolangHelper** | IDA script collection; parses Go type information | https://github.com/sibears/IDAGolangHelper |
| **AlphaGolang** | IDAPython script collection by SentinelLabs | https://github.com/SentineLabs/AlphaGolang |
| **IDA 9.2+ Native Support** | Official Hex-Rays Go decompilation improvements | https://hex-rays.com/blog/stop-guessing-and-start-going |

### Ghidra Plugins

| Tool | Purpose | Link |
|------|---------|------|
| **Ghidra + GoReSym Output** | Import symbols exported by GoReSym into Ghidra | Used in combination |
| **golang_loader_assist** | Ghidra Go loading assistant | Community scripts |

### Standalone Analysis Tools

| Tool | Purpose | Link |
|------|---------|------|
| **gore** | Go reverse engineering library (underlying engine of redress) | https://github.com/goretk/gore |
| **garble** | Go obfuscation tool (understand it to counter it) | https://github.com/burrowers/garble |

---

## Key Structures of Go Binaries

### pclntab (PC Line Table)

The most critical structure in a Go binary, containing:
- Mappings for all function names and addresses
- Source file paths
- Line number information
- Stack frame sizes

Even if symbols are stripped, `pclntab` usually remains intact (the Go runtime relies on it).

```text
Locating methods:
1. Search magic bytes: 0xFFFFFFF0 (Go 1.16+) or 0xFFFFFFFB (Go 1.18+)
2. Locate automatically using GoReSym
3. Parse automatically using the go_parser IDA plugin
```

### moduledata

Contains:
- Pointer to `pclntab`
- Type information table
- `itab` (interface table)
- Global variable information

### String Format

Go strings are not C-style null-terminated strings; they use a `(pointer, length)` structure:

```text
C string:   "hello\0"
Go string:  struct { ptr *byte; len int } -> ptr points to "hello" (no \0)
```

This causes default string identification in IDA/Ghidra to miss a large number of Go strings.

**Solutions**:
- Automatically identify Go strings using `go_parser`
- Export the string list using GoReSym
- Manual: Locate `runtime.stringtable` or resolve via cross-references

---

## Practical Workflows

### Scenario 1: Unstripped Go Binary

```text
1. GoReSym -t -d -p binary > symbols.json
   -> Export all function names, types, and source file paths
2. Load into IDA/Ghidra
3. Import GoReSym symbol information
4. Filter out runtime.* and standard library functions to focus on user code
5. Begin analysis from main.main
```

### Scenario 2: Stripped Go Binary

```text
1. GoReSym -t -d -p binary > symbols.json
   -> Even if stripped, pclntab is usually still present
2. If GoReSym fails -> use redress
   redress -src binary    # Recover source file paths
   redress -pkg binary    # Recover package structure
   redress -type binary   # Recover type information
3. Load into IDA + go_parser plugin
4. Run go_parser to automatically recover structures
5. Begin analysis from the recovered main.main
```

### Scenario 3: Garble-Obfuscated Go Binary

```text
Garble will:
- Randomize function names (main.main -> main.a3f2b1c)
- Encrypt strings
- Remove file path information
- Obfuscate package names

Countermeasures:
1. GoResolver (CFG signature matching)
   -> Recover standard library function names via control flow graph similarity
2. GoStringUngarbler (string decryption)
   -> Automatically identify Garble string encryption patterns and decrypt them
3. Dynamic analysis (Frida/dlv)
   -> Hook runtime functions to observe actual behavior
4. Differential analysis
   -> Compile a Hello World binary using the same Go version and binary-diff the runtime section
```

### Scenario 4: CGo Mixed Compilation

```text
1. Identify CGo boundaries (_cgo_* functions)
2. Recover Go portions using go_parser
3. Analyze C portions using standard IDA workflows
4. Focus on bridging functions such as _cgo_topofstack and crosscall2
```

---

## Quick Command Reference

```bash
# GoReSym: Export symbols
GoReSym -t -d -p binary > symbols.json
GoReSym -t -d -p binary -o ida_script.py  # Generate IDA script

# redress: Analyze stripped binaries
redress -src binary          # Source file paths
redress -pkg binary          # Package structure
redress -type binary         # Type information
redress -interface binary    # Interface information
redress -filepath binary     # Full file paths

# GoResolver: Deobfuscate Garble
GoResolver -binary binary -output resolved.json

# GoStringUngarbler: Decrypt Garble strings
GoStringUngarbler -i binary -o deobfuscated_binary

# Quickly determine Go version
strings binary | grep "go1\."
GoReSym -p binary | grep "Version"
```

---

## Go Analysis Workflow in IDA

```text
1. Load binary (select the correct architecture)
2. Wait for auto-analysis to finish
3. Run the go_parser plugin:
   - File -> Script File -> go_parser.py
   - Or Edit -> Plugins -> Go Parser
4. The plugin will automatically:
   - Parse pclntab
   - Recover function names
   - Mark Go strings
   - Parse type information
5. Filter views:
   - Hide runtime.* functions
   - Focus on main.* and third-party packages
6. Begin reverse engineering from main.main
```

---

## Common Pitfalls

| Pitfall | Description | Solution |
|---------|-------------|----------|
| Too many functions to navigate | Static linking results in 5,000-50,000 functions | Filter by package name; focus only on `main.*` and business logic packages |
| Incomplete string identification | Go strings are not null-terminated | Recover using `go_parser` or GoReSym |
| Decompilation output is difficult to read | Go constructs like defer, goroutines, and interfaces make pseudocode complex | Leverage IDA 9.2+ improvements, or assist with dynamic analysis |
| Garble obfuscation | Function names and strings are fully randomized | Use GoResolver + GoStringUngarbler |
| Version differences | Different Go versions use different pclntab formats | GoReSym supports Go 1.2 through 1.23+ |
| CGo boundaries | Go and C code are intertwined | Identify `_cgo_*` functions as boundary markers |

---

## Integration with Other Skills

| Requirement | Tool / Method |
|-------------|---------------|
| In-depth Go binary analysis in IDA | `ida-reverse/` + go_parser plugin |
| Analysis in Ghidra (Free) | Ghidra + GoReSym symbol import |
| Rapid reconnaissance | `radare2/` — inspect strings via `rabin2 -z` |
| Dynamic hooking | Frida (hook runtime functions) or dlv (native Go debugger) |
| Cross-version comparison | `binary-diff/` — migrate symbols from older symbolicated versions to newer ones |
| Garble deobfuscation | GoResolver + GoStringUngarbler |