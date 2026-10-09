# APK Security Testing Cheatsheet

> Organized based on OWASP MASTG (Mobile Application Security Testing Guide).
> Covers six major dimensions: static analysis, dynamic analysis, network communication, data storage, authentication & authorization, and code protection.

---

## Static Analysis Checklist

### Manifest Audit

```text
□ android:debuggable="true" → Debuggable (must not appear in production)
□ android:allowBackup="true" → Application data can be backed up and extracted
□ Components with android:exported="true" → Exposed Activity/Service/Receiver/Provider
□ Custom permission protectionLevel → Whether it is set to normal (should be signature)
□ scheme in intent-filter → Whether custom deep links can be hijacked
□ android:usesCleartextTraffic="true" → Allows cleartext HTTP
□ Low minSdkVersion → May lack modern security features
```

### Key Code Audit Points

```text
□ Hardcoded keys/tokens (search for "key", "secret", "password", "api_key")
□ Insecure random number generators (java.util.Random instead of SecureRandom)
□ Insecure cryptography (ECB mode, DES, MD5 used for passwords)
□ WebView configuration (setJavaScriptEnabled + addJavascriptInterface = RCE risk)
□ SQL injection (rawQuery concatenated with user input)
□ Path traversal (ContentProvider openFile does not validate path)
□ Log leakage (Log.d/Log.i printing sensitive information)
□ Clipboard leakage (ClipboardManager storing sensitive data)
□ Implicit Intent leakage (sendBroadcast without specifying package name)
```

### Third-Party Library Audit

```text
□ Outdated OkHttp/Retrofit versions (known vulnerabilities)
□ Outdated WebView engines
□ SDKs containing known vulnerabilities (check CVEs)
□ Data collection scope of advertising SDKs
□ Push notification SDK configuration (whether tokens are leaked)
```

---

## Dynamic Analysis Checklist

### Frida Hook Priority Targets

| Target | Hook Point | Purpose |
|------|---------|------|
| Login Authentication | `LoginActivity.login()` | Inspect credential handling |
| Signature Generation | `*Sign*`, `*sign*`, `*encrypt*` | Reverse-engineer signature algorithm |
| SSL Pinning | `CertificatePinner.check` | Bypass traffic inspection restrictions |
| Root Detection | `*root*`, `*su*`, `*magisk*` | Bypass detection |
| Cryptographic Operations | `javax.crypto.Cipher` | Extract keys/IVs |
| Token Storage | `SharedPreferences.getString` | Observe token read/write operations |
| Network Requests | `OkHttpClient.newCall` | Inspect request construction |

### Common Frida One-Liners

```bash
# Trace all cryptographic operations
frida-trace -U -f com.target.app -j '*Cipher*!*'

# Trace all HTTP requests
frida-trace -U -f com.target.app -j '*OkHttp*!*'

# Trace SharedPreferences read and write operations
frida-trace -U -f com.target.app -j '*SharedPreferences*!*'

# Trace all native function calls
frida-trace -U -f com.target.app -i 'Java_*'
```

### Objection Quick Commands

```bash
# Connect
objection -g com.target.app explore

# Common commands
android hooking list activities
android hooking list services
android sslpinning disable
android root disable
android clipboard monitor
env                              # View application directories
sqlite connect <db_path>         # Connect to database
```

---

## Network Communication Security

### Traffic Capture Configuration

```text
Method 1: System Proxy + Burp/mitmproxy
- Set Wi-Fi proxy → Burp listener address
- Install CA certificate onto the device
- Android 7+ requires network_security_config or Frida bypass

Method 2: VPN Mode (Recommended)
- Use HttpCanary / Packet Capture
- No root required, no proxy configuration required
- However, cannot decrypt traffic enforced by SSL Pinning

Method 3: Frida + r2frida
- Directly intercept network calls within the process
- Not restricted by proxy or VPN settings
```

### Inspection Items

```text
□ Whether HTTPS is enforced (for all API calls)
□ Whether SSL Pinning is implemented (certificate pinning)
□ Whether certificate validation is proper (does not accept self-signed certificates)
□ Whether Certificate Transparency (CT) checks are performed
□ Whether API keys are transmitted in cleartext within requests
□ Whether tokens implement an expiration mechanism
□ Whether request signatures exist to prevent tampering
□ Whether replay attack protections exist (nonce/timestamp)
□ Whether WebSocket traffic is encrypted
□ Whether sensitive data is included in URL parameters (will be recorded in logs)
```

---

## Data Storage Security

### Inspection Locations

| Location | Risk | Inspection Command |
|------|------|---------|
| SharedPreferences | Cleartext storage of tokens/passwords | `adb shell cat /data/data/pkg/shared_prefs/*.xml` |
| SQLite Database | Unencrypted sensitive data | `adb pull /data/data/pkg/databases/` |
| External Storage | Readable by any application | `adb shell ls /sdcard/Android/data/pkg/` |
| Application Logs | Leaking debug information | `adb logcat \| grep pkg` |
| Backup Files | allowBackup=true | `adb backup -f backup.ab pkg` |
| Keyboard Cache | Input history | Check whether `inputType` is set to `textPassword` |
| Screenshot Protection | Sensitive screens can be screenshotted | Check for `FLAG_SECURE` |

### Comparison of Encrypted Storage Solutions

| Solution | Security | Description |
|------|--------|------|
| SharedPreferences (Cleartext) | ❌ | Directly readable after root |
| EncryptedSharedPreferences | ✓ | AndroidX Security library |
| SQLCipher | ✓ | Encrypted SQLite |
| Android Keystore | ✓✓ | Hardware-backed key protection |
| Custom AES Encryption | ⚠️ | Dependent on key management |

---

## Authentication and Authorization

### Common Vulnerabilities

| Vulnerability | Testing Method |
|------|---------|
| Weak Password Policy | Attempt 123456, password, etc. |
| Lack of Lockout Mechanism | Brute-force the login interface |
| Non-expiring Token | Replay old token after logout |
| Broken Object Level Authorization (IDOR) | Modify user_id in the request |
| SMS Verification Code Brute-force | 4/6-digit numeric code with no rate limiting |
| OAuth Misconfiguration | redirect_uri can be tampered with |
| Biometric Authentication Bypass | Hook BiometricPrompt |
| Device Binding Bypass | Modify device_id |

### Testing Payloads

```bash
# IDOR testing
curl -H "Authorization: Bearer USER_A_TOKEN" \
     "https://api.target.com/users/USER_B_ID/profile"

# Token replay
# 1. Log in normally to obtain token
# 2. Log out
# 3. Request with old token → should return 401

# SMS verification code brute-force
for code in $(seq 0000 9999); do
    curl -X POST "https://api.target.com/verify" \
         -d "phone=13800138000&code=$code"
done
```

---

## Code Protection Assessment

| Protection Mechanism | Detection Method | Bypass Difficulty |
|---------|---------|---------|
| ProGuard Obfuscation | Inspect whether class names are a/b/c using jadx | Low (renaming only) |
| String Encryption | Search for decryption functions; hook to retrieve cleartext | Medium |
| Anti-Debugging | Attempt to attach debugger | Medium (bypassable via Frida) |
| Root Detection | Run on a rooted device | Medium (bypassable via generic scripts) |
| Emulator Detection | Run inside an emulator | Low-Medium |
| Integrity Check | Modify APK and install | Medium (patch verification function) |
| Hardening / Packers | Inspect entry class and .so files | Medium-High (requires unpacking) |
| Native Protection | Core logic located inside .so files | High (requires IDA analysis) |
| VMP Virtualization | Code executed via virtualization | Extremely High |

---

## Quick Testing Workflow (30 Minutes)

```text
1. [5min] Unpack + Manifest Audit
   apktool d app.apk
   Inspect debuggable / allowBackup / exported / cleartext

2. [10min] Fast Code Audit
   jadx -d out app.apk
   Search for: password, key, secret, token, http://

3. [5min] Network Testing
   Configure proxy → Interact with APP → Check for cleartext or weak encryption

4. [5min] Storage Inspection
   adb shell → Inspect shared_prefs and databases

5. [5min] Dynamic Verification
   Frida hook critical functions → Confirm findings
```