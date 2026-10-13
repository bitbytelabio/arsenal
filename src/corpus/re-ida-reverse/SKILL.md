---
name: re-ida-reverse
description: IDA Pro reverse engineering guidance for binary triage, decompilation, and vulnerability analysis.
domain: re
category: decompilation
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-ida-reverse/SKILL.md
---
# IDA Pro Reverse Engineering Skill

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://re-ida-reverse/support/field-journal/precedent-reverse.md` — Confirm that operations in this skill are authorized routine procedures.
2. `NOW`: Confirm whether the current task falls within the scope of this skill.
3. `NEXT`: Read `tool-index` (workstation tool inventory) to verify tool availability and actual paths.
4. `NEXT`: Invoke bootstrap when tools are missing; do not guess paths.
5. `ACT`: Proceed to Step 1 of the workflow and execute; do not remain in confirmation status.

## Known Issues and Post-Mortems (Must Read)

### Pitfalls Encountered

1. **Do not rely on certain AI client MCP calls directly for `idb_open` (formerly `idalib_open`)**
   - Certain coding AI clients have a bug regarding MCP output schema validation for open-type tools.
   - Error: `Structured content does not match the tool's output schema`
   - **Workaround**: Use the `arsenal scripts re-ida-reverse/open` script to call the HTTP API directly, bypassing the MCP validation layer.
   - The current ida-pro-mcp 2.x tool names are `idb_open` / `idb_list` / `idb_save` (no longer `idalib_*`).
   - Opening a file returns a `session_id` (database); subsequent tool calls must include this session parameter.

2. **Permission denied when opening files in `C:\Windows\System32\`**
   - idalib cannot directly read files under the System32 directory.
   - **Workaround**: `arsenal scripts re-ida-reverse/open` automatically detects this and copies the file to the temp directory before opening it.

3. **Server startup command blocks the conversation**
   - After startup, `idalib-mcp` continuously outputs INFO logs to the console.
   - **Workaround**: Use `arsenal scripts re-ida-reverse/start` (starts silently in the background with `-WindowStyle Hidden`).
   - The script exits automatically once the service is ready, without blocking the conversation.

4. **MCP server name cannot contain hyphens**
   - Previously, using `ida-pro-mcp` as the server name caused tool registration issues.
   - **Current configuration**: Server name is `idapro`, tool prefix is `idapro_*`.

5. **Remote HTTP vs Local Stdio**
   - `type:"local"` (stdio) mode: `idalib_open` suffers from the same schema validation issue.
   - `type:"remote"` (HTTP) mode: You can first open the file directly via script, then use MCP tools.
   - **Current solution**: Remote HTTP mode.

6. **PR #389 resolved part of the schema issues**
   - The author mrexodia merged fixes via PR #389 following issue #388.
   - Fixed the structuredContent schema in HTTP mode, but validation issues persist on the side of certain coding AI clients.
   - The latest `main` branch version has been installed.

7. **idalib timeout leaves orphaned worker process file locks**
   - After the first `arsenal scripts re-ida-reverse/open` timeout, the idalib Python worker child process may become orphaned, holding locks on `.id0`/`.id1`/`.nam`.
   - Subsequent tool executions or manual drag-and-drop into IDA GUI will report "Access is denied".
   - **DO NOT** kill the process tree with `taskkill /F /T` — `/T` will terminate the GUI `ida.exe` child process as well.
   - **Workaround**: `arsenal scripts re-ida-reverse/start` only replaces the managed supervisor when no process is listening on the port, or when `tools/list` returns quickly but lacks `py_eval` (an outdated supervisor); an RPC timeout while 13337 is still listening is treated as busy and will not be killed. When opening a database, `arsenal scripts re-ida-reverse/open` writes `opening.lock`, and the watchdog must not use `-Force`.
   - **Deadlock exception**: Only when `tools/list` **fails continuously for more than 3 minutes** (based on the last-healthy timestamp, not process creation time), there is no in-flight `opening.lock`, and the GUI is not occupying the port, use `-Force` to replace the supervisor without killing `ida.exe`.
   - **Fallback**: When `arsenal scripts re-ida-reverse/open` detects that the old database is locked, it automatically copies it to Temp with a GUID prefix.

8. **Opening with auto-analysis enabled looks like a freeze**
   - `idalib_open(run_auto_analysis=true)` may take a long time to return a response, but the backend is actually continuing to open and analyze.
   - Previously, the user side saw "PowerShell has no output for a long time", which was easily misdiagnosed as a script freeze.
   - **Current workaround**: `arsenal scripts re-ida-reverse/open` adds `-TimeoutSeconds`, shifting to background requests + foreground polling + periodic progress output.
   - When polling detects that the session is ready, it returns `OK:filename:session_id` early; on timeout, it returns `ERR:open_timeout_xxs`.

9. **HTTP MCP exits silently after login**
   - Cursor/Claude with `type: http` does not launch processes on your behalf; legacy scheduled tasks only run once at logon.
   - `pythonw` has no console; when it crashes, the Application event log is also empty.
   - **Workaround**: `arsenal scripts re-ida-reverse/start` reuses the instance if healthy by default; `arsenal scripts re-ida-reverse/watchdog` inspects every minute; logs are stored in `%LOCALAPPDATA%\arsenal\ida-mcp\`.
   - Installation: `arsenal scripts re-ida-reverse/install-autostart`. If the port is not up yet when the HTTP client starts, you still need to refresh manually once in the MCP panel.

10. **Streamable HTTP GET `/mcp` hangs single-threaded supervisor**
    - Some HTTP MCP clients send persistent long-polling GET requests (SSE) to `/mcp`. The stock `idalib_supervisor` uses `HTTPServer` with `background=False`, handling only one request at a time.
    - Result: `tools/list` times out, and the client marks `idapro` as an error.
    - **Workaround**: `arsenal scripts re-ida-reverse/run-supervisor` replaces HTTP with `ThreadingHTTPServer` and accepts GET `/mcp`; if patching fails, it skips and still starts the supervisor. When hung, use `arsenal scripts re-ida-reverse/recover` (immediate `-Force`).

### Workflow Principles

| Step | Action | Tool / Script |
|------|--------|---------------|
| 1 | Ensure the HTTP server is running | `arsenal scripts re-ida-reverse/start` (no parameters) |
| 2 | Open the target binary | `arsenal scripts re-ida-reverse/open` -Path "xxx.exe" |
| 3 | Use MCP analysis tools | Call `idapro_*` / HTTP tools directly (~65 tools, version dependent) |
| 4 | Complete analysis | Tools are ready automatically |

## Script Resources

### start.sh — Start MCP HTTP Server

Command: `arsenal scripts re-ida-reverse/start`

- Automatically resolves `IDADIR` (environment variable / portable desktop path / common installation paths).
- Prefers IDA's built-in `Python314\python.exe -m ida_pro_mcp.idalib_supervisor`.
- By default, probes `http://127.0.0.1:13337/mcp` first; if healthy, outputs `OK:<n>:reuse` and exits.
- 13337 is listening but `tools/list` times out → `WARN:busy` / `OK:busy:reuse`, **do not kill** (cannot respond while opening a database or occupied by GUI).
- `tools/list` **fails continuously for more than 3 minutes** (last-healthy timestamp) and no `opening.lock` exists → treated as deadlock, outputs `INFO:deadlock` and replaces supervisor with `-Force`. In-progress `idb_open` and GUI will not trigger this path.
- Only replaces the managed supervisor when no process is listening on the port, `py_eval` is missing, or the deadlock condition above is met; **never kill `ida.exe`, never use `taskkill /T`**.
- When GUI occupies 13337, outputs `WARN:gui_busy` and exits without launching another supervisor.
- On success, outputs `OK:<tool_count>` (currently ~66); on failure, outputs `ERR:timeout`.
- Supervisor log: `%LOCALAPPDATA%\arsenal\ida-mcp\supervisor.log`
- The server runs in the background and does not block conversations.

**Usage**:
```bash
arsenal scripts re-ida-reverse/start [port]
```

### watchdog.ps1 / recover.sh / install-autostart.sh — Keepalive

- `arsenal scripts re-ida-reverse/watchdog`: Probes 13337; reuses if healthy (and refreshes last-healthy); GUI / `arsenal scripts re-ida-reverse/open` database opening lock / busy states within 3 minutes of last-healthy → reuse; only executes `arsenal scripts re-ida-reverse/start` -Force when `tools/list` fails continuously for over 3 minutes.
- `arsenal scripts re-ida-reverse/recover`: Executes `arsenal scripts re-ida-reverse/start` -Force immediately (without killing `ida.exe`). Use this when the HTTP client marks `idapro` as an error.
- `arsenal scripts re-ida-reverse/install-autostart`: Registers scheduled task `arsenal-ida-mcp` (at logon + every minute).
- Log: `%LOCALAPPDATA%\arsenal\ida-mcp\watchdog.log`

### open.sh — Open Binary File

Command: `arsenal scripts re-ida-reverse/open`

- Calls `idb_open` directly via HTTP API, bypassing MCP schema validation.
- Automatically detects System32 paths and copies files to a temporary directory.
- Automatically cleans up old database files with the same name (`.id0`/`.id1`/`.nam`/`.til`/`.i64`).
- Automatically degrades when old database is locked: copies to Temp with a GUID prefix and opens without error.
- Executes open requests in the background to prevent script unresponsiveness caused by long synchronous waiting.
- Supports `-TimeoutSeconds`; returns `ERR:open_timeout_xxs` on timeout instead of hanging indefinitely.
- Outputs `INFO:opening:elapsed/timeout_seconds` every 10 seconds to indicate ongoing analysis.
- On success, outputs `OK:filename:session_id`; appends `(temp copy)` when degraded.
- Automatically retries using a Temp copy upon failure.

**Usage**:
```bash
arsenal scripts re-ida-reverse/open "/path/to/file.exe" [port]
```

**Output Conventions**:
```
# Analysis in progress (output every 10 seconds)
INFO:opening:11/600s

# Successfully opened
OK:sample.exe:abcd1234

# Successfully opened, but degraded to Temp copy due to file locks
OK:1234abcd-sample.exe:abcd1234 (temp copy)

# Timeout limit reached
ERR:open_timeout_600s
```

**Field Notes**:
- In testing, `Snipaste.exe` took about `324s` to complete with auto-analysis enabled; this indicates a lengthy analysis process rather than a script freeze.
- Therefore, when analyzing GUI applications or complex samples, it is recommended to explicitly set `-TimeoutSeconds 600`.

## Core Tool List

### Triage Analysis (First Step)
- `idapro_survey_binary(detail_level="minimal")` — Quick overview: function count, strings, segments, entry points, categorized imports (crypto/network/file IO).
- `idapro_list_funcs(queries)` — List functions (paginated, filter by name).
- `idapro_list_globals(queries)` — List global variables.
- `idapro_entity_query(kind, filter)` — Unified query: functions/globals/imports/strings/names.

### Decompilation and Disassembly
- `idapro_decompile(addr)` — Decompile to pseudocode.
- `idapro_disasm(addr, max_instructions=N)` — Disassemble instructions.
- `idapro_analyze_function(addr, include_asm=false)` — Comprehensive analysis (pseudocode + strings + constants + callers + callees + blocks).
- `idapro_func_profile(queries)` — Function summary profile metrics.

### Cross-References and Data Flow
- `idapro_xrefs_to(addrs)` — Check what references the target address.
- `idapro_xref_query(addr, direction)` — Advanced xref query (direction/type filtering).
- `idapro_callees(addrs)` — List child functions / callees.
- `idapro_callgraph(roots, max_depth)` — Call graph generation.
- `idapro_trace_data_flow(addr, direction, max_depth)` — Data flow tracking (forward/backward).

### Search
- `idapro_find_regex(pattern, limit)` — Regex search across strings.
- `idapro_search_text(pattern)` — Search text across disassembly listing.
- `idapro_find_bytes(patterns, limit)` — Byte pattern search (supports `??` wildcards).
- `idapro_find(type, targets)` — Advanced search (immediates/strings/references).

### Memory and Data
- `idapro_get_bytes(addrs)` — Read raw bytes.
- `idapro_get_string(addrs)` — Read strings.
- `idapro_get_int(queries)` — Read integer values.
- `idapro_get_global_value(queries)` — Read global variable values.
- `idapro_read_struct(queries)` — Read struct member values.
- `idapro_search_structs(filter)` — Search structs.

### Modifications
- `idapro_set_comments(items)` — Add comments (synchronized across disassembly and decompilation).
- `idapro_append_comments(items)` — Append comments.
- `idapro_rename(batch)` — Batch rename (functions/globals/locals/stack variables).
- `idapro_patch_asm(items)` — Patch assembly instructions.
- `idapro_patch(patches)` — Patch raw bytes.
- `idapro_define_func(items)` — Define functions.
- `idapro_undefine(items)` — Undefine instructions/data.
- `idapro_define_code(items)` — Convert bytes to code.

### Type System
- `idapro_declare_type(decls)` — Declare C structs/enums/unions.
- `idapro_set_type(edits)` — Apply types to functions/globals/locals.
- `idapro_infer_types(addrs)` — Infer types.
- `idapro_type_query(queries)` — Query declared types.
- `idapro_type_inspect(queries)` — Inspect type details.

### Stack Frame
- `idapro_stack_frame(addrs)` — View stack frame variables.
- `idapro_declare_stack(items)` — Declare stack variables.
- `idapro_delete_stack(items)` — Delete stack variables.

### Signatures
- `idapro_make_signature(addrs)` — Generate unique byte signature for an address.
- `idapro_make_signature_for_function(addrs)` — Generate signature for a function.
- `idapro_find_xref_signatures(addrs)` — Generate signatures for code referencing target addresses.

### Debugger (Requires ?ext=dbg)
- `idapro_open_file(file_path)` — Open file in GUI IDA instance.
- Debugger tools are hidden by default; enable via URL parameter `?ext=dbg`.

### Session Management (ida-pro-mcp 2.x)
- `idapro_idb_open` / HTTP `idb_open` — ⚠️ Recommended to open via `arsenal scripts re-ida-reverse/open`.
- `idapro_idb_list` / HTTP `idb_list` — List all active sessions.
- `idapro_idb_save` / HTTP `idb_save` — Save database.
- Most analysis tools require the `database=<session_id>` parameter (session returned by `arsenal scripts re-ida-reverse/open`).

### Miscellaneous
- `idapro_int_convert(inputs)` — Radix conversion (**MUST use this; do not calculate bases manually!**).
- `idapro_export_funcs(addrs, format)` — Export functions (json/c_header/prototypes).
- `idapro_py_eval(code)` — Execute Python within IDA context.
- `idapro_server_health()` — Server health check.
- `idapro_server_warmup()` — Warm up subsystems (string cache, Hex-Rays, etc.).

## Complete Reverse Engineering Workflow

### Step 1: Start Server

**Path A — Headless idalib (Requires valid license)**
```bash
arsenal scripts re-ida-reverse/start
```
Output `OK:<tool_count>` (currently ~65) indicates readiness.

**Path B — GUI + Plugin (Fallback when idalib license fails or interactive analysis is required)**
```bash
arsenal scripts re-ida-reverse/start-gui "target.exe"
```
Or double-click the portable `Launch-IDA-Pro.cmd` and open the sample inside IDA.

Once the Output window shows `[MCP] ... port=13337`, MCP tools are ready.

For general setup procedures, see `LOCAL-SETUP.md`.

### Step 2: Open File

Headless:
```bash
arsenal scripts re-ida-reverse/open "target.exe"
```
Output `OK:filename:session_id` indicates success (suffixed with `(temp copy)` if degraded to a temporary copy).

If `ERR:idalib_license:...` appears, switch to Path B (GUI mode); do not retry `arsenal scripts re-ida-reverse/open` repeatedly.

GUI mode: Open the sample directly inside IDA; `arsenal scripts re-ida-reverse/open` is not required.

### Step 3: Global Overview (Including Import Table Hard Gate)
```
idapro_survey_binary(detail_level="minimal")
```
Focus on:
- Architecture (x86/x64/ARM)
- Entry points (main/WinMain/DllMain)
- Interesting strings (URLs, paths, error messages)
- **Categorized Imports (MUST)**: Crypto functions / Network APIs / File operations / Process injection / Registry — MUST be recorded as Evidence (recommended id: `E-imports`), via `idapro_entity_query(kind="imports")` or the imports section in survey output.
- **DLL/SYS**: Export tables side-by-side with import tables (Evidence `E-exports`).
- **.NET**: When standard IAT is missing, write module/metadata/managed references summary as the equivalent anchor into the `E-imports` semantic slot.
- **Clean Import Table**: Note suspicion of dynamic loading; push for dynamic API breakpoint verification.
- High-interest functions (functions with high xref counts usually contain critical logic).

**Hard Gate**: Before recording the imports view/categorization summary (or legitimate equivalent anchor) into Evidence, you MUST NOT proceed to Step 4 deep-dive conclusions, and MUST NOT claim survey completion. If the import table is empty or query fails, you STILL MUST record the failure phenomenon. If packed IAT repair fails, you MUST record `E-iat-repair-fail` and transition to dynamic debugging API tracing; do not persist stubbornly with static analysis. When a user requests re-checking import tables/IAT, you MUST re-execute the specified step (if blocked, feasibility latch: Notes + confirmation; if forced, mark `quality=unreadable`); switching to unrelated steps is prohibited.

### Step 4: Deep Dive into Critical Functions
```
idapro_analyze_function(addr="critical_function_name")
```
Or:
```
idapro_decompile(addr="function_name")
idapro_disasm(addr="function_name", max_instructions=50)
```

### Step 5: Data Flow and Cross-References
```
idapro_xrefs_to(addrs="target_address_or_string")
idapro_callgraph(roots=["critical_function"], max_depth=3)
idapro_trace_data_flow(addr="target_address", direction="backward", max_depth=5)
```

### Step 6: Documentation and Optimization
```
idapro_set_comments(items=[{"addr": "0x140001000", "comment": "Your interpretation"}])
idapro_rename(batch={"func": [{"addr": "function_address", "name": "meaningful_name"}]})
```

### Step 7: Output Report
After completing the analysis, generate `report.md` documenting findings and steps taken.

## Prompt Engineering Guidelines

1. **Do not calculate radices manually** — Whenever number conversion is needed, use `idapro_int_convert`.
2. **Survey first, dive deep later** — Inspect high-level triage first before targeted deep analysis.
3. **Continuously annotate and rename** — Update function and variable names throughout analysis to improve subsequent decompilation accuracy.
4. **Follow cross-references** — When interesting data/strings are identified, use `xrefs_to` to locate references.
5. **Handling obfuscated code** — Prioritize string decryption, import de-hashing, and control-flow de-flattening preprocessing first.
6. **C++ STL code** — Use FLIRT/Lumina to identify standard library functions before analyzing business logic.
7. **Do not brute-force** — Derive logic from disassembly, leveraging lightweight Python scripts for auxiliary math.
8. **When seeing "No database bound"** — No binary file is loaded yet; execute `arsenal scripts re-ida-reverse/open` first.
9. **When seeing "Failed to open database"** — An old database file may be locked; `arsenal scripts re-ida-reverse/open` will automatically degrade to a Temp copy (output will contain `(temp copy)`).
10. **Opening GUI/complex samples with auto-analysis** — Add `-TimeoutSeconds 600` by default; do not mistake prolonged `INFO:opening:...` logs for script freezes.

---

## Routing Context

**Upstream Entry**: `skill://re-ida-reverse/support/SKILL.md` (Master Controller), `skill://re-ida-reverse/support/routing.md`
**Upstream Alternatives**: `re-radare2/` (For fast initial reconnaissance if IDA startup is deferred)
**Downstream Exit**:
- Dynamic verification via Frida required → `arsenal skill_load re-reverse-engineering/tools-dynamic.md`
- Symbolic execution/angr required → `arsenal skill_load re-reverse-engineering/tools-dynamic.md`
- General reverse engineering methodology → `arsenal skill_load re-reverse-engineering`

**Related Sibling Modules**: `re-radare2/` (Alternative when IDA is unavailable)

---

## On-Demand Bootstrap

Entry scripts for this skill are integrated into the unified bootstrap system.

### Automation Capability Boundaries

| Tool | Auto-installable | Installation Method | Notes |
|------|------------------|---------------------|-------|
| idalib-mcp | ✓ | pip install (from GitHub) | Automatically installed via `arsenal scripts re-ida-reverse/start` when missing |
| IDA Pro Core | ✗ | Commercial software, requires manual installation | Set `IDADIR` environment variable pointing to installation directory |

### Installation Steps (Verified)

```cmd
# 1. Set IDA path (replace with your actual IDA installation directory)
setx IDADIR "<your_IDA_installation_path>"

# 2. Install ida-pro-mcp from GitHub (ida-mcp on PyPI is a different project, do not confuse them!)
pip install git+https://github.com/mrexodia/ida-pro-mcp.git

# 3. Install IDA plugin (Select Streamable HTTP + Global + Check all clients)
ida-pro-mcp --install

# 4. Restart IDA Pro and open the target file
# Plugin automatically listens on 127.0.0.1:13337

# 5. Verify
ida-pro-mcp --config
```

> ⚠️ **Notice**: The `ida-mcp` package on PyPI (authored by jtsylve) is a separate project and not what is required here.
> You must install `mrexodia/ida-pro-mcp` from GitHub.

### Bootstrap Triggers

- `arsenal scripts re-ida-reverse/start`: Automatically invokes `bootstrap-reverse.ps1` when `idalib-mcp` is missing.
- MCP Registration: Bootstrap automatically writes `idapro` into Claude MCP configuration.

### Prerequisites

- IDA Pro is installed and `IDADIR` environment variable is configured (or script default paths are valid).
- Recommended to use `ida-pro-mcp` under IDA's bundled Python314 (built into portable versions).
- Typical local machine setup:
  - User env `IDADIR` → IDA installation folder (containing `ida.exe`).
  - Optional `~\Tools\bin\idalib-mcp.cmd` / `ida-pro-mcp.cmd` wrappers.
  - Client MCP server configuration retains only `idapro` → `http://127.0.0.1:13337/mcp`.

## References

- `skill://re-ida-reverse/references/ida-mcp-cheatsheet.md` — IDA Pro MCP tool reference and command patterns

## Task Completion Self-Check (MUST pass before claiming completion)

- [ ] Did I execute each step in the workflow (rather than only reading)?
- [ ] Have survey/imports been recorded into Evidence (E-imports or equivalent)? Does DLL/SYS contain E-exports? Was E-iat-repair-fail logged on IAT failure?
- [ ] If the user requested re-running the import table/IAT inspection, did I re-execute that exact step?
- [ ] Did I use verified tool paths based on `tool-index`?
- [ ] Did I produce reproducible evidence (commands/templates/screenshots/reports)?
- [ ] Did I complete and verify the Checklist items required by RULES?
