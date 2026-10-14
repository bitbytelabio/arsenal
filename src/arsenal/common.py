"""Common types, context, and exit codes for Arsenal CLI and runtime."""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

def _resolve_version() -> str:
    # 1. package.json is the Version Single Source of Truth (SSOT)
    try:
        candidate = Path(__file__).resolve().parent.parent.parent / "package.json"
        if candidate.is_file():
            data = json.loads(candidate.read_text(encoding="utf-8"))
            if "version" in data:
                return str(data["version"])
    except Exception:
        pass
    # 2. Package resources / metadata
    try:
        import importlib.resources as pkg_resources
        res_pkg = pkg_resources.files("arsenal").joinpath("resources/package.json")
        if res_pkg.is_file():
            data = json.loads(res_pkg.read_text(encoding="utf-8"))
            if "version" in data:
                return str(data["version"])
    except Exception:
        pass
    try:
        from importlib.metadata import version
        try:
            return version("arsenal")
        except Exception:
            return version("arsenal-security")
    except Exception:
        pass
    return "4.0.1"

VERSION = _resolve_version()


class ExitCodes:
    SUCCESS = 0
    CHECK_FAILURE = 1
    CLI_USAGE_ERROR = 2
    MUTATION_REFUSED = 3
    INTEGRITY_COMPROMISED = 4
    ENVIRONMENT_UNAVAILABLE = 5


def create_json_envelope(
    command: str,
    exit_code: int,
    mode: str,
    data: Any,
    warnings: list[str] | None = None,
    errors: list[str] | None = None,
    version: str = VERSION,
) -> dict[str, Any]:
    """Create a RFC-compliant JSON envelope matching the Arsenal TypeScript contract."""
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "version": version,
        "command": command,
        "status": "success" if exit_code == 0 else "failure",
        "exitCode": exit_code,
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "mode": mode,
        "data": data if data is not None else {},
        "warnings": warnings or [],
        "errors": errors or [],
    }


def emit_json(envelope: dict[str, Any]) -> None:
    """Emit formatted JSON envelope to standard output."""
    print(json.dumps(envelope, indent=2))


@dataclass
class Context:
    """Execution context passed to all Arsenal command handlers."""

    family: str
    subcommand: str | None
    positionals: list[str]
    values: dict[str, object]
    repo_root: Path
    profile_dir: Path
    mode: str  # "preview" | "write" | "check"
    is_json: bool
    raw_args: list[str] = field(default_factory=list)
    remainder: list[str] = field(default_factory=list)

    def result(
        self,
        data: object,
        code: int = ExitCodes.SUCCESS,
        *,
        warnings: list[str] | None = None,
        errors: list[str] | None = None,
        command: str | None = None,
    ) -> int:
        """Emit result as JSON envelope or standard text, returning exit code."""
        cmd_str = command if command is not None else (" ".join(self.raw_args) if self.raw_args else self.family)
        if self.is_json:
            envelope = create_json_envelope(
                command=cmd_str,
                exit_code=code,
                mode=self.mode,
                data=data,
                warnings=warnings,
                errors=errors,
            )
            emit_json(envelope)
        else:
            if errors:
                for err in errors:
                    print(f"Error: {err}", file=sys.stderr)
            if warnings:
                for warn in warnings:
                    print(f"Warning: {warn}", file=sys.stderr)
        return code

    def fail(self, message: str, code: int = ExitCodes.CLI_USAGE_ERROR) -> int:
        """Helper to fail execution with an error message and exit code."""
        return self.result(data={}, code=code, errors=[message])
