# IDA ↔ reverse-skill Integration (Portable)

This page provides general procedures without machine-specific absolute paths. The local readiness report is located at `LOCAL-READINESS.md` in the repository root (gitignored).

## Target Configuration

| Item | Convention |
|------|------------|
| IDA Installation Directory | Environment variable `IDADIR` (contains `ida.exe` or `ida.dll`) |
| HTTP MCP | `http://127.0.0.1:13337/mcp` |
| Client Server Name | Use only **`idapro`** (do not register `ida-pro-mcp` concurrently) |
| Startup | `scripts/start.sh` (`--unsafe`, without `?ext=dbg`) |
| Opening Database | For large files, prefer `scripts/open.sh`; do not invoke `idb_open` directly through certain clients |

Pointing two MCP names to the same port 13337 registers tools twice and causes port conflicts with the idalib worker.

## Installation

```powershell
setx IDADIR "<your IDA installation directory>"

# Must use mrexodia/ida-pro-mcp; do not install ida-mcp from PyPI
python -m pip install "git+https://github.com/mrexodia/ida-pro-mcp.git"

# Activate idalib (adjust path according to local IDA installation)
python "<IDADIR>\idalib\python\py-activate-idalib.py" -d "<IDADIR>"

# Install plugin + client configuration
python -m ida_pro_mcp --install --transport streamable-http --scope global
```

## Startup and Keepalive

MCP entries with `type: http` do not automatically launch processes. When port 13337 is not listening, all clients report an error.

| Script | Purpose |
|--------|---------|
| `scripts/start.sh` | Outputs `OK:<n>:reuse` and updates last-healthy if healthy; treats the port as busy and avoids killing it if listening but RPC times out; replaces the managed supervisor only if nobody is listening, `py_eval` is missing, or tools/list consecutively fails for over 3 minutes (and no `opening.lock` exists); never kills `ida.exe` |
| `scripts/watchdog.ps1` | Inspects every minute; reuses if healthy; reuses if GUI / `scripts/open.sh` database opening lock / last-healthy is within 3 minutes; **applies `-Force` only if tools/list consecutively fails for over 3 minutes** |
| `scripts/recover.sh` | Immediately applies `-Force` to restart supervisor (does not kill `ida.exe`). Use this when HTTP clients flag `idapro` as error |
| `scripts/install-autostart.sh` | Registers scheduled task `reverse-skill-ida-mcp` (on logon + every minute) |
| `scripts/start-gui.sh` | Launches GUI plugin when idalib license fails |
| `scripts/open.sh` | Calls `idb_open` directly via HTTP, bypassing schema validation in certain clients |

Logs: `%LOCALAPPDATA%\reverse-skill\ida-mcp\supervisor.log` and `watchdog.log`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "skills\ida-reverse\scripts\start.sh"
powershell -NoProfile -ExecutionPolicy Bypass -File "skills\ida-reverse\scripts\open.sh" -Path "C:\path\to\target.exe" -TimeoutSeconds 600
powershell -NoProfile -ExecutionPolicy Bypass -File "skills\ida-reverse\scripts\install-autostart.sh"
```

If GUI occupies port 13337 but temporarily does not respond, `scripts/start.sh` outputs `WARN:gui_busy` and exits to prevent killing the IDA instance currently performing analysis.

## Clients

All point to Streamable HTTP: `http://127.0.0.1:13337/mcp`, server name `idapro`.

A new session must be started after modifying configurations. If the port is not listening when Cursor starts, it **will not automatically reconnect** even if the service is brought up afterward; a manual refresh in the MCP panel is required.

## Known Considerations

1. System32 files: `scripts/open.sh` copies them to a temporary path (output contains `(temp copy)`)
2. Do not invoke `idb_open` directly via MCP in certain clients
3. `scripts/start.sh` prefers `python -m ida_pro_mcp.idalib_supervisor`, which is more stable than `.cmd` wrappers
4. If both an official installation and a desktop portable package coexist, `IDADIR` takes precedence
5. Do not append `?ext=dbg` (debugger tools are not exposed by default)