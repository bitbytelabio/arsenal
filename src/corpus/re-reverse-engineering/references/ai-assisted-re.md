# AI-Assisted Reverse Engineering

> LLM-Driven Decompilation / Multi-Agent Verification / Neural Semantic Recovery
> The Largest Paradigm Shift of 2025–2026

## Core Tools and Models

### LLM4Decompile
- First open-source framework applying LLMs to binary-to-source decompilation
- Multi-architecture support: x86/ARM/MIPS
- Input: Assembly code → Output: C source code
- Training data: Millions of source-assembly pairs

### Decaf (2026)
- **Compiler Feedback Verification**: LLM-generated source code → Compile → Compare against original binary
- Performance: Decompilation success rate 26% → 83.9% (ExeBench Real -O2)
- Key insight: Feedback loops are more effective than larger models

### Constraint-Guided Multi-Agent (2026)
- Three-stage verification pipeline:
  1. Syntactic correctness (parsing)
  2. Compilability (GCC)
  3. Behavioral equivalence (LLM-generated test cases)
- 84–97% re-executability rate, only $0.03–$0.05 per run

### REMEND (2026)
- Specialization: Extracting mathematical equations from binaries
- 89.8–92.4% accuracy (across 3 ISAs × 3 optimization levels × 2 languages)
- Speed: 0.132s/function, only 12M parameters

### Glaurung
- Open-source Ghidra alternative, Rust core + Python bindings
- **AI-Native Architecture**: LLM Agents embedded across every analysis layer
- Evidentiary artifacts: plain/rich/JSON/JSONL multi-format outputs for LLM consumption
- Support: ELF/PE/Mach-O, x86/ARM/RISC-V, IOC detection, entropy analysis

## Workflow: AI-Enhanced Binary Analysis

### 1. LLM-Assisted Rapid Reconnaissance

```text
□ strings extraction → LLM semantic classification (URLs/keys/paths/protocols)
□ Import table analysis → LLM functionality inference (Crypto=OpenSSL? Network=libcurl?)
□ Disassembly snippets → LLM pattern identification (cryptographic algorithms, anti-debugging, VM detection)
□ Error messages → LLM context inference ("Invalid license" → licensing logic location)
```

### 2. Neural Decompilation

```bash
# LLM4Decompile
python llm4decompile.py --binary target.so --arch arm64 --output target.c

# Verification (Recompilation + Comparison)
gcc -O2 -o target_recompiled target.c -fPIC -shared
# → Verify output behavioral equivalence
```

### 3. Multi-Agent Verification

```text
Agent 1 (Syntax): Check if generated C code can parse
  ↓ Failure → Feed back error message to LLM to retry
Agent 2 (Compilation): GCC compile → Check warnings/errors
  ↓ Failure → Feed back compilation errors to LLM
Agent 3 (Behavior): LLM generates inputs → Execute original and recompiled versions → Compare outputs
  ↓ Inconsistency → Feed back discrepancies to LLM → Iterative correction
```

### 4. LLM-Assisted Static Analysis

```text
□ Function renaming: Input decompiled pseudocode → LLM suggests semantic names
□ Type recovery: Context analysis → LLM infers struct/class definitions
□ Algorithm identification: Assembly snippets → LLM identifies cryptographic algorithms (AES/TEA/RC4/custom)
□ Protocol reverse engineering: Packet sequences → LLM infers protocol formats
□ Comment generation: Decompiled code → LLM generates comments in English/other languages
```

### 5. macOS/iOS Private Framework Reverse Engineering (MOTIF)

```text
Problem: macOS private frameworks lack documentation; type information is missing
Solution: LLM analyzes usage patterns → Infers method signatures and parameter types
Result: ObjC signature recovery rate 15% → 86% (vs. static analysis)
```

## LLM Prompt Templates

### Function Semantic Analysis

```
You are a reverse engineering expert. Analyze this decompiled function:

[Pseudocode]

1. What does this function do? (one sentence)
2. Suggest a meaningful function name.
3. What are the input parameters and their likely types?
4. What is the return value?
5. What external APIs/functions does it depend on?
6. Any security-relevant operations (crypto, auth, network, file I/O)?
```

### Algorithm Identification

```
Analyze this assembly/disassembly for cryptographic operations:

[Assembly Code]

1. Is this a known cryptographic algorithm? (AES/DES/RC4/TEA/ChaCha20/custom?)
2. Identify the key schedule and round structure.
3. What is the key size?
4. Are there any hardcoded constants that identify the algorithm?
```

### Protocol Format Inference

```
Given this network packet sequence, infer the protocol structure:

[hex dump]

1. Identify magic bytes and length fields.
2. Propose a struct definition for the packet header.
3. What field(s) appear to be checksums/CRCs?
4. Is this a known protocol or custom?
```

## Tool Selection

| Scenario | Recommended Tool | Cost |
|------|---------|------|
| Rapid Decompilation | LLM4Decompile | Free (Local GPU) |
| High-Precision Decompilation | Constraint-Guided Multi-Agent | ~$0.05/binary |
| Mathematical Function Extraction | REMEND | Free |
| Cross-Platform RE | Glaurung (Rust) | Free & Open Source |
| LLM Interaction | Claude API / GPT-4 / DeepSeek | ~$0.01–$0.10/request |

## Limitations

- **Complex Control Flow**: Virtualized/obfuscated code remains difficult (control flow flattening, VMProtect)
- **Indirect Calls**: Virtual method tables (vtables) and function pointers are difficult to recover
- **Inlined Functions**: Boundaries blur after compiler inlining
- **Floating-Point Operations**: Semantic recovery for vectorized instructions requires improvement
- **Context Windows**: Large functions (>1000 lines) exceed LLM context limitations

Source: Decaf (2026), REMEND (2026), Constraint-Guided Multi-Agent Decompilation (2026), LLM4Decompile, Glaurung