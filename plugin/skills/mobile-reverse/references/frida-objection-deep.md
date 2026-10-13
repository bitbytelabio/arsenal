# Advanced Frida + Objection Usage

## Frida Core API

### Java Runtime (Android)

```javascript
Java.perform(function() {
    // Get class instance
    var String = Java.use("java.lang.String");

    // Hook static method
    var System = Java.use("java.lang.System");
    System.getProperty.overload('java.lang.String').implementation = function(key) {
        console.log("System.getProperty: " + key);
        return this.getProperty(key);
    };

    // Hook constructor
    var File = Java.use("java.io.File");
    File.$init.overload('java.lang.String').implementation = function(path) {
        console.log("File opened: " + path);
        return this.$init(path);
    };

    // Enumerate loaded classes
    Java.enumerateLoadedClasses({
        onMatch: function(className) { console.log(className); },
        onComplete: function() {}
    });

    // Modify return value
    var RootDetector = Java.use("com.app.security.RootDetector");
    RootDetector.isDeviceRooted.implementation = function() {
        return false;
    };
});
```

### Native Layer (Android + iOS)

```javascript
// Hook exported function
Interceptor.attach(Module.findExportByName(null, "open"), {
    onEnter: function(args) {
        this.path = Memory.readUtf8String(args[0]);
    },
    onLeave: function(retval) {
        console.log("open(" + this.path + ") = " + retval);
    }
});

// Hook arbitrary address (via offset)
var base = Module.findBaseAddress("libnative.so");
var target = base.add(0x12345);
Interceptor.attach(target, {
    onEnter: function(args) {
        console.log("Function called from: " + Thread.backtrace(this.context, Backtracer.ACCURATE)
            .map(DebugSymbol.fromAddress).join('\n'));
    }
});

// Modify return value
Interceptor.attach(Module.findExportByName(null, "strcmp"), {
    onLeave: function(retval) {
        if (retval.toInt32() === 0) return; // strings equal, skip
        // Force match
        retval.replace(0);
    }
});
```

### ObjC Runtime (iOS)

```javascript
// Hook ObjC method
var hook = ObjC.classes.ViewController["- viewDidLoad"];
Interceptor.attach(hook.implementation, {
    onEnter: function(args) {
        console.log("viewDidLoad called");
    }
});

// Enumerate all classes
ObjC.enumerateLoadedClasses({
    onMatch: function(className) { console.log(className); },
    onComplete: function() {}
});

// Call ObjC method
var NSString = ObjC.classes.NSString;
var str = NSString.stringWithString_("Hello from Frida");
```

## Objection Command Quick Reference

### General

```bash
objection -g "com.app" explore           # Launch
objection -g "com.app" explore -q        # Quiet launch (inject only, do not wait)
objection patchapk --source app.apk      # Automatically inject Frida Gadget
objection signapk --source app.apk       # Sign only

# File System
env              # Application data directories
ls               # List files
file download /path/to/file  # Download file
file upload local.txt /remote/path  # Upload file

# SQLite
sqlite connect /path/to/db.sqlite
.tables          # List tables
select * from users;  # Query
```

### Android Specific

```bash
android root disable              # Bypass Root detection
android sslpinning disable        # Bypass SSL Pinning
android hooking list classes      # Enumerate classes
android hooking list class_methods com.app.Main  # Enumerate methods
android hooking watch class com.app.Main  # Hook all methods
android intent launch_activity com.app.MainActivity  # Launch Activity
android heap search instances com.app.User  # Heap search
android keystore list             # Keystore entries
```

### iOS Specific

```bash
ios jailbreak disable             # Bypass jailbreak detection
ios sslpinning disable            # Bypass SSL Pinning
ios keychain dump                 # Dump Keychain
ios nsuserdefaults get            # NSUserDefaults
ios nsurlcache dump               # HTTP Cache
ios cookies get                   # Read Cookies
ios pasteboard monitor            # Monitor clipboard
ios ui dump                       # UI hierarchy
ios plist cat Info.plist          # Read plist
```

## Non-Root / Non-Jailbreak Deployment

### Android — Frida Gadget Injection

```bash
# 1. Decompile APK
apktool d app.apk -o app_unpacked

# 2. Download frida-gadget and place into lib directory
cp frida-gadget-17.x.x-android-arm64.so \
   app_unpacked/lib/arm64-v8a/libfrida-gadget.so

# 3. Inject System.loadLibrary("frida-gadget") into smali
# Modify onCreate or attachBaseContext of the main Activity

# 4. Rebuild and sign
apktool b app_unpacked -o app_patched.apk
uber-apk-signer -a app_patched.apk

# 5. Objection automation
objection patchapk --source app.apk --skip-resources
```

### iOS — Frida Gadget Injection

```bash
# 1. Decrypt App Store IPA (prerequisite: git clone https://github.com/AloneMonkey/frida-ios-dump.git)
python3 frida-ios-dump/dump.py -u -p com.app.target

# 2. Inject FridaGadget.dylib
# Modify Mach-O Load Commands, add @executable_path/FridaGadget.dylib

# 3. Resign
codesign -f -s "Apple Development" Payload/App.app

# 4. Install via Xcode sideload or AltStore
```

## Advanced SSL Pinning Bypass

### Multi-layer Bypass (Android)

```javascript
// 1. OkHttp CertificatePinner
var CertificatePinner = Java.use("okhttp3.CertificatePinner");
CertificatePinner.check.overload('java.lang.String', 'java.util.List').implementation = function() {};

// 2. Custom TrustManager
var TrustManagerImpl = Java.use("com.android.org.conscrypt.TrustManagerImpl");
TrustManagerImpl.verifyChain.implementation = function() { return []; };

// 3. WebView SSL Error
var SslErrorHandler = Java.use("android.webkit.SslErrorHandler");
SslErrorHandler.proceed.implementation = function() { return this.proceed(); };

// 4. Network Security Config
// Requires modifying AndroidManifest.xml -> android:networkSecurityConfig="@xml/network_security_config"
// Add user certificate trust in the xml configuration
```

### Multi-layer Bypass (iOS)

```javascript
// 1. NSURLSession
var SecTrustEvaluate = Module.findExportByName("Security", "SecTrustEvaluate");
Interceptor.replace(SecTrustEvaluate, new NativeCallback(function(trust, result) {
    Memory.writeU32(result, 1); // kSecTrustResultProceed = 1
    return 0; // errSecSuccess
}, 'int', ['pointer', 'pointer']));

// 2. Alamofire
// Hook ServerTrustManager.evaluate -> Always return success
```

Source: Frida docs, Objection wiki, OWASP MSTG