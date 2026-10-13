"""Quarantine and License Validation.

Enforces legal and OpSec quarantine rules per Constitution & Contracts.
"""

from __future__ import annotations

from typing import Any, Final

FORBIDDEN_LICENSES: Final[frozenset[str]] = frozenset({
    "GPL-3.0",
    "GPLv3",
    "GPL-3.0-only",
    "GPL-3.0-or-later",
    "AGPL-3.0",
    "AGPLv3",
    "AGPL-3.0-only",
    "AGPL-3.0-or-later",
})


def evaluate_quarantine(
    file_path: str,
    license: str | None = None,
    content: str | None = None,
) -> dict[str, Any]:
    """Evaluate whether a file or component is admitted, quarantined, or excluded."""
    normalized_path = file_path.replace("\\", "/")

    # Check GPLv3 ctf-sandbox
    if "ctf-sandbox" in normalized_path.lower():
        return {
            "allowed": False,
            "status": "quarantined",
            "reason": "GPLv3 license incompatibility (CTF-Sandbox-Orchestrator dropped)",
        }

    # Check AGPL jshookmcp
    if "jshookmcp" in normalized_path.lower():
        return {
            "allowed": False,
            "status": "quarantined",
            "reason": "AGPL-3.0 copyleft quarantine (external stdio only, zero bytes vendored)",
        }

    # Check PowerShell scripts
    if normalized_path.endswith(".ps1"):
        return {
            "allowed": False,
            "status": "quarantined",
            "reason": "PowerShell scripts excluded per POSIX/Linux/macOS standard",
        }

    # Check license
    if license and license.strip() in FORBIDDEN_LICENSES:
        return {
            "allowed": False,
            "status": "quarantined",
            "reason": f"Prohibited copyleft license: {license}",
        }

    # Check raw payloads
    if (
        "/payloads/" in normalized_path
        or "/data/" in normalized_path
        or normalized_path.endswith(".exe")
        or normalized_path.endswith(".dll")
    ):
        return {
            "allowed": False,
            "status": "excluded",
            "reason": "Raw payload or binary artifact isolated from guidance bodies",
        }

    # Check content for embedded PowerShell execution
    if content and "#!powershell" in content:
        return {
            "allowed": False,
            "status": "quarantined",
            "reason": "Embedded PowerShell execution content excluded",
        }

    return {
        "allowed": True,
        "status": "admitted",
    }
