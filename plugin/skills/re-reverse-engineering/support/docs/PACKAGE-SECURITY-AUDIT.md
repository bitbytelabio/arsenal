# Package Internal Security Audit (Executable Surface)

> **2026-09-03 Review**: Extended to Git objects, payload identity, symlinks, binary allowlists, GitHub Action pinning, and Gradle Wrapper verification. See [Repository security review — 2026-09-03](https://github.com/zhaoxuya520/reverse-skill/blob/cab634bd855fc287f6e420c1f36fd1a6b9245960/docs/SECURITY-REVIEW-2026-09-03.md).

> Date: 2026-08-02  
> Scope: Executable scripts in `support/scripts/`, skill `templates/`, and `skill://re-reverse-engineering/support/scripts/bootstrap-manifest.json`  
> **Excludes**: Educational payload documentation such as `skill://webapp-pentest-tools/src-hunter/SKILL.md` (SQL DROP / injection examples are methodology references, not auto-executed)

## Summary Assessment

| Category | Verdict |
|----------|---------|
| **Backdoors / Active DB Deletion / Disk Formatting** | **None found** |
| **Piped Download-and-Execute (`curl\|sh` / `IEX DownloadString`)** | **None found** |
| **Hardcoded Cloud Keys / Private Keys** | **None found** (`sk-` / `BEGIN RSA` strings in documentation are detection examples) |
| **Residual Supply Chain Risk** | **Hardened (Medium-Low -> Low)**: pinned `@latest`; GitHub downloads verify **manifest SHA-256 + API digest** |

**Overall Verdict: No implanted backdoors or destructive wipe logic were found across the executable skill script surface; file removals are strictly confined to tool reinstallation temp directories and case output directories.**

### 2026-07-18 Hardening

| Item | Action |
|------|--------|
| jshookmcp | `@latest` -> `@0.3.4` |
| pentestswarm | `@latest` / docker `:latest` -> `@v0.1.0` / `:v0.1.0` |
| jadx | pinned `v1.5.6` + `assetSha256` |
| apktool | pinned `v3.0.2` + `assetSha256` |
| bootstrap PS/sh | Post-download `Assert-DownloadedFileIntegrity` / `verify_sha256`; prioritizes manifest hash, then GitHub `digest`; deletes file and aborts on mismatch |
| Unpinned releases | Still installable, but emits **WARN** and prints the observed SHA-256 |

### 2026-08-02 Security Fixes

| Item | Fix |
|------|-----|
| Kali quick setup | Uses `getent` to resolve sudo user home directory; removed `eval` |
| Frida process listing | Uses `frida-ps` argument array; removed inline Python code concatenation |
| Burp MCP token | Atomic replacement via restricted temporary file with POSIX mode `0600` |
| Burp MCP bridge | Parses newline-delimited MCP messages and reconnects on demand after Burp starts |
| Anything Analyzer MCP | Bootstrap enables bearer authentication by default and registers credentials via optional host adapter |
| IDA MCP startup | Terminates stale processes individually to avoid multi-PID argument expansion errors |

## Scan Methodology

Searched executable extensions (`.ps1` / `.sh` / `.py` / `.js` / `.java`) for:

- `Invoke-Expression` / `IEX` / `FromBase64String` / `DownloadString`
- `curl|bash` / `wget|sh` piped execution
- `DROP DATABASE|TABLE`, `rm -rf /`, `Remove-Item ... C:\Windows`
- Reverse shell patterns (`/dev/tcp` abuse, `TcpClient` callbacks)
- Hidden window process launches (reviewed for legitimacy)

Pass 2: Manual code review of download and cleanup paths in `arsenal scripts bootstrap-reverse`, `arsenal scripts bootstrap-reverse`, `arsenal scripts burp-mcp-bridge`, and diagram/cryptography Python helpers.

## Detailed Findings

### 1. File Deletion Operations (Expected Cleanup Only)

| Location | Behavior | Risk |
|----------|----------|------|
| `arsenal scripts bootstrap-reverse` (`Expand-ArchiveIntoDirectory`) | Removes target tool install directory before reinstallation; removes `%TEMP%\reverse-bootstrap-*` | Scoped strictly to tool installation paths |
| `arsenal scripts bootstrap-reverse` (`anything-analyzer`) | Runs `Remove-Item node_modules` before `pnpm install` on failure | Scoped to cloned tool repository |
| `arsenal scripts re-apk-reverse/decode` | Cleans task output directory for jadx/apktool | Scoped to task output root |
| `arsenal scripts case-init` | Cleans temporary directory | Temporary workspace only |
| `arsenal scripts bootstrap-reverse` | Equivalent temp / install target cleanup | Scoped to tool installation paths |

**None found**: No executable `DROP`/`TRUNCATE` or destructive deletion targeting `C:\`, system directories, or arbitrary database connection strings.

### 2. Network Behavior (Tool Bootstrapping, Not C2)

| Location | Behavior | Notes |
|----------|----------|-------|
| `arsenal scripts bootstrap-reverse` | Queries `api.github.com` for releases; downloads zip/jar via `Invoke-WebRequest` | Repository names come strictly from the **manifest allowlist** |
| `arsenal scripts bootstrap-reverse` | Runs `curl` / `git clone` / `pipx` / `npm` | Governed by the same manifest allowlist |
| `arsenal scripts burp-mcp-bridge` | Connects only to `127.0.0.1:9876` HTTP -> Burp | Local loopback only |
| `arsenal scripts master-route` | Probes `http://host:port/mcp` | Local health check |

### 3. Hidden Windows

| Location | Purpose |
|----------|---------|
| `arsenal scripts bootstrap-reverse` (`Start-Process ... -WindowStyle Hidden`) | Starts background `pnpm dev` (`anything-analyzer`) |
| `arsenal scripts re-ida-reverse/start` | Starts background IDA MCP supervisor process |

All instances are legitimate local service launches; no hidden payload downloads were found.

### 4. "Dangerous Keywords" in Documentation / Payloads (Not Auto-Executed)

Methodology documents such as `skill://webapp-pentest-tools/src-hunter/SKILL.md` and `skill://red-attack-chain/SKILL.md` contain SQL injection, `DROP` examples, and log-cleanup red-team references.  
These **are never automatically executed by bootstrap or master-route**; execution requires explicit human/AI action under an **authorized scope**.

See related controls: `skill://webapp-pentest-tools/support/ops/scope-contract.md`, `skill://re-apk-reverse/support/ops/skill-supply-chain.md`, and `skill://re-reverse-engineering/support/field-journal/precedent-reverse.md`.

### 5. Residual Supply Chain Risks & Hardening Recommendations

| Item | Risk | Recommendation |
|------|------|----------------|
| `@jshookmcp/jshook@0.3.4` and `pentestswarm@v0.1.0` in `skill://re-reverse-engineering/support/scripts/bootstrap-manifest.json` | Tag drift / registry poisoning surface | Pin exact versions and verify checksums |
| GitHub release archives without pinned SHA-256 | Delayed detection if upstream release assets are replaced | Add `assetSha256` to manifest and enforce verification in bootstrap |
| Default `npm install -g` / `pip` registries | Inherent package ecosystem risk | Install only manifest capabilities; use private mirrors/lockfiles in production |

## Executable Script Inventory (Audit Baseline)

```text
re-reverse-engineering/support/scripts/*.ps1|*.sh + lib/ToolDiscovery.ps1
re-apk-reverse/templates/*
re-radare2/templates/*
re-ida-reverse/templates/*
webapp-browser-automation/templates/*
re-diagram-generator/templates/*.py
re-case-review/templates/*.py
webapp-pentest-tools/support/burp-mcp-full/arsenal scripts burp-mcp-bridge
```

## Recommended Continuous Verification

```powershell
# Quick static audit of executable script surfaces (run from local checkout root):
rg -n "Invoke-Expression|FromBase64String|DownloadString|rm -rf /|DROP DATABASE" -g "*.ps1" -g "*.sh" -g "*.py" -g "*.js"
```

Run this check before merging any new executable skill scripts.

## Sign-off

- Audit execution: Local static repository scan + manual review of critical execution paths  
- Result: Zero backdoors / zero automated destructive deletions; supply-chain hash pinning tracked as continuous hardening
