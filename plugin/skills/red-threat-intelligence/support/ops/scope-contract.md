# General Scope Contract (Hard Precondition for Task Initiation)

> **MUST**: Prior to performing **ACT** on any security, reverse engineering, or penetration testing task, a `scope.md` file must be created under `work/<case>/` within the current user analysis project.
> No scope → Reading documentation/routing is the only permitted action; active scanning, hooking, and exploiting against targets are **FORBIDDEN**.
> The template can be copied directly; field names must remain in English for script validation purposes.

## How to Initialize

Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File skills\scripts\case-init.sh -Hint "<one-line task description>" -CaseName "my-case"
# Default output: work/<case>/scope.md, etc., in the current analysis project
# Explicitly specify when calling the skill from another directory: -ProjectRoot "C:\path\to\analysis-project"

# Authorized local offline sample: auth granted + offline + explicit sample → ready_for_act=true
powershell -NoProfile -ExecutionPolicy Bypass -File skills\scripts\case-init.sh `
  -Hint "offline apk" -CaseName "my-sample" -Preset offline-sample -Sample ".\app.apk"
```

Linux / macOS / Kali:

```bash
bash skills/scripts/case-init.sh --hint "<one-line task description>" --case-name "my-case"
# Default output: work/<case>/scope.md, etc., in the caller's current analysis project
# Explicitly specify when calling from another directory: --project-root "/path/to/analysis-project"

# Authorized local offline sample
bash skills/scripts/case-init.sh \
  --hint "offline apk" --case-name "my-sample" \
  --preset offline-sample --sample ./app.apk
```

`-PackageRoot` / `--package-root` is retained as a compatibility parameter; new workflows should use `ProjectRoot` / `--project-root` to represent the owner project of the case artifacts.

## Complete scope.md Template

```markdown
# Case Scope

## meta
- case_id: {YYYYMMDD-short}
- created: {ISO-8601}
- operator: {name or local}
- project_root: {caller analysis project}
- primary_skill: {from master-route}
- lead_role: lead   # see ops/role-map.md
- specialist_roles: []  # e.g. cie, cpe, cre

## auth
- status: granted | pending | denied
- basis: written_contract | bug_bounty_scope | ctf_public | own_system | lab_only
- evidence_of_auth: {ticket/path or "CTF public" or "owner-operated"}
- MUST NOT proceed if status != granted

## in_scope
- assets: []          # hosts, domains, APK paths, binaries, URLs
- surfaces: []        # web, mobile, binary, network, api
- activities: []      # recon, reverse, exploit_validate, report

## out_of_scope
- assets: []
- activities: []      # e.g. DoS, phishing real users, data exfil

## network_profile
- mode: offline | lab_only | authorized_target_only | unrestricted_lab
- notes: |
    offline = No outbound packets (pure static/local sample)
    lab_only = Lab/VM IPs only
    authorized_target_only = in_scope assets only
- MUST NOT use unrestricted against production without written auth

## deliverables
- report: true
- field_journal: true
- diagrams: true
- timeline: true

## constraints
- timebox: {}
- stealth: low | medium | high
- data_handling: anonymize | no_user_pii

## signoff
- ready_for_act: false
- checklist:
  - [ ] auth.status = granted
  - [ ] in_scope.assets non-empty OR offline sample path set
  - [ ] network_profile.mode chosen
  - [ ] out_of_scope reviewed
```

## Routing Hooks (AI Must Execute)

```text
RULES / MASTER-ROUTING / SKILL:
  1) master-route → PRIMARY
  2) Platform-native case-init or manually written scope.md
  3) auth NOT granted → STOP, only authorization material supplementation is permitted
  4) ready_for_act = true → Open PRIMARY SKILL.md → ACT
```

`case-guard -Force` / `case-guard --force` is a compatibility parameter and **MUST NOT** bypass `auth.status`, valid scope, network profile, or the `ready_for_act` hard gate.

## network_profile Quick Reference

| mode | Allowed | Prohibited |
|------|---------|------------|
| `offline` | Static analysis, local files, emulation | Any outbound connection, public RPC |
| `lab_only` | Lab/CTF target network segment | Production/unauthorized IPs |
| `authorized_target_only` | in_scope list | Assets outside the list |
| `unrestricted_lab` | Isolated lab network (written consent) | Public internet production |

## Highlights

- Pure Markdown, **no database**  
- Orthogonal to `tool-index` / bootstrap: scope manages "permission to engage", tool-index manages "tools to engage with"