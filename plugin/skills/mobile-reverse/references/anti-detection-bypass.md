# Root / Jailbreak / Anti-Debugging / SSL Pinning Bypass

## Detection Layer Model

```
Layer 1: Static Detection (Install-time / Launch-time)
  ├─ Package manager detection (Cydia, apt, Magisk)
  ├─ File detection (su, busybox, frida-server)
  └─ Permission detection (ro.debuggable, ro.secure)

Layer 2: Runtime Detection (Continuous)
  ├─ Process detection (frida-server, magiskd)
  ├─ Port detection (27042 frida default)
  ├─ Memory detection (/proc/self/maps injection traces)
  └─ Stack detection (Frida call frames)

Layer 3: Environment Detection (On-demand trigger)
  ├─ ptrace detection (TracerPid)
  ├─ /proc/self/status detection
  ├─ build.prop detection (test-keys)
  └─ Direct syscall detection (bypassing libc)
```

## Android Root Detection Bypass

### Common Detection Libraries and Bypass Methods

| Detection Library | Detection Method | Bypass Method |
|---|---|---|
| RootBeer | 8-method detection suite | Hook each detection method to return false |
| SafetyNet | Google Play Services remote attestation | Use Magisk Hide / Shamiko / Play Integrity Fix |
| Google Play Integrity | Replacement for SafetyNet | TrickyStore + PIF |
| Custom native detection | syscall reading /proc/self/status | Hook syscall or modify /proc mount |

### Comprehensive Frida Bypass

```javascript
Java.perform(function() {
    // RootBeer
    var RootBeer = Java.use("com.scottyab.rootbeer.RootBeer");
    var methods = ["isRooted", "isRootedWithBusyBox", "checkSuExists",
        "detectRootManagementApps", "detectPotentiallyDangerousApps",
        "detectTestKeys", "checkForDangerousProps", "checkForRWPaths"];
    methods.forEach(function(m) {
        RootBeer[m].implementation = function() { return false; };
    });

    // Generic Build.TAGS detection
    var Build = Java.use("android.os.Build");
    var original = Build.TAGS.value;
    Build.TAGS.value = "release-keys";

    // PackageManager → Hide package names
    var PackageManager = Java.use("android.content.pm.PackageManager");
    PackageManager.getPackageInfo.overload('java.lang.String', 'int').implementation = function(pkg, flags) {
        if (pkg == "de.robv.android.xposed.installer" || 
            pkg.includes("magisk") || pkg.includes("frida")) {
            throw Java.use("android.content.pm.PackageManager$NameNotFoundException").$new();
        }
        return this.getPackageInfo(pkg, flags);
    };
});
```

## iOS Jailbreak Detection Bypass

### Multi-Layer Frida Hook

```javascript
// 1. File system detection
var NSFileManager = ObjC.classes.NSFileManager;
var paths = [
    "/Applications/Cydia.app", "/var/lib/apt", "/bin/bash",
    "/usr/sbin/sshd", "/etc/apt", "/Library/MobileSubstrate"
];
// Hook fileExistsAtPath to return NO

// 2. fork detection (prohibited inside sandbox)
var fork_ptr = Module.findExportByName("libSystem.B.dylib", "fork");
Interceptor.replace(fork_ptr, new NativeCallback(function() {
    return -1;
}, 'int', []));

// 3. Scheme detection
// Hooked via MobileSubstrate
var LSApplicationWorkspace = ObjC.classes.LSApplicationWorkspace;
// Hook defaultWorkspace → canOpenURL → return NO for cydia://

// 4. Signature detection
var MISValidateSignature = Module.findExportByName(null, "MISValidateSignature");
Interceptor.attach(MISValidateSignature, {
    onLeave: function(retval) { retval.replace(0); }
});
```

## Anti-Debugging Bypass

### Android

```javascript
// 1. ptrace self → prevent attaching
// Native: ptrace(PTRACE_TRACEME, 0, NULL, 0)
// Bypass: Hook ptrace → return 0

// 2. TracerPid detection
// /proc/self/status → TracerPid: 0
var fopen = Module.findExportByName(null, "fopen");
Interceptor.attach(fopen, {
    onEnter: function(args) {
        this.path = Memory.readUtf8String(args[0]);
    },
    onLeave: function(retval) {
        if (this.path && this.path.includes("status")) {
            // Modify returned FILE* to return forged content
        }
    }
});

// 3. isDebuggerConnected (Java)
var Debug = Java.use("android.os.Debug");
Debug.isDebuggerConnected.implementation = function() { return false; };
```

### iOS

```javascript
// 1. PT_DENY_ATTACH
// ptrace(PT_DENY_ATTACH, 0, NULL, 0) → prevent debugger attachment
var ptrace = Module.findExportByName(null, "ptrace");
Interceptor.replace(ptrace, new NativeCallback(function(request, pid, addr, data) {
    if (request == 31) return 0; // PT_DENY_ATTACH → ignore
    return ptrace(request, pid, addr, data);
}, 'int', ['int', 'int', 'pointer', 'int']));

// 2. sysctl detection
var sysctl = Module.findExportByName(null, "sysctl");
Interceptor.attach(sysctl, {
    onLeave: function(retval) {
        // Modify p_flag field of kinfo_proc → clear P_TRACED
    }
});

// 3. getppid detection (check if parent process is launchd)
// During debugging, getppid() != 1
```

## SSL Pinning Bypass

### Android Five-Layer Bypass

```text
Layer 1 — TrustManager: Accept all certificates
Layer 2 — OkHttp CertificatePinner: Hook to clear the pins list
Layer 3 — WebView SSL Error Handler: Ignore certificate errors
Layer 4 — Network Security Config: Modify xml → trust user certificates
Layer 5 — Native SSL (OpenSSL/BoringSSL): Hook SSL_get_verify_result → X509_V_OK
```

### iOS Four-Layer Bypass

```text
Layer 1 — NSURLSession: Hook SecTrustEvaluate → kSecTrustResultProceed
Layer 2 — Alamofire: Hook ServerTrustManager
Layer 3 — AFNetworking: Hook AFSecurityPolicy
Layer 4 — libcurl: LD_PRELOAD to replace SSL verification callback
```

### Common Objection Commands

```bash
# Android
objection -g "com.app" explore
android sslpinning disable
# Equivalent to: automatically hooking the 5 layers described above

# iOS
objection -g "com.app" explore
ios sslpinning disable
# Equivalent to: automatically hooking the 4 layers described above
```

Source: OWASP MSTG, Frida CodeShare, objection wiki