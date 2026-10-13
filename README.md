[ English ] | [ Tiếng Việt ](README.vi.md)

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

- [OMP Plugin Installation Guide](docs/install-omp-plugin.md) ([Tiếng Việt](docs/install-omp-plugin.vi.md)): Complete guide to installation via the OMP Marketplace mechanism (`OMP_PROFILE=arsenal omp plugin marketplace add bitbytelabio/arsenal`, `OMP_PROFILE=arsenal omp plugin install arsenal@arsenal`), local development linking (`OMP_PROFILE=arsenal omp plugin link ./plugin`), and profile/project MCP bridge management.

---

## Modernized OMP Harness Features

### 1. Native TypeScript Security Tooling (`apk_inspect`)
- Core analysis tasks (including Android APK inspection and binary manifest analysis) execute directly inside the plugin runtime via native Bun/TS tools without relying on host Python or unmanaged dependencies.
- Ad-hoc standalone scripts in the corpus are eliminated, replaced with managed template assets and monitored `evidence_exec` tool invocations.

### 2. Canonical `skill://` URI Scheme & Dynamic Asset Loading
- All 3,288 references and support citations across 1,647 playbooks use canonical platform URIs (`skill://<skill-id>/references/...` or `skill://<skill-id>/support/...`).
- Dynamic asset loading (`skill_asset_load`, `skills read-asset`) resolves auxiliary reference materials, checklists, and payload blueprints regardless of the agent's current working directory, with character-safe output bounds ($\le 4096$ bytes).

### 3. Subagent Governance & Profile Provisioning
- All 5 specialist agent prompts (`sec-re`, `sec-webapp`, `sec-mobile`, `sec-red`, `sec-verifier`) inline Operational Security (OpSec) safety gates and Epistemic evaluation constraints (`E-*` empirical observations vs `P-*` analytical inferences vs `unk-*` variables).
- Enforces typed JSON schema task handoffs with single-retry recovery logic.
- Installing the plugin supplies `master`, all 5 specialists, rules, commands, and MCP definitions automatically. `arsenal profile install` is optional for operator templates; it writes specialist overrides to `<profileDir>/agents/`.

### 4. Dynamic MCP Lifecycle Management & Isolated `uv` Runner
- CLI subcommands `arsenal mcp enable <name>` and `arsenal mcp disable <name>` dynamically toggle tool bridges under strict opt-in control with profile (`--scope profile`, default) or project (`--scope project`) isolation.
- Official catalog supports 6 canonical bridges: `ida-pro`, `ghidra`, `jshook`, `burp-ultra`, `playwright`, and `rea` (all initialized to `enabled: false`).
- Python-based bridges execute via isolated `uv` environments, with fail-fast diagnostics if `uv` is not present on the host.
- REA runs through `bunx rea-agents@6.4.0 mcp`. Its matching `re-reverse-engineer-anything` skill, six references, and MIT license ship with the plugin; see [REA installation](docs/install-omp-plugin.md#6-rea-reverse-engineer-anything).

### 5. Complete Operational Slash Command Suite
- 8 comprehensive slash commands guiding multi-stage security engagements:
  - `/sec-scope`: Scope manager enforcing in-scope targets and exclusions.
  - `/sec-recon`: Surface reconnaissance coordinator with interactive authorization prompt on un-scoped targets.
  - `/sec-engage`: 5-phase end-to-end security assessment orchestrator.
  - `/sec-verify`: Direct dispatch to `sec-verifier` running deterministic oracles (`verify_oracle`).
  - `/sec-finding`: Structured finding logger linking directly to SHA-256 evidence ledger receipts.
  - `/sec-review`: Case review auditor asserting evidence continuity across all 37 validation codes.
  - `/sec-report`: Deliverable compiler supporting Markdown, JSON, and SARIF exports (defaulting to `.omp/arsenal/reports/report-<timestamp>.md` with terminal summary).
  - `/sec-doctor`: Platform diagnostic checker verifying plugin health, bridges, and manifests.

### 6. Evidence-Based Technique Coverage & Manifest Integrity
- 496 empirically verified technique mappings enrolled into `presets/baselines/coverage-map.json` using verified markdown heading locators in target `SKILL.md` playbooks.
- Artificial `accepted-gaps.json` reduced by > 50% in strict adherence to Principle III (Evidence Rigor) and rule CM-4.
- 100% clean corpus manifest integrity verified via `arsenal skills check --domains` (0 errors).
## CLI Usage

```bash
# Run directly via bunx without installation
bunx @bitbytelab/arsenal --help
bunx @bitbytelab/arsenal doctor --json

# Build plugin distribution and verify byte-for-byte determinism
bun run bin/arsenal.ts build --write --force
bun run bin/arsenal.ts build --check-determinism --json

# Package plugin marketplace distribution
bun run bin/arsenal.ts plugin pack --write

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
