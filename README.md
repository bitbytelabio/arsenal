# Arsenal

> **Plugin-First Offensive Security & Reverse Engineering Harness for Oh My Pi (OMP)**

Arsenal is a production-grade security engagement harness and skill corpus designed for offensive penetration testing, binary reverse engineering, and dynamic vulnerability assessment.

---

## Architecture Overview

Arsenal is architected around a **Single Source of Truth (SSOT)** model and strict separation of concerns:

- **Single Source of Truth (`src/corpus/`, `presets/`, `src/core/`)**:
  Canonical security playbooks, routing tables, baseline coverage mappings, and CLI verification tooling.
- **Generated Distribution Package (`plugin/`)**:
  A self-contained OMP plugin containing compiled standalone runtime extensions, catalog indexes, and routing definitions.
- **Runtime State (`evidence/`)**:
  Cryptographically verifiable, append-only JSONL event logs with SHA-256 hash chains and WAL-mode SQLite journal tracking.

---

## Documentation & Installation

- [OMP Plugin Installation Guide](docs/install-omp-plugin.md): Hướng dẫn liên kết và nạp plugin vào Oh My Pi (`omp plugin link ./plugin`).
- [System Architecture & Design Specification (v3)](docs/DESIGN.md): Đặc tả kiến trúc SSOT và hợp đồng runtime.
- [Hardening & Improvement Findings](docs/IMPROVE.md): Kế hoạch nâng cấp và đối chiếu kiến trúc thực nghiệm.
- [Feature Specifications](docs/specs/): Các hồ sơ đặc tả kỹ thuật và kế hoạch thực thi theo phương pháp SpecKit.


## Hardened Runtime Features

### 1. Standalone Plugin Packaging & Distribution
- Extensions in `plugin/extensions/*.ts` compile into standalone, self-contained ESM JavaScript bundles in `plugin/dist/extensions/{bounding,ledger,budget,routing}.js` via `Bun.build()`.
- Bundled modules eliminate external relative imports outside `plugin/`.
- Catalog path discovery anchors portably to `import.meta.dir`, ensuring seamless operation when invoked from any arbitrary directory.
- Extension bundling is covered by byte-for-byte build determinism checks (`arsenal build --check-determinism`).

### 2. Concurrency-Safe Append-Only Evidence Ledger
- Concurrent multi-agent writes to `LedgerActor.appendEvent()` are serialized through a FIFO `AsyncMutex`.
- Sequence allocation, head retrieval, file append, and journal commits execute in an atomic critical section.
- Guarantees strictly monotonic sequences and unbroken SHA-256 hash chains under high-concurrency workloads (tested with 100 simultaneous asynchronous writes).

### 3. Execution Deadlines & Character-Safe Output Bounding
- Subprocess execution via `evidence_exec` enforces strict deadlines using `timeout_ms`. Commands exceeding limits are cleanly terminated via `SIGTERM`/`SIGKILL` with POSIX exit code `124`, retaining partial stdout/stderr buffers.
- Output bounding (`boundOutput()`, `boundAndStore()`) enforces a strict 4096-byte delivered budget using codepoint-aligned truncation, eliminating multi-byte UTF-8 replacement character corruption (`\uFFFD`) across Vietnamese diacritics, CJK ideographs, and emoji.

### 4. Authenticated Target Scope Attribution
- Evidence records probe `.omp/scope.json` (or `ARSENAL_SCOPE_FILE`) and compute genuine SHA-256 revision hashes.
- Targets are dynamically evaluated as `in_scope`, `out_of_scope`, or `unknown`.
- Synthetic placeholder hashes (`"0".repeat(64)`) and blanket in-scope assumptions are strictly forbidden.

### 5. Technical English Corpus & Cross-Platform Script Hygiene
- 100% of playbook documentation across `src/corpus/` (including all nested `references/`, `assets/`, and `support/` files) is audited and harmonized in technical English.
- All legacy Windows-only `.ps1` scripts have been replaced with cross-platform POSIX shell and TypeScript scripts.
- Verified zero dangling script citations (`arsenal skills scripts-audit`).

### 6. Standards-Based Capability Baseline Accounting
- Accounted for 100% of capabilities across all four security domains (`re`, `webapp`, `mobile`, `red`).
- Cross-domain duplicates are mapped to canonical owners via `presets/skills/dedup-aliases.json`.
- High-confidence playbooks are promoted to verified coverage mappings in `presets/baselines/coverage-map.json`.

### 7. Objective Verification Oracles & Empirical Benchmarking
- Registered `verify_oracle` tool for independent finding evaluation:
  - `timing_differential`: Statistical separation analysis for time-based vulnerabilities.
  - `authz_matrix`: Multi-identity access replay for BOLA / IDOR detection.
  - `path_traversal`: Marker verification and root escape confirmation.
- Includes `Arsenal-Bench` empirical benchmark scenarios (`tests/fixtures/benchmark/scenarios.json`) evaluated by `tests/benchmark.test.ts` with 100% precision and recall.

---

## CLI Usage

```bash
# Build plugin distribution and verify byte-for-byte determinism
bun run bin/arsenal.ts build --write --force
bun run bin/arsenal.ts build --check-determinism --json

# Verify language compliance and script citations
bun run bin/arsenal.ts skills check --language --json
bun run bin/arsenal.ts skills scripts-audit --json

# Check standards-based capability coverage across domains
bun run bin/arsenal.ts skills coverage --domain re --check --json
bun run bin/arsenal.ts skills coverage --domain webapp --check --json
bun run bin/arsenal.ts skills coverage --domain mobile --check --json
bun run bin/arsenal.ts skills coverage --domain red --check --json

# Verify cryptographic evidence ledger integrity
bun run bin/arsenal.ts evidence verify --ledger evidence/ledger.jsonl --json

# Run test suite
bun test
```

---

## License

MIT
