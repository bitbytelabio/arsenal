---
name: webapp-browser-automation
description: Headless browser and UI automation for web vulnerability verification and interaction replay.
domain: webapp
category: client-side
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/webapp-browser-automation/SKILL.md
---
# Desktop & Browser Automation

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Confirm whether the current task falls within the scope of this skill.
2. `NOW`: Verify tool availability and actual paths based on available tools.
3. `NEXT`: Invoke bootstrap when tools are missing; do not guess paths.
4. `ACT`: Proceed to Step 1 of the workflow and execute; do not remain in confirmation status.

## Scope of Application

Use this skill when tasks fall under the following scenarios:

### Browser Scenarios (Playwright / agent-browser)
- Opening web pages and manipulating page elements (clicking, filling out forms, submitting)
- Scraping page content or taking screenshots
- Automated login workflows
- Interacting with web pages during security testing (submitting payloads, triggering XSS)
- Automated handling of CAPTCHA/verification code pages
- Batch form submission

### Desktop Application Scenarios (OpenReverse)
- Operating Windows desktop applications (IDA Pro, x64dbg, Wireshark, etc.)
- Visual-driven interaction needed (CUA mode)
- Structured UI operations needed (UIA mode)
- Monitoring desktop application network traffic (built-in mitmproxy)
- Automating reverse engineering tool GUI operations
- Black-box testing of desktop software

### Division of Labor with Other Tools

| Scenario | What to Use |
|----------|-------------|
| Operating web pages (in-browser) | **Playwright / agent-browser** |
| Operating desktop applications (Windows GUI) | **OpenReverse** |
| Packet capture analysis, HTTP request interception | anything-analyzer or OpenReverse network lane |
| JS breakpoints, Hooking, CDP debugging | jshookmcp |
| Locating signature algorithms, environment emulation/reproduction | js-reverse |

Simple decision rule:
- Target is a web page → Playwright
- Target is a Windows desktop application → OpenReverse
- Both are needed → Combine both

---

## Part 1: Browser Automation (Playwright / agent-browser)

### Core Workflow

```bash
# 1. Open page
agent-browser open <url>

# 2. Get interactive elements (returns @e1, @e2... references)
agent-browser snapshot -i

# 3. Operate on elements using references
agent-browser click @e1
agent-browser fill @e2 "text"

# 4. Close when finished
agent-browser close
```

### Command Reference

```bash
# Navigation
agent-browser open <url>
agent-browser close

# Page snapshot
agent-browser snapshot        # Full accessibility tree
agent-browser snapshot -i     # Interactive elements only (recommended)

# Interaction operations
agent-browser click @e1
agent-browser fill @e2 "text"
agent-browser type @e2 "text"
agent-browser press Enter
agent-browser scroll down 500

# Retrieve information
agent-browser get text @e1
agent-browser get title
agent-browser get url

# Waiting
agent-browser wait @e1
agent-browser wait 2000
agent-browser wait --load networkidle
```

### Important Notes
- `agent-browser close` must be executed; otherwise, processes will leak
- Always take a snapshot before operating; do not guess element references
- After submitting forms, use `wait --load networkidle` to wait for page stability

---

## Part 2: Desktop Application Automation (OpenReverse)

### Overview

[OpenReverse](https://github.com/zhexulong/openreverse) is a desktop interaction and evidence collection framework designed for AI Agents, supporting:
- **UIA Mode**: Windows UI Automation, structured desktop control operations
- **CUA Mode**: Visual-driven interaction (Computer Use Agent), suitable for complex GUIs
- **Network Observation**: Built-in mitmproxy proxy + local capture

### Choosing an Interaction Mode

| Mode | Suitable Scenario | Underlying Mechanism |
|------|-------------------|----------------------|
| UIA | Target application has standard Windows controls (buttons, text boxes, lists) | Windows UI Automation API |
| CUA | Target application has a complex UI or non-standard controls (IDA disassembly view, custom-rendered interfaces) | Visual recognition + mouse/keyboard |

### Network Observation Modes

| Mode | Suitable Scenario |
|------|-------------------|
| Proxy Lane | Target application can be configured to use a proxy (recommended) |
| Local Lane | Target application cannot route through a proxy, requiring local packet capture |

### Installation & Configuration

```bash
# 1. Clone project
git clone https://github.com/zhexulong/openreverse.git
cd openreverse

# 2. Install dependencies
npm install

# 3. Connect to Agent host (Claude Code / Codex / Zed)
npm run init:agents -- --target=all /path/to/project

# 4. Install CUA runtime (if visual-driven mode is needed)
npm run install:cua-runtime
npm run doctor:cua-runtime

# 5. Install network observation dependencies (if packet capture is needed)
npm run install:mitmproxy
npm run doctor:network
```

### Common Combinations

| Requirement | Configuration |
|-------------|---------------|
| Desktop application operation only | UIA or CUA, without attaching network lane |
| Desktop application operation + packet capture | UIA/CUA + proxy lane |
| Desktop application operation + local capture | UIA/CUA + local lane |

### Reverse Engineering Scenario Examples

```text
Scenario: Automating IDA Pro operations for batch analysis

1. Open IDA Pro using OpenReverse CUA mode
2. Automatically load the target binary
3. Wait for analysis to complete
4. Export the function list via UI operations
5. Simultaneously observe IDA's network behavior (such as Lumina requests) using the network lane
```

```text
Scenario: Automating x64dbg debugging operations

1. Launch x64dbg using OpenReverse UIA mode
2. Load the target program
3. Set breakpoints
4. Run and observe register/memory changes
5. Take screenshots to save evidence
```

---

## On-Demand Bootstrap

### Automation Capability Boundaries

| Tool | Auto-installable | Installation Method | Notes |
|------|------------------|---------------------|-------|
| Playwright | ✓ | npm + npx playwright install | Browser automation engine |
| agent-browser CLI | ✓ | npm install -g agent-browser | Browser operation CLI |
| Node.js | ✓ | winget | Prerequisite dependency |
| OpenReverse | ✗ | Manual clone + npm install | Experimental stage, heavy dependencies |
| mitmproxy | ✗ | Manual installation | Dependency for OpenReverse network observation |

### Bootstrap Triggers

- Browser operation missing Playwright → Automatic bootstrap
- Desktop operation requires OpenReverse → Guide user through manual installation (provide complete steps)

### OpenReverse Manual Installation Guide

If the AI detects that desktop application automation is required but OpenReverse is not installed:

```markdown
⚠️ **OpenReverse is required for desktop application automation**

**Installation Steps**:
1. `git clone https://github.com/zhexulong/openreverse.git`
2. `cd openreverse && npm install`
3. `npm run init:agents -- --target=all <your_project_path>`
4. If visual mode is needed: `npm run install:cua-runtime`
5. If network observation is needed: `npm run install:mitmproxy`

**Verification**: `npm run doctor:cua-runtime` and `npm run doctor:network`
```

---

## References

- `skill://webapp-browser-automation/references/playwright-cheatsheet.md` — Playwright automation and selector cheatsheet
- `arsenal scripts bootstrap-reverse` — Windows capability bootstrap script
- `arsenal scripts bootstrap-reverse` — POSIX capability bootstrap script

## Routing Context

**Upstream Entry**: `skill://webapp-browser-automation/support/SKILL.md` (Master Controller), `skill://webapp-browser-automation/support/routing.md`
**Applicable Scenarios**: Any task requiring automated browser or desktop application operations
**Downstream Exit**:
- Captured requests require analysis → `anything-analyzer` or `js-reverse`
- JS debugging/Hooking needed → `jshookmcp`
- Signature algorithm recovery needed → `js-reverse`
- Desktop application is a reverse engineering tool → `ida-reverse/`

**Related Sibling Modules**: `js-reverse` (JS analysis may be needed after browser interactions), `ida-reverse` (OpenReverse can automate IDA GUI operations)


## Task Completion Self-Check (MUST pass before claiming completion)

- [ ] Did I execute each step in the workflow (rather than only reading)?
- [ ] Did I use verified tool paths based on `tool-index`?
- [ ] Did I produce reproducible evidence (commands/templates/screenshots/reports)?
- [ ] Did I complete and verify the Checklist items required by RULES?
