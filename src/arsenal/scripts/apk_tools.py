"""Android APK operations and instrumentation tools.

Ports decode.sh, manifest-summary.sh, rebuild-sign-install.sh, and frida-run.sh
into centralized Python CLI commands. Preserves flags, stdout/stderr, and uses
standard library and maintained SDKs (androguard, ElementTree).
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes


def decode_apk(
    apk_path: str | Path,
    task_name: str = "",
    out_root: str | Path | None = None,
    skip_jadx: bool = False,
    skip_apktool: bool = False,
    clean: bool = False,
) -> dict[str, Any]:
    """Unpack APK with jadx and apktool."""
    apk = Path(apk_path).resolve()
    if not apk.is_file():
        raise FileNotFoundError(f"APK not found: {apk}")

    base_name = apk.stem
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in base_name)
    name = task_name or safe_name
    out_dir = Path(out_root).resolve() if out_root else apk.parent
    task_root = out_dir / name

    if clean and task_root.exists():
        shutil.rmtree(task_root)

    task_root.mkdir(parents=True, exist_ok=True)
    jadx_out = task_root / "jadx"
    apktool_out = task_root / "apktool"

    jadx_exit = 0
    if not skip_jadx:
        jadx_cmd = shutil.which("jadx")
        if jadx_cmd:
            proc = subprocess.run([jadx_cmd, "-d", str(jadx_out), str(apk)], capture_output=True, text=True)
            jadx_exit = proc.returncode

    apktool_exit = 0
    if not skip_apktool:
        apktool_cmd = shutil.which("apktool")
        if apktool_cmd:
            proc = subprocess.run(
                [apktool_cmd, "d", "-f", "-o", str(apktool_out), str(apk)], capture_output=True, text=True
            )
            apktool_exit = proc.returncode

    # Extract statistics
    java_count = len(list(jadx_out.rglob("*.java"))) if jadx_out.is_dir() else 0
    smali_dirs = len([d for d in apktool_out.iterdir() if d.is_dir() and d.name.startswith("smali")]) if apktool_out.is_dir() else 0
    so_count = len(list(apktool_out.rglob("*.so"))) if apktool_out.is_dir() else 0

    package_name = ""
    manifest_file = apktool_out / "AndroidManifest.xml"
    if manifest_file.is_file():
        try:
            tree = ET.parse(manifest_file)
            package_name = tree.getroot().attrib.get("package", "")
        except Exception:
            pass

    return {
        "task_root": str(task_root),
        "jadx_out": str(jadx_out) if not skip_jadx else None,
        "apktool_out": str(apktool_out) if not skip_apktool else None,
        "package": package_name,
        "jadx_exit": jadx_exit,
        "apktool_exit": apktool_exit,
        "java_files": java_count,
        "smali_dirs": smali_dirs,
        "so_files": so_count,
    }


def manifest_summary(target_path: str | Path) -> dict[str, Any]:
    """Summarize AndroidManifest.xml or APK components and permissions."""
    target = Path(target_path).resolve()
    if not target.is_file():
        raise FileNotFoundError(f"Target not found: {target}")

    package = ""
    permissions: list[str] = []
    activities: list[str] = []
    services: list[str] = []
    receivers: list[str] = []
    providers: list[str] = []

    # If it's an APK, use androguard
    if target.suffix.lower() == ".apk":
        try:
            from androguard.core.apk import APK
            apk = APK(str(target))
            package = apk.get_package()
            permissions = apk.get_permissions()
            activities = apk.get_activities()
            services = apk.get_services()
            receivers = apk.get_receivers()
            providers = apk.get_providers()
        except ImportError:
            raise RuntimeError("androguard is required to inspect binary APK manifest. Install androguard.")
    else:
        # It's an XML file
        try:
            tree = ET.parse(target)
            root = tree.getroot()
            package = root.attrib.get("package", "")
            android_ns = "{http://schemas.android.com/apk/res/android}"

            for elem in root.iter():
                tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                name = elem.attrib.get(f"{android_ns}name", elem.attrib.get("name", ""))
                if tag == "uses-permission" and name:
                    permissions.append(name)
                elif tag == "activity" and name:
                    activities.append(name)
                elif tag == "service" and name:
                    services.append(name)
                elif tag == "receiver" and name:
                    receivers.append(name)
                elif tag == "provider" and name:
                    providers.append(name)
        except Exception as exc:
            raise ValueError(f"Failed to parse AndroidManifest.xml: {exc}")

    return {
        "package": package,
        "permissions_count": len(permissions),
        "permissions": permissions,
        "activities_count": len(activities),
        "activities": activities,
        "services_count": len(services),
        "services": services,
        "receivers_count": len(receivers),
        "receivers": receivers,
        "providers_count": len(providers),
        "providers": providers,
    }


def rebuild_sign_install(
    project_dir: str | Path,
    out_dir: str | Path | None = None,
    name: str = "",
    keystore: str = "",
    key_alias: str = "androiddebugkey",
    store_pass: str = "android",
    key_pass: str = "android",
    device_serial: str = "",
    do_install: bool = False,
    reinstall: bool = False,
    clean: bool = False,
) -> dict[str, Any]:
    """Rebuild, zipalign, sign and optionally install an APK project."""
    proj = Path(project_dir).resolve()
    if not proj.is_dir():
        raise FileNotFoundError(f"Project directory not found: {proj}")

    output_dir = Path(out_dir).resolve() if out_dir else proj.parent
    output_dir.mkdir(parents=True, exist_ok=True)
    base = name or proj.name

    unsigned_apk = output_dir / f"{base}-unsigned.apk"
    aligned_apk = output_dir / f"{base}-aligned.apk"
    signed_apk = output_dir / f"{base}-signed.apk"

    if clean:
        for p in (unsigned_apk, aligned_apk, signed_apk):
            if p.exists():
                p.unlink()

    # Step 1: apktool b
    apktool = shutil.which("apktool")
    if not apktool:
        raise RuntimeError("apktool binary required on $PATH")
    subprocess.run([apktool, "b", str(proj), "-o", str(unsigned_apk)], check=True)

    # Step 2: zipalign
    zipalign = shutil.which("zipalign")
    target_to_sign = unsigned_apk
    if zipalign:
        subprocess.run([zipalign, "-f", "-p", "4", str(unsigned_apk), str(aligned_apk)], check=True)
        target_to_sign = aligned_apk

    # Step 3: apksigner
    apksigner = shutil.which("apksigner")
    keystore_path = Path(keystore or Path.home() / ".android" / "debug.keystore").resolve()
    if apksigner and keystore_path.is_file():
        cmd = [
            apksigner,
            "sign",
            "--ks",
            str(keystore_path),
            "--ks-key-alias",
            key_alias,
            "--ks-pass",
            f"pass:{store_pass}",
            "--key-pass",
            f"pass:{key_pass}",
            "--out",
            str(signed_apk),
            str(target_to_sign),
        ]
        subprocess.run(cmd, check=True)
    else:
        signed_apk = target_to_sign

    # Step 4: adb install
    installed = False
    if do_install:
        adb = shutil.which("adb")
        if adb:
            adb_cmd = [adb]
            if device_serial:
                adb_cmd.extend(["-s", device_serial])
            adb_cmd.append("install")
            if reinstall:
                adb_cmd.append("-r")
            adb_cmd.append(str(signed_apk))
            subprocess.run(adb_cmd, check=True)
            installed = True

    return {
        "project": str(proj),
        "signed_apk": str(signed_apk),
        "installed": installed,
    }


def frida_run(
    package: str = "",
    process_name: str = "",
    script_path: str | Path | None = None,
    usb: bool = False,
    spawn: bool = False,
    pause: bool = False,
    list_devices: bool = False,
    list_processes: bool = False,
    remote_host: str = "127.0.0.1:27042",
) -> dict[str, Any]:
    """Launch Frida dynamic instrumentation."""
    frida_cmd = shutil.which("frida")
    if not frida_cmd:
        raise RuntimeError("frida binary not found. Install frida-tools.")

    if list_devices:
        cmd = [shutil.which("frida-ls-devices") or "frida-ls-devices"]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        return {"action": "list_devices", "stdout": proc.stdout, "returncode": proc.returncode}

    if list_processes:
        cmd = [shutil.which("frida-ps") or "frida-ps"]
        if usb:
            cmd.append("-U")
        else:
            cmd.extend(["-H", remote_host])
        proc = subprocess.run(cmd, capture_output=True, text=True)
        return {"action": "list_processes", "stdout": proc.stdout, "returncode": proc.returncode}

    target = package or process_name
    if not target:
        raise ValueError("Must specify either --package or --process")
    if not script_path or not Path(script_path).is_file():
        raise FileNotFoundError(f"Frida script not found: {script_path}")

    args = [frida_cmd]
    if usb:
        args.append("-U")
    else:
        args.extend(["-H", remote_host])

    if spawn:
        args.extend(["-f", target])
    else:
        args.extend(["-n", target])

    args.extend(["-l", str(Path(script_path).resolve())])
    if not pause:
        args.append("--no-pause")

    # Run frida
    proc = subprocess.run(args)
    return {"action": "run", "target": target, "returncode": proc.returncode}


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal scripts re-apk-reverse/*'."""
    action = ctx.subcommand or ""
    # Strip prefix if invoked as re-apk-reverse/<action>
    if "/" in action:
        action = action.split("/", 1)[1]

    argv = list(ctx.positionals)
    if ctx.remainder:
        argv.extend(ctx.remainder)

    try:
        if action == "decode":
            parser = argparse.ArgumentParser(prog="arsenal scripts re-apk-reverse/decode")
            parser.add_argument("apk", help="Path to APK file")
            parser.add_argument("--name", default="", help="Task directory name")
            parser.add_argument("--out", default="", help="Output root directory")
            parser.add_argument("--skip-jadx", action="store_true", help="Skip jadx decompilation")
            parser.add_argument("--skip-apktool", action="store_true", help="Skip apktool unpacking")
            parser.add_argument("--clean", action="store_true", help="Clean existing output directory")
            args, _ = parser.parse_known_args(argv)

            res = decode_apk(
                apk_path=args.apk,
                task_name=args.name,
                out_root=args.out or None,
                skip_jadx=args.skip_jadx,
                skip_apktool=args.skip_apktool,
                clean=args.clean,
            )
            if not ctx.is_json:
                print(f"APK Unpack Complete: {res['task_root']}")
                print(f"  Package:     {res['package']}")
                print(f"  Java files:  {res['java_files']}")
                print(f"  Smali dirs:  {res['smali_dirs']}")
                print(f"  .so files:   {res['so_files']}")
            return ctx.result(res, code=ExitCodes.SUCCESS)

        elif action == "manifest-summary":
            if not argv:
                return ctx.fail("Usage: arsenal scripts re-apk-reverse/manifest-summary <path>", code=ExitCodes.CLI_USAGE_ERROR)
            target = argv[0]
            res = manifest_summary(target)
            if not ctx.is_json:
                print(f"Manifest Summary: {res['package']}")
                print(f"  Permissions ({res['permissions_count']}): {', '.join(res['permissions'][:5])}...")
                print(f"  Activities:  {res['activities_count']}")
                print(f"  Services:    {res['services_count']}")
            return ctx.result(res, code=ExitCodes.SUCCESS)

        elif action == "rebuild-sign-install":
            parser = argparse.ArgumentParser(prog="arsenal scripts re-apk-reverse/rebuild-sign-install")
            parser.add_argument("project_dir", help="Project directory")
            parser.add_argument("--out", default="", help="Output directory")
            parser.add_argument("--name", default="", help="Base name")
            parser.add_argument("--keystore", default="", help="Keystore path")
            parser.add_argument("--alias", default="androiddebugkey", help="Key alias")
            parser.add_argument("--store-pass", default="android", help="Keystore password")
            parser.add_argument("--key-pass", default="android", help="Key password")
            parser.add_argument("--device", default="", help="Device serial")
            parser.add_argument("--install", action="store_true", help="Install after signing")
            parser.add_argument("--reinstall", action="store_true", help="Reinstall existing")
            parser.add_argument("--clean", action="store_true", help="Clean old artifacts")
            args, _ = parser.parse_known_args(argv)

            res = rebuild_sign_install(
                project_dir=args.project_dir,
                out_dir=args.out or None,
                name=args.name,
                keystore=args.keystore,
                key_alias=args.alias,
                store_pass=args.store_pass,
                key_pass=args.key_pass,
                device_serial=args.device,
                do_install=args.install,
                reinstall=args.reinstall,
                clean=args.clean,
            )
            if not ctx.is_json:
                print(f"Rebuild and Sign Complete: {res['signed_apk']}")
                if res["installed"]:
                    print("  Installed to device successfully.")
            return ctx.result(res, code=ExitCodes.SUCCESS)

        elif action == "frida-run":
            parser = argparse.ArgumentParser(prog="arsenal scripts re-apk-reverse/frida-run")
            parser.add_argument("--package", default="", help="Target Android package")
            parser.add_argument("--process", default="", help="Target process name")
            parser.add_argument("--script", default="", help="Path to JavaScript hook script")
            parser.add_argument("--usb", "-U", action="store_true", help="Target USB device")
            parser.add_argument("--spawn", "-f", action="store_true", help="Spawn package instead of attach")
            parser.add_argument("--pause", action="store_true", help="Pause on spawn")
            parser.add_argument("--list-devices", action="store_true", help="List connected devices")
            parser.add_argument("--list-processes", action="store_true", help="List target processes")
            parser.add_argument("--remote", default="127.0.0.1:27042", help="Remote host:port")
            args, _ = parser.parse_known_args(argv)

            res = frida_run(
                package=args.package,
                process_name=args.process,
                script_path=args.script or None,
                usb=args.usb,
                spawn=args.spawn,
                pause=args.pause,
                list_devices=args.list_devices,
                list_processes=args.list_processes,
                remote_host=args.remote,
            )
            return ctx.result(res, code=ExitCodes.SUCCESS)

        else:
            return ctx.fail(f"Unknown re-apk-reverse command: '{action}'", code=ExitCodes.CLI_USAGE_ERROR)

    except Exception as exc:
        return ctx.fail(str(exc), code=ExitCodes.CLI_USAGE_ERROR)
