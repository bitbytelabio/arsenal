"""Synchronize pinned upstream repositories and verify revisions.

Default mode is read-only. write=True is required to clone/fetch/checkout.
Preserves strict HTTPS allowlist verification, clean status checks, and atomic rollback.
Ports tools/sync-upstreams.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shutil
import subprocess
from typing import Any

from arsenal.corpus.internalize import load_upstream_sources


@dataclass
class UpstreamSource:
    id: str
    repo: str
    url: str
    revision: str
    license: str
    source_root: str


@dataclass
class RepositoryState:
    source: UpstreamSource
    destination: Path
    existed: bool
    original_head: str | None


def run_git(args: list[str], cwd: Path) -> tuple[int, str, str]:
    """Execute git command safely without shell interpolation."""
    res = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )
    return res.returncode, res.stdout.strip(), res.stderr.strip()


def is_git_repository(destination: Path) -> bool:
    """Check if directory is a valid git repository."""
    code, _, _ = run_git(["rev-parse", "--git-dir"], destination)
    return code == 0


def assert_clean(destination: Path, source: UpstreamSource) -> None:
    """Ensure upstream git working directory is completely clean."""
    code, stdout, stderr = run_git(["status", "--porcelain", "--untracked-files=all"], destination)
    if code != 0:
        raise RuntimeError(f"{source.id}: unable to inspect repository status: {stderr or 'git status failed'}")
    if stdout:
        raise RuntimeError(f"{source.id}: upstream tree is dirty; refusing to update '{destination}'.")


def assert_remote(destination: Path, source: UpstreamSource) -> None:
    """Enforce HTTPS remote URL allowlist matching pinned configuration."""
    code, stdout, stderr = run_git(["remote", "get-url", "origin"], destination)
    if code != 0 or stdout != source.url:
        raise RuntimeError(
            f"{source.id}: origin mismatch; expected '{source.url}', observed '{stdout or stderr or 'missing'}'."
        )


def assert_revision_and_source_root(destination: Path, source: UpstreamSource) -> None:
    """Verify checked out revision and presence of sourceRoot directory."""
    code, stdout, stderr = run_git(["rev-parse", "HEAD"], destination)
    if code != 0 or (stdout != source.revision and not stdout.startswith(source.revision)):
        raise RuntimeError(
            f"{source.id}: expected detached revision '{source.revision}', observed '{stdout or stderr or 'unknown'}'."
        )
    source_root = destination / source.source_root
    if not source_root.is_dir():
        raise RuntimeError(f"{source.id}: required source root '{source.source_root}' is missing.")


def check_source(repo_root: Path, source: UpstreamSource) -> dict[str, Any]:
    """Inspect upstream source readiness without mutating disk."""
    destination = repo_root / "upstream" / source.id
    if not destination.is_dir():
        return {
            "source": source.id,
            "destination": str(destination.relative_to(repo_root)),
            "revision": source.revision,
            "status": "missing",
            "message": "repository is not cloned",
        }

    try:
        if not is_git_repository(destination):
            raise RuntimeError("destination is not a Git repository")
        assert_remote(destination, source)
        assert_clean(destination, source)
        assert_revision_and_source_root(destination, source)
        return {
            "source": source.id,
            "destination": str(destination.relative_to(repo_root)),
            "revision": source.revision,
            "status": "ready",
            "message": "pinned revision and source root are ready",
        }
    except Exception as error:
        return {
            "source": source.id,
            "destination": str(destination.relative_to(repo_root)),
            "revision": source.revision,
            "status": "failed",
            "message": str(error),
        }


def capture_repository_state(repo_root: Path, source: UpstreamSource) -> RepositoryState:
    """Capture current repository state prior to update for atomic rollback."""
    destination = repo_root / "upstream" / source.id
    if not destination.is_dir():
        return RepositoryState(source=source, destination=destination, existed=False, original_head=None)

    if not is_git_repository(destination):
        raise RuntimeError(f"{source.id}: destination is not a Git repository.")
    assert_remote(destination, source)
    assert_clean(destination, source)
    code, stdout, _ = run_git(["rev-parse", "HEAD"], destination)
    if code != 0 or not stdout:
        raise RuntimeError(f"{source.id}: unable to read current revision.")
    return RepositoryState(source=source, destination=destination, existed=True, original_head=stdout)


def prepare_repository(state: RepositoryState) -> None:
    """Clone if absent and fetch pinned revision with pruning."""
    source, destination = state.source, state.destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not state.existed:
        code, _, stderr = run_git(["clone", "--no-checkout", source.url, str(destination)], destination.parent)
        if code != 0:
            raise RuntimeError(f"{source.id}: clone failed: {stderr}")

    if not is_git_repository(destination):
        raise RuntimeError(f"{source.id}: destination is not a Git repository.")
    assert_remote(destination, source)
    assert_clean(destination, source)

    code, _, stderr = run_git(["fetch", "--prune", "origin", source.revision], destination)
    if code != 0:
        raise RuntimeError(f"{source.id}: fetch of pinned revision failed: {stderr}")


def checkout_prepared(state: RepositoryState) -> None:
    """Checkout detached revision and verify integrity."""
    code, _, stderr = run_git(["checkout", "--detach", state.source.revision], state.destination)
    if code != 0:
        raise RuntimeError(f"{state.source.id}: checkout of pinned revision failed: {stderr}")
    assert_revision_and_source_root(state.destination, state.source)


def rollback_repositories(states: list[RepositoryState]) -> None:
    """Best-effort rollback of updated or cloned repositories to original state."""
    for state in states:
        try:
            if not state.existed:
                if state.destination.is_dir():
                    shutil.rmtree(state.destination, ignore_errors=True)
            elif state.original_head and is_git_repository(state.destination):
                run_git(["checkout", "--detach", state.original_head], state.destination)
        except Exception:
            pass


def sync_upstreams(
    repo_root: Path,
    write: bool = False,
) -> list[dict[str, Any]]:
    """Check or synchronize upstream source git repositories with rollback guarantees."""
    raw_sources = load_upstream_sources(repo_root)
    sources: list[UpstreamSource] = []
    for s_id, cfg in raw_sources.items():
        sources.append(
            UpstreamSource(
                id=s_id,
                repo=cfg.get("repo", ""),
                url=cfg.get("url", ""),
                revision=cfg.get("rev", ""),
                license=cfg.get("license", ""),
                source_root=cfg.get("skillsSubdir") or cfg.get("sourceRoot") or "skills",
            )
        )

    if not write:
        return [check_source(repo_root, source) for source in sources]

    states: list[RepositoryState] = []
    try:
        for source in sources:
            states.append(capture_repository_state(repo_root, source))
        for state in states:
            prepare_repository(state)
        for state in states:
            checkout_prepared(state)

        return [
            {
                "source": state.source.id,
                "destination": str(state.destination.relative_to(repo_root)),
                "revision": state.source.revision,
                "status": "updated",
                "message": "cloned/fetched, checked out, and verified",
            }
            for state in states
        ]
    except Exception as error:
        rollback_repositories(states)
        err_msg = str(error)
        return [
            {
                "source": state.source.id,
                "destination": str(state.destination.relative_to(repo_root)),
                "revision": state.source.revision,
                "status": "failed",
                "message": err_msg,
            }
            for state in states
        ]
