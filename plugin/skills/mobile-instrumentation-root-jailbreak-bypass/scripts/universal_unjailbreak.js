if (ObjC.available) {
    console.log("[*] Initializing iOS Objective-C Jailbreak Cloaking Engine...");

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
