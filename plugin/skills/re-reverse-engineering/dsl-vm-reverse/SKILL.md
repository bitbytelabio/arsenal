---
name: dsl-vm-reverse
description: Reverse JavaScript-based custom DSL/VM interpreters, non-standard WASM-like runtimes, and risk-control engines. Use when analyzing IIFE or switch-based opcode dispatchers, extracting instruction tables, recovering bytecode semantics, capturing VM state at runtime, or reconstructing execution flow.
---

# DSL Custom Virtual Machine Reverse Engineering

## ACTION REQUIRED (Execute immediately upon reading)

1. `NOW`: Confirm the current task is a custom JS opcode VM or risk-control engine, not standard WASM or ordinary webpack bundles.
2. `NOW`: Run `case-init` (resolve from `arsenal scripts case-init`) until `scope.md` is ready; use `offline` or `lab` for offline samples.
3. `ACT`: Start file classification from "3. General Reverse Engineering Workflow" Phase 1; do not stop at directory listings.

> Used for reverse engineering JavaScript-based custom WASM-like virtual machines and risk-control engines.

---

## Table of Contents

- [1. Scope of Application](#1-scope-of-application)
- [2. DSL VM Identification Signatures](#2-dsl-vm-identification-signatures)
- [3. General Reverse Engineering Workflow](#3-general-reverse-engineering-workflow)
- [4. Opcode Extraction and Classification](#4-opcode-extraction-and-classification)
- [5. Runtime Capture Solutions](#5-runtime-capture-solutions)
- [6. Common Status Codes](#6-common-status-codes)
- [7. Skill Self-Check Checklist](#7-skill-self-check-checklist)

---

## 1. Scope of Application

Use this skill when the target file matches **any** of the following characteristics:

| # | Characteristic | Description |
|---|----------------|-------------|
| 1 | Starts with an IIFE + numerous single-letter variable names | `!function(){var U=void 0,y=parseInt,E0=Function,...}` |
| 2 | Contains `DG()` or a similar function with a switch-case loop | Main interpreter loop, `d[7]&31` decodes the opcode |
| 3 | Large file (500KB+) with zero-byte ratio < 1% | Non-standard WASM, pure JS |
| 4 | Contains `C[number]` constant table references | `C[9][xxx]` function table / string table |
| 5 | Single-line minified code | 583KB single line with obfuscated variable names |

### Exclusion Rules

| Condition | Not This Skill | Route To |
|-----------|----------------|----------|
| File starts with `\x00asm` | Standard WASM binary | `skill://re-reverse-engineering/languages.md` |
| File starts with `Uint8Array([0,97,115,109])` containing WASM magic bytes | Embedded WASM | Extract `.wasm` then route to `skill://re-ida-reverse/SKILL.md` or `skill://re-ghidra-reverse/SKILL.md` |
| Standard Webpack bundle (`function(e,t,n){...}`) | Standard JS | `skill://webapp-js-reverse/SKILL.md` |
| Zero-byte ratio > 20% | WASM binary | `skill://re-reverse-engineering/languages.md` |

---

## 2. DSL VM Identification Signatures

### Code Signatures

```javascript
// Signature 1: IIFE entry, single-letter variables mapping numeric constants
!function(){
    var U=void 0, y=parseInt, E0=Function, AN=Uint8Array;
    var E=15, l=10, m=12, x=16, S=13, $=11;
    // Numeric constants mapped to variable names replacing raw numbers
    ...
}

// Signature 2: Main interpreter loop DG()
function DG(C, d, ...) {
    var d = [];  // Array simulating WASM stack/locals
    for (d[7] = x; d[7] !== U;) {
        var aE = d[7] & 31;         // Low 5 bits = opcode
        var O = d[7] >> 5 & 31;      // Next 5 bits = sub-operation
        switch (aE) {
            case 0: /* ... */ d[7] = 612; break;
            case 1: /* ... */
            // ... N cases
        }
    }
}

// Signature 3: Constant table C[9] storing function indices and strings
// C[9][0] = ["pc"]      -> Function parameter descriptor
// C[9][667] = "string"  -> String constant
// C[9][x] = number      -> Function index

// Signature 4: W(C[index], null, ...) invocation pattern
// W = Function.prototype.call.bind(call)
// All built-in functions are invoked via C[index] lookup

// Signature 5: Instruction encoding format
// d[7] = opcode(bit 0-4) | subop(bit 5-9) | operand(bit 10+)
```

### Opcode Encoding Format

Each instruction is encoded as a 32-bit integer:

```text
bit 0-4:   opcode (0-N)
bit 5-9:   sub-operation (0-31)
bit 10-31: operand / immediate value

Decoding:
  aE = d[7] & 31        -> opcode
  O  = d[7] >> 5 & 31   -> sub-operation
  d[other] = d[7] >> 10  -> operand
```

---

## 3. General Reverse Engineering Workflow

### Phase 1: File Classification (5 minutes)

```bash
# Check whether target.js is a DSL VM
python3 << 'EOF'
with open('target.js', 'rb') as f:
    head = f.read(100)

# 1. Check WASM magic bytes
if head[:4] == b'\x00asm':
    print("Standard WASM binary")
    exit()

# 2. Check zero-byte percentage
data = open('target.js', 'rb').read()
zero_pct = data.count(b'\x00') / len(data) * 100
print(f"Zero-byte ratio: {zero_pct:.1f}%")

if zero_pct > 20:
    print("WASM binary")
elif head[:2] == b'!f':
    # Check single-letter variable pattern
    if b'var U=void 0' in head or b'U=void 0,y=parseInt' in head:
        print("-> DSL VM!")
    else:
        print("Standard JS IIFE")
EOF
```

### Phase 2: Variable Mapping Table Extraction (10 minutes)

```python
import re

with open('target.js', 'r', errors='replace') as f:
    s = f.read()

# Extract var X=number mappings from the first 2000 characters
mappings = re.findall(r'var\s+(\w+)\s*=\s*(\d+)', s[:2000])
print('Constant mappings:')
for name, val in mappings:
    print(f"  {name:4s} = {val:3d} (0x{int(val):02x})")
```

### Phase 3: Opcode Extraction and Classification (15 minutes)

```python
# 1. Extract all cases
all_cases = re.findall(r'case\s+(\d+):', s)
unique = sorted(set(int(c) for c in all_cases))

print(f"Total cases: {len(all_cases)}")
print(f"Unique opcodes ({len(unique)}): {unique}")

# 2. Classify each opcode
for op in unique:
    idx = s.find(f'case {op}:')
    snippet = s[idx:idx+200]
    if 'd[7]=' in snippet:
        op_type = 'BRANCH'
    elif 'return' in snippet:
        op_type = 'RETURN'
    elif 'W(C[' in snippet:
        op_type = 'CALL'
    elif 'new' in snippet:
        op_type = 'ALLOC'
    elif 'try' in snippet or 'catch' in snippet:
        op_type = 'EXCEPTION'
    else:
        op_type = 'ARITH/STORE'
    print(f"  opcode {op:2d}: {op_type}")
```

### Phase 4: Constant Table Analysis (30 minutes)

```python
const_refs = re.findall(r'C\[9\]\[(\d+)\]', s)
unique_refs = sorted(set(int(x) for x in const_refs))

print(f"C[9] references: {len(unique_refs)} indices")
print(f"Range: {min(unique_refs)} - {max(unique_refs)}")

# Inspect context for each reference
for ref in unique_refs[:20]:
    idx = s.find(f'C[9][{ref}]')
    ctx = s[max(0,idx-50):idx+80]
    clean = ''.join(c if c.isprintable() else ' ' for c in ctx)
    print(f"  C[9][{ref}] -> {clean}")
```

### Phase 5: Exported Function Tracing (1-2 hours)

Locate exported functions (such as `getToken`) along the following path:

```text
1. Find AWSCInner.register() or similar registration calls
2. Identify the registered module and factory function
3. Locate the object returned by the factory function -> exported function definition site
4. If the function name is not in plain JS -> stored as bytecode in the C[9] constant table
5. Trace the call chain:
   AWSCInner._modules['fy'].getToken()
   -> W(C[func_index], null, ...)
   -> DG() interpreter executes the encoded instruction sequence
```

### Phase 6: Runtime Injection (when static analysis is insufficient)

```javascript
// Inject minimal AWSC-compatible environment
const fakeEnv = {
    AWSCInner: {
        _modules: {},
        register(name, moduleName, factory) {
            this._modules[moduleName] = factory();
        }
    }
};

// Execute DSL VM code
dslVmCode();

// Obtain exported function output
const token = fakeEnv.AWSCInner._modules['fy'].getToken({});
```

---

## 4. Opcode Extraction and Classification

### Reference Opcode Table (Based on Prior Cases)

| Opcode | Operation Type | Signature |
|--------|---------------|-----------|
| 0 | **BRANCH** | `d[7]=xxx` unconditional jump |
| 1 | **CALL** | `W(C[Y],null,function(){...})` embedded function call |
| 2 | **ARITH** | `d[4]=0`, `d[7]=72` variable assignment |
| 3 | **ARITH** | `d[0]=d[1][C[x]]`, `d[5]=d[0]<d[3]` comparison operation |
| 4 | **STORE** | `d[8]=d[5]in d[4]` property access / existence check |
| 5 | **ARITH** | `d[8]=d[4]-d[8]` arithmetic operation |
| 6 | **RETURN** | `return gV`, `throw` return / exception throw |
| 7 | **ALLOC** | `d[6]=[]`, `d[6][C[8]](...)` push operation |
| 8 | **BRANCH** | `d[7]=d[k]?512:425` conditional jump |
| 9 | **STRING** | `d[6][C[t]]=d[m]`, `new fh(...)` regular expression |
| 10 | **ALLOC** | Function argument preparation, call stack setup |
| 11 | **STRING** | `new fh("\\s",d[5])` regex matching |
| 12 | **STORE** | `P[d[9]]=d[4][C[H]](d[3])` data transfer |
| 13 | **CALL** | `C[9][113]=d[9]` module initialization |
| 14 | **STRING** | `d[8]=d[9]+d[m]` string concatenation |
| 15 | **RETURN** | `return EL;` function return |
| 16 | **ALLOC** | `var r,P,Z,B...` local variable declaration |
| 17 | **ALLOC** | `(Z=[])[C[8]](69,T,445)` static array initialization |
| 18 | **TABLE** | Function table / type table initialization |
| 19 | **EXCEPTION** | `try{for(var RK=x;...` try-catch loop |
| 20 | **DOM** | `Is[d[o]]` DOM operation |
| 21 | **STORE** | Safe global / object property retrieval |
| 22 | **STRING** | `new fh(r,v)` string / regex processing |
| 23 | **BRANCH** | `try...catch` safe retrieval + conditional jump |
| 24 | **CALL** | `W(C[2],null,8,z,FL)` multi-argument function call |
| 25 | **EXCEPTION** | `try{...}catch(C){...}` exception catch + jump |

---

## 5. Runtime Capture Solutions

### Option A: Selenium + Native CDP Events (Recommended, Highest Success Rate)

```python
from selenium import webdriver

driver = webdriver.Chrome()

# Inject anti-detection overrides
driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
    "source": r"""
        Object.defineProperty(navigator, 'webdriver', {get: () => false});
        Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
        Object.defineProperty(navigator, 'languages', {get: () => ['en-US','en']});
    """
})

# Dispatch native CDP mouse event
driver.execute_cdp_cmd("Input.dispatchMouseEvent", {
    "type": "mousePressed",
    "x": 549.5, "y": 441.2,
    "button": "left", "buttons": 1,
    "clickCount": 1, "pointerType": "mouse"
})
```

### Option B: Playwright Headless Browser

```javascript
const { chromium } = require('playwright');

async function run() {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Intercept network requests
    await page.route('**/api/**', async route => {
        await route.continue_();
    });

    await page.goto('https://target-page.com');

    // Wait for DSL VM initialization
    await page.waitForFunction(() => {
        return window.AWSCInner &&
               window.AWSCInner._modules &&
               window.AWSCInner._modules['fy'];
    });

    // Execute interaction sequence
    await page.mouse.move(500, 400);
    await page.mouse.down();
    // ... interaction sequence
    await page.mouse.up();
}
```

### Option C: Pure Protocol Verification (Very Low Success Rate)

> Tokens generated by DSL VMs are typically tightly bound to browser context (TLS JA3 fingerprint, IP, cookies, headers, etc.). Outside the browser, the server detects context mismatches. **Pure protocol replay is not recommended.**

---

## 6. Common Status Codes

| Code | Meaning | Handling |
|------|---------|----------|
| 0 | **Verification Passed** | Extract `sessionId` + `sig` |
| 300 | **Risk Control Blocked** | Blocked by risk control; cannot pass directly |
| 8778 | **Verification Failed, Retry Needed** | Retry operation |
| 8776 | **Operation Too Fast, Retry Needed** | Increase delay and retry |
| 69634 | **Generic Failure** | Verify whether input parameters are well-formed |

---

## 7. Skill Self-Check Checklist

- [ ] Did I complete DSL VM identification (IIFE + single-letter variables + `DG()` interpreter)?
- [ ] Did I extract the variable mapping table (`var X=number`)?
- [ ] Did I extract and classify the opcode list?
- [ ] Did I analyze the reference range of the `C[9]` constant table?
- [ ] Did I locate the exported function registration site?
- [ ] When static analysis was insufficient, did I attempt runtime injection?
- [ ] Did I write lessons learned back to `skill://re-reverse-engineering/support/field-journal/_template.md` after completion?
- [ ] If new tools or scenarios were discovered, did I update `skill://re-reverse-engineering/support/routing.md`?

---

## Routing Registration

| Type | Route |
|------|-------|
| **Target Type**: WASM / DSL VM / Custom Instruction Set | `skill://re-reverse-engineering/dsl-vm-reverse/SKILL.md` |
| **User Intent**: "DSL VM / risk-control engine reverse engineering" | `skill://re-reverse-engineering/dsl-vm-reverse/SKILL.md` |
| **Toolchain**: Playwright / Selenium CDP | `skill://webapp-browser-automation/SKILL.md` |

### Path Crossing

```text
DSL VM Reverse Path:
  skill://re-reverse-engineering/dsl-vm-reverse/SKILL.md -> Phase 1-6 workflow
  ↓ If runtime data capture is required
  skill://webapp-browser-automation/SKILL.md -> Playwright/Selenium CDP
  ↓ If API protocol layer analysis is required
  skill://webapp-js-reverse/SKILL.md -> Observe->Capture->Rebuild
```
