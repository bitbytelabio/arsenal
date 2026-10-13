"""Android APK binary/text manifest inspection and verification oracle analysis engine.

Uses androguard and lxml for safe, specification-compliant manifest parsing.
Preserves ApkInspectResult shape and real Android component export semantics.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path
from typing import Any

from lxml import etree

from arsenal.common import Context, ExitCodes
from arsenal.oracles import verify_oracle

ANDROID_NS = "http://schemas.android.com/apk/res/android"
AXML_MAGIC = b"\x03\x00\x08\x00"


def _get_safe_parser() -> etree.XMLParser:
    """Create a hardened XML parser rejecting external entities and network."""
    return etree.XMLParser(
        resolve_entities=False,
        no_network=True,
        recover=True,
        remove_comments=True,
    )


def _parse_int_attr(value: str | None) -> int | None:
    """Safely parse integer attribute, supporting decimal and hex literals."""
    if value is None:
        return None
    try:
        val_str = value.strip()
        if val_str.startswith(("0x", "0X")):
            return int(val_str, 16)
        return int(val_str)
    except (ValueError, TypeError):
        return None


def inspect_apk(
    apk_path: Path | str | dict[str, Any],
    *,
    extract_components: bool = True,
    extract_permissions: bool = True,
) -> dict[str, Any]:
    """Inspect an Android APK archive and extract package, component, and security metadata.

    Supports both compiled binary AXML and plain text XML manifests.
    """
    if isinstance(apk_path, dict):
        extract_components = bool(
            apk_path.get("extract_components", apk_path.get("extractComponents", extract_components))
        )
        extract_permissions = bool(
            apk_path.get("extract_permissions", apk_path.get("extractPermissions", extract_permissions))
        )
        raw_path = apk_path.get("apk_path") or apk_path.get("apkPath")
        if not raw_path:
            raise ValueError("Missing 'apk_path' in inspect_apk input dictionary")
        resolved_path = Path(raw_path).expanduser().resolve()
    else:
        resolved_path = Path(apk_path).expanduser().resolve()

    if not resolved_path.is_file():
        raise FileNotFoundError(f"APK file not found: {resolved_path}")
    try:
        with zipfile.ZipFile(resolved_path, "r") as zf:
            if "AndroidManifest.xml" not in zf.namelist():
                raise ValueError(f"AndroidManifest.xml not found in APK: {resolved_path}")
            manifest_bytes = zf.read("AndroidManifest.xml")
    except zipfile.BadZipFile as e:
        raise ValueError(f"Invalid APK/ZIP archive '{resolved_path}': {e}") from e

    parser = _get_safe_parser()
    root: etree._Element | None = None

    # 1. Attempt binary AXML decoding via androguard when AXML magic is present
    if manifest_bytes.startswith(AXML_MAGIC):
        try:
            try:
                from androguard.core.axml import AXMLPrinter
            except ImportError:
                try:
                    from androguard.core.bytecodes.axml import AXMLPrinter
                except ImportError:
                    from androguard.axml import AXMLPrinter
            printer = AXMLPrinter(manifest_bytes)
            xml_data = printer.get_xml()
            if isinstance(xml_data, str):
                xml_bytes = xml_data.encode("utf-8")
            else:
                xml_bytes = bytes(xml_data)

            root = etree.fromstring(xml_bytes, parser=parser)
        except Exception:
            root = None

    # 2. Fall back to direct XML parsing (supports plain text manifests and standard XML)
    if root is None:
        try:
            root = etree.fromstring(manifest_bytes, parser=parser)
        except Exception as e:
            raise ValueError(f"Failed to parse AndroidManifest.xml from {resolved_path}: {e}") from e

    if root is None:
        raise ValueError(f"Unable to parse manifest XML tree from {resolved_path}")

    # Extract package name and versioning
    package_name = root.attrib.get("package") or "unknown.package"
    version_code = _parse_int_attr(root.attrib.get(f"{{{ANDROID_NS}}}versionCode"))
    version_name = root.attrib.get(f"{{{ANDROID_NS}}}versionName")

    # Extract SDK versions
    min_sdk_version: int | None = None
    target_sdk_version: int | None = None
    uses_sdk = root.find("uses-sdk")
    if uses_sdk is not None:
        min_sdk_version = _parse_int_attr(uses_sdk.attrib.get(f"{{{ANDROID_NS}}}minSdkVersion"))
        target_sdk_version = _parse_int_attr(uses_sdk.attrib.get(f"{{{ANDROID_NS}}}targetSdkVersion"))

    # Extract permissions
    permissions: list[str] = []
    if extract_permissions:
        for perm in root.findall("uses-permission"):
            p_name = perm.attrib.get(f"{{{ANDROID_NS}}}name")
            if p_name and p_name not in permissions:
                permissions.append(p_name)

    # Extract application element and dangerous security flags
    app = root.find("application")
    debuggable = False
    allow_backup = False
    dangerous_flags: list[str] = []

    if app is not None:
        dbg_attr = app.attrib.get(f"{{{ANDROID_NS}}}debuggable")
        if dbg_attr is not None and dbg_attr.lower() == "true":
            debuggable = True
            dangerous_flags.append("debuggable")

        backup_attr = app.attrib.get(f"{{{ANDROID_NS}}}allowBackup")
        if backup_attr is not None and backup_attr.lower() == "true":
            allow_backup = True
            dangerous_flags.append("allowBackup")

        cleartext_attr = app.attrib.get(f"{{{ANDROID_NS}}}usesCleartextTraffic")
        if cleartext_attr is not None and cleartext_attr.lower() == "true":
            dangerous_flags.append("usesCleartextTraffic")

        test_only_attr = app.attrib.get(f"{{{ANDROID_NS}}}testOnly")
        if test_only_attr is not None and test_only_attr.lower() == "true":
            dangerous_flags.append("testOnly")

    # Extract exported components
    exported_components: list[dict[str, Any]] = []
    if extract_components and app is not None:
        component_tags = [
            ("activity", "activity"),
            ("service", "service"),
            ("receiver", "receiver"),
            ("provider", "provider"),
        ]

        for tag_name, comp_type in component_tags:
            for comp in app.findall(tag_name):
                raw_name = comp.attrib.get(f"{{{ANDROID_NS}}}name")
                if not raw_name:
                    continue

                # Normalize component name
                if raw_name.startswith("."):
                    comp_name = f"{package_name}{raw_name}"
                elif "." not in raw_name:
                    comp_name = f"{package_name}.{raw_name}"
                else:
                    comp_name = raw_name

                # Real Android export resolution
                exp_attr = comp.attrib.get(f"{{{ANDROID_NS}}}exported")
                if exp_attr is not None:
                    is_exported = exp_attr.lower() == "true"
                else:
                    # Default: exported if component contains at least one intent-filter
                    has_intent_filter = len(comp.findall("intent-filter")) > 0
                    is_exported = has_intent_filter

                if is_exported:
                    permission = comp.attrib.get(f"{{{ANDROID_NS}}}permission")
                    exported_components.append({
                        "type": comp_type,
                        "name": comp_name,
                        "permission": permission,
                    })

    result: dict[str, Any] = {
        "packageName": package_name,
        "debuggable": debuggable,
        "allowBackup": allow_backup,
        "permissions": permissions,
        "exportedComponents": exported_components,
        "dangerousFlags": dangerous_flags,
    }

    if version_code is not None:
        result["versionCode"] = version_code
    if version_name is not None:
        result["versionName"] = version_name
    if min_sdk_version is not None:
        result["minSdkVersion"] = min_sdk_version
    if target_sdk_version is not None:
        result["targetSdkVersion"] = target_sdk_version

    return result


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal apk' and 'arsenal oracle' command families."""
    family = ctx.family.lower()

    if family == "apk":
        subcommand = (ctx.subcommand or "inspect").lower()
        if subcommand in ("help", "-h", "--help"):
            if not ctx.is_json:
                print("Usage: arsenal apk inspect <path-to-apk> [--json]")
            return ctx.result({"commands": ["inspect"]}, code=ExitCodes.SUCCESS)

        apk_path_raw = (
            ctx.positionals[0]
            if ctx.positionals
            else ctx.values.get("apk") or ctx.values.get("apk-path") or ctx.values.get("apk_path")
        )

        if not apk_path_raw:
            return ctx.fail("Path to APK file is required: arsenal apk inspect <path>", code=ExitCodes.CLI_USAGE_ERROR)

        try:
            res = inspect_apk(str(apk_path_raw))
        except FileNotFoundError as e:
            return ctx.fail(str(e), code=ExitCodes.CHECK_FAILURE)
        except Exception as e:
            return ctx.fail(f"APK inspection failed: {e}", code=ExitCodes.CHECK_FAILURE)

        if not ctx.is_json:
            print(f"[apk inspect] Package: {res.get('packageName')} (v{res.get('versionCode', '?')})")
            perms = ", ".join(res.get("permissions", [])) or "none"
            print(f"Permissions: {perms}")
            print(f"Exported Components: {len(res.get('exportedComponents', []))}")
            for c in res.get("exportedComponents", []):
                perm_info = f" (requires {c['permission']})" if c.get("permission") else ""
                print(f"  - [{c.get('type')}] {c.get('name')}{perm_info}")
            if res.get("dangerousFlags"):
                print(f"Dangerous Flags: {', '.join(res.get('dangerousFlags', []))}")

        return ctx.result(res, code=ExitCodes.SUCCESS)

    if family == "oracle":
        subcommand = (ctx.subcommand or "verify").lower()
        if subcommand in ("help", "-h", "--help"):
            if not ctx.is_json:
                print("Usage: arsenal oracle verify --type <timing_differential|authz_matrix|path_traversal> [--json]")
            return ctx.result({"commands": ["verify"]}, code=ExitCodes.SUCCESS)

        request_file = ctx.values.get("file")
        request_data: dict[str, Any] = {}
        if request_file:
            try:
                request_data = json.loads(Path(str(request_file)).read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                return ctx.fail(f"Oracle request file could not be read: {exc}", code=ExitCodes.CLI_USAGE_ERROR)

        oracle_type = str(
            ctx.values.get("oracle_type")
            or ctx.values.get("oracle-type")
            or ctx.values.get("type")
            or request_data.get("oracle_type", "")
            or (ctx.positionals[0] if ctx.positionals else "")
        )

        params_raw = (
            ctx.values.get("params")
            or ctx.values.get("parameters")
            or request_data.get("parameters")
        )

        parameters: dict[str, Any] = {}
        if isinstance(params_raw, str):
            try:
                parameters = json.loads(params_raw)
            except json.JSONDecodeError as exc:
                return ctx.fail(f"Oracle parameters are invalid JSON: {exc}", code=ExitCodes.CLI_USAGE_ERROR)
        elif isinstance(params_raw, dict):
            parameters = params_raw

        # If parameters not provided in flag, attempt to read JSON from stdin if non-interactive

        if not oracle_type:
            return ctx.fail("Missing required --type / --oracle-type parameter", code=ExitCodes.CLI_USAGE_ERROR)

        res = verify_oracle({"oracle_type": oracle_type, "parameters": parameters})
        outcome = res.get("outcome", "error")

        if outcome == "validated":
            exit_code = ExitCodes.SUCCESS
        elif outcome in ("partial", "rejected", "unvalidated"):
            exit_code = ExitCodes.CHECK_FAILURE
        else:
            exit_code = ExitCodes.CLI_USAGE_ERROR

        if not ctx.is_json:
            print(f"[oracle verify] Outcome: {outcome.upper()}")
            print(f"Rationale: {res.get('rationale')}")

        return ctx.result(res, code=exit_code)

    return ctx.fail(f"Unrecognized analysis command family: '{family}'", code=ExitCodes.CLI_USAGE_ERROR)

__all__ = ["inspect_apk", "verify_oracle", "handle"]
