# Frida Bypass Kit — Universal Android Security Bypass Framework

> Source: [FridaBypassKit](https://github.com/okankurtuluss/FridaBypassKit) (2025)
> Use Cases: Required when bypassing root detection, SSL pinning, emulator detection, and anti-debugging during dynamic APK analysis

## Overview

FridaBypassKit is a Frida script integrating four major bypass capabilities. It works out of the box without requiring customization for specific apps.

## Four Major Bypass Capabilities

### 1. Root Detection Bypass

- Hooks `File.exists()` to hide the su binary
- Intercepts `Runtime.exec()` root check calls
- Hides root-related packages (Magisk, SuperSU, etc.) from PackageManager
- Modifies system properties to make the device appear unrooted

### 2. SSL Pinning Bypass

- Hooks `TrustManagerImpl.verifyChain()`
- Hooks `TrustManagerImpl.checkTrustedRecursive()`
- Bypasses certificate chain verification
- Returns empty certificate chains to avoid validation
- Compatible with OkHttp, Retrofit, and custom implementations

### 3. Emulator Detection Bypass

- Spoofs TelephonyManager return values
- Returns fake phone numbers and carrier names
- Modifies Build properties

### 4. Anti-Debugging Bypass

- Hooks `Debug.isDebuggerConnected()`
- Blocks debugger detection
- Bypasses anti-debugging checks

## Usage

```bash
# Prerequisites
pip install frida-tools
adb push frida-server /data/local/tmp/
adb shell chmod 755 /data/local/tmp/frida-server
adb shell su -c /data/local/tmp/frida-server &

# Inject into the target app
frida -U -f com.example.app -l FridaBypassKit.js
```

## Other Recommended Frida Bypass Scripts

| Project | Features | Link |
|---------|----------|------|
| httptoolkit/frida-interception-and-unpinning | Directly MitMs all HTTPS traffic | [GitHub](https://github.com/httptoolkit/frida-interception-and-unpinning) |
| 0xCD4/SSL-bypass | Universal, uncustomized SSL bypass | [GitHub](https://github.com/0xCD4/SSL-bypass) |
| incogbyte/ssl-bypass gist | Bypasses common SSL pinning methods | [Gist](https://gist.github.com/incogbyte/1e0e2f38b5602e72b1380f21ba04b15e) |
| Zero3141/Frida-OkHttp-Bypass | Specifically targets OkHttp CertificatePinner | [GitHub](https://github.com/Zero3141/Frida-OkHttp-Bypass) |

## Integration with This Package

Use in the `apk-reverse` workflow when encountering the following scenarios:

1. App detects root and refuses to run → Enable Root Detection Bypass
2. HTTPS requests cannot be inspected in plaintext during traffic capture → Enable SSL Pinning Bypass
3. App detects emulator and refuses to run → Enable Emulator Detection Bypass
4. App crashes after attaching Frida → Enable Debug Detection Bypass

Recommended workflow: Run the complete FridaBypassKit first, then make targeted adjustments.