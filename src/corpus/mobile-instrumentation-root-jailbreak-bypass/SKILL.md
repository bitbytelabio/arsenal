---
name: mobile-instrumentation-root-jailbreak-bypass
description: Dynamic root and jailbreak detection bypass across Android and iOS using Frida instrumentation, libc hooking, and kernel cloaking.
domain: mobile
category: instrumentation
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/mobile-instrumentation-root-jailbreak-bypass/SKILL.md
---
# Dynamic Root and Jailbreak Detection Bypass (Android & iOS)

## When to Use
Execute this operational playbook when mobile application security assessments are obstructed by client-side environment integrity controls on Android (Root detection, Magisk, KernelSU) or iOS (Jailbreak detection, Cydia, Sileo, Dopamine). Bypassing these controls is required to perform runtime API hooking, dynamic traffic interception, and memory forensics aligned with OWASP MASTG-RESILIENCE-01 and MASTG-RESILIENCE-02.

---

## 1. Operational Decision Tree

```text
                  [Mobile Target Launched on Test Device]
                                     │
                                     ▼
                      [Preflight Architecture Check]
             (Identify OS: Android ART vs iOS Objective-C/Swift)
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
             [Android Target]                  [iOS Target]
                     │                               │
                     ▼                               ▼
         [Detect Detection Mechanism]    [Detect Detection Mechanism]
         - Java File check (/system/bin/su) - Cydia / Sileo URL schemes
         - PackageManager (Magisk, SuperSU)- Sandbox write (/private/jb.txt)
         - Build.TAGS ("test-keys")       - Dyld injected dylibs
         - Runtime.exec ("which su")      - stat() on /Applications/Cydia.app
         - Native libc (fopen, stat, faccess)- fork() syscall execution
                     │                               │
                     ▼                               ▼
         [Stage 1: Native Frida Hook]    [Stage 2: iOS Frida Hook]
         Inject universal_unroot.js       Inject universal_unjailbreak.js
         Hook Java & libc native APIs     Hook ObjC methods & libSystem
                     │                               │
                     └───────────────┬───────────────┘
                                     │
                                     ▼
                          [Application Evaluation]
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
  [App Launches Normally]                                 [App Exits / Detects Frida]
  Dashboard & UI Rendered                                 Anti-Frida Mechanism Active
         │                                                       │
         ▼                                                       ▼
  [Tripartite Verification]                              [Stage 3: Anti-Frida Bypass]
  - Positive UI assertion                                - Rename frida-server
  - Negative baseline control                            - Change port from 27042
  - Differential spawn invariance                        - Hook pthread_create / ptrace
         │                                                       │
         └───────────────────────────┬───────────────────────────┘
                                     ▼
                       [Evidence Ledger Capture]
         arsenal append-evidence --case $CASE_ID --tool frida ...
                                     │
                                     ▼
                       [Downstream Kill-Chain Handoff]
         - Traffic Proxying -> mobile-instrumentation-flutter-traffic-interception
         - IPC Surface -> mobile-testing-android-intents-for-vulnerabilities
```

---

## 2. Multi-Stage Tooling Pipeline & Execution Flags

### Stage 1: Android Dynamic Root Bypass with Frida

Deploy comprehensive hooks across Java reflection, PackageManager, Runtime execution, and native libc system calls:

```bash
# Verify USB connection to Android test device
adb devices

# Start frida-server on Android device with root permissions
adb shell "su -c '/data/local/tmp/frida-server &'"

# Spawn target application with universal unroot hook script
frida -U -f com.target.app \
  -l scripts/universal_unroot.js \
  --pause
```

#### Universal Android Root Bypass Script (`scripts/universal_unroot.js`)
```javascript
Java.perform(function() {
    console.log("[*] Initializing Universal Android Root Cloaking Engine...");

    // 1. Hook Java File existence checks
    var File = Java.use("java.io.File");
    var rootPaths = [
        "/system/app/Superuser.apk",
        "/sbin/su",
        "/system/bin/su",
        "/system/xbin/su",
        "/data/local/xbin/su",
        "/data/local/bin/su",
        "/system/sd/xbin/su",
        "/system/bin/failsafe/su",
        "/data/local/su",
        "/su/bin/su",
        "/system/xbin/daemonsu"
    ];

    File.exists.implementation = function() {
        var path = this.getAbsolutePath();
        for (var i = 0; i < rootPaths.length; i++) {
            if (path.indexOf(rootPaths[i]) !== -1) {
                console.log("[+] Cloaked File.exists() probe: " + path);
                return false;
            }
        }
        return this.exists.call(this);
    };

    // 2. Hook Runtime.exec command execution (which su, su, busybox)
    var Runtime = Java.use("java.lang.Runtime");
    Runtime.exec.overload("[Ljava.lang.String;").implementation = function(cmdArray) {
        var cmd = cmdArray.join(" ");
        if (cmd.indexOf("su") !== -1 || cmd.indexOf("which") !== -1 || cmd.indexOf("busybox") !== -1) {
            console.log("[+] Blocked Runtime.exec() probe: " + cmd);
            throw Java.use("java.io.IOException").$new("Command failed");
        }
        return this.exec.call(this, cmdArray);
    };

    // 3. Hook Build.TAGS test-keys check
    var Build = Java.use("android.os.Build");
    Build.TAGS.value = "release-keys";

    // 4. Hook Native libc fopen, stat, access probes
    var fopen = Module.findExportByName("libc.so", "fopen");
    if (fopen) {
        Interceptor.attach(fopen, {
            onEnter: function(args) {
                var path = Memory.readUtf8String(args[0]);
                for (var i = 0; i < rootPaths.length; i++) {
                    if (path.indexOf(rootPaths[i]) !== -1) {
                        console.log("[+] Cloaked libc.so fopen() probe: " + path);
                        args[0] = Memory.allocUtf8String("/system/does_not_exist_null");
                        break;
                    }
                }
            }
        });
    }

    console.log("[+] Universal Root Cloaking Active.");
});
```

---

### Stage 2: iOS Dynamic Jailbreak Bypass with Frida

```bash
# Verify USB connection to jailbroken iOS test device
frida-ls-devices

# Spawn target iOS application with unjailbreak script
frida -U -f com.target.iosapp \
  -l scripts/universal_unjailbreak.js
```

#### Universal iOS Jailbreak Bypass Script (`scripts/universal_unjailbreak.js`)
```javascript
if (ObjC.available) {
    console.log("[*] Initializing iOS Objective-C Jailbreak Cloaking Engine...");

    // 1. Hook NSFileManager fileExistsAtPath:
    var NSFileManager = ObjC.classes.NSFileManager;
    var hook = NSFileManager["- fileExistsAtPath:"];
    var jbPaths = [
        "/Applications/Cydia.app",
        "/Applications/Sileo.app",
        "/Library/MobileSubstrate/MobileSubstrate.dylib",
        "/bin/bash",
        "/usr/sbin/sshd",
        "/etc/apt",
        "/private/var/lib/apt/",
        "/private/jailbreak.txt"
    ];

    Interceptor.attach(hook.implementation, {
        onEnter: function(args) {
            var path = ObjC.Object(args[2]).toString();
            this.isJbPath = false;
            for (var i = 0; i < jbPaths.length; i++) {
                if (path.indexOf(jbPaths[i]) !== -1) {
                    this.isJbPath = true;
                    console.log("[+] Cloaked NSFileManager fileExistsAtPath: " + path);
                    break;
                }
            }
        },
        onLeave: function(retval) {
            if (this.isJbPath) {
                retval.replace(0);
            }
        }
    });

    // 2. Hook UIApplication canOpenURL: for Cydia URL schemes
    var UIApplication = ObjC.classes.UIApplication;
    var openHook = UIApplication["- canOpenURL:"];
    if (openHook) {
        Interceptor.attach(openHook.implementation, {
            onEnter: function(args) {
                var url = ObjC.Object(args[2]).toString();
                this.isJbUrl = (url.indexOf("cydia://") !== -1 || url.indexOf("sileo://") !== -1);
            },
            onLeave: function(retval) {
                if (this.isJbUrl) {
                    console.log("[+] Cloaked canOpenURL probe");
                    retval.replace(0);
                }
            }
        });
    }

    console.log("[+] Universal iOS Jailbreak Cloaking Active.");
}
```

---

### Stage 3: Anti-Frida & Dynamic Tamper Evasion

When applications actively detect the Frida agent (closing immediately upon spawn), deploy evasion measures:

```bash
# 1. Rename frida-server binary and socket name
adb shell "mv /data/local/tmp/frida-server /data/local/tmp/sys_daemon"
adb shell "su -c '/data/local/tmp/sys_daemon -l 127.0.0.1:39182 &'"

# 2. Forward custom port to host
adb forward tcp:39182 tcp:39182

# 3. Connect via custom host address
frida -H 127.0.0.1:39182 -f com.target.app -l scripts/universal_unroot.js
```

#### Hooking ptrace and Anti-Debug Checks
```javascript
Interceptor.attach(Module.findExportByName(null, "ptrace"), {
    onEnter: function(args) {
        var req = args[0].toInt32();
        if (req === 31) { // PT_DENY_ATTACH on iOS
            console.log("[+] Neutralized ptrace(PT_DENY_ATTACH)");
            args[0] = ptr(-1);
        }
    },
    onLeave: function(retval) {
        retval.replace(0);
    }
});
```

---

## 3. Tripartite Verification Oracle

Bypass success is verified against three deterministic criteria:

```text
+---------------------------------------------------------------------------------------+
|                              TRIPARTITE VERIFICATION ORACLE                            |
+---------------------------------------------------------------------------------------+
| 1. POSITIVE ASSERTION       | Target application successfully renders its interactive |
|                             | main dashboard activity without showing "Security Alert"|
|                             | or "Device Tampered" dialogs, and process remains alive |
|                             | for > 30 seconds after launch.                          |
+-----------------------------+---------------------------------------------------------+
| 2. NEGATIVE BASELINE        | Launch application WITHOUT Frida script attached:       |
|    CONTROL                  | Application immediately displays root warning dialog or |
|                             | calls System.exit(0) / abort(), confirming root checks  |
|                             | were active and successfully suppressed by the hooks.   |
+-----------------------------+---------------------------------------------------------+
| 3. DIFFERENTIAL INVARIANCE  | Close and re-spawn process 3 times under Frida hooks:   |
|                             | Verify 100% bypass consistency with zero crashes.       |
+---------------------------------------------------------------------------------------+
```

---

## 4. False-Positive & Edge-Case Elimination

- **Hardware-Backed Keystore Attestation**: Note that Frida userspace hooks cannot bypass hardware-backed Play Integrity / SafetyNet attestation (which requires cryptographically signed hardware keystore responses from Google servers). If attestation fails at the server level, verify whether the check is enforced locally (bypassable) or by backend API authentication tokens (requires device-level Magisk modules such as PlayIntegrityFix).
- **Proactive Crash Handlers**: Some applications call `killProcess()` from a secondary thread. Ensure hooks attach early via `-f` (spawn mode) rather than attaching to an already-running process.

---

## 5. Evidence Capture & Ledger Registration

```bash
# 1. Capture process status and Frida execution receipt
frida -U -f com.target.app -l scripts/universal_unroot.js --eval "console.log('PID: ' + Process.id)" \
  > work/$CASE_ID/evidence/raw/root_bypass_frida.txt

# 2. Append evidence entry to cryptographic audit ledger
arsenal append-evidence \
  --case $CASE_ID \
  --tool frida \
  --file work/$CASE_ID/evidence/raw/root_bypass_frida.txt \
  --desc "Confirmed dynamic root detection bypass via Frida hooking on Android"
```

---

## 6. Kill-Chain Chaining & Downstream Handoffs

- **Prerequisites**: Android device connected via ADB or iOS device connected via USB with Frida server running. Target package declared in `scope.json`.
- **Downstream Handoffs**:
  - **Traffic Proxying**: Once root bypass is active, inject `mobile-instrumentation-flutter-traffic-interception` to bypass SSL pinning.
  - **IPC Audit**: Transition to `mobile-testing-android-intents-for-vulnerabilities` to fuzz exported activities.
