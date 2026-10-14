Java.perform(function() {
    console.log("[*] Initializing Universal Android Root Cloaking Engine...");

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

    var Runtime = Java.use("java.lang.Runtime");
    Runtime.exec.overload("[Ljava.lang.String;").implementation = function(cmdArray) {
        var cmd = cmdArray.join(" ");
        if (cmd.indexOf("su") !== -1 || cmd.indexOf("which") !== -1 || cmd.indexOf("busybox") !== -1) {
            console.log("[+] Blocked Runtime.exec() probe: " + cmd);
            throw Java.use("java.io.IOException").$new("Command failed");
        }
        return this.exec.call(this, cmdArray);
    };

    var Build = Java.use("android.os.Build");
    Build.TAGS.value = "release-keys";

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
