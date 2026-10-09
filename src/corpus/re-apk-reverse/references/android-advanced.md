# Advanced Android Reverse Engineering Reference

> Covers Native SO Analysis, Advanced Frida Usage, SSL Pinning Bypass, Root Detection Countermeasures, Packer Unpacking, and Flutter/React Native Reverse Engineering.

---

## Native SO Reverse Engineering

### Analysis Workflow

```text
1. Extract .so files from the APK
   unzip app.apk lib/arm64-v8a/*.so -d extracted/

2. Verify architecture and basic information
   file libxxx.so
   rabin2 -I libxxx.so

3. Locate JNI entry points
   - Search for JNI_OnLoad (Dynamic registration)
   - Search for Java_com_xxx_yyy (Static registration)
   - nm -D libxxx.so | grep -i java

4. IDA/Ghidra loading and analysis
   - Import JNI headers (jni.h types)
   - Annotate JNIEnv* parameters
   - Locate RegisterNatives calls (Dynamic registration function table)

5. Locate critical logic
   - Trace from Java-layer native method names
   - Cross-reference strings (keys, URLs, error messages)
   - Trace crypto library function calls (AES/MD5/SHA)
```

### JNI Function Registration

```c
// Static registration: Function name = Java_PackageName_ClassName_MethodName
JNIEXPORT jstring JNICALL Java_com_example_app_Security_getSign(
    JNIEnv *env, jobject thiz, jstring input) { ... }

// Dynamic registration: Call RegisterNatives inside JNI_OnLoad
static JNINativeMethod methods[] = {
    {"getSign", "(Ljava/lang/String;)Ljava/lang/String;", (void*)native_getSign},
};

JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *reserved) {
    JNIEnv *env;
    vm->GetEnv((void**)&env, JNI_VERSION_1_6);
    jclass clazz = env->FindClass("com/example/app/Security");
    env->RegisterNatives(clazz, methods, sizeof(methods)/sizeof(methods[0]));
    return JNI_VERSION_1_6;
}
```

### Tips for Analyzing JNI in IDA

```text
1. Import JNI type library
   File → Load File → Parse C Header → jni.h

2. Annotate the first parameter as JNIEnv*
   Right-click parameter → Set type → JNIEnv*
   This enables automatic recognition for calls like env->FindClass / env->GetMethodID

3. Locate RegisterNatives
   Search for calls to JNIEnv vtable offset 0x35C (ARM64)
   → The third parameter is the JNINativeMethod array
   → Extract all native function addresses from the array
```

---

## Advanced Frida Usage

### Hooking Native Functions

```javascript
// Hook libc function
Interceptor.attach(Module.findExportByName("libc.so", "open"), {
    onEnter: function(args) {
        this.path = args[0].readUtf8String();
        console.log("[open] " + this.path);
    },
    onLeave: function(retval) {
        if (this.path.includes("su") || this.path.includes("magisk")) {
            console.log("[open] Blocked root check: " + this.path);
            retval.replace(-1);  // Return failure
        }
    }
});

// Hook function in custom SO
var base = Module.findBaseAddress("libsecurity.so");
var targetFunc = base.add(0x1234);  // Offset address
Interceptor.attach(targetFunc, {
    onEnter: function(args) {
        console.log("arg0: " + args[0].readUtf8String());
    },
    onLeave: function(retval) {
        console.log("return: " + retval.readUtf8String());
    }
});
```

### Hooking Java Methods

```javascript
Java.perform(function() {
    // Hook instance method
    var Security = Java.use("com.example.app.Security");
    Security.getSign.implementation = function(input) {
        console.log("[getSign] input: " + input);
        var result = this.getSign(input);  // Call original method
        console.log("[getSign] output: " + result);
        return result;
    };

    // Hook constructor
    Security.$init.overload('java.lang.String').implementation = function(key) {
        console.log("[Security.<init>] key: " + key);
        this.$init(key);
    };

    // Hook overloaded method
    Security.encrypt.overload('java.lang.String', 'int').implementation = function(data, mode) {
        console.log("[encrypt] data=" + data + " mode=" + mode);
        return this.encrypt(data, mode);
    };
});
```

### Memory Searching and Patching

```javascript
// Search for string in memory
Process.enumerateModules().forEach(function(module) {
    if (module.name === "libtarget.so") {
        Memory.scan(module.base, module.size, "48 65 6C 6C 6F", {  // "Hello"
            onMatch: function(address, size) {
                console.log("Found at: " + address);
            }
        });
    }
});

// Modify memory (patch instructions)
var addr = Module.findBaseAddress("libsecurity.so").add(0x5678);
Memory.patchCode(addr, 4, function(code) {
    var writer = new Arm64Writer(code, {pc: addr});
    writer.putNop();  // Replace with NOP
    writer.flush();
});
```

---

## SSL Pinning Bypass

### Universal Approach (Recommended)

```javascript
// Universal Frida SSL Pinning Bypass
// Source: https://github.com/0xCD4/SSL-bypass
Java.perform(function() {
    // 1. TrustManager bypass
    var TrustManager = Java.registerClass({
        name: 'com.custom.TrustManager',
        implements: [Java.use('javax.net.ssl.X509TrustManager')],
        methods: {
            checkClientTrusted: function(chain, authType) {},
            checkServerTrusted: function(chain, authType) {},
            getAcceptedIssuers: function() { return []; }
        }
    });

    // 2. SSLContext replacement
    var SSLContext = Java.use('javax.net.ssl.SSLContext');
    var sslContext = SSLContext.getInstance("TLS");
    sslContext.init(null, [TrustManager.$new()], null);

    // 3. OkHttp CertificatePinner bypass
    try {
        var CertificatePinner = Java.use('okhttp3.CertificatePinner');
        CertificatePinner.check.overload('java.lang.String', 'java.util.List').implementation = function() {};
    } catch(e) {}
});
```

### Bypass Methods by Framework

| Framework | Bypass Method |
|---|---|
| OkHttp3 | Hook `CertificatePinner.check` to return empty |
| Retrofit | Same as OkHttp (underlying implementation uses OkHttp) |
| Volley | Hook SSL factory of `HurlStack` |
| Flutter | Hook `SecurityContext` in `dart:io` (requires dedicated script) |
| React Native | Hook `OkHttpClientProvider` |
| WebView | Hook `WebViewClient.onReceivedSslError` |

### Flutter Topics

```javascript
// Flutter SSL Pinning Bypass (requires locating the ssl_verify_peer_cert function)
var flutter_lib = Module.findBaseAddress("libflutter.so");
// Search for the signature pattern of ssl_verify_peer_cert
var pattern = "FF 03 05 D1 FD 7B 0F A9";  // ARM64 signature
Memory.scan(flutter_lib, Module.findModuleByName("libflutter.so").size, pattern, {
    onMatch: function(address) {
        Interceptor.replace(address, new NativeCallback(function() {
            return 0;  // Return success
        }, 'int', []));
    }
});
```

---

## Root Detection Bypass

### Common Detection Methods

| Detection Method | Bypass Method |
|---------|---------|
| Check `/system/app/Superuser.apk` | Hook `File.exists()` to return false |
| Check `su` command | Hook `Runtime.exec()` to intercept su calls |
| Check `/proc/self/mounts` | Hook file reading to filter Magisk-related entries |
| SafetyNet/Play Integrity | Magisk Hide / Zygisk + Shamiko |
| Check Magisk package name | Randomize Magisk package name |
| Check `/data/adb/` | Hook `opendir`/`access` |

### Frida Generic Root Bypass

```javascript
Java.perform(function() {
    // Hook File.exists
    var File = Java.use("java.io.File");
    File.exists.implementation = function() {
        var path = this.getAbsolutePath();
        var blacklist = ["su", "Superuser", "magisk", "busybox", "xposed"];
        for (var i = 0; i < blacklist.length; i++) {
            if (path.toLowerCase().includes(blacklist[i])) {
                return false;
            }
        }
        return this.exists();
    };

    // Hook System.getProperty
    var System = Java.use("java.lang.System");
    System.getProperty.overload('java.lang.String').implementation = function(key) {
        if (key === "ro.debuggable" || key === "ro.secure") {
            return "1";
        }
        return this.getProperty(key);
    };
});
```

---

## Hardening/Packer Identification and Unpacking

### Common Hardening Vendors

| Hardener/Packer | Identification Features | Unpacking Method |
|------|---------|---------|
| 360 Hardening | `libjiagu.so`, `com.stub.StubApp` | FART / Frida dump dex |
| Tencent Legu | `libshell*.so`, `com.tencent.StubShell` | FART / BlackDex |
| Bangcle | `libDexHelper.so`, `com.secneo.apkwrapper` | FART |
| IJiami | `libexec.so`, `s.h.e.l.l` | Frida dump |
| NetEase YiDun | `libnesec.so` | Frida dump |
| Naga | `libnaga.so` | Frida dump |

### Generic Unpacking Methods

```text
Method 1: FART (ART Environment Unpacking)
- Flash FART ROM or use the Frida version of FART
- Automatically dump all DEX files loaded by ClassLoaders

Method 2: Frida DEX Dump
- frida -U -f com.target.app -l dex_dump.js
- Hook at DexFile::OpenMemory to dump DEX from memory

Method 3: BlackDex
- Non-root unpacking tool
- Directly install BlackDex APK and select the target app to unpack

Method 4: Manual Dump
- Use Frida to enumerate all ClassLoaders
- Locate the application ClassLoader -> Obtain the DexFile object
- Read and save the DEX memory region
```

### Frida DEX Dump Script

```javascript
Java.perform(function() {
    Java.enumerateClassLoaders({
        onMatch: function(loader) {
            try {
                var dexFiles = loader.getDexFileList();
                console.log("ClassLoader: " + loader);
                console.log("  DEX files: " + dexFiles);
            } catch(e) {}
        },
        onComplete: function() {}
    });
});
```

---

## React Native / Flutter Reverse Engineering

### React Native

```text
1. Unzip APK -> assets/index.android.bundle (JS code)
2. Format JS -> Search for API addresses, keys, and signing logic
3. If Hermes bytecode (.hbc file) is present -> Decompile with hermes-dec
4. Hook: Use Frida to hook ReactBridge at the Java layer
```

### Flutter

```text
1. Flutter code compiles to libapp.so (Dart AOT)
2. Cannot be directly decompiled into Dart source code
3. Analysis methods:
   - reFlutter tool: patch libflutter.so to obtain snapshot
   - Doldrums: Parse Dart snapshot to recover class/function information
   - Frida hook key functions in libflutter.so
4. Network analysis: Flutter bypasses system proxies, requiring dedicated SSL handling
```

---

## Tool Quick Reference

| Tool | Purpose | Installation |
|------|------|------|
| jadx | Java decompiler | Already in bootstrap |
| apktool | Unpack/repack | Already in bootstrap |
| Frida | Dynamic hooking | `pip install frida-tools` |
| Objection | Frida wrapper (easier to use) | `pip install objection` |
| MobSF | Automated mobile security analysis | Docker deployment |
| BlackDex | Non-root unpacking | APK installation |
| FART | ART unpacking | Flash ROM or Frida version |
| hermes-dec | Hermes bytecode decompiler | npm install |
| reFlutter | Flutter reverse engineering assistant | pip install |
| Magisk + Shamiko | Root hiding | Flash |

---

## Reference Resources

| Resource | Description | Link |
|------|------|------|
| OWASP MASTG | Mobile Application Security Testing Guide | https://mas.owasp.org/ |
| FridaBypassKit | Generic bypass framework | https://github.com/okankurtuluss/FridaBypassKit |
| SSL-bypass | Generic SSL Pinning bypass | https://github.com/0xCD4/SSL-bypass |
| awesome-frida | Curated list of Frida resources | https://github.com/dweinstein/awesome-frida |
| Android Security Awesome | Android security resources | https://github.com/ashishb/android-security-awesome |