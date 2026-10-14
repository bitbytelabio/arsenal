---
name: mobile-instrumentation-flutter-traffic-interception
description: Bypassing proxy ignorance and BoringSSL custom certificate pinning in Flutter and React Native compiled ARM64 binaries via Frida dynamic hooking.
domain: mobile
category: instrumentation
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/mobile-instrumentation-flutter-traffic-interception/SKILL.md
---
# Flutter & React Native Mobile Traffic Interception & Pinning Bypass

## When to Use
Execute this operational playbook when intercepting network communication of compiled Flutter or React Native mobile applications on Android or iOS. Flutter applications compile into standalone ARM/ARM64 shared libraries (`libflutter.so` and `libapp.so`) which bundle an internal copy of BoringSSL. Because Flutter bypasses the OS certificate store and ignores system proxy configurations, traditional proxy interception fails. This playbook aligns with OWASP MASTG-NETWORK-01 and MASTG-NETWORK-02.

---

## 1. Operational Decision Tree

```text
                  [Flutter / React Native Target Identified]
                                      │
                                      ▼
                      [Preflight Network Configuration]
          (Verify Burp Suite / mitmproxy listening on 127.0.0.1:8080)
                                      │
                     ┌────────────────┴────────────────┐
                     ▼                                 ▼
             [Challenge 1: Proxy Ignorance]    [Challenge 2: Custom Pinning]
             (Flutter ignores OS proxy)       (BoringSSL rejects Burp CA)
                     │                                 │
                     ▼                                 ▼
         [Stage 1: Transparent Proxy]      [Stage 2: Frida Binary Hook]
         - iptables REDIRECT to proxy      - Scan memory for libflutter.so
         - adb reverse tcp:8080 tcp:8080   - Pattern scan verify_cert_chain
         - WireGuard / OpenVPN redirect    - Patch return register x0 = 1
                     │                                 │
                     └────────────────┬────────────────┘
                                      │
                                      ▼
                         [Traffic Interception Test]
                                      │
         ┌────────────────────────────┴────────────────────────────┐
         ▼                                                         ▼
  [HTTP/HTTPS Visible in Proxy]                             [Handshake Error / SSL Drop]
  Cleartext Requests & Responses                            Pattern Mismatch / Anti-Frida
         │                                                         │
         ▼                                                         ▼
  [Tripartite Verification Oracle]                         [Stage 3: Offline Disassembly]
  - Positive proxy receipt in Burp                         - Load libflutter.so in Ghidra
  - Negative baseline control                              - Identify custom verify offset
  - Differential request invariance                        - Hardcode memory hook offset
         │                                                         │
         └────────────────────────────┬────────────────────────────┘
                                      ▼
                        [Evidence Ledger Registration]
         arsenal append-evidence --case $CASE_ID --tool burp ...
                                      │
                                      ▼
                        [Downstream API Kill-Chain]
         - REST / GraphQL Testing -> webapp-api-security
         - BOLA / IDOR Testing -> webapp-testing-api-for-broken-object-level-authorization
```

---

## 2. Multi-Stage Tooling Pipeline & Execution

### Stage 1: Overcoming Proxy Ignorance (Traffic Redirection)

Because Dart HTTP clients ignore the system proxy configured in Android Wi-Fi settings, route all outbound traffic through an intercepting proxy using `iptables` or a VPN profile:

```bash
# Option A: Forward device traffic to Burp using iptables on rooted test device
adb shell "su -c 'iptables -t nat -A OUTPUT -p tcp --dport 80 -j REDIRECT --to-ports 8080'"
adb shell "su -c 'iptables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-ports 8080'"

# Option B: Reverse port forward host proxy to Android device
adb reverse tcp:8080 tcp:8080

# Option C: Use ProxyDroid or local WireGuard VPN tunnel routing to host IP (e.g. 192.168.1.50:8080)
```

---

### Stage 2: BoringSSL Certificate Pinning Bypass via Frida

Deploy dynamic memory pattern scanning to hook BoringSSL verification functions inside `libflutter.so`:

```bash
# Spawn Flutter target application with Frida dynamic pinning bypass
frida -U -f com.target.flutterapp \
  -l scripts/flutter_ssl_bypass.js \
  --pause
```

#### Production Flutter BoringSSL Bypass Script (`scripts/flutter_ssl_bypass.js`)
```javascript
/**
 * Universal Flutter BoringSSL Certificate Verification Bypass for ARM64
 * Scans libflutter.so memory for ssl_crypto_x509_session_verify_cert_chain
 * and forces return value to 1 (VERIFY_OK).
 */

function hookFlutterBoringSSL() {
    var libflutter = Process.findModuleByName("libflutter.so");
    if (!libflutter) {
        console.log("[-] libflutter.so not loaded yet, retrying in 250ms...");
        setTimeout(hookFlutterBoringSSL, 250);
        return;
    }

    console.log("[+] Found libflutter.so at base: " + libflutter.base);

    // Standard ARM64 byte pattern for ssl_crypto_x509_session_verify_cert_chain
    // Commonly: 0xff 0x03 0x01 0xd1 ... (sub sp, sp, #... / stp x29, x30...)
    var patterns = [
        "ff 03 01 d1 f4 4f 02 a9 fd 7b 03 a9 fd 03 00 91",
        "ff 43 01 d1 f8 5f 01 a9 f6 57 02 a9 f4 4f 03 a9",
        "ff 83 01 d1 fa 67 01 a9 f8 5f 02 a9 f6 57 03 a9",
        "ff 03 01 d1 f8 5f 01 a9 f6 57 02 a9 f4 4f 03 a9 fd 7b 04 a9 fd 03 00 91"
    ];

    var hooked = false;

    for (var i = 0; i < patterns.length; i++) {
        var matches = Memory.scanSync(libflutter.base, libflutter.size, patterns[i]);
        if (matches.length > 0) {
            var targetAddr = matches[0].address;
            console.log("[+] Located verify_cert_chain signature at: " + targetAddr);

            Interceptor.attach(targetAddr, {
                onEnter: function(args) {
                    console.log("[*] Intercepted BoringSSL certificate verification call");
                },
                onLeave: function(retval) {
                    console.log("[+] Overriding verification result (original: " + retval + ") -> 1 (OK)");
                    retval.replace(ptr(1));
                }
            });

            hooked = true;
            break;
        }
    }

    if (!hooked) {
        console.log("[-] Automated pattern scan did not match. Falling back to export inspection...");
        var verifyExport = Module.findExportByName("libflutter.so", "ssl_crypto_x509_session_verify_cert_chain");
        if (verifyExport) {
            Interceptor.attach(verifyExport, {
                onLeave: function(retval) {
                    retval.replace(ptr(1));
                }
            });
            console.log("[+] Hooked exported verify function directly.");
        } else {
            console.log("[!] Manual disassembly required to find target offset.");
        }
    }
}

// Execute hook when library is initialized
setImmediate(hookFlutterBoringSSL);
```

---

### Stage 3: Offline Disassembly & Custom Offset Resolution (Ghidra / Radare2)

When automated byte pattern scanning fails on updated Flutter engine versions:

```bash
# 1. Extract libflutter.so from APK
unzip -q target.apk "lib/arm64-v8a/libflutter.so" -d tmp/

# 2. Search for BoringSSL verification error strings using radare2
rabin2 -z tmp/lib/arm64-v8a/libflutter.so | grep -iE "x509|verify_cert|chain"

# 3. Disassemble function cross-references in radare2
r2 -A tmp/lib/arm64-v8a/libflutter.so
# Find cross-references to "ssl_client" and inspect return values
```

Once the specific function offset is identified (e.g., `0x5b3a40`), hook by direct offset in Frida:
```javascript
var libflutter = Process.findModuleByName("libflutter.so");
var targetOffset = ptr("0x5b3a40");
Interceptor.attach(libflutter.base.add(targetOffset), {
    onLeave: function(retval) {
        retval.replace(ptr(1));
    }
});
```

---

## 3. Tripartite Verification Oracle

Interception success is confirmed **only** when three distinct verification controls are satisfied:

```text
+---------------------------------------------------------------------------------------+
|                              TRIPARTITE VERIFICATION ORACLE                            |
+---------------------------------------------------------------------------------------+
| 1. POSITIVE ASSERTION       | Burp Suite or mitmproxy HTTP History records incoming   |
|                             | API requests (e.g. POST /api/v1/auth/login) with valid  |
|                             | JSON request/response bodies and HTTP 200/400 status    |
|                             | (no TLS handshake drop or SSL alert 46).                |
+-----------------------------+---------------------------------------------------------+
| 2. NEGATIVE BASELINE        | Launch Flutter application WITHOUT Frida hook script:   |
|    CONTROL                  | App network requests fail immediately with TLS error:   |
|                             | "HandshakeException: Handshake error in client" or      |
|                             | "CERTIFICATE_VERIFY_FAILED", proving pinning was active.|
+-----------------------------+---------------------------------------------------------+
| 3. DIFFERENTIAL INVARIANCE  | Navigate through 3 distinct application screens:        |
|                             | Confirm all corresponding backend API endpoints stream  |
|                             | through the proxy consistently.                         |
+---------------------------------------------------------------------------------------+
```

---

## 4. False-Positive & Edge-Case Elimination

- **Network Inactivity vs Pinning**: Some Flutter apps delay network requests until a button click or user action. Never declare interception failure on application launch alone; interact with the UI to trigger API calls.
- **WebSocket & gRPC Channels**: Flutter applications frequently use WebSockets (`wss://`) or gRPC over HTTP/2. Configure Burp Suite to support HTTP/2 and inspect the WebSocket history tab if standard HTTP history appears empty.
- **Multiple Shared Libraries**: Some hybrid applications embed multiple runtimes (e.g., native Android WebView + Flutter subview). Ensure both the Android default TrustManager and Flutter's BoringSSL are hooked concurrently.

---

## 5. Evidence Capture & Ledger Registration

Persist interception receipts into Arsenal's cryptographic evidence pipeline:

```bash
# 1. Export captured API endpoints from Burp / mitmproxy
mitmdump -nr tmp/traffic.mitm --flow-filter "~m POST" --export-json tmp/intercepted_endpoints.json

# 2. Append evidence entry to cryptographic audit ledger
arsenal append-evidence \
  --case $CASE_ID \
  --tool mitmproxy \
  --file tmp/intercepted_endpoints.json \
  --desc "Confirmed Flutter BoringSSL certificate pinning bypass and API traffic interception"
```

---

## 6. Kill-Chain Chaining & Downstream Handoffs

- **Prerequisites**: Android/iOS test device connected with Frida server running. Target APK/IPA unpacked and verified within `scope.json`.
- **Downstream Handoffs**:
  - **API Attack Surface**: Feed discovered endpoints into `webapp-api-security` for parameter tampering.
  - **Authorization Testing**: Feed authorization tokens and object IDs into `webapp-testing-api-for-broken-object-level-authorization` (BOLA/IDOR).
  - **Authentication Flaws**: Test token replay and algorithm confusion using `webapp-auth-offensive-jwt`.
