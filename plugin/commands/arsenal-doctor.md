# /arsenal-doctor: Platform Health & Diagnostic Suite

Inspect and verify the complete operational health of the Arsenal plugin harness, tool bridges, specialist profiles, and corpus manifests.

---

## Usage

```text
/arsenal-doctor [--json] [--verbose]
```

## Description
Runs end-to-end diagnostics across the entire Arsenal system, verifying runtime environment prerequisites, tool bridge configurations, subagent profiles, and corpus manifest integrity.

## Diagnostic Checks

1. **Runtime & Environment**:
   - Bun runtime version (>= 1.2.0).
   - Package manager and isolated runner availability (`uv`).
   - Output bounding bounds ($\le 4096$ bytes) and ledger lock responsiveness.

2. **Tool Bridge Readiness**:
   - Status of all 5 canonical bridges (`ida-pro`, `ghidra`, `jshook`, `burp-ultra`, `playwright`).
   - Runner availability for enabled bridges.

3. **Specialist Profiles**:
   - Verification of all 5 specialist definitions (`arsenal-reverse.md`, `arsenal-web.md`, `arsenal-mobile.md`, `arsenal-redteam.md`, `arsenal-verifier.md`) in active profile path.
   - Assert presence of OpSec rules, Epistemic rules, and typed handoff contracts.

4. **Corpus & Manifest Integrity**:
   - Execution of `skills check --domains`.
   - Assert zero orphaned files and zero unrecorded assets.
