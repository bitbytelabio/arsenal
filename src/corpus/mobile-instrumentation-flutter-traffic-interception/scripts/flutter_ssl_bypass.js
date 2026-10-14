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

setImmediate(hookFlutterBoringSSL);
