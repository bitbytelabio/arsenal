"""Arsenal plugin handler.

Implements plugin link and pack commands for local testing, symlinking into
OMP plugins directory, and building reproducible distribution tarballs.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import tarfile

from arsenal.common import Context, ExitCodes, VERSION
from arsenal.installation.resources import resolve_plugin_dir

FORBIDDEN_FILE_PATTERNS = (
    ".env",
    ".git",
    "node_modules",
    "__pycache__",
    ".DS_Store",
)

FORBIDDEN_EXTENSIONS = (
    ".pyc",
    ".pyo",
    ".key",
    ".pem",
    ".token",
)


def handle_plugin(ctx: Context) -> int:
    """Entry point for arsenal plugin command family."""
    sub = (ctx.subcommand or "").lower()
    if sub == "link":
        return handle_plugin_link(ctx)
    if sub == "pack":
        return handle_plugin_pack(ctx)
    return ctx.fail(f"Unrecognized plugin subcommand: '{sub}'", code=ExitCodes.CLI_USAGE_ERROR)


def handle_plugin_link(ctx: Context) -> int:
    """Symlink the Arsenal plugin directory into ~/.omp/plugins/node_modules/arsenal."""
    is_write = bool(ctx.values.get("write"))
    is_force = bool(ctx.values.get("force"))

    user_plugins_dir = Path.home() / ".omp" / "plugins" / "node_modules"
    link_target = user_plugins_dir / "arsenal"
    source_dir = resolve_plugin_dir(ctx.repo_root)

    if not source_dir or not source_dir.is_dir():
        msg = f"Source plugin directory '{source_dir}' does not exist. Run 'arsenal build --write' first."
        return ctx.result(data={}, code=ExitCodes.ENVIRONMENT_UNAVAILABLE, errors=[msg])

    if not is_write:
        if not ctx.is_json:
            print(f"[plugin link preview] Planned symlink: {link_target} -> {source_dir}")
        return ctx.result(
            data={"plannedLink": str(link_target), "source": str(source_dir)},
            code=ExitCodes.SUCCESS,
        )

    if link_target.exists() or link_target.is_symlink():
        if not is_force:
            msg = f"Destination '{link_target}' already exists. Specify --force to overwrite."
            return ctx.result(data={}, code=ExitCodes.MUTATION_REFUSED, errors=[msg])

        if link_target.is_symlink() or link_target.is_file():
            link_target.unlink()
        elif link_target.is_dir():
            shutil.rmtree(link_target)

    user_plugins_dir.mkdir(parents=True, exist_ok=True)
    link_target.symlink_to(source_dir, target_is_directory=True)

    if not ctx.is_json:
        print(f"[plugin link] Successfully linked: {link_target} -> {source_dir}")

    return ctx.result(
        data={"linked": True, "path": str(link_target), "target": str(source_dir)},
        code=ExitCodes.SUCCESS,
    )


def _is_safe_file_to_pack(file_path: Path, source_root: Path) -> bool:
    """Ensure sensitive secrets and symlink traversal escapes are excluded."""
    # Symlink traversal check
    if file_path.is_symlink():
        try:
            target = file_path.resolve(strict=True)
            target.relative_to(source_root.resolve())
        except (ValueError, OSError):
            return False

    name = file_path.name
    for pattern in FORBIDDEN_FILE_PATTERNS:
        if name == pattern or name.startswith(pattern + "."):
            return False

    suffix = file_path.suffix.lower()
    if suffix in FORBIDDEN_EXTENSIONS:
        return False

    return True


def handle_plugin_pack(ctx: Context) -> int:
    """Package the plugin into a reproducible distribution archive with marketplace metadata."""
    is_write = bool(ctx.values.get("write"))
    out_dir = (
        Path(str(ctx.values["out"])).resolve()
        if ctx.values.get("out")
        else (ctx.repo_root / "dist")
    )
    archive_name = f"arsenal-{VERSION}.tar.gz"
    archive_path = out_dir / archive_name

    if not is_write:
        if not ctx.is_json:
            print(f"[plugin pack preview] Planned archive: {archive_path}")
        return ctx.result(
            data={"archivePath": str(archive_path)},
            code=ExitCodes.SUCCESS,
        )

    source_dir = resolve_plugin_dir(ctx.repo_root)
    if not source_dir or not source_dir.is_dir():
        msg = f"Source plugin directory '{source_dir}' does not exist."
        return ctx.result(data={}, code=ExitCodes.ENVIRONMENT_UNAVAILABLE, errors=[msg])

    out_dir.mkdir(parents=True, exist_ok=True)

    # Collect and sort all files for deterministic archive generation
    all_files: list[tuple[Path, str]] = []
    prefix = source_dir.name  # "plugin"

    for root, dirs, files in os.walk(source_dir, followlinks=False):
        root_path = Path(root)
        # Filter directories in-place to avoid traversing into .git or node_modules
        dirs[:] = [
            d for d in dirs
            if d not in FORBIDDEN_FILE_PATTERNS
            and not (root_path / d).is_symlink()
        ]
        dirs.sort()

        for f in sorted(files):
            full_p = root_path / f
            if _is_safe_file_to_pack(full_p, source_dir):
                rel_p = full_p.relative_to(source_dir)
                arc_name = f"{prefix}/{rel_p.as_posix()}"
                all_files.append((full_p, arc_name))

    all_files.sort(key=lambda x: x[1])

    try:
        with tarfile.open(archive_path, "w:gz") as tar:
            for full_p, arc_name in all_files:
                ti = tar.gettarinfo(str(full_p), arcname=arc_name)
                ti.uid = 0
                ti.gid = 0
                ti.uname = ""
                ti.gname = ""
                ti.mtime = 0  # Reproducible epoch
                if ti.isreg():
                    with full_p.open("rb") as f_obj:
                        tar.addfile(ti, f_obj)
                else:
                    tar.addfile(ti)
    except Exception as e:
        msg = f"Tar packaging failed: {e}"
        return ctx.result(data={}, code=ExitCodes.ENVIRONMENT_UNAVAILABLE, errors=[msg])

    marketplace_catalog = {
        "name": "arsenal",
        "version": VERSION,
        "description": "Arsenal Security Engagement Harness Plugin",
        "archive": archive_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    marketplace_file = out_dir / "marketplace.json"
    marketplace_file.write_text(json.dumps(marketplace_catalog, indent=2), encoding="utf-8")

    if not ctx.is_json:
        print(f"[plugin pack] Packaged marketplace archive at: {archive_path}")

    return ctx.result(
        data={"archivePath": str(archive_path), "catalog": marketplace_catalog},
        code=ExitCodes.SUCCESS,
    )
