# OLLVM Deobfuscation / Obfuscator-LLVM Deobfuscation

> Deobfuscation workflows targeting APK .so libraries, ELF binaries, and control flow flattening scenarios.
> Tool and variant information is based on active community project research as of 2026, not static training memory.
> Applicable to: Android NDK hardening, CTF reverse engineering, packed .so analysis, and commercial obfuscator countermeasures.

---

## 0. Quick Decision: Which Tool Should I Use?

Match your environment and target obfuscation type directly to the table below:

| Your Situation | Primary Tool | Alternative | Description |
|----------------|--------------|-------------|-------------|
| IDA Pro 7.5-7.7 + Hex-Rays available; want one-click deflattening | **obpo-plugin** | d810-ng | obpo utilizes microcode + data flow + concolic execution, delivering the strongest results; however, it is a cloud plugin (requires internet access, core engine is closed-source) |
| IDA Pro (any modern version) available; want local all-in-one deobfuscation | **d810-ng** | Original D-810 | Local, open-source, integrates Z3, supports multiple variants including OLLVM/Tigress/Hodur/Approov |
| Binary Ninja available | **ollvm-breaker** | — | Geared toward real-world Android .so workflows (hardened samples like libvdog) |
| No IDA/BN, script-only workflow, target is x86/x64 | **ollvm-unflattener** (Miasm) | angr deflat | Based on Miasm symbolic execution, handles multi-level structures via BFS |
| No IDA/BN, script-only workflow, target is x86/x64 | **ollvm-unflattener** (Miasm) | angr deflat | Based on Miasm symbolic execution, handles multi-level structures via BFS |
| Pure Python symbolic execution, CTF scenarios | **angr** Deobfuscator | Triton | GUI-independent, scriptable |
| Target is ARM64 .so, no IDA | **deollvm** (Unicorn) | angr | ARM64 deflat based on Unicorn |
| BR obfuscation encountered (indirect branching) | **DeObfBR** | Set data section to read-only | Goron/Arkari-style BR obfuscation can often be neutralized simply by marking data sections as read-only |
| Tigress obfuscation encountered | d810-ng `UnflattenerSwitchCase`/`UnflattenerTigressIndirect` | — | d810-ng includes dedicated built-in Tigress unflatteners |

> **Core Recommendation:** Prioritize **d810-ng** (local, actively maintained, broad variant coverage). When the cloud service is reachable, **obpo-plugin** yields the best results. If both fail, fall back to **angr/Miasm** symbolic execution for customized processing.

---

## 1. Modern OLLVM Variant Ecosystem (2026 Community Survey)

OLLVM has evolved far beyond the original 2017 repository. Below are active obfuscator branches. **You must identify the target variant before deobfuscating**, as countermeasure techniques differ significantly across variants:

### 1.1 Obfuscator Branch Lineage

| Variant | Base LLVM | Features Added Relative to Vanilla OLLVM | Countermeasure Key Points |
|---------|-----------|------------------------------------------|---------------------------|
| **Obfuscator** (Vanilla) | 3.3~4.0 | sub + bcf + fla (three foundational passes) | Can be processed by all standard tools |
| **Hikari** | 6~8 | Anti Class Dump, Function Call Obfuscate, Function Wrapper, Indirect Branching, Split BB, String Encryption | Requires decrypting strings first + repairing indirect branches |
| **Hikari-LLVM15** | 15~19 | + Anti Debugging, Anti Hook, Constant Encryption | Now closed-source; Constant Encryption increases static analysis difficulty |
| **goron** | 7~10 | Indirect Branch/Call/GlobalVariable | ⚠️ Goron-style indirect obfuscation can be countered simply by setting data sections to read-only |
| **Arkari** (komimoe/Hikari) | 14~latest | Based on goron, actively maintained | Same as goron; marking data sections read-only partially neutralizes it |
| **Pluto** | 14 | MBA Obfuscation, Random CF, Split BB, **Trap Angr** (specifically targeting angr) | ⚠️ The Trap Angr pass breaks angr symbolic execution; switch tools or bypass traps |
| **Polaris** (formerly Pluto) | 16 | Alias Access, Indirect Branch/Call, String Encryption, Merge Function, Linear MBA, Dirty Bytes Insertion, Function Splitting, Junk Insertion | Combines Hikari + Pluto; highly complex; requires layered processing |
| **O-MVLL** | open-obfuscator | Python-driven pass manager; Anti Hooking, Arithmetic(MBA), BB Duplicate, CF Breaking, Function Outline, Indirect Branch/Call, Opaque Constants | Common in modern Android hardening; easily customized via Python configuration |
| **amice** (Rust) | Rust implementation | Complete suite + VM Flatten, Instruction Virtualization, Delayed Offset Loading, Parameter Aggregation | Contains virtualization; requires VM handler recovery rather than simple deflat |
| **VMP Family** (SmallVmp/VMPilot/xVMP/VMPacker) | — | Instruction Virtualization | **Outside the scope of OLLVM**; requires VM reverse engineering; consult dedicated VM tooling |

### 1.2 Key Diagnostic Clues

- **Trap Angr** (Pluto/Polaris): If angr crashes or encounters path explosion during execution, suspect the target uses the Trap Angr pass → Switch to d810-ng or dynamic Unicorn-based approaches.
- **Goron/Arkari Indirect Branching**: If the dispatcher uses indirect branching (`BR x8` rather than a `switch`), first attempt marking the relevant data section as read-only; indirect branch targets often resolve statically once patched.
- **Constant Encryption** (Hikari-LLVM15/Polaris/O-MVLL): Constants decrypt at runtime, leaving true values invisible to pure static analysis → Requires Unicorn dynamic execution to run the decryption stubs.
- **VM Flatten** (amice): Control flow becomes a VM dispatch loop; **do not treat as standard fla**. The VM handler table must be identified first.

---

## 2. OLLVM Obfuscation Type Detection

Identification characteristics of the three core OLLVM passes:

### 2.1 Control Flow Flattening (`fla`)

**IDA View Characteristics:**
- Function entry jumps directly to a single dispatcher block.
- Main logic is split into multiple basic blocks, each jumping back to the dispatcher at its end.
- The dispatcher relies on a **state variable** to determine the next block to execute.
- Massive `switch` construct with no logical relationship between adjacent cases.

```
Original:             OLLVM flattened:
  block_A               entry -> dispatcher
  block_B                 ↓
  block_C              state_machine:
                         switch(state):
                           0 → block_A
                           1 → block_B
                           2 → block_C
```

**Variant Patterns (Multiple Dispatchers Recognized by d810-ng):**
- O-LLVM: switch / if-chain + state variable
- Tigress: `m_jtbl` (switch-case) or `m_ijmp` (indirect jump, requires `goto_table_info` configuration)
- Hodur (PlugX): Nested `while(1)` state machine, `jnz state, #CONST`, **no switch dispatcher**
- Approov: `while(v8 != C)`, state constants concentrated within `0xF6000–0xF6FFF`

### 2.2 Bogus Control Flow (`bcf`)

- **Unreachable bogus branches** inserted between genuine control flow branches.
- Bogus branches protected by **opaque predicates** (conditions always evaluating to true/false, but not directly provable by static analysis engines).
- Extensive dead code causes significant function size inflation.

```c
// Classic opaque predicate: x * (x + 1) is always even, which compiler analysis cannot reduce directly
if (x * (x + 1) % 2 == 0) {
    // True logic
} else {
    // Unreachable dead code
}
```

### 2.3 Instruction Substitution (`sub`) → MBA

- Simple arithmetic/bitwise operations replaced with equivalent complex expressions (MBA, Mixed Boolean-Arithmetic).

```
a + b  →  (a ^ b) + 2*(a & b)
a ^ b  →  (a | b) - (a & b)
a - b  →  a + (~b) + 1
```

### 2.4 Quick Classification Reference

| Obfuscation Type | IDA Characteristics | Primary Countermeasure |
|------------------|---------------------|------------------------|
| fla (Flattening) | Massive switch + dispatcher | obpo / d810-ng / deflat |
| bcf (Bogus Control Flow) | Unreachable branches + dead code | d810-ng opaque predicate removal / symbolic execution |
| sub/MBA | Complex arithmetic expressions | d810-ng MBA simplifier / SiMBA (Z3) |
| fla + bcf + sub | All passes applied; extreme inflation | **Layered deobfuscation (bcf first, then fla, then sub)** |

---

## 3. In-Depth Mainstream Tooling (Active Community Projects)

### 3.1 obpo-plugin — Peak Performance, Cloud Plugin

> [obpo-project/obpo-plugin](https://github.com/obpo-project/obpo-plugin) · 629⭐ · Active 2026-06

A pseudocode optimizer built on Hex-Rays **microcode**, utilizing **data flow tracking + program slicing + concolic execution** to reconstruct flattened control flow. Widely recognized in the community as offering superior results.

**Key Features:**
- Operates at the microcode layer, directly optimizing decompiler output (rather than patching assembly).
- Supports IDA 7.5.0 / 7.6.0 / 7.7.0 + Hex-Rays.
- Architectures: ARM, ARM64, x86, x86_64, PowerPC, PowerPC64, MIPS (7.6/7.5).
- **Cloud plugin**: Target function binaries are transmitted to `obpo-server` for processing (core engine is closed-source, plugin is free and open-source).
- Self-funded server maintenance with a 600-second timeout; **multithreading and abusive automated calls are prohibited**.

**Installation and Usage:**
```text
1. Download obpo_plugin.py and the obpoplugin directory
2. Copy them to the IDA plugins path
3. Restart IDA and load the target binary
4. Locate the dispatcher block within the CFG, typically structured as follows:
   [Refer to repository assets/dispatchblock.png]
5. Right-click → OBPO → Mark and process function
6. Once processing concludes, refresh the decompiler
7. Continue marking new dispatcher blocks based on decompilation updates (iteratively resolving nested fla)
```

**Applicable Scenarios and Limitations:**
- ✅ Standard and nested fla; yields high-quality outputs
- ⚠️ Requires an active internet connection; exercise caution with sensitive samples (undisclosed internal vulnerabilities, proprietary trade secrets) as binary data is uploaded upstream
- ⚠️ Server availability depends on maintainer upkeep and may experience downtime
- ❌ Does not resolve all obfuscation permutations (explicitly stated by the author)

### 3.2 d810-ng — Preferred All-in-One Local Solution

> [w00tzenheimer/d810-ng](https://github.com/w00tzenheimer/d810-ng) · 223⭐ · Updated 2026-06-26

A modern maintained/refactored version (Next Generation) of D-810. Runs locally, open-source, integrates the **Z3 SMT** solver, and provides the broadest variant coverage.

**Core Capabilities (Organized from d810-ng README):**

*Instruction-Level Optimization:*
| Category | Description |
|------|------|
| MBA simplification | `(a+b)-2*(a&b) => a^b`, Z3-verified DSL rules |
| Hacker's Delight | Bitwise equivalence rules (from the book *Hacker's Delight*) |
| O-LLVM patterns | MBA patterns specific to Obfuscator-LLVM |
| Constant folding | 22 constant simplification rules |
| Predicate simplification | Opaque predicate removal (setz/setnz/lnot/smod) |
| Z3 rules | SMT solving fallback when template matching fails |
| Hodur-specific | MBA patterns specific to PlugX (Hodur) malware |

*Control Flow Unflattener (Categorized by Target Obfuscation):*
| Unflattener | Target | Description |
|------------|------|------|
| `Unflattener` | O-LLVM | Standard switch/if-chain + state variable |
| `UnflattenerSwitchCase` | Tigress | Tigress switch-case dispatch (`m_jtbl`) |
| `UnflattenerTigressIndirect` | Tigress | Tigress indirect jumps (`m_ijmp`), requires `goto_table_info` configuration |
| `HodurUnflattener` | Hodur (PlugX) | Nested `while(1)` + `jnz state, #CONST`, without switch |
| `BadWhileLoop` | Approov | `while(v8 != C)`, state constants in 0xF6000–0xF6FFF |
| `UnflattenerFakeJump` | Generic | Removal of always-true/always-false conditional jumps |
| `SingleIterationLoopUnflattener` | Residuals | Cleans up single-iteration loops where `INIT == CHECK` and `UPDATE != CHECK` |
| `UnflattenControlFlowRule` (Experimental) | Generic | Path emulation-based CFG unflattener |

**Installation and Usage:**
```text
1. clone d810-ng
2. Install dependencies (including Z3)
3. Copy to the IDA plugins directory
4. Press Ctrl-Shift-D in IDA to load the plugin
5. Select the rule sets to apply in the GUI
6. Apply to the target function
```

**Why choose d810-ng over the original D-810:**
- The original D-810 is infrequently maintained
- d810-ng includes CI testing, refactored code, and newly added unflatteners specific to Tigress/Hodur/Approov
- Integrates Z3 to fall back to SMT solving when template matching fails, yielding higher success rates

### 3.3 ollvm-unflattener — Miasm Symbolic Execution, Script-Only

> [cdong1012/ollvm-unflattener](https://github.com/cdong1012/ollvm-unflattener) · 265⭐ · Active 2026-06

Based on the **Miasm** symbolic execution engine, independent of IDA/BN, pure Python command-line tool.

**Features:**
- Recovers original control flow using Miasm symbolic execution (distinct from MODeflattener's purely static approach)
- **Multi-layer BFS processing**: Automatically follows calls within the target function for recursive deobfuscation
- Supports Windows/Linux x86/x64
- Outputs deobfuscated new binary

**Installation and Usage:**
```bash
git clone https://github.com/cdong1012/ollvm-unflattener.git
cd ollvm-unflattener
pip install -r requirements.txt   # miasm, graphviz, keystone-engine

# Basic usage
python unflattener -i <input.bin> -o <output.bin> -t <function_addr> -a
# -a: Automatically follow calls for multi-layer processing
```

**Applicability:** No IDA available, target is x86/x64, requires batch scriptable processing.

### 3.4 ollvm-breaker — Binary Ninja in Practice

> [amimo/ollvm-breaker](https://github.com/amimo/ollvm-breaker) · 441⭐

Uses **Binary Ninja** for deflattening. The repository includes an Android hardened sample `libvdog.so` as a test case, successfully recovering functions such as JNI_OnLoad, crazy::GetPackageName, and prevent_attach_one.

**Applicability:** Binary Ninja users, Android .so analysis in practice.

### 3.5 deollvm — ARM64 Unicorn

> [GeT1t/deollvm](https://github.com/GeT1t/deollvm) · 34⭐ · 2026-04

ARM64 OLLVM deflat based on **Unicorn**. An alternative for processing ARM64 .so files when IDA is unavailable.

### 3.6 DeObfBR — Specialized for BR Obfuscation

> [Mrack/DeObfBR](https://github.com/Mrack/DeObfBR) · 96⭐ · 2026-06-25

Specifically removes **BR obfuscation** (indirect branch obfuscation, Goron/Arkari style).

**⚠️ Simple Countermeasure Technique (from awesome-ollvm):** Indirect-related obfuscation in the Goron/Arkari style can be simply countered by **setting data segments to read-only**—indirect jump targets often rely on data segments that are writable at runtime; setting them to read-only makes them statically solvable.

### 3.7 angr — Generic Symbolic Execution Framework

```python
import angr

proj = angr.Project("target.so", auto_load_libs=False)
cfg = proj.analyses.CFGFast()
func = proj.kb.functions[0x12345]

# Built-in Deobfuscator
deob = proj.analyses.Deobfuscator(func=func)
deob.normalize()
```

**⚠️ Pluto/Polaris Trap Angr pass:** These two variants specifically include traps designed to disrupt angr symbolic execution. If angr experiences path explosion or anomalies, suspect that the target uses Trap Angr → switch to d810-ng or dynamic Unicorn approaches.

---

## 4. Complete Deobfuscation Workflow (by Scenario)

### 4.1 General Decision Tree

```
Target Binary
  ↓
1. Identify OLLVM Variant (see Section 1.2 clues)
  ├── Original OLLVM / Hikari / O-MVLL  → Standard fla/bcf/sub
  ├── Pluto / Polaris                   → Beware of Trap Angr, avoid angr
  ├── Goron / Arkari                    → First try read-only data segments, then handle BR
  ├── Tigress                           → d810-ng Tigress unflattener
  ├── Hodur (PlugX)                     → d810-ng HodurUnflattener
  └── amice (contains VM)               → Not simple fla, requires VM handler recovery
  ↓
2. Tool Selection (see Section 0 decision table)
  ├── With IDA + Internet access + Non-sensitive sample → obpo-plugin
  ├── With IDA + Local                                  → d810-ng
  ├── With Binary Ninja                                 → ollvm-breaker
  ├── No GUI + x86/x64                                  → ollvm-unflattener (Miasm)
  ├── No GUI + ARM64                                    → deollvm (Unicorn) / angr
  └── Pure Symbolic Execution / CTF                     → angr
  ↓
3. Layered Deobfuscation (Order is critical)
  a) First remove opaque predicates (bcf)   → d810-ng opaque predicate removal
  b) Then remove control flow flattening (fla) → unflattener
  c) Finally simplify MBA (sub)            → d810-ng MBA simplifier / SiMBA
  ↓
4. Verification
  ├── Significant decrease in function size?
  ├── CFG transformed from star/radial shape to linear/tree shape?
  └── Logic verified correctly via Frida hook on key functions?
```

### 4.2 Android NDK .so Deobfuscation Focus

OLLVM-hardened .so libraries compiled with Android NDK represent the most common scenario in APK reverse engineering.

**Step 1 — Extract .so:**
```bash
adb pull /data/app/~~/lib/arm64/libnative.so
# Or extract directly from APK: unzip target.apk -d out/ ; find out -name "*.so"
```

**Step 2 — Identify OLLVM and Variants:**
```bash
readelf -a libnative.so | grep -E "Size|text"   # Abnormally large .text with few functions → Highly likely OLLVM
# Open in IDA to inspect function signatures:
#   Huge switch → fla
#   Unreachable branches → bcf
#   Complex arithmetic → sub/MBA
#   Indirect jumps BR x8 → Goron/Arkari, try setting data segment to read-only
#   while(1) + jnz state → Hodur, use d810-ng HodurUnflattener
```

**Step 3 — Deobfuscate (Layered):**
```
a) bcf: d810-ng opaque predicate removal  (or handled automatically by obpo)
b) fla: d810-ng Unflattener / obpo-plugin / deollvm(ARM64)
c) sub: d810-ng MBA simplifier
```

**Step 4 — Frida Dynamic Verification:**
```javascript
// Trace OLLVM state variable to assist deflat in determining the state variable address
const target = Module.findBaseAddress("libnative.so");
console.log("[+] libnative.so @", target);

// Hook at the dispatcher entry point to observe the state transition sequence
Interceptor.attach(target.add(0x1234), {  // dispatcher offset
    onEnter(args) {
        // Read state variable (determine register/stack location based on decompilation)
        console.log("[state]", this.context.x8);  // Assuming state is in x8
    }
});
```

### 4.3 Rapid Deobfuscation in CTF Scenarios

CTF competitions usually have tight time constraints, so prioritize the fastest path:

```python
#!/usr/bin/env python3
"""CTF OLLVM quick deflat with angr"""
import angr

proj = angr.Project("challenge", auto_load_libs=False)
cfg = proj.analyses.CFGFast()

# Locate the largest functions (most likely to be obfuscated)
funcs = sorted(cfg.functions.values(), key=lambda f: f.size, reverse=True)[:5]
for func in funcs:
    print(f"[*] {func.name} @ {hex(func.addr)} size={hex(func.size)}")
    try:
        deob = proj.analyses.Deobfuscator(func=func)
        deob.normalize()
        print(f"    [+] deobfuscated")
    except Exception as e:
        print(f"    [-] failed: {e}")
        # If angr fails -> suspect Trap Angr -> switch to d810-ng / Unicorn
```

---

## 5. MBA Expression Simplification

### 5.1 Common OLLVM MBA Patterns

```python
# These identities are simplification targets for expressions generated by OLLVM sub passes
"(a | b) + (a & b)"        # → a + b
"(a | b) - (a & b)"        # → a ^ b
"(a ^ b) + 2*(a & b)"      # → a + b
"(a | b) & ~(a & b)"       # → a ^ b
"~(~a & ~b)"               # → a | b (De Morgan)
```

### 5.2 Tool Selection

| Tool | Approach | Applicable Context |
|------|----------|-------------------|
| **d810-ng MBA simplifier** | Batch inside IDA, Z3 validation | Preferred; integrated into the decompilation workflow |
| **SiMBA** (`pip install simba-simplifier`) | CLI / Library | Pure expression simplification, batch processing |
| **Arybo** | Symbolic bit-vector | Large volumes of MBA expressions |
| **Z3 Direct Solver** | SMT | Most versatile; fallback when template matching fails |

```python
# SiMBA example
from simba import simplify_mba
exprs = ["(a | b) + (a & b)", "(a ^ b) + 2*(a & b)"]
for e in exprs:
    print(f"{e}  →  {simplify_mba(e)}")
```

---

## 6. Complete Deobfuscation Case Script

```bash
#!/bin/bash
# OLLVM deobfuscation pipeline (2026 community tools)
# Applicable to ELF/.so hardened with standard OLLVM / Hikari / O-MVLL

BINARY=$1

echo "[*] Stage 0: Basic analysis and variant identification"
file $BINARY
readelf -h $BINARY 2>/dev/null | head -5
echo "    → Identify the variant in IDA (refer to Section 1)"

echo "[*] Stage 1: d810-ng local deobfuscation (preferred)"
echo "    IDA → Ctrl-Shift-D to load d810-ng"
echo "    Select: MBA + Opaque predicate + Unflattener"
echo "    Apply to target functions"
echo "    Save IDB"

echo "[*] Stage 2: obpo-plugin (if d810-ng results are insufficient and network access is available)"
echo "    IDA → Right-click dispatcher → OBPO → Mark and process"
echo "    ⚠️ Do not use on sensitive samples (binary uploaded to cloud service)"

echo "[*] Stage 3: Alternative without IDA (x86/x64)"
echo "    python unflattener -i $BINARY -o deobf.bin -t <func_addr> -a"

echo "[*] Stage 4: ARM64 .so alternative without IDA"
echo "    deollvm (Unicorn) or angr Deobfuscator"

echo "[+] Done. Re-analyze and verify in IDA."
```

---

## 7. Common Pitfalls (Community Practical Summary)

| Issue | Root Cause | Solution |
|-------|------------|----------|
| angr path explosion / abnormal termination | **Trap Angr** pass in Pluto/Polaris | Switch to d810-ng or dynamic Unicorn approaches |
| Unable to connect to obpo-plugin | Server is community/self-funded and may experience downtime | Switch to local d810-ng; open an issue in the obpo repository |
| Goron/Arkari indirect jump deflat fails | Dispatcher uses `BR x8` instead of switch | Set data section to read-only first, then use DeObfBR |
| Functions remain obfuscated after d810-ng | OLLVM customized pass parameters / seed | Perform symbolic execution to remove opaque predicates first, then unflatten |
| Nested fla (multi-layer flattening) not fully resolved in one pass | obpo/d810-ng only clears one layer per run | **Iterative processing**: mark newly surfaced dispatchers each run |
| deflat error on ARM64 .so | Legacy deflat scripts only support x86 | Use d810-ng / obpo (supports ARM64) / deollvm |
| Hikari strings invisible | String Encryption pass | Use Unicorn to emulate the decryption stub and dump decrypted strings |
| deflat completely ineffective on amice targets | Employs VM Flatten / Instruction Virtualization | **Not OLLVM fla**; requires VM handler recovery (refer to VM reverse engineering) |
| Hodur (PugX) samples lack a switch dispatcher | Nested `while(1)` + `jnz state` | Use d810-ng **HodurUnflattener**; do not use standard Unflattener |
| Approov sample state constants exhibit no patterns | Constants concentrated within `0xF6000`–`0xF6FFF` | Use d810-ng **BadWhileLoop** unflattener |
| Accidental use of obpo on sensitive samples | Binary is uploaded to a cloud service | **Only use local tools** (d810-ng/angr) for confidential/undisclosed vulnerability samples |
| Frida hook hangs on OLLVM function | Modified state variable leads to an infinite loop | Add conditional breakpoints at the dispatcher entry to limit execution counts |

---

## 8. Tool Quick Reference Table (2026 Community Activity)

| Tool | Platform | Mechanism | Stars / Price | Latest Update | Open Source | Remarks |
|------|----------|-----------|---------------|---------------|-------------|---------|
| **obpo-plugin** | IDA | microcode + concolic (cloud) | 629 | 2026-06 | Plugin open source / core closed source | Most effective; requires internet access |
| **ollvm-breaker** | Binary Ninja | BN API | 441 | 2026-06 | ✅ | Android .so real-world usage |
| **ollvm-unflattener** | CLI | Miasm symbolic execution | 265 | 2026-06 | ✅ | x86/x64, multi-layer BFS |
| **d810-ng** | IDA | microcode + Z3 | 223 | 2026-06 | ✅ | **Top local choice**; broad variant coverage |
| **DeObfBR** | — | Dedicated BR deobfuscation | 96 | 2026-06 | ✅ | Goron/Arkari indirect branches |
| **IDA_Ollvm-unflattener** | IDA | Miasm plugin edition | 90 | 2026-04 | ✅ | IDA plugin wrapper for ollvm-unflattener |
| **deollvm** | CLI | Unicorn | 34 | 2026-04 | ✅ | ARM64 dedicated |
| **angr** | CLI | Symbolic execution | — | Active | ✅ | General purpose; countered by Trap Angr |
| **SiMBA** | CLI / Library | MBA simplification | — | — | ✅ | Expression simplification |
| **Triton** | CLI | Symbolic execution + taint | — | Active | ✅ | Dynamic symbolic execution |

---

## 9. References

**Obfuscators (for understanding target mechanisms):**
- [obfuscator-llvm/obfuscator](https://github.com/obfuscator-llvm/obfuscator) — Original OLLVM
- [HikariObfuscator/Hikari](https://github.com/HikariObfuscator/Hikari) — Hikari
- [komimoe/Hikari](https://github.com/komimoe/Hikari) — Arkari (based on goron, LLVM 14+)
- [amimo/goron](https://github.com/amimo/goron) — goron
- [bluesadi/Pluto](https://github.com/bluesadi/Pluto) — Pluto
- [za233/Polaris-Obfuscator](https://github.com/za233/Polaris-Obfuscator) — Polaris (formerly Pluto)
- [open-obfuscator/o-mvll](https://github.com/open-obfuscator/o-mvll) — O-MVLL
- [fuqiuluo/amice](https://github.com/fuqiuluo/amice) — Rust implementation of OLLVM passes
- [lich4/awesome-ollvm](https://github.com/lich4/awesome-ollvm) — **Overview of variant ecosystem (strongly recommended reading first)**

**Deobfuscation Tools:**
- [obpo-project/obpo-plugin](https://github.com/obpo-project/obpo-plugin) — Most powerful cloud plugin
- [w00tzenheimer/d810-ng](https://github.com/w00tzenheimer/d810-ng) — Top local choice
- [cdong1012/ollvm-unflattener](https://github.com/cdong1012/ollvm-unflattener) — Standalone Miasm script
- [amimo/ollvm-breaker](https://github.com/amimo/ollvm-breaker) — Binary Ninja
- [GeT1t/deollvm](https://github.com/GeT1t/deollvm) — ARM64 Unicorn
- [Mrack/DeObfBR](https://github.com/Mrack/DeObfBR) — Dedicated BR deobfuscation
- [maskelihileci/IDA_Ollvm-unflattener](https://github.com/maskelihileci/IDA_Ollvm-unflattener) — IDA plugin edition
- [angr](https://angr.io/) — Symbolic execution framework
- [SiMBA](https://github.com/tech-srl/simba) — MBA simplification

**Academic / Blog Posts:**
- [Quarkslab: Deobfuscation: Recovering an OLLVM-protected program](https://blog.quarkslab.com/deobfuscation-recovering-an-ollvm-protected-program.html) — Classic principles of deflat
- [MODeflattener](https://github.com/mrT4ntr4/MODeflattener) — Static deflat (counterpart to ollvm-unflattener)

> Related Documents: [[anti-analysis.md]] (Master Table for Anti-Debugging / Anti-Analysis), [[tools-advanced.md]] (Advanced Toolset), [[elf-analysis.md]] (ELF File Analysis), [[ai-assisted-re.md]] (AI-Assisted Reverse Engineering)