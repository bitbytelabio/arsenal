"""File Mutation Safety Layer for Arsenal installer.

Controls preview mode, --write gates, --force backup, and POSIX permissions.
Conforms to contracts/cli.md §1.2.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import time
from dataclasses import dataclass


@dataclass
class SafeWriteResult:
    written: bool
    action: str  # "created" | "updated" | "preview" | "refused" | "identical"
    target_path: str
    backup_path: str | None = None
    conflict: bool = False
    error: str | None = None


def safe_mkdir(dir_path: Path | str, mode: int = 0o700) -> None:
    """Create directory hierarchy safely with restricted permissions."""
    p = Path(dir_path).resolve()
    p.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(p, mode)
    except OSError:
        pass


def safe_write_file(
    target_path: Path | str,
    content: str | bytes,
    *,
    write: bool,
    force: bool = False,
    allow_update: bool = False,
    mode: int = 0o600,
) -> SafeWriteResult:
    """Safely write or update a file, honoring preview/check mode and creating backups on conflict."""
    resolved = Path(target_path).resolve()
    incoming_bytes = content.encode("utf-8") if isinstance(content, str) else content

    if resolved.exists():
        existing_bytes = resolved.read_bytes()
        if existing_bytes == incoming_bytes:
            return SafeWriteResult(
                written=False,
                action="identical",
                target_path=str(resolved),
                conflict=False,
            )

        # File exists with different content
        if not write:
            return SafeWriteResult(
                written=False,
                action="preview",
                target_path=str(resolved),
                conflict=not allow_update,
            )

        if not force and not allow_update:
            return SafeWriteResult(
                written=False,
                action="refused",
                target_path=str(resolved),
                conflict=True,
                error=f"Target file '{resolved}' exists with conflicting content. Specify --force to overwrite with backup.",
            )

        # Overwrite with backup
        timestamp = int(time.time() * 1000)
        backup_path = resolved.with_name(f"{resolved.name}.bak.{timestamp}")
        shutil.copy2(resolved, backup_path)

        resolved.write_bytes(incoming_bytes)
        try:
            os.chmod(resolved, mode)
        except OSError:
            pass

        return SafeWriteResult(
            written=True,
            action="updated",
            target_path=str(resolved),
            backup_path=str(backup_path),
            conflict=False,
        )

    # New file
    if not write:
        return SafeWriteResult(
            written=False,
            action="preview",
            target_path=str(resolved),
            conflict=False,
        )

    safe_mkdir(resolved.parent, mode=0o700)
    resolved.write_bytes(incoming_bytes)
    try:
        os.chmod(resolved, mode)
    except OSError:
        pass

    return SafeWriteResult(
        written=True,
        action="created",
        target_path=str(resolved),
        conflict=False,
    )
