# iOS Reverse Engineering Special Topic

## IPA Acquisition and Decryption

```bash
# Download from App Store
ipatool search "Target App"
ipatool purchase -b com.target.app
ipatool download -b com.target.app -o app.ipa

# Extract installed app from device
# Jailbroken device
scp root@device:/private/var/containers/Bundle/Application/*/Target.app .

# Decryption (App Store binaries are in encrypted FAT format)
# frida-ios-dump (Recommended; prerequisite: git clone https://github.com/AloneMonkey/frida-ios-dump.git)
python3 frida-ios-dump/dump.py com.target.app -o decrypted.ipa

# Clutch
Clutch -i  # List installed applications
Clutch -d 1  # Decrypt the 1st application

# dumpdecrypted
DYLD_INSERT_LIBRARIES=dumpdecrypted.dylib /path/to/App
```

## Mach-O Analysis

```bash
# Basic information
otool -l TargetBinary | grep crypt    # Encryption status
otool -L TargetBinary                 # Dynamic library dependencies
otool -hv TargetBinary                # Header information
jtool2 --pages TargetBinary           # Memory page information

# Fat Binary Thinning
lipo -info TargetBinary
lipo TargetBinary -thin arm64 -output TargetBinary_arm64

# Symbol analysis
nm -g TargetBinary                    # Exported symbols
nm -a TargetBinary                    # All symbols
swift-demangle <mangled_name>         # Swift symbol demangling

# class-dump
class-dump -H TargetBinary -o headers/
# Export ObjC class and method declarations to headers/ directory
```

## Objective-C Runtime Analysis

```text
Message dispatch mechanism:
objc_msgSend(id self, SEL op, ...)  →  Dynamic method dispatch
  ↓
Runtime lookup:
1. Class method list cache
2. Class method list
3. Step-by-step superclass lookup
4. +resolveInstanceMethod / +resolveClassMethod
5. forwardingTargetForSelector
6. methodSignatureForSelector + forwardInvocation
```

### Frida ObjC Hook

```javascript
// Hook instance method
var hook = ObjC.classes.ClassName["- instanceMethod:"];
Interceptor.attach(hook.implementation, {
    onEnter: function(args) {
        // args[0] = self, args[1] = selector, args[2+] = method args
        console.log("self: " + new ObjC.Object(args[0]));
        console.log("arg: " + args[2].toInt32());
    }
});

// Hook class method
var hook = ObjC.classes.ClassName["+ classMethod:"];
Interceptor.attach(hook.implementation, { ... });

// Call ObjC method
var NSString = ObjC.classes.NSString;
var str = NSString.stringWithString_("test");
console.log(str.UTF8String());
```

## Swift Reverse Engineering

```text
Swift Name Mangling:
$s10ModuleName5ClassC6method3argSi_tF
  │ │         │     │ │      │  │   └─ Parameter type
  │ │         │     │ │      │  └───── Return type  
  │ │         │     │ │      └──────── Parameter name
  │ │         │     │ └─────────────── Method name
  │ │         │     └──────────────── Class name (length + name)
  │ │         └────────────────────── Module name
  │ └──────────────────────────────── Identifier marker
  └────────────────────────────────── Global marker

Tools: swift-demangle, Hopper (automatic demangling)
```

## Jailbreak Detection Bypass

```text
Detection classification:

1. File system checks:
   □ /Applications/Cydia.app
   □ /var/lib/apt/
   □ /bin/bash
   □ /usr/sbin/sshd
   → Hook NSFileManager.fileExistsAtPath:

2. Sandbox escape detection:
   □ Check if fork() succeeds (prohibited inside sandbox)
   □ system() calls
   → Hook fork → return -1

3. Dyld injection detection:
   □ _dyld_get_image_count > limit value
   → Restrict return value to reasonable range

4. Scheme detection:
   □ cydia:// URL Scheme
   → Hook UIApplication.canOpenURL:

5. sysctl detection:
   □ CTL_KERN/KERN_PROC/KERN_PROC_PID → kinfo_proc
   → Hook sysctl → Clear p_flag P_TRACED bit
```

### Frida Unified Bypass Script

```javascript
// File detection bypass
var NSFileManager = ObjC.classes.NSFileManager;
var defaultManager = NSFileManager.defaultManager();
Interceptor.attach(defaultManager["- fileExistsAtPath:"].implementation, {
    onLeave: function(retval) {
        var path = ObjC.Object(args[2]).toString();
        if (path.includes("Cydia") || path.includes("apt") || 
            path.includes("sshd") || path.includes("bash")) {
            retval.replace(0); // false
        }
    }
});

// fork bypass
Interceptor.replace(Module.findExportByName(null, "fork"), 
    new NativeCallback(function() { return -1; }, 'int', []));

// dyld bypass
var _dyld_get_image_count = Module.findExportByName(null, "_dyld_get_image_count");
Interceptor.attach(_dyld_get_image_count, {
    onLeave: function(retval) {
        if (retval.toInt32() > 200) retval.replace(200);
    }
});
```

## Key Protection Bypass Checklist

| Protection | iOS Bypass Method |
|---|---|
| App Store Encryption | frida-ios-dump / Clutch |
| SSL Pinning | Objection `ios sslpinning disable` / SSL Kill Switch 2 |
| Jailbreak Detection | Objection `ios jailbreak disable` / Custom Frida Hook |
| Anti-Debugging (PT_DENY_ATTACH) | Inject after Frida launch / debugserver |
| Integrity Check | Hook MAC checks / Code signature validation |
| Anti-Injection | Modify Mach-O to remove __RESTRICT segment |
| Swift Obfuscation | swift-demangle + LLM-assisted semantic recovery |
| Screenshot Protection | Hook UIScreen.mainScreen.snapshotViewAfterScreenUpdates |

Source: OWASP MSTG, frida-ios-dump, The iPhone Wiki