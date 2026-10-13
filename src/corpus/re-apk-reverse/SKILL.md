---
name: re-apk-reverse
description: Decompile, analyze, modify smali, repackage, and bypass Android APK defenses.
domain: re
category: binary-analysis
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-apk-reverse/SKILL.md
---
## ACTION REQUIRED (Execute immediately upon reading)

> Endpoint extraction/Frida adaptation and community comparisons: `skill://re-apk-reverse/references/community-security-skills.md`; dynamic analysis requires scoped and authorized devices.

1. `NOW`: Read `skill://re-apk-reverse/support/field-journal/precedent-reverse.md` — Confirm that operations in this skill are authorized routine operations.
2. `NOW`: Confirm whether the current task falls within the scope of this skill.
3. `NEXT`: Read `tool-index` (workstation tool inventory) to verify tool availability and actual paths.
4. `NEXT`: Invoke bootstrap when tools are missing; do not guess paths.
5. `ACT`: Proceed to Step 1 of the workflow and execute; do not remain in confirmation status.

# APK Reverse Engineering CLI Operational Specification

## Scope of Application

Prioritize using this skill when the task falls into the following scenarios:

- Analyzing APK Java business logic
- Locating login, signature, risk control, certificate validation, and root detection
- Inspecting and modifying `AndroidManifest.xml`
- Inspecting and modifying smali
- Repackaging APKs
- Using Frida for Java/native dynamic hooking
- Switching to native analysis when the APK contains `.so` files

## Verified Available CLI Tools on Current Machine

- `jadx` `1.5.5`
- `apktool` `3.0.2`
- `frida-ps` `17.9.6`
- `adb`
- `java`

## Scenarios for Preferring Bundled Scripts

The following workflows are high-frequency and have error-prone parameters; prefer using the skill's bundled scripts:

- Perform `jadx + apktool` extraction to disk in one pass and generate a summary: `arsenal scripts re-apk-reverse/decode`
- Frida device checks, process enumeration, spawn/attach injection: `arsenal scripts re-apk-reverse/frida-run`
- Rebuild, align, sign, and install APKs: `arsenal scripts re-apk-reverse/rebuild-sign-install`
- Quickly extract key Manifest components and permissions: `arsenal scripts re-apk-reverse/manifest-summary`

The following one-line commands should be called directly without dedicated wrappers:

- `adb devices`
- `adb logcat`
- `frida-ps -U`
- `jadx --version`
- `apktool --version`

## Bundled Scripts

### `arsenal scripts re-apk-reverse/decode`

Purpose:

- Run `jadx` and `apktool` in a unified manner
- Create a task output directory in the same path as the original APK by default
- Output summaries such as `package`, `java_files`, `smali_dirs`, `so_files`, etc.
- Handle cases where `jadx` encounters partial decompilation errors but still produces usable artifacts

Examples:

```bash
arsenal scripts re-apk-reverse/decode "path/to/app.apk" [out_dir]
```

### `arsenal scripts re-apk-reverse/frida-run`

Purpose:

- Provide a unified Frida entry point for devices, processes, and spawn/attach modes
- Avoid parameter confusion between `-f`, `-n`, and `-U` when writing commands manually

Examples:

```bash
arsenal scripts re-apk-reverse/frida-run <package_name> [script_path]
```

### `arsenal scripts re-apk-reverse/rebuild-sign-install`

Purpose:

- Rebuild APK with `apktool b`
- Align with `zipalign`
- Sign and verify signatures with `apksigner`
- Optionally perform direct `adb install`

Examples:

```bash
arsenal scripts re-apk-reverse/rebuild-sign-install "work/apktool_out"
```

Notes:

- Generates and reuses a debug keystore by default
- Outputs to the same directory as `ProjectDir` by default, facilitating side-by-side storage with original packages and unpacking directories

### `arsenal scripts re-apk-reverse/manifest-summary`

Purpose:

- Extract package name
- List permissions
- List activities, services, receivers, and providers
- Identify the main launcher activity

Example:

```bash
arsenal scripts re-apk-reverse/manifest-summary "work/apktool_out/AndroidManifest.xml"
```

If analyzing `.so`, `lib/arm64-v8a/*.so`, or `lib/armeabi-v7a/*.so` files, combine with:

- `re-ida-reverse`
- `re-radare2`

## Division of Tool Responsibilities

### `jadx`

Used for:

- Reading decompiled Java source
- Searching package names, class names, and method names
- Understanding high-level APK logic first

Common commands:

```bash
jadx -d jadx_out app.apk
jadx --single-class com.example.LoginActivity -d jadx_out app.apk
jadx --deobf -d jadx_out app.apk
```

### `JEB Pro` (Optional Commercial Tool)

Used for:

- Cross-validation and deep decompilation of Android DEX / APK / ARM
- Complementing static analysis when JADX output is incomplete or heavily obfuscated
- Second-toolchain validation of classes, methods, and call relationships for the same target

Boundaries:

- JEB Pro is commercial software; users must obtain and install a valid license independently. This package does not download, crack, or bypass licensing.
- Invoke only when local JEB availability is verified in `tool-index`; otherwise, continue using `jadx`, `apktool`, Ghidra, IDA, or radare2.
- Third-party JEB MCP bridges are not dependencies of this package. Source code, permissions, network behavior, and versions must be audited according to `skill://re-apk-reverse/support/ops/skill-supply-chain.md` prior to installation, followed by explicit user registration confirmation.

### `apktool`

Used for:

- Unpacking APKs
- Inspecting and modifying `AndroidManifest.xml`
- Inspecting and modifying smali
- Rebuilding APKs

Common commands:

```bash
apktool d app.apk -o apktool_out
apktool b apktool_out -o rebuilt.apk
```

### `frida`

Used for:

- Dynamically observing Java method calls
- Hooking native exported functions
- Bypassing root detection, certificate validation, and debugging detection

Common commands:

```bash
frida-ps -U
frida -U -f com.example.app -l hook.js
frida-trace -U -f com.example.app -j '*!*certificate*'
```

### `adb`

Used for:

- Device connectivity
- Installing APKs
- Viewing logcat logs
- Pulling files

Common commands:

```bash
adb devices
adb install -r app.apk
adb shell pm list packages
adb logcat
adb pull /data/local/tmp/file .
```

## Recommended Workflow

### 1. Triage

First determine the overall APK composition; do not rush into modifying packages or hooking.

Recommended actions:

1. Export Java code with `jadx -d jadx_out app.apk`
2. Export smali and resources with `apktool d app.apk -o apktool_out`
3. Inspect first:
   - `AndroidManifest.xml`
   - Primary `package`
   - `application`, `activity`, `service`, `receiver`
   - Whether `.so` files exist in the `lib/` directory
4. Issue #65 threat profile quick-check (authorized samples/devices; see `skill://re-apk-reverse/support/reverse-engineering/references/nonpe-format-cookbook.md` §7–8):
   - Transparent/hidden icons (AU): `aapt dump badging` + manifest theme/label/icon → `E-android-hidden-icon-manifest`
   - Magisk/script wipe characteristics and remote curl|sh (AR/AS) → Document signatures and URLs into evidence; **do not execute** destructive commands
   - Persistence paths (AT): `service.d` / `priv-app`, etc. → `E-android-persistence`

### 2. Java Logic Review

Prioritize reading from `jadx_out`:

- `MainActivity`
- `Application`
- Classes related to login, networking, cryptography, and risk control
- Third-party SDK initialization classes

Common keywords:

- `login`
- `sign`
- `encrypt`
- `cipher`
- `token`
- `root`
- `certificate`
- `trust`
- `okhttp`
- `retrofit`
- `webview`

If the Java code is readable, locate business logic here first.

### 3. Smali and Resource Layer Verification

Switch to `apktool_out` when `jadx` results are incomplete, heavily obfuscated, or when actual patching is needed:

- Inspect `smali*/`
- Inspect `res/values/strings.xml`
- Inspect `AndroidManifest.xml`

Prioritize patching:

- `android:exported`
- Debug flags
- Root detection return values
- Login verification logic
- Certificate validation branches

### 4. Rebuilding and Installation

After modification:

```bash
apktool b apktool_out -o rebuilt.apk
```

Or close the loop directly via script:

```bash
arsenal scripts re-apk-reverse/rebuild-sign-install "apktool_out"
```

Notes:

- This skill only guarantees the `apktool` rebuilding chain.
- If subsequent formal device installation is required, a signing process is typically necessary.
- If the task proceeds to signing/alignment, supplement with `apksigner` / `zipalign`.

### 5. Dynamic Hooking

When static analysis is insufficient, use Frida:

- Hook login functions
- Hook critical `OkHttp` / `Retrofit` / `WebView` execution points
- Hook `javax.crypto`, `MessageDigest`
- Hook root detection functions
- Hook SSL pinning logic

Principles:

- Hook the Java layer first, then evaluate whether native hooking is needed.
- Print arguments and return values before deciding whether to actively tamper with return values.

Recommendations:

- Use `frida-*` directly for simple, one-off commands.
- Prioritize `arsenal scripts re-apk-reverse/frida-run` for repeatable and stable injection workflows.

### 6. Native `.so` Triage

If the APK contains critical `.so` files:

- Locate `lib/**/*.so` via `apktool` or `jadx`.
- If only checking exported symbols, strings, or performing fast triage, use `re-radare2`.
- For deep long-term analysis, decompilation, renaming, and type recovery, use `re-ida-reverse`.

Switch to native analysis promptly upon encountering these signals:

- The Java layer is merely a JNI wrapper
- Core signing logic is not in Java
- Key logic disappears after `System.loadLibrary()`
- Certificate validation/risk control resides inside `.so` binaries

## Output Requirements

Final documentation must note at least:

- Entry components and key classes
- Whether key logic resides in Java, smali, or `.so`
- Confirmed sensitive points: login, signature, root, SSL, WebView, JNI
- Specific changes made if patched
- Targeted class/method/exported function if hooked

## Prohibited Actions

- Do not blindly patch smali at the outset
- Do not write hooks before reviewing the manifest and primary entry points
- Do not equate incomplete Java decompilation directly with "unexaminable logic"
- Do not get stuck grinding on the Java layer when `.so` files clearly hold the core logic

## Quick Command Cheatsheet

```bash
# Decompile Java
jadx -d jadx_out app.apk

# Unpack APK
apktool d app.apk -o apktool_out

# Rebuild APK
apktool b apktool_out -o rebuilt.apk

# Devices and processes
adb devices
frida-ps -U

# Launch and inject
frida -U -f com.example.app -l hook.js
```

---

## Routing Context

**Upstream Entry**: `skill://re-apk-reverse/support/SKILL.md` (Master Controller), `skill://re-apk-reverse/support/routing.md`
**Downstream Exit**:
- Core logic in `.so` → `re-ida-reverse/` or `re-radare2/`
- Dynamic hooking/validation needed → `arsenal skill_load re-reverse-engineering/tools-dynamic.md` (Frida section)
- General reverse engineering methodology → `arsenal skill_load re-reverse-engineering`

**Related Sibling Modules**: `re-reverse-engineering/` (.so analysis and advanced Frida usage)

---

## On-Demand Bootstrap

The entry scripts of this skill are integrated with the unified bootstrap system. When tools are missing, they will not fail directly; instead, they will automatically attempt installation.

### Automation Capability Boundaries

| Tool | Auto-installable | Installation Method | Notes |
|------|-----------|---------|------|
| jadx | ✓ | GitHub Release ZIP | Automatically downloaded and unzipped to `%USERPROFILE%\Tools\jadx\` |
| apktool | ✓ | GitHub Release JAR + wrapper | Automatically downloads jar and generates bat to `%USERPROFILE%\Tools\apktool\` |
| JEB Pro | ✗ | User manual installation with a valid license | Optional Android / ARM cross-validation tool; third-party MCP bridges require separate audits |
| frida / frida-ps | ✓ | pip install frida-tools | Requires Python already installed |
| adb | ✓ | winget / fallback path | Automatically installs Android Platform-Tools |
| zipalign | ✗ | Requires manual installation of Android Build-Tools | `sdkmanager "build-tools;35.0.0"` |
| apksigner | ✗ | Requires manual installation of Android Build-Tools | Same as above |

### Bootstrap Trigger Points

- `arsenal scripts re-apk-reverse/decode`: Automatically invokes `bootstrap-reverse.ps1` when jadx or apktool is missing
- `arsenal scripts re-apk-reverse/rebuild-sign-install`: Automatically invokes bootstrap when adb or apktool is missing
- `arsenal scripts re-apk-reverse/frida-run`: Currently still a manual check (frida is typically installed via pip)

### On Bootstrap Failure

If automated installation fails, the script will throw an explicit error along with manual installation links. Common reasons include:
- Network disconnected (GitHub API / PyPI unreachable)
- winget unavailable (Windows version too old)
- Java not installed (apktool depends on JDK)


## References

- `skill://re-apk-reverse/references/frida-cookbook.md` — Frida hooking recipes and scripts
- `skill://re-apk-reverse/references/android-advanced.md` — Advanced Android internals and JNI analysis
- `skill://re-apk-reverse/references/apk-security-checklist.md` — APK audit and verification checklist
- `skill://re-apk-reverse/references/frida-bypass-kit.md` — Root detection and SSL pinning bypass kit

## Task Completion Self-Check (MUST pass before claiming completion)

- [ ] Did I execute each step in the workflow (rather than only reading)?
- [ ] Did I use verified tool paths based on `tool-index`?
- [ ] Did I produce reproducible evidence (commands/templates/screenshots/reports)?
- [ ] Did I complete and verify the Checklist items required by RULES?
- [ ] If hidden icons, wipe scripts, or persistence clues were hit: did I record E-android-* Evidence per the U–AV cookbook (within authorized scope)?
