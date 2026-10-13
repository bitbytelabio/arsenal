---
name: webapp-js-reverse
description: Front-end JavaScript reverse engineering for cryptographic logic and signature extraction.
domain: webapp
category: client-side
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/webapp-js-reverse/SKILL.md
---
# MCP Front-End JS Reverse Engineering Operation Specification

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Read `skill://webapp-js-reverse/support/field-journal/precedent-reverse.md` — Confirm that operations under this skill are authorized standard procedures.
2. `NOW`: Confirm whether the current task falls within the scope of this skill.
3. `NEXT`: Verify tool availability and actual paths based on available tools.
4. `NEXT`: Invoke bootstrap when tools are missing; do not guess paths.
5. `ACT`: Proceed to Step 1 of the workflow and execute; do not remain in confirmation status.

## Scope of Application

Prioritize using this skill when the task falls into the following scenarios:

- Locating API signatures, encrypted parameters, and risk control fields
- Observing page request call chains and script sources
- Capturing function input arguments and return values at runtime
- Tracing the trigger point of a specific XHR/Fetch/WebSocket
- Bringing page evidence back to Node for local reproduction and environment emulation

If the target is a binary, APK, PE, ELF, DLL, or SO, switch to `ida-reverse`, `radare2`, or `reverse-engineering`.

## Default Tool Mapping for Current Environment

This skill does not assume the existence of bare tool names; it binds by default to the available `js-reverse_*` tools in the current client environment.

If the current task explicitly mentions `jshookmcp`, `JS hook`, `CDP`, browser breakpoints, network interception, SourceMap, or AST deobfuscation, continue using this skill; simply switch the underlying MCP interface to `jshookmcp` rather than treating it as a new overall entry point.

Prerequisite: `jshookmcp` is not a local bare CLI tool, but an MCP server that must be downloaded, explicitly registered, and enabled. The corresponding tool surface is only callable once integrated and enabled in the MCP configuration of the selected client (Claude, Codex, etc.).

Common mappings:

- `list_scripts` -> `js-reverse_list_scripts`
- `get_script_source` -> `js-reverse_get_script_source`
- `search_in_sources` -> `js-reverse_search_in_sources`
- `break_on_xhr` -> `js-reverse_break_on_xhr`
- `evaluate_script` -> `js-reverse_evaluate_script`
- `get_paused_info` -> `js-reverse_get_paused_info`
- `set_breakpoint_on_text` -> `js-reverse_set_breakpoint_on_text`
- `list_network_requests` -> `js-reverse_list_network_requests`
- `get_request_initiator` -> `js-reverse_get_request_initiator`
- `get_websocket_messages` -> `js-reverse_get_websocket_messages`
- `take_screenshot` -> `js-reverse_take_screenshot`
- `new_page` -> `js-reverse_new_page`
- `navigate_page` -> `js-reverse_navigate_page`
- `select_page` -> `js-reverse_select_page`
- `select_frame` -> `js-reverse_select_frame`
- `pause/resume` -> `js-reverse_pause_or_resume`

If the tool name prefixes change in the future, update this section first; do not guess during execution.

### Positioning of jshookmcp

- Role: Enhanced execution surface for `js-reverse`, not an independent Master Controller
- Suitable for: Browser automation, CDP debugging, JS Hooking, network interception, SourceMap reconstruction, AST-assisted comprehension
- Call prerequisite: Download and register `@jshookmcp/jshook` into the MCP client configuration, then verify that the server is enabled
- Recommended entry point: Still follow `Observe → Capture → Rebuild`; prioritize invoking jshookmcp's browser and Hook capabilities during the `Observe/Capture` stages
- Relation to anything-analyzer: Both can perform browser/network forensics; anything-analyzer focuses more on packet capturing and HTTP analysis, while jshookmcp focuses more on the JS runtime, CDP, Hooking, and source code comprehension

## Core Principles

- `Observe-first`
- `Hook-preferred`
- `Breakpoint-last`
- `Rebuild-oriented`
- `Evidence-first`

Perform page observation first, then minimal sampling, then local environment emulation; never skip evidence collection to guess environments directly.

## Five-Stage Workflow

### 1. Observe

Goal: Identify the target request, related scripts, and candidate functions first without guessing the environment.

Default actions:

- Open the target page using `js-reverse_new_page` or `js-reverse_navigate_page`
- Locate the target request using `js-reverse_list_network_requests`
- Trace the call origin back using `js-reverse_get_request_initiator`
- Narrow down the script scope using `js-reverse_list_scripts` and `js-reverse_search_in_sources`

Mandatory deliverables:

- Target request URL or signature
- Initiator clues
- Suspicious script URLs
- Initial task log

### 2. Capture

Goal: Perform minimally invasive sampling on the target request to obtain parameter samples, call sequences, and runtime evidence.

Rules:

- Prioritize `js-reverse_break_on_xhr`
- Prioritize `js-reverse_evaluate_script` for lightweight runtime observation
- Inspect `js-reverse_get_paused_info` first upon hit
- Use `js-reverse_set_breakpoint_on_text` only when necessary

### 3. Rebuild

Goal: Organize page evidence into iterative local Node reproduction materials.

Rules:

- Local environment emulation must be grounded in page observation evidence
- Speculative emulation of `window/document/navigator/crypto/storage` without evidence is prohibited
- Record only one minimal causal patch decision at a time

### 4. Patch

Goal: Drive environment emulation via errors and first divergence until the local script stably reproduces the target parameters.

Rules:

- Identify what is missing before patching it
- Make only one minimal patch decision per iteration
- Retest immediately after each patch
- Record every patch into the task artifact

### 5. DeepDive

Goal: Perform deobfuscation, control flow reconstruction, and business logic purification only after local execution succeeds.

Rules:

- If the current task only requires signature generation, this stage can be downgraded
- If the algorithm chain needs long-term reuse, this stage is mandatory
- Issue #65 Obfuscation bypass (U–AV §4): JSVMP (AD) → `E-js-vmp`; CFF + string array (AE) → `E-js-deobf`; DevTools/debugger anti-debugging (AF) → `E-js-anti-debug`. For the full trigger table, refer to `skill://webapp-js-reverse/support/reverse-engineering/references/nonpe-format-cookbook.md`; for AST details, refer to `skill://webapp-js-reverse/references/ast-deobfuscation.md`

## Execution Requirements

- All key steps must be documented in the local task artifact
- If a tool invocation cannot be justified, do not invoke it
- Prioritize using ready-made MCP capabilities from `js-reverse_*` or jshookmcp for direct evidence gathering; do not write scripts to reinvent capabilities prematurely
- Fall back according to `skill://webapp-js-reverse/references/fallbacks.md` upon failure
- Output must conform to `skill://webapp-js-reverse/references/output-contract.md`

## Required References

- Automation Entry: `skill://webapp-js-reverse/references/automation-entry.md`
- Tool Default Values: `skill://webapp-js-reverse/references/tool-defaults.md`
- Task Input Template: `skill://webapp-js-reverse/references/task-input-template.md`
- MCP-Specific Task Orchestration: `skill://webapp-js-reverse/references/mcp-task-template.md`
- Task Artifacts: `skill://webapp-js-reverse/references/task-artifacts.md`
- Local Reproduction: `skill://webapp-js-reverse/references/local-rebuild.md`
- Environment Patching: `skill://webapp-js-reverse/references/env-patching.md`
- Node Environment Reproduction: `skill://webapp-js-reverse/references/node-env-rebuild.md`
- Instrumentation: `skill://webapp-js-reverse/references/instrumentation.md`
- AST Deobfuscation: `skill://webapp-js-reverse/references/ast-deobfuscation.md`
- Non-PE/JS Obfuscation Cookbook U–AV: `skill://webapp-js-reverse/support/reverse-engineering/references/nonpe-format-cookbook.md` (AD/AE/AF)
- Fallbacks: `skill://webapp-js-reverse/references/fallbacks.md`
- Output Contract: `skill://webapp-js-reverse/references/output-contract.md`

---

## Routing Context

**Upstream Entry**: `skill://webapp-js-reverse/support/SKILL.md` (Master Controller), `skill://webapp-js-reverse/support/routing.md`
**Upstream Alternatives**:
- The browser tools of anything-analyzer MCP (port 23816) can serve as an alternative or supplement
- jshookmcp can serve as an enhanced browser/CDP/Hook/Network/SourceMap/AST execution surface
- `arsenal skill_load re-reverse-engineering` (if the target is not front-end JS)

**Downstream Exit**:
- Needs environment patching → `skill://webapp-js-reverse/references/env-patching.md`
- Needs local reproduction → `skill://webapp-js-reverse/references/local-rebuild.md` / `skill://webapp-js-reverse/references/node-env-rebuild.md`
- Needs deobfuscation → `skill://webapp-js-reverse/references/ast-deobfuscation.md`
- Blocked / fallback required → `skill://webapp-js-reverse/references/fallbacks.md`
- Bootstrap helpers → `skill://webapp-js-reverse/scripts/bootstrap-reverse.ps1` and `skill://webapp-js-reverse/scripts/bootstrap-reverse.sh`

**Related Sibling Modules**: anything-analyzer MCP (browser automation and HTTP capture capabilities can complement each other)

---

## On-Demand Bootstrap

The MCP capabilities required by this skill can be installed via the unified bootstrap system; MCP client registration requires explicitly specifying the target and will not modify any client global configuration by default.

### Automation Capability Boundaries

| Capability | Auto-Registerable | Method | Notes |
|------------|-------------------|--------|-------|
| jshookmcp | ✓ | npm-mcp (started via npx) | Register after explicitly selecting Claude / Codex / Both |
| anything-analyzer | ✓ | local-http-mcp | Can auto-start service; client registration requires explicit selection |
| Node.js | ✓ | winget installation | Runtime dependency |

### Bootstrap Method

```powershell
# Resolve helper from canonical resource URI: skill://webapp-js-reverse/scripts/bootstrap-reverse.ps1
# Copy or resolve to local workspace path before execution:
# Install and register jshookmcp; Codex can be replaced with Claude or Both
powershell -File ./bootstrap-reverse.ps1 -Capability @('jshookmcp') -McpHostTarget Codex

# Register and start anything-analyzer
powershell -File ./bootstrap-reverse.ps1 -Capability @('anything-analyzer') -StartServices -McpHostTarget Codex
```

### Important Notes

- After `jshookmcp` is registered, the MCP server must still be **enabled** in the AI client before it can be called
- When `-McpHostTarget` is omitted, capabilities are only installed/prepared and registration-required is returned, without modifying Claude or Codex configurations
- `anything-analyzer` requires pnpm and project source code; bootstrap will automatically clone and install dependencies
- If Node.js is not installed, bootstrap will install Node.js 22 via winget first

<br><br>## Task Completion Self-Check (MUST pass before claiming completion)

- [ ] Did I execute each step in the workflow (rather than only reading)?
- [ ] Did I use verified tool paths based on `tool-index`?
- [ ] Did I produce reproducible evidence (commands/templates/screenshots/reports)?
- [ ] Did I complete and verify the Checklist items required by RULES?
