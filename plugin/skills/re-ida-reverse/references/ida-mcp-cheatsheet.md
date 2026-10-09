# IDA Pro MCP Tools Quick Reference

> ida-pro-mcp 2.x tools categorized by functionality, including common parameters and typical usage.
> Server name: `idapro`, Tool prefix: `idapro_*`, runs in HTTP mode. Tool count varies across versions (approx. 66, including `py_eval`).

---

## Launch and Session Management

### Server Launch

```powershell
# Start the MCP HTTP server (silent background execution; returns OK:<n>:reuse if healthy)
powershell -File "scripts/start.sh"
# Output OK:<tool_count> indicates ready state (approx. 66, including py_eval)

# Open target file (bypasses schema validation)
powershell -File "scripts/open.sh" -Path "C:\target.exe"
# Output: OK:filename:session_id

# Recommended to specify a timeout for large files or GUI programs
powershell -File "scripts/open.sh" -Path "C:\big.exe" -TimeoutSeconds 600

# Skip auto-analysis (for fast loading)
powershell -File "scripts/open.sh" -Path "C:\huge.sys" -NoAutoAnalysis
```

### Session Tools

| Tool | Purpose | Example |
|------|---------|---------|
| `idapro_idb_list()` / HTTP `idb_list` | List all sessions | — |
| `idapro_idb_open()` / HTTP `idb_open` | Open database (prefer using `scripts/open.sh`) | Use script for large files |
| `idapro_idb_save(path)` / HTTP `idb_save` | Save database | Save analysis progress |
| `idapro_idb_current()` | Currently bound session (if supported by version) | — |
| `idapro_idb_switch(session_id)` | Switch session | When comparing multiple files |
| `idapro_idb_close(session_id)` | Close session | Release resources |
| `idapro_server_health()` | Server health check | — |
| `idapro_server_warmup()` | Warm up subsystems | Before first use |

---

## Step 1: Global Overview

### survey_binary — Quick Overview

```
idapro_survey_binary(detail_level="minimal")
```

Returns:
- Architecture (x86/x64/ARM/MIPS)
- Entry point
- Total function count
- String statistics
- Section information
- Import classifications (crypto/network/file IO/registry)
- High-xref hotspot functions

**detail_level Options**:
- `"minimal"` — Quick overview (recommended default)
- `"standard"` — Includes more details
- `"full"` — Complete information

### Function List

```
# List all functions (paginated)
idapro_list_funcs(queries=[{"offset": 0, "limit": 50}])

# Filter by name
idapro_list_funcs(queries=[{"filter": "crypt", "offset": 0, "limit": 20}])
idapro_list_funcs(queries=[{"filter": "main", "offset": 0, "limit": 10}])
```

### Unified Query

```
# Query imported functions
idapro_entity_query(kind="imports", filter="Create")

# Query strings
idapro_entity_query(kind="strings", filter="http")

# Query all named symbols
idapro_entity_query(kind="names", filter="")
```

---

## Decompilation and Disassembly

### Decompilation (Pseudocode)

```
# By function name
idapro_decompile(addr="main")
idapro_decompile(addr="sub_140001000")

# By address
idapro_decompile(addr="0x140001000")
```

### Disassembly

```
# Default instruction count
idapro_disasm(addr="main")

# Specify instruction count
idapro_disasm(addr="0x401000", max_instructions=100)
```

### Comprehensive Analysis (Recommended)

```
# Retrieve in a single call: pseudocode + strings + constants + callers + callees + basic blocks
idapro_analyze_function(addr="main", include_asm=false)

# Include assembly
idapro_analyze_function(addr="sub_401000", include_asm=true)
```

### Function Profile

```
# Batch retrieve function metrics (size, block count, xref count)
idapro_func_profile(queries=["main", "sub_401000", "sub_402000"])
```

---

## Cross References and Call Graphs

### References to Target

```
# Check callers of a function
idapro_xrefs_to(addrs=["sub_401000"])

# Check references to a string or data
idapro_xrefs_to(addrs=["0x404000"])

# Batch query
idapro_xrefs_to(addrs=["CreateFileW", "ReadFile", "WriteFile"])
```

### Advanced Xref Query

```
# Specify direction and type
idapro_xref_query(addr="0x401000", direction="to")    # What references this
idapro_xref_query(addr="0x401000", direction="from")  # What this references
```

### Callee Function List

```
idapro_callees(addrs=["main"])
```

### Call Graph

```
# Starting from main, depth 3
idapro_callgraph(roots=["main"], max_depth=3)

# Multiple root nodes
idapro_callgraph(roots=["sub_401000", "sub_402000"], max_depth=2)
```

### Data Flow Tracing

```
# Backward trace: Where did this value originate
idapro_trace_data_flow(addr="0x401050", direction="backward", max_depth=5)

# Forward trace: Where does this value flow to
idapro_trace_data_flow(addr="0x401050", direction="forward", max_depth=5)
```

---

## Search

### String Search (Regex)

```
# Search for URLs
idapro_find_regex(pattern="https?://", limit=20)

# Search for file paths
idapro_find_regex(pattern="C:\\\\", limit=20)

# Search for error messages
idapro_find_regex(pattern="error|fail|invalid", limit=30)

# Search for keys or passwords
idapro_find_regex(pattern="key|password|secret|token", limit=20)
```

### Disassembly Text Search

```
# Search within disassembly listing
idapro_search_text(pattern="call    sub_")
idapro_search_text(pattern="xor     eax, eax")
```

### Byte Pattern Search

```
# Exact bytes
idapro_find_bytes(patterns=["48 8B 05"], limit=10)

# With wildcards
idapro_find_bytes(patterns=["48 89 ?? 24 ??"], limit=10)

# Multiple patterns
idapro_find_bytes(patterns=["CC CC CC CC", "90 90 90 90"], limit=5)
```

### Advanced Search

```
# Search for immediate values
idapro_find(type="immediate", targets=["0xDEADBEEF"])

# Search for string references
idapro_find(type="string", targets=["password"])
```

---

## Memory and Data Reading

### Read Raw Bytes

```
idapro_get_bytes(addrs=[{"addr": "0x401000", "size": 64}])
```

### Read String

```
idapro_get_string(addrs=["0x404000", "0x404100"])
```

### Read Integer

```
idapro_get_int(queries=[{"addr": "0x405000", "size": 4}])
```

### Read Global Variable

```
idapro_get_global_value(queries=["g_flag", "g_key_size"])
```

### Read Structure

```
idapro_read_struct(queries=[{"addr": "0x405000", "type": "HEADER"}])
```

### Search Structures

```
idapro_search_structs(filter="FILE")
```

---

## Modification Operations

### Add Comments

```
# Single comment
idapro_set_comments(items=[{"addr": "0x401000", "comment": "Decryption function entry point"}])

# Batch comments
idapro_set_comments(items=[
    {"addr": "0x401000", "comment": "XOR decryption loop"},
    {"addr": "0x401050", "comment": "Key initialization"},
    {"addr": "0x4010A0", "comment": "Result validation"}
])

# Append comments (does not overwrite existing)
idapro_append_comments(items=[{"addr": "0x401000", "comment": "Note: Key length is 16"}])
```

### Rename

```
# Rename functions
idapro_rename(batch={"func": [
    {"addr": "sub_401000", "name": "decrypt_payload"},
    {"addr": "sub_402000", "name": "verify_license"}
]})

# Rename global variables
idapro_rename(batch={"global": [
    {"addr": "0x405000", "name": "g_encryption_key"}
]})
```

# Rename local variable
idapro_rename(batch={"local": [
    {"func": "decrypt_payload", "old": "v1", "name": "plaintext_buf"}
]})
```

### Patch Assembly

```
# NOP out detection code
idapro_patch_asm(items=[{"addr": "0x401050", "asm": "nop"}])

# Modify jump
idapro_patch_asm(items=[{"addr": "0x401060", "asm": "jmp 0x401080"}])

# Force return true
idapro_patch_asm(items=[
    {"addr": "0x401000", "asm": "mov eax, 1"},
    {"addr": "0x401005", "asm": "ret"}
])
```

### Patch Bytes

```
# Directly write bytes
idapro_patch(patches=[{"addr": "0x401050", "bytes": "9090909090"}])
```

---

## Type System

### Declare Structure

```
idapro_declare_type(decls=[{
    "name": "PacketHeader",
    "decl": "struct PacketHeader { uint32_t magic; uint16_t type; uint16_t length; uint8_t data[0]; };"
}])
```

### Apply Type

```
# Set function prototype
idapro_set_type(edits=[{
    "addr": "sub_401000",
    "type": "int __fastcall decrypt(void *buf, int size, const char *key)"
}])

# Set type for global variable
idapro_set_type(edits=[{
    "addr": "0x405000",
    "type": "PacketHeader"
}])
```

### Infer Types

```
idapro_infer_types(addrs=["sub_401000", "sub_402000"])
```

### Query/Inspect Types

```
idapro_type_query(queries=["Packet"])
idapro_type_inspect(queries=["PacketHeader"])
```

---

## Stack Frame Analysis

```
# Inspect function stack frame
idapro_stack_frame(addrs=["main", "sub_401000"])

# Declare stack variable
idapro_declare_stack(items=[{
    "func": "sub_401000",
    "offset": -0x20,
    "name": "local_buf",
    "type": "char [32]"
}])
```

---

## Signature Generation

```
# Generate unique byte signature for address
idapro_make_signature(addrs=["0x401000"])

# Generate signature for entire function
idapro_make_signature_for_function(addrs=["decrypt_payload"])

# Generate signatures for code referencing a specific address
idapro_find_xref_signatures(addrs=["0x405000"])
```

---

## Radix Conversion

```
# Hexadecimal -> Decimal
idapro_int_convert(inputs=["0x401000"])

# Decimal -> Hexadecimal
idapro_int_convert(inputs=["4198400"])

# Batch conversion
idapro_int_convert(inputs=["0xDEAD", "0xBEEF", "12345"])
```

> ⚠️ **Always use this tool for radix conversion; do not calculate it manually!**

---

## Export and Scripting

### Export Functions

```
# JSON format
idapro_export_funcs(addrs=["main", "sub_401000"], format="json")

# C header file
idapro_export_funcs(addrs=["main", "sub_401000"], format="c_header")

# Function prototypes
idapro_export_funcs(addrs=["main", "sub_401000"], format="prototypes")
```

### Execute Python Scripts

```
# Execute Python in IDA context
idapro_py_eval(code="import idautils; print(list(idautils.Functions())[:10])")

# Get segment information
idapro_py_eval(code="import idc; print(idc.get_segm_name(0x401000))")

# Batch operations
idapro_py_eval(code="import ida_funcs; f=ida_funcs.get_func(0x401000); print(f.size())")
```

---

## Typical Analysis Workflows

### Malware Analysis

```text
1. survey_binary -> Check imports (Network API? Encryption? Registry?)
2. find_regex("http|socket|connect") -> Find network-related strings
3. xrefs_to(network_string_address) -> Find referencing functions
4. decompile(referencing_function) -> Review communication logic
5. trace_data_flow(crypto_param, "backward") -> Trace key source
6. set_comments + rename -> Annotate findings
```

### Registration Validation Cracking

```text
1. find_regex("serial|license|register|valid") -> Find validation-related strings
2. xrefs_to(validation_string) -> Locate validation function
3. analyze_function(validation_function) -> Understand logic
4. callgraph(validation_function, 2) -> Review call chain
5. patch_asm(conditional_jump_address, "jmp always_pass") -> Apply patch
```

### CTF Reverse Engineering

```text
1. survey_binary -> Confirm architecture and entry point
2. decompile("main") -> Review main logic
3. find_regex("flag|correct|wrong") -> Find decision points
4. trace_data_flow(decision_point, "backward") -> Trace input transformations
5. Use Python for auxiliary calculation/decryption -> Retrieve flag
```

### Vulnerability Analysis

```text
1. entity_query(kind="imports", filter="strcpy|sprintf|gets") -> Find dangerous functions
2. xrefs_to(dangerous_function) -> Find call sites
3. analyze_function(caller_function) -> Review context
4. stack_frame(function) -> Confirm buffer size
5. trace_data_flow(dangerous_param, "backward") -> Verify user controllability
```

---

## Common Errors and Solutions

| Error | Cause | Solution |
|------|------|------|
| "No database bound" | No file opened | Run `scripts/open.sh` |
| "Failed to open database" | Old database locked | `scripts/open.sh` automatically falls back to Temp |
| Schema validation failed | MCP client BUG | Use `scripts/open.sh` instead of `idb_open` |
| Tool timeout | Large file under analysis | Add `-TimeoutSeconds 600` |
| "ERR:timeout" (start.sh) | Server failed to start | Check Python/idalib-mcp installation |
| Radix conversion error | Manual calculation error | Use `idapro_int_convert` |
| Function name not found | Inexact name | Search first using `list_funcs` + filter |