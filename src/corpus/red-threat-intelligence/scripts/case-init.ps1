#Requires -Version 5.1
# Initialize work/<case>/ with scope, timeline, workitems (reverse-skill ops contract).
# Bare invocation keeps pending/offline defaults.
# Ready-to-act example:
#   powershell -File case-init.ps1 -Hint "web pentest" -CaseName my-case `
#     -AuthGranted -TargetUrl "https://app.example/" -NetworkProfile authorized_target_only
# Offline sample ready-to-act example:
#   powershell -File case-init.ps1 -Hint "offline apk" -CaseName my-sample `
#     -Preset offline-sample -Sample ".\app.apk"
param(
    [string] $Hint = '',
    [string] $CaseName = '',
    [string] $PackageRoot = '',
    [AllowEmptyString()]
    [string] $ProjectRoot = '',
    [switch] $AuthGranted,
    [string] $AuthStatus = '',
    [string] $AuthBasis = 'own_system',
    [string] $EvidenceOfAuth = '',
    [string] $TargetUrl = '',
    [string] $Sample = '',
    [string] $Preset = '',
    [string[]] $InScopeAssets = @(),
    [string] $NetworkProfile = '',
    [switch] $ReadyForAct
)
$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$skillsRoot = Split-Path -Parent $scriptDir
if (-not $PackageRoot) { $PackageRoot = Split-Path -Parent $skillsRoot }
$requestedProjectRoot = if (-not [string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot
} elseif ($PSBoundParameters.ContainsKey('PackageRoot')) {
    $PackageRoot
} else {
    (Get-Location).ProviderPath
}
if (-not (Test-Path -LiteralPath $requestedProjectRoot)) {
    New-Item -ItemType Directory -Force -Path $requestedProjectRoot | Out-Null
}
$projectRoot = (Get-Item -LiteralPath $requestedProjectRoot).FullName
if (-not [string]::IsNullOrWhiteSpace($Sample)) {
    try {
        $Sample = [System.IO.Path]::GetFullPath($Sample)
    } catch {
        throw "Invalid -Sample path '$Sample': $($_.Exception.Message)"
    }
    if (-not (Test-Path -LiteralPath $Sample -PathType Leaf)) {
        throw "Local -Sample file not found: $Sample"
    }
}

# Cross-platform case presets. Keep semantics aligned with case-init.sh.
$presetNormalized = $Preset.Trim().ToLowerInvariant()
if ($presetNormalized -in @('offline-sample', 'own-sample', 'local-sample')) {
    $AuthGranted = $true
    $AuthStatus = 'granted'
    $AuthBasis = 'own_system'
    if ([string]::IsNullOrWhiteSpace($NetworkProfile)) { $NetworkProfile = 'offline' }
    if ([string]::IsNullOrWhiteSpace($EvidenceOfAuth)) {
        $EvidenceOfAuth = 'preset:offline-sample (owner-operated local file)'
    }
} elseif ($presetNormalized -in @('ctf-public', 'ctf')) {
    $AuthGranted = $true
    $AuthStatus = 'granted'
    $AuthBasis = 'ctf_public'
    if ([string]::IsNullOrWhiteSpace($NetworkProfile)) { $NetworkProfile = 'authorized_target_only' }
    if ([string]::IsNullOrWhiteSpace($EvidenceOfAuth)) { $EvidenceOfAuth = 'preset:ctf-public' }
} elseif ($presetNormalized -in @('own-system', 'lab-only')) {
    $AuthGranted = $true
    $AuthStatus = 'granted'
    $AuthBasis = 'own_system'
    if ([string]::IsNullOrWhiteSpace($NetworkProfile)) { $NetworkProfile = 'lab_only' }
    if ([string]::IsNullOrWhiteSpace($EvidenceOfAuth)) { $EvidenceOfAuth = 'preset:own-system/lab' }
} elseif (-not [string]::IsNullOrWhiteSpace($Preset)) {
    throw ("Invalid -Preset '{0}'. Allowed: offline-sample|ctf-public|own-system" -f $Preset)
}

if (-not $CaseName) {
    $slug = if ($Hint) {
        ($Hint.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
    } else { 'case' }
    if ($slug.Length -gt 32) { $slug = $slug.Substring(0, 32).TrimEnd('-') }
    $CaseName = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $slug
}

# CaseName is a directory name, not a path. Keep every case under projectRoot/work.
# The pattern allows localized names but excludes Windows path syntax and names that
# Windows would normalize into a dot segment (for example, '.. ' or 'case.').
if ([string]::IsNullOrWhiteSpace($CaseName) -or
    $CaseName -notmatch '^[\p{L}\p{N}][\p{L}\p{N}._ -]{0,79}$' -or
    $CaseName -match '[.\s]$') {
    throw "Invalid -CaseName '$CaseName'. Use a 1-80 character directory name beginning with a letter or number; path separators, dot segments, trailing dots/spaces, control characters, and wildcard characters are not allowed."
}
if (-not [string]::IsNullOrWhiteSpace($NetworkProfile) -and
    $NetworkProfile.Trim().ToLowerInvariant() -notin @('offline', 'lab_only', 'authorized_target_only', 'unrestricted_lab', 'lab', 'authorized', 'auth', 'offline_only')) {
    throw "Invalid -NetworkProfile '$NetworkProfile'. Allowed: offline, lab_only, authorized_target_only, unrestricted_lab (aliases: lab, authorized, auth, offline_only)."
}

$workRoot = Join-Path $projectRoot 'work'
$caseRoot = Join-Path $workRoot $CaseName
$dirs = @('evidence', 'notes', 'report')
New-Item -ItemType Directory -Force -Path $caseRoot | Out-Null
foreach ($d in $dirs) {
    New-Item -ItemType Directory -Force -Path (Join-Path $caseRoot $d) | Out-Null
}

# Resolve auth / network / assets
# Priority: explicit -AuthStatus (only if bound) > -AuthGranted > pending.
# Never let a stray positional string overwrite AuthGranted.
$authStatusResolved = 'pending'
if ($AuthGranted) { $authStatusResolved = 'granted' }
if ($PSBoundParameters.ContainsKey('AuthStatus') -and -not [string]::IsNullOrWhiteSpace($AuthStatus)) {
    $candidate = $AuthStatus.Trim().ToLowerInvariant()
    $allowedAuth = @('pending', 'granted', 'denied', 'unknown')
    if ($allowedAuth -contains $candidate) {
        $authStatusResolved = $candidate
    } else {
        Write-Host ("WARN: ignoring invalid -AuthStatus '{0}' (allowed: pending|granted|denied|unknown)" -f $AuthStatus) -ForegroundColor Yellow
        # if user also passed AuthGranted, keep granted; else stay pending
    }
}

$evidenceAuth = if (-not [string]::IsNullOrWhiteSpace($EvidenceOfAuth)) {
    $EvidenceOfAuth
} elseif ($AuthGranted -or $authStatusResolved -eq 'granted') {
    'cli-flag AuthGranted or AuthStatus=granted'
} else {
    'FILL_ME'
}

$assets = New-Object System.Collections.Generic.List[string]
if (-not [string]::IsNullOrWhiteSpace($TargetUrl)) { [void]$assets.Add($TargetUrl.Trim()) }
if (-not [string]::IsNullOrWhiteSpace($Sample) -and -not $assets.Contains($Sample.Trim())) {
    [void]$assets.Add($Sample.Trim())
}
foreach ($a in @($InScopeAssets)) {
    if (-not [string]::IsNullOrWhiteSpace($a) -and -not $assets.Contains($a.Trim())) {
        [void]$assets.Add($a.Trim())
    }
}
# Also accept host-only tokens that look like domains/IPs from TargetUrl leftovers
if ($assets.Count -eq 0 -and $Hint -match 'https?://([^\s/]+)') {
    [void]$assets.Add(('https://{0}/' -f $Matches[1]))
}

$networkMode = 'offline'
if (-not [string]::IsNullOrWhiteSpace($NetworkProfile)) {
    $networkMode = $NetworkProfile.Trim()
} elseif ($assets.Count -gt 0 -and $authStatusResolved -eq 'granted' -and [string]::IsNullOrWhiteSpace($Sample)) {
    # Authorized network targets default to target-only. Explicit local samples remain offline.
    $networkMode = 'authorized_target_only'
}
# normalize common aliases
$netAliases = @{
    'lab' = 'lab_only'
    'authorized' = 'authorized_target_only'
    'auth' = 'authorized_target_only'
    'offline_only' = 'offline'
}
if ($netAliases.ContainsKey($networkMode.ToLowerInvariant())) {
    $networkMode = $netAliases[$networkMode.ToLowerInvariant()]
}
$allowedNetworkModes = @('offline', 'lab_only', 'authorized_target_only', 'unrestricted_lab')
if ($networkMode -notin $allowedNetworkModes) {
    throw "Invalid -NetworkProfile '$NetworkProfile'. Allowed: offline, lab_only, authorized_target_only, unrestricted_lab (aliases: lab, authorized, auth, offline_only)."
}

# ready_for_act requires auth granted + assets. Network targets need a non-offline
# profile; an explicit local sample is valid in offline mode. -ReadyForAct never
# bypasses auth or scope.
$ready = $false
$netAllowsAct = ($networkMode -ne 'offline' -and -not [string]::IsNullOrWhiteSpace($networkMode))
$offlineSampleReady = ($networkMode -eq 'offline' -and -not [string]::IsNullOrWhiteSpace($Sample) -and $assets.Count -gt 0)
if ($authStatusResolved -eq 'granted' -and $assets.Count -gt 0 -and ($netAllowsAct -or $offlineSampleReady)) {
    $ready = $true
} elseif ($ReadyForAct) {
    if ($authStatusResolved -ne 'granted') {
        Write-Host 'WARN: -ReadyForAct ignored because auth.status is not granted' -ForegroundColor Yellow
    } elseif ($assets.Count -eq 0) {
        Write-Host 'WARN: -ReadyForAct ignored because in_scope.assets is empty' -ForegroundColor Yellow
    } elseif (-not $netAllowsAct -and -not $offlineSampleReady) {
        Write-Host 'WARN: -ReadyForAct ignored because offline mode requires an explicit -Sample' -ForegroundColor Yellow
    }
}

# Optional master-route for primary skill
$primary = 'skill://re-reverse-engineering/SKILL.md'
$primaryId = 'R0'
$routeScript = Join-Path $scriptDir 'master-route.ps1'
if ((Test-Path $routeScript) -and $Hint) {
    $tmpBase = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
    $tmp = Join-Path $tmpBase ("case-init-route-" + [guid]::NewGuid().ToString('n'))
    try {
        $hostExe = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh' } else { 'powershell' }
        & $hostExe -NoProfile -ExecutionPolicy Bypass -File $routeScript -Hint $Hint -OutDir $tmp 2>$null | Out-Null
        $scopeRoute = Join-Path $tmp 'route-scope.md'
        if (Test-Path $scopeRoute) {
            $rt = Get-Content $scopeRoute -Raw -Encoding UTF8
            $rawSkill = $null
            $skillHits = [regex]::Matches($rt, '(?m)^-\s*primary_skill:\s*(\S+)\s*$')
            if ($skillHits.Count -gt 0) { $rawSkill = $skillHits[$skillHits.Count - 1].Groups[1].Value }
            if ($rawSkill) {
                if ($rawSkill -match '^skill://([^/]+)(/(.*))?$') {
                    $routedSkill = $Matches[1]
                    $subPath = if ($Matches[3]) { $Matches[3] } else { 'SKILL.md' }
                    $targetFound = $false
                    $checkRoots = @($PackageRoot, $skillsRoot, (Split-Path -Parent $skillsRoot), (Join-Path $projectRoot 'src/corpus'))
                    foreach ($root in $checkRoots) {
                        if ($root -and (Test-Path -LiteralPath (Join-Path $root $routedSkill))) {
                            $targetFound = $true
                            break
                        }
                    }
                    if (-not $targetFound) {
                        throw ("ERROR: master-route returned non-existent canonical skill URI: {0}" -f $rawSkill)
                    }
                    $primary = if ($subPath -eq 'SKILL.md') { "skill://${routedSkill}/SKILL.md" } else { "skill://${routedSkill}/${subPath}" }
                } else {
                    $modClean = ($rawSkill -replace '^skills/', '') -replace '/SKILL\.md$', ''
                    $routedSkill = switch ($modClean) {
                        'apk-reverse' { 're-apk-reverse' }
                        'mobile-reverse' { 'mobile-reverse' }
                        'js-reverse' { 'webapp-js-reverse' }
                        'reverse-engineering/dsl-vm-reverse' { 're-reverse-engineering' }
                        'dotnet-reverse' { 're-dotnet-reverse' }
                        'ida-reverse' { 're-ida-reverse' }
                        'radare2' { 're-radare2' }
                        'firmware-pentest' { 're-firmware-pentest' }
                        'malware-analysis' { 're-malware-analysis' }
                        'attack-chain' { 'red-attack-chain' }
                        'pentest-tools' { 'webapp-pentest-tools' }
                        'api-security' { 'webapp-api-security' }
                        'supply-chain-security' { 'red-supply-chain-security' }
                        'llm-security' { 'red-llm-security' }
                        'binary-diff' { 're-binary-diff' }
                        'patch-diff-exploit' { 're-patch-diff-exploit' }
                        'pwn-chain' { 're-pwn-chain' }
                        'edr-bypass-re' { 'red-edr-bypass-re' }
                        'browser-automation' { 'webapp-browser-automation' }
                        'docs-generator' { 're-docs-generator' }
                        'diagram-generator' { 're-diagram-generator' }
                        'protocol-reverse' { 're-protocol-reverse' }
                        'ghidra-reverse' { 're-ghidra-reverse' }
                        'cloud-k8s' { 'red-cloud-k8s' }
                        'windows-ad' { 'red-windows-ad' }
                        'digital-forensics' { 're-digital-forensics' }
                        'code-audit' { 'webapp-code-audit' }
                        'threat-hunting' { 'red-threat-hunting' }
                        'threat-intelligence' { 'red-threat-intelligence' }
                        'ot-ics' { 'red-ot-ics' }
                        'wifi-wireless' { 'red-wifi-wireless' }
                        'browser-extension-reverse' { 'webapp-browser-extension-reverse' }
                        'macos-reverse' { 're-macos-reverse' }
                        'thick-client' { 'webapp-thick-client' }
                        'go-rust-reverse' { 're-go-rust-reverse' }
                        'hardware-security' { 're-hardware-security' }
                        'database-security' { 'webapp-database-security' }
                        'email-security' { 'webapp-email-security' }
                        'identity-federation' { 'webapp-identity-federation' }
                        'radio-sdr' { 'red-radio-sdr' }
                        'case-review' { 're-case-review' }
                        'ctf-sandbox' { 're-reverse-engineering' }
                        'binary-ninja-reverse' { 're-binary-ninja-reverse' }
                        'reverse-engineering' { 're-reverse-engineering' }
                        default {
                            if ($modClean -match '^(re|webapp|red|mobile)-') {
                                $targetFound = $false
                                $checkRoots = @($PackageRoot, $skillsRoot, (Split-Path -Parent $skillsRoot), (Join-Path $projectRoot 'src/corpus'))
                                foreach ($root in $checkRoots) {
                                    if ($root -and (Test-Path -LiteralPath (Join-Path $root $modClean))) {
                                        $targetFound = $true
                                        break
                                    }
                                }
                                if (-not $targetFound) {
                                    throw ("ERROR: master-route returned non-existent skill: {0}" -f $modClean)
                                }
                                $modClean
                            } else {
                                throw ("ERROR: master-route returned unmapped/malformed primary route: {0}" -f $rawSkill)
                            }
                        }
                    }
                    $primary = "skill://${routedSkill}/SKILL.md"
                }
            }
            $idHits = [regex]::Matches($rt, '(?m)^-\s*primary:\s*(\S+)\s*$')
            if ($idHits.Count -gt 0) { $primaryId = $idHits[$idHits.Count - 1].Groups[1].Value }
        }
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}

$created = Get-Date -Format 'o'
if ($assets.Count -gt 0) {
    $assetsBlock = ($assets | ForEach-Object { "  - $_" }) -join [Environment]::NewLine
} else {
    $assetsBlock = '  []'
}

$checkAuth = if ($authStatusResolved -eq 'granted') { '[x]' } else { '[ ]' }
$checkScope = if ($assets.Count -gt 0) { '[x]' } else { '[ ]' }
$checkNet = if ($networkMode -and $networkMode -ne '') { '[x]' } else { '[ ]' }
$readyStr = if ($ready) { 'true' } else { 'false' }
$timelineNext = if ($ready) {
    'open PRIMARY SKILL.md and ACT within scope'
} else {
    'fill scope auth + in_scope; set ready_for_act'
}
$timelineSummary = if ($ready) {
    'case directory created; scope ready_for_act=true'
} else {
    'case directory created; scope pending auth'
}

$scope = @"
# Case Scope

## meta
- case_id: $CaseName
- created: $created
- operator: local
- project_root: $projectRoot
- primary_skill: $primary
- primary_id: $primaryId
- lead_role: lead
- specialist_roles: []
- hint: $Hint
- preset: $(if ([string]::IsNullOrWhiteSpace($Preset)) { 'none' } else { $Preset })

## auth
- status: $authStatusResolved
- basis: $AuthBasis
- evidence_of_auth: $evidenceAuth
- MUST NOT proceed if status != granted

## in_scope
- assets:
$assetsBlock
- surfaces: []
- activities: []

## out_of_scope
- assets: []
- activities: [dos, phishing_real_users, unrestricted_exfil]

## network_profile
- mode: $networkMode
- notes: |
    offline | lab_only | authorized_target_only | unrestricted_lab
    Change mode only after auth.status = granted.

## deliverables
- report: true
- field_journal: true
- diagrams: true
- timeline: true

## constraints
- timebox: {}
- stealth: low
- data_handling: anonymize

## signoff
- ready_for_act: $readyStr
- checklist:
  - $checkAuth auth.status = granted
  - $checkScope in_scope.assets non-empty OR offline sample path set
  - $checkNet network_profile.mode chosen
  - [ ] out_of_scope reviewed
  - [ ] roles assigned (see ``skill://webapp-pentest-tools/support/ops/role-map.md``)

## ops_refs
- ``skill://webapp-pentest-tools/support/ops/scope-contract.md``
- ``skill://webapp-pentest-tools/support/ops/evidence-finding-path.md``
- ``skill://webapp-pentest-tools/support/ops/role-map.md``
- ``skill://webapp-pentest-tools/support/ops/timeline-workitem.md``
- ``skill://webapp-pentest-tools/support/ops/IDENTITY.md``
"@

$timeline = @"
# Timeline (append-only)

## $created | lead | init
- action: case-init
- command_or_ref: ``skill://red-threat-intelligence/scripts/case-init.ps1``
- result_summary: $timelineSummary
- artifacts: [scope.md, workitems.md]
- evidence_ids: []
- decision_delta: [case_initialized]
- carry_forward_refs: [scope.md]
- next: $timelineNext
"@

$workitems = @"
# Work Items

| ID | title | role | targets | surface | status | evidence | notes |
|----|-------|------|---------|---------|--------|----------|-------|
| WI-001 | Establish scope and auth | lead | case | process | in_progress | | |

## Coverage
- [ ] Recon/analysis complete for in_scope assets
- [ ] Critical/High candidates triaged (or N/A for pure RE)
- [ ] Validated findings have Evidence (E-*)
- [ ] Path documented (attack/call/solve)
- [ ] Timeline continuous across major phases
- [ ] Report via ``skill://re-docs-generator/SKILL.md``
- [ ] field-journal anonymized

## Refs
- `skill://webapp-pentest-tools/support/ops/timeline-workitem.md`
- `skill://webapp-pentest-tools/support/ops/evidence-finding-path.md`
"@

$utf8 = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText((Join-Path $caseRoot 'scope.md'), $scope, $utf8)
[System.IO.File]::WriteAllText((Join-Path $caseRoot 'timeline.md'), $timeline, $utf8)
[System.IO.File]::WriteAllText((Join-Path $caseRoot 'workitems.md'), $workitems, $utf8)

$readmeNext = if ($ready) {
    @"
1. Scope is ready_for_act=true (auth granted + in_scope set)
2. Open primary skill: ``$primary``
3. Append ``timeline.md``; update ``workitems.md``
4. Append Evidence: resolve ``skill://webapp-pentest-tools/support/templates/append-evidence.ps1`` then run:
   ``powershell -File append-evidence.ps1 -CaseRoot <this dir> ...``
5. Promote findings with Evidence chain (``skill://webapp-pentest-tools/support/ops/evidence-finding-path.md``)
6. Report via ``skill://re-docs-generator/SKILL.md``; journal via field-journal
"@
} else {
    @"
1. Edit ``scope.md`` — set auth.status=granted and in_scope
   - network target: re-run (resolve ``skill://red-threat-intelligence/scripts/case-init.ps1`` to ``./case-init.ps1``) with:
     ``powershell -File ./case-init.ps1 -AuthGranted -TargetUrl <url>``
   - local sample: re-run with:
     ``powershell -File ./case-init.ps1 -Preset offline-sample -Sample <path>``
2. Set ready_for_act when checklist complete
3. Open primary skill: ``$primary``
4. Append ``timeline.md``; update ``workitems.md``
5. Promote findings with Evidence chain (``skill://webapp-pentest-tools/support/ops/evidence-finding-path.md``)
6. Report via ``skill://re-docs-generator/SKILL.md``; journal via field-journal
"@
}

$readme = @"
# Case $CaseName

$readmeNext
"@
[System.IO.File]::WriteAllText((Join-Path $caseRoot 'README.md'), $readme, $utf8)

Write-Host ("CASE -> {0}" -f $caseRoot) -ForegroundColor Green
Write-Host ("PROJECT -> {0}" -f $projectRoot)
Write-Host ("PRIMARY skill: {0} ({1})" -f $primary, $primaryId)
Write-Host ("auth.status={0} network_profile={1} ready_for_act={2}" -f $authStatusResolved, $networkMode, $readyStr)
if ($ready) {
    Write-Host 'NEXT: open PRIMARY SKILL.md and ACT within scope' -ForegroundColor Green
} else {
    Write-Host 'NEXT: fill scope.md auth + in_scope; then open PRIMARY SKILL.md'
}

