[ English ] | [ Tiếng Việt ](install-omp-plugin.vi.md)

# Arsenal Plugin Installation Guide for Oh My Pi (OMP)

This guide documents how to install and load the `arsenal` plugin into an Oh My Pi (OMP) environment using the official OMP Marketplace mechanism from GitHub repository `bitbytelabio/arsenal` or by directly linking local development source code (`omp plugin link`).

## Official OMP Reference Documentation

The procedures described here strictly align with official OMP standards:
- [OMP Marketplace Plugin System](https://github.com/can1357/oh-my-pi/blob/main/docs/marketplace.md)
- [OMP Configuration Discovery & Profiles](https://github.com/can1357/oh-my-pi/blob/main/docs/config-usage.md#profiles)
- [MCP Configuration in OMP](https://github.com/can1357/oh-my-pi/blob/main/docs/mcp-config.md)
- [Plugin Manager and Installer Plumbing](https://github.com/can1357/oh-my-pi/blob/main/docs/plugin-manager-installer-plumbing.md)
- [Public Arsenal Marketplace Catalog](https://raw.githubusercontent.com/bitbytelabio/arsenal/main/.omp-plugin/marketplace.json)
- [OMP Magic Keywords](https://github.com/can1357/oh-my-pi/blob/main/docs/magic-keywords.md)

> **Identity & Endorsement Notice**: Arsenal is an independent security engagement harness and plugin designed for Oh My Pi; it is **not an OMP-endorsed plugin**. Third-party remote packages must always be audited by security operators before integration into sensitive assessment environments.

---

## Quick Start via Justfile

Prerequisites: `uv`, Python 3.11+, `just`, `bun`, and `omp` in `PATH` for repository development. The installed Python CLI itself does not require Bun; native OMP extension compilation does.

```bash
just                       # List available recipes without installing
just preview               # Preview plugin link without writing configuration
just install-local         # Install dependencies → build bundle → link OMP
just test-local            # Test profile, MCP, specialist parity, and slash commands
just test                  # Run full test suite
uv run --locked pytest tests/python/test_install_mcp.py
just typecheck             # Run TypeScript type check
just determinism           # Verify byte-for-byte build determinism
```

`install-local` synchronizes the locked Python environment and Bun build dependencies, compiles the plugin, and links `./plugin` into OMP. Plugin installation supplies native skills, subagents, commands, rules, and disabled MCP definitions. Install the operational CLI separately:

```bash
uv tool install git+https://github.com/bitbytelabio/arsenal.git
arsenal --help
```

The profile template installation step (`just profile-install`) is **optional**, intended solely for operators who wish to deeply customize the orchestrator prompt (`AGENTS.md`) or deploy custom configuration into their profile agent directory:

```bash
# Optional: install custom profile prompt templates
ARSENAL_OMP_PROFILE=security-lab just profile-install
ARSENAL_OMP_PROFILE=security-lab just verify

# Or point directly to an explicit agent profile directory path
ARSENAL_PROFILE=/tmp/arsenal-test/agent just profile-install
ARSENAL_PROFILE=/tmp/arsenal-test/agent just verify
```

`just build`, `just profile-install`, and `just link` can also be run independently. Recipes preserve CLI merge/conflict behavior and never force overwrite files unless explicitly requested.

## OMP Magic Keywords for Operator Prompts

OMP recognizes the exact lowercase standalone words `ultrathink`, `orchestrate`, `workflowz`, and `jevify` in the operator's original prompt and after slash-command expansion. Use `orchestrate` for `/arsenal-engage`, `jevify` for `/arsenal-review`, and `workflowz` for `/arsenal-skill-update`; add `ultrathink` for unusually complex reasoning.

Magic keywords are OMP turn controls, not Arsenal prompt content. They do not fire when embedded in skill files, rules, or synthetic subagent handoffs. Keep them as standalone prose outside fenced code blocks and inline code spans.

See the [official OMP magic-keyword reference](https://github.com/can1357/oh-my-pi/blob/main/docs/magic-keywords.md).

---
## Operational Playbook Runtime

Arsenal provides a deterministic in-package catalog for operational playbooks and core script utilities:

```bash
# Programmatic listing with full metadata (type, domain, execution mode, admission status)
arsenal scripts --json list

# Human-readable listing grouped by domain
arsenal scripts list
arsenal scripts list --domain webapp
arsenal scripts list --all

# Verify parity between disk files, catalog descriptors, packaged resources, and receipts
arsenal scripts catalog/verify --json

# Execute a helper through the canonical interface
arsenal scripts <canonical-id> -- <arguments>
```

### Execution Boundaries and Preflight Gates

- **Shared Process (`shared`)**: In-process execution reserved for reviewed, pure, reentrant handlers (`admission_status: approved_shared`).
- **Managed Subprocess (`managed_subprocess`)**: Default boundary for unclassified or legacy playbooks, isolating child `SystemExit`, signals, and dependencies with process-group timeouts and bounded UTF-8 output.
- **Locked Environment (`locked_environment`)**: For dependency-conflicted playbooks (e.g. LLM Guard). Executes `uv run --locked --offline --project ...` once; never retries online or mutates lockfiles during dispatch.
- **External Tool (`external_tool`)**: For allowlisted system binaries with capability probes.
- **Fail-Closed Provider Contracts**: Side-effectful helpers verify machine-readable scope (`.omp/arsenal/scope.json` or `ARSENAL_SCOPE_FILE`), trusted host authorization, required proxy adapters (Burp for web/API, mitmproxy+hooks for reversing), and evidence sinks before invocation. If any provider is missing or unavailable, dispatch is refused.


## Disambiguation: Arsenal CLI `--profile <path>` vs OMP `OMP_PROFILE=<name>`

- **`--profile <path>` in Arsenal CLI**: Specifies an explicit **filesystem path to an agent directory** (default: `~/.omp/profiles/arsenal/agent`). This CLI flag does not resolve short profile names and is independent of OMP environment variables.
- **`OMP_PROFILE=<name>` (or `omp --profile <name>`) in OMP**: Specifies an OMP **profile identifier** (e.g., `OMP_PROFILE=arsenal`). When set, OMP redirects user configuration paths from `~/.omp/agent/` to `~/.omp/profiles/<name>/agent/`.

---

## 1. Capability Distribution Architecture & Dynamic Loaders

Empirical verification on OMP 18.10.2 establishes:
- **Two Loaders**:
  - **Marketplace Installation**: Loaded via the `claude-plugins` provider (priority 70). MCP servers are automatically namespaced with the marketplace/plugin identifier prefix (e.g., `arsenal:burp-ultra`, `arsenal:rea`).
  - **Local Link (`omp plugin link`)**: Loaded via the legacy `omp-plugins` provider (priority 90). MCP servers retain their original bare identifiers (`burp-ultra`, `rea`).
- **Automatic Capability Availability**: The `master` agent, 5 specialist subagents (`arsenal-reverse`, `arsenal-web`, `arsenal-mobile`, `arsenal-redteam`, `arsenal-verifier`), 9 slash commands (`/arsenal-*`), and security rules are loaded directly from the plugin without requiring `profile install`. Verified via OMP RPC inspection.
- **Configuration Precedence**: Native profile/project configuration (priority 100) takes precedence when matching server identifiers (including namespaced IDs for marketplace installations). The plugin never overwrites existing native user configurations.

Distribution Modes:
1. **Marketplace**: Repository catalog references source `./plugin` and skills `./skills`.
2. **Local Link**: Requires running a prior build (`just build`) as OMP does not execute build hooks automatically during link.

---

## 2. Marketplace Installation Workflow

In OMP, marketplace registries and plugin state are isolated per named profile (stored by default in `~/.omp/profiles/<name>/marketplaces.json` and `~/.omp/profiles/<name>/plugins/` in non-XDG environments, or under `$XDG_DATA_HOME/omp/profiles/<name>/` when configured).

Therefore, **all marketplace commands** must be consistently prefixed with `OMP_PROFILE=arsenal` to ensure the catalog and plugin registry are registered in the target profile:

### Step 1: Add Marketplace Source

Register the GitHub repository marketplace source in your profile:

```bash
# Add GitHub repository marketplace catalog to profile arsenal
OMP_PROFILE=arsenal omp plugin marketplace add bitbytelabio/arsenal

# Verify configured marketplaces in profile
OMP_PROFILE=arsenal omp plugin marketplace list

# Discover available plugins in arsenal marketplace
OMP_PROFILE=arsenal omp plugin discover arsenal
```

### Step 2: Validate Installation (Dry Run)

OMP's `--dry-run` flag validates cached catalog state, installation scopes, and dependency constraints without mutating disk state:

```bash
# Run dry-run validation prior to installation
OMP_PROFILE=arsenal omp plugin install --dry-run arsenal@arsenal
```

> **Dry-Run Prerequisite**: OMP requires the catalog to be cached locally (`~/.omp/profiles/arsenal/marketplaces.json`). `marketplace add` must precede `install --dry-run`.

### Step 3: Install Plugin into OMP

You can install into either of two scopes:

#### Option A: User Scope Installation (arsenal profile)

The `user` scope is the OMP default. To preserve environment isolation:

```bash
# Install plugin for user profile arsenal
OMP_PROFILE=arsenal omp plugin install arsenal@arsenal

# List installed plugins
OMP_PROFILE=arsenal omp plugin list
```

#### Option B: Project Scope Installation

To scope Arsenal to a specific assessment workspace while preserving profile resolution:

```bash
# Install plugin into local project scope (.omp/plugins/)
OMP_PROFILE=arsenal omp plugin install --scope project arsenal@arsenal

# List project-scoped plugins
OMP_PROFILE=arsenal omp plugin list
```

### Step 4: Update and Upgrade Plugin

OMP separates updating the marketplace repository clone from upgrading installed plugins. By default, `marketplace.autoUpdate` only refreshes catalogs best-effort once cached metadata is older than 24 hours; a targeted `omp plugin upgrade` invocation does not automatically refresh the marketplace repository cache on each run.

When a new version is released on GitHub, update and upgrade using the two-step workflow:

```bash
# 1. Sync latest source and catalog from remote repository into local cache
OMP_PROFILE=arsenal omp plugin marketplace update arsenal

# 2. Upgrade plugin from the refreshed cache
OMP_PROFILE=arsenal omp plugin upgrade arsenal@arsenal
```

---

## 3. Local Link Development Workflow

For developers building and testing directly from source:

### Step 1: Build & Verify Distribution Bundle

```bash
# 1. Compile distribution bundle into plugin/
arsenal build --write --force

# 2. Assert byte-for-byte build determinism
arsenal build --check-determinism --json
```

### Step 2: Preview Symlink (Dry Run)

> **Link Scope Warning**: Per OMP documentation (`docs/plugin-manager-installer-plumbing.md`), `omp plugin link` operations are strictly **user-level** (creating symlinks under the active profile's plugins directory: `~/.omp/profiles/<name>/plugins/node_modules/` or `~/.omp/plugins/node_modules/` in default profile). OMP ignores `--scope project` on link commands. For project-scoped workflows, use the marketplace mechanism above.

```bash
# Preview symlink creation
OMP_PROFILE=arsenal omp plugin link ./plugin --dry-run --json
```

### Step 3: Execute Local Link

```bash
# Link local plugin/ directory into OMP under the active profile
OMP_PROFILE=arsenal omp plugin link ./plugin
```

---

## 4. Operational Caveats & Troubleshooting

1. **Verify Plugin Status**:
   ```bash
   OMP_PROFILE=arsenal omp plugin list --json
   ```
   If resolution delays occur, inspect configuration files at:
   - Profile user scope: `~/.omp/profiles/arsenal/plugins/` or `~/.omp/profiles/arsenal/agent/config.json`
   - Project scope: `.omp/plugins/` or `.omp/config.json`

2. **Run Diagnostics**:
   ```bash
   OMP_PROFILE=arsenal omp plugin doctor
   ```

3. **Reload Limitations (Restart vs /reload-plugins)**:
   - The interactive `/reload-plugins` command reloads task agents, skills, slash commands, and MCP servers.
   - For non-MCP tools, hooks, or runtime extension modules (such as JavaScript bundles in `plugin/dist/extensions/`), **you must restart the OMP session** to load updated bytecode.

4. **Optional Profile Installation & OMP Configuration**:
   Since the plugin delivers subagents and skills automatically, installing profile templates is optional:
   ```bash
   arsenal profile install --profile ~/.omp/profiles/arsenal/agent --write
   arsenal profile verify --profile ~/.omp/profiles/arsenal/agent --json
   ```
   - **Commands and Specialists**: Slash commands use the `/arsenal-*` namespace (e.g., `/arsenal-engage`, `/arsenal-doctor`), and specialist agents use `arsenal-*` (e.g., `arsenal-reverse`, `arsenal-web`, `arsenal-mobile`, `arsenal-redteam`, `arsenal-verifier`).
   - **Model Resolution & OMP Config**: OMP does **not** auto-load arbitrary plugin `config.yml` files. Arsenal relies on OMP's default agent model resolution. Running `arsenal profile install` does not write OMP `config.yml` or `models.yml`, nor are `modelRoles` or `task.agentModelOverrides` required setup steps. To load custom configurations in OMP, specify files via `PI_CONFIG_FILES`, pass `--config` flags, or manage native profile/project configuration.
   - **IDA Guest Remote Debugging**: Remote guest definitions (`remoteDebug.guests`) stay in user-owned `config.yml` / `config.yaml` because multi-host environment variables are cumbersome across multiple VMs; `IDA_DIR`, `IDA_INSTALL_DIR`, and `IDA_PYTHON` in `.env` are optional local path overrides only.

---

## 5. Configuring & Managing MCP Bridges

Arsenal ships with 6 canonical MCP bridges: `ida-pro`, `ghidra`, `jshook`, `burp-ultra`, `playwright`, and `rea`. These definitions are pre-packaged in the plugin's `.mcp.json` and auto-register with OMP.

> **Default-Disabled Policy**: All canonical bridges default to `enabled: false`. OMP 18.10.2's `/mcp list` inspects native configuration files (`mcp.json`) rather than bundle catalogs. To activate a bridge, declare it in your native configuration.

### Opt-in Activation

Add the server identifier to `enabledServers` in `~/.omp/profiles/arsenal/agent/mcp.json`:

- **Marketplace Installation**: Use namespaced identifier `arsenal:<name>` (e.g., `"arsenal:burp-ultra"`).
- **Local Link Installation**: Use bare identifier `<name>` (e.g., `"burp-ultra"`).

Example configuration fragment for **Marketplace**:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  "enabledServers": ["arsenal:burp-ultra"]
}
```

The Arsenal CLI manages native configuration files across profile and project scopes:

```bash
# List bridges in profile scope
arsenal mcp list --scope profile --profile ~/.omp/profiles/arsenal/agent --json

# List bridges in project scope
arsenal mcp list --scope project --repo . --json

# Enable 'rea' in profile scope
arsenal mcp enable rea --scope profile --profile ~/.omp/profiles/arsenal/agent --write

# Disable 'rea' in profile scope
arsenal mcp disable rea --scope profile --profile ~/.omp/profiles/arsenal/agent --write

# Enable 'rea' in project scope
arsenal mcp enable rea --scope project --repo . --write

# Verify MCP configuration integrity
arsenal mcp verify --scope profile --profile ~/.omp/profiles/arsenal/agent --json
arsenal mcp verify --scope project --repo . --json
```

---

## 6. REA (Reverse Engineer Anything)

Arsenal integrates [morluto/rea](https://github.com/morluto/rea) via stdio MCP, pinned to `rea-agents@6.4.0` using `bunx`. Requires Bun and Node.js 22.19+ (v22), 24.11+ (v24), or 26+ per [upstream specifications](https://github.com/morluto/rea/blob/main/docs/installation.md).

The companion skill is internalized at `src/corpus/re-reverse-engineer-anything/`. Build artifacts include `SKILL.md`, all 6 reference manuals, and the MIT `LICENSE` under `plugin/skills/re-reverse-engineer-anything/`. Internal links resolve via canonical `skill://re-reverse-engineer-anything/` URIs.

To enable REA in your profile:

```bash
# Enable REA bridge in profile
arsenal mcp enable rea --scope profile --profile ~/.omp/profiles/arsenal/agent --write

# Verify activation status
arsenal mcp list --scope profile --profile ~/.omp/profiles/arsenal/agent --json
```

Resulting configuration entry in `mcp.json`:

```json
"rea": {
  "type": "stdio",
  "command": "bunx",
  "args": ["rea-agents@6.4.0", "mcp"],
  "enabled": true
}
```

Restart your OMP session with `OMP_PROFILE=arsenal` to load the new bridge and skill. Do not run global `rea setup` to prevent conflicts with other clients.

Static JavaScript reverse engineering functions without native disassemblers:

```bash
bunx rea-agents@6.4.0 analyze-javascript-application /absolute/path/to/extracted-app --json
```

Note: This integration does not install or configure Hopper, Ghidra, or IDA Pro. Native decompilation requires host disassembler installations; OMP native IDA configurations do not automatically bind to REA.

---

## 7. Burp Suite & BurpMCP-Ultra Bridge

Arsenal connects to [Cy-S3c/BurpMCP-Ultra](https://github.com/Cy-S3c/BurpMCP-Ultra) via SSE MCP with Bearer token authentication, adhering to upstream reference [mcp-claude-code-direct.json](https://github.com/Cy-S3c/BurpMCP-Ultra/blob/main/configs/mcp-claude-code-direct.json).

### 1. Setup BurpMCP-Ultra Extension in Burp Suite Professional

1. Download the release JAR from [BurpMCP-Ultra Releases](https://github.com/Cy-S3c/BurpMCP-Ultra/releases) (or compile with JDK 17–21 via `./gradlew shadowJar`).
2. In **Burp Suite Professional** → open **Extensions** → click **Add** → select the JAR file `burpmcp-ultra-*.jar`.
3. The **BurpMCP-Ultra** tab appears showing green "Running" status at default endpoint `http://127.0.0.1:9876/` along with your connection token.

### 2. MCP Endpoint & Protocol Specifications

- **Transport**: `sse`.
- **URL Endpoint**: Listens at root `/` (default port 9876). Do not append `/sse` or `/mcp`.
- **Authentication**: `Authorization: Bearer <TOKEN>` header.

The bridge definition supports environment variable expansion with sensible defaults:

```json
"burp-ultra": {
  "type": "sse",
  "url": "${BURP_MCP_URL:-http://127.0.0.1:9876/}",
  "headers": {
    "Authorization": "Bearer ${BURP_MCP_TOKEN}"
  },
  "enabled": false
}
```

> **OMP Native Environment Expansion**: OMP expands `${BURP_MCP_TOKEN}` and `${BURP_MCP_URL:-http://127.0.0.1:9876/}` during discovery.
> - **Never write raw credentials directly to `mcp.json`**.
> - User-defined `url` and `headers` configurations are preserved during plugin updates.

### 3. Store Credentials Securely in Profile `.env`

In OMP (`docs/providers.md`), the active profile's `.env` resides at:

```
~/.omp/profiles/arsenal/agent/.env
```

Append your token and optional URL override:

```bash
# Add BURP_MCP_TOKEN from BurpMCP-Ultra server tab
echo 'BURP_MCP_TOKEN=your_token_from_burpmcp_server_tab' >> ~/.omp/profiles/arsenal/agent/.env

# Optional: override URL for custom ports or remote Burp instances
# SECURITY NOTE: Remote connections over network MUST use HTTPS to protect Bearer tokens!
echo 'BURP_MCP_URL=http://127.0.0.1:9876/' >> ~/.omp/profiles/arsenal/agent/.env
```

> **Precedence Rules**: Environment variables in the active process shell and project-level `.env` (`<project>/.env`) take precedence over profile `.env`. If you receive `401 Unauthorized`, verify that no conflicting or empty `BURP_MCP_TOKEN` exists in your shell.

### 4. Activation and Reload

1. **Activate in profile `mcp.json`**:
   - Marketplace: Add `"arsenal:burp-ultra"` to `enabledServers`.
   - Local Link: Add `"burp-ultra"` to `enabledServers`.
2. **Restart OMP**: Restart the OMP session after modifying `.env` to ensure new environment variables propagate to the runtime process.

---

## 8. Plugin Uninstallation & Removal

### Uninstall Marketplace Plugin

```bash
# Remove from user scope
OMP_PROFILE=arsenal omp plugin uninstall arsenal@arsenal --scope user

# Or remove from project scope
OMP_PROFILE=arsenal omp plugin uninstall arsenal@arsenal --scope project
```

### Unlink Local Development Plugin

```bash
OMP_PROFILE=arsenal omp plugin uninstall arsenal
```

Verify clean removal with `OMP_PROFILE=arsenal omp plugin list`.

---

## 9. Proxy Analysis Tiers: Burp and mitmproxy + Hooks
Canonical policy resides in `plugin/rules/proxy-analysis-tiers.md`, automatically loaded by OMP from the installed plugin root.
- **Web/API Security**: Prioritize Burp Suite Proxy history and Repeater.
- **Reverse Engineering (Native/Mobile/Electron/JavaScript)**: Prioritize mitmproxy for network visibility coupled with scoped runtime hooks for code/data correlation. Use `mitmdump` for headless automation and `mitmweb` for interactive UI.
- **Tier 1 (Active Discovery)**: Capture, replay, scan/fuzz, and modify requests/responses as needed for authorized targets while retaining clean baselines.
- **Tier 2 (Correlation - Default for RE)**: Correlate network flows with runtime hooks at request builders, serialization routines, cryptographic boundaries, or response parsers.
- **Tier 3 (Verification)**: Reproducible verification against baselines through controlled singular mutations.

Tiers distinguish analysis depth and evidentiary rigor rather than tooling permission gates. Never apply arbitrary capture quotas, rate limits, or mandatory sequential barriers; follow operator authorization and target stability constraints.

**Android & iOS HTTPS Interception**: When TLS pinning interferes, operators are authorized to deploy targeted bypasses (test builds, Frida scripts, or debugger breakpoints at platform trust checks) across all tiers within authorized engagement scope without repetitive approval prompts. Distinguish routing faults, CA trust failures, and TLS pinning. Record app version, package/bundle ID, binary hashes, host/device OS, proxy/CA configuration, and hook locations. Hook observations must be explicitly labeled as runtime-only rather than raw wire captures.
