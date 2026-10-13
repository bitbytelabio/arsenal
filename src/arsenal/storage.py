"""Cryptographic ledger, SQLite WAL journal, hash-chain verification,
and output bounding engine.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

GENESIS_PREV_HASH = "0" * 64


# --- Hash Utilities ---

def sha256_bytes(data: bytes) -> str:
    """Compute SHA-256 hexadecimal digest of raw bytes."""
    return hashlib.sha256(data).hexdigest().lower()


def sha256_string(text: str) -> str:
    """Compute SHA-256 hexadecimal digest of a UTF-8 string."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest().lower()


def sha256_file(path: Path | str) -> str:
    """Compute SHA-256 hexadecimal digest of a file on disk."""
    p = Path(path)
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest().lower()


def verify_hash_chain(lines: list[str]) -> tuple[bool, int, int | None, str | None]:
    """Verify hash chain integrity across newline-delimited ledger records.

    Returns (valid, total_records, failed_index, error_message).
    """
    non_empty = [ln for ln in lines if ln.strip()]
    if not non_empty:
        return True, 0, None, None

    expected_prev = GENESIS_PREV_HASH
    for i, raw_line in enumerate(non_empty):
        try:
            parsed = json.loads(raw_line)
        except Exception:
            return False, len(non_empty), i, f"Record at line {i + 1} is not valid JSON."

        if not isinstance(parsed, dict) or "prev_hash" not in parsed:
            return False, len(non_empty), i, f"Record at line {i + 1} is missing prev_hash."

        prev_hash = str(parsed["prev_hash"]).lower()
        if prev_hash != expected_prev.lower():
            return (
                False,
                len(non_empty),
                i,
                f"Hash chain broken at line {i + 1}: expected prev_hash '{expected_prev}', observed '{prev_hash}'.",
            )

        line_with_lf = raw_line if raw_line.endswith("\n") else f"{raw_line}\n"
        expected_prev = sha256_string(line_with_lf)

    return True, len(non_empty), None, None


def verify_artifact_integrity(file_path: Path | str, expected_hash: str) -> bool:
    """Verify whether a referenced artifact file exists and matches its expected SHA-256."""
    p = Path(file_path)
    if not p.is_file():
        return False
    return sha256_file(p) == expected_hash.lower()


# --- Output Bounding Engine ---

class BOUNDING_LIMITS:
    MAX_LOGICAL_LINES = 500
    MAX_RAW_BYTES = 51200  # 50 KiB
    MAX_DELIVERED_BYTES = 4096  # 4 KiB
    HEAD_LINES = 20
    TAIL_LINES = 20


def truncate_head_to_byte_budget(s: str, max_bytes: int) -> str:
    """Truncate characters from start of string to fit within max_bytes without partial codepoints."""
    if max_bytes <= 0:
        return ""
    cur_bytes = 0
    res_chars: list[str] = []
    for ch in s:
        ch_bytes = len(ch.encode("utf-8"))
        if cur_bytes + ch_bytes > max_bytes:
            break
        res_chars.append(ch)
        cur_bytes += ch_bytes
    return "".join(res_chars)


def truncate_tail_to_byte_budget(s: str, max_bytes: int) -> str:
    """Truncate characters from end of string backwards to fit within max_bytes without partial codepoints."""
    if max_bytes <= 0:
        return ""
    cur_bytes = 0
    picked: list[str] = []
    for ch in reversed(s):
        ch_bytes = len(ch.encode("utf-8"))
        if cur_bytes + ch_bytes > max_bytes:
            break
        picked.append(ch)
        cur_bytes += ch_bytes
    picked.reverse()
    return "".join(picked)


def bound_and_store(
    raw_input: str | bytes,
    evidence_dir: Path | str,
    ext: str = "txt",
) -> dict[str, Any]:
    """Decouple raw byte persistence from LLM conversational context delivery."""
    ev_dir = Path(evidence_dir)
    raw_bytes = raw_input.encode("utf-8") if isinstance(raw_input, str) else raw_input
    raw_text = raw_input if isinstance(raw_input, str) else raw_bytes.decode("utf-8", errors="replace")
    lines = raw_text.split("\n")

    byte_len = len(raw_bytes)
    line_count = len(lines)
    if line_count <= BOUNDING_LIMITS.MAX_LOGICAL_LINES and byte_len <= BOUNDING_LIMITS.MAX_RAW_BYTES:
        return {
            "bounded": False,
            "content": raw_text,
            "artifactPath": None,
            "artifactHash": None,
            "originalBytes": byte_len,
            "originalLines": line_count,
        }

    # Bounding triggered: persist raw artifact
    h = sha256_bytes(raw_bytes)
    raw_dir = ev_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

    artifact_rel = f"evidence/raw/{h}.{ext}"
    artifact_full = raw_dir / f"{h}.{ext}"

    with open(artifact_full, "wb") as f:
        f.write(raw_bytes)
        f.flush()
        os.fsync(f.fileno())
    try:
        os.chmod(artifact_full, 0o600)
    except OSError:
        pass

    head_lines = lines[: BOUNDING_LIMITS.HEAD_LINES]
    tail_lines = lines[-BOUNDING_LIMITS.TAIL_LINES :]
    spilled = max(0, line_count - BOUNDING_LIMITS.HEAD_LINES - BOUNDING_LIMITS.TAIL_LINES)
    marker = f"\n[OUTPUT BOUNDED: {spilled} lines spilled to {artifact_rel} (SHA-256: {h})]\n"

    head_text = "\n".join(head_lines)
    tail_text = "\n".join(tail_lines)
    combined = f"{head_text}{marker}{tail_text}"

    # Enforce MAX_DELIVERED_BYTES
    comb_bytes = len(combined.encode("utf-8"))
    if comb_bytes > BOUNDING_LIMITS.MAX_DELIVERED_BYTES:
        marker_bytes = len(marker.encode("utf-8"))
        available = max(0, BOUNDING_LIMITS.MAX_DELIVERED_BYTES - marker_bytes)
        half = available // 2
        head_text = truncate_head_to_byte_budget(head_text, half)
        used_head = len(head_text.encode("utf-8"))
        tail_text = truncate_tail_to_byte_budget(tail_text, available - used_head)
        combined = f"{head_text}{marker}{tail_text}"

    return {
        "bounded": True,
        "content": combined,
        "artifactPath": artifact_rel,
        "artifactHash": h,
        "originalBytes": byte_len,
        "originalLines": line_count,
    }


def bound_output(
    raw_input: str | bytes,
    evidence_dir: Path | str = "evidence",
    ext: str = "txt",
) -> dict[str, Any]:
    """Character-safe diagnostic output bounding helper matching TS contract."""
    res = bound_and_store(raw_input, evidence_dir, ext)
    content = res["content"]
    delivered_bytes = len(content.encode("utf-8"))
    return {
        "bounded": content,
        "content": content,
        "isBounded": res["bounded"],
        "artifactPath": res["artifactPath"],
        "artifactHash": res["artifactHash"],
        "originalBytes": res["originalBytes"],
        "originalLines": res["originalLines"],
        "deliveredBytes": delivered_bytes,
        "hasReplacementChars": "\uFFFD" in content,
    }


# --- Safe File Operations ---

def safe_mkdir(dir_path: Path | str, mode: int = 0o700) -> None:
    """Create directory safely with specific permissions."""
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
    mode: int = 0o600,
    allow_update: bool = False,
) -> dict[str, Any]:
    """Safe file writer with preview mode, conflict detection, and backup."""
    resolved = Path(target_path).resolve()
    incoming = content.encode("utf-8") if isinstance(content, str) else content

    if resolved.exists():
        existing = resolved.read_bytes()
        if existing == incoming:
            return {
                "written": False,
                "action": "identical",
                "targetPath": str(resolved),
                "conflict": False,
            }

        if not write:
            return {
                "written": False,
                "action": "preview",
                "targetPath": str(resolved),
                "conflict": not allow_update,
            }

        if not force and not allow_update:
            return {
                "written": False,
                "action": "refused",
                "targetPath": str(resolved),
                "conflict": True,
                "error": f"Target file '{resolved}' exists with conflicting content. Specify --force to overwrite with backup.",
            }

        # Backup existing file
        ts = int(time.time() * 1000)
        backup_path = f"{resolved}.bak.{ts}"
        shutil.copyfile(resolved, backup_path)

        with open(resolved, "wb") as f:
            f.write(incoming)
            f.flush()
            os.fsync(f.fileno())
        try:
            os.chmod(resolved, mode)
        except OSError:
            pass

        return {
            "written": True,
            "action": "updated",
            "targetPath": str(resolved),
            "backupPath": backup_path,
            "conflict": False,
        }

    # Target does not exist
    if not write:
        return {
            "written": False,
            "action": "preview",
            "targetPath": str(resolved),
            "conflict": False,
        }

    resolved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(resolved, "wb") as f:
        f.write(incoming)
        f.flush()
        os.fsync(f.fileno())
    try:
        os.chmod(resolved, mode)
    except OSError:
        pass

    return {
        "written": True,
        "action": "created",
        "targetPath": str(resolved),
        "conflict": False,
    }


def safe_read_bounded_file(
    file_path: Path | str,
    max_bytes: int = BOUNDING_LIMITS.MAX_DELIVERED_BYTES,
) -> dict[str, Any]:
    """Read a file bounded to byte budget from tail if oversized."""
    p = Path(file_path).resolve()
    if not p.is_file():
        raise FileNotFoundError(f"File not found: {p}")
    raw_bytes = p.read_bytes()
    size_bytes = len(raw_bytes)
    raw_str = raw_bytes.decode("utf-8", errors="replace")
    if size_bytes <= max_bytes:
        return {
            "content": raw_str,
            "sizeBytes": size_bytes,
            "truncated": False,
        }
    bounded_str = truncate_tail_to_byte_budget(raw_str, max_bytes)
    return {
        "content": bounded_str,
        "sizeBytes": size_bytes,
        "truncated": True,
    }


# --- Process Advisory File Lock ---

class ProcessFileLock:
    """Cross-process advisory lock using OS primitives (fcntl on POSIX, msvcrt on Windows)."""

    def __init__(self, lock_path: Path | str) -> None:
        self.lock_path = Path(lock_path)
        self._file: Any = None

    def __enter__(self) -> "ProcessFileLock":
        self.lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._file = open(self.lock_path, "a+", encoding="utf-8")
        try:
            import fcntl
            fcntl.flock(self._file.fileno(), fcntl.LOCK_EX)
        except (ImportError, OSError):
            try:
                import msvcrt
                msvcrt.locking(self._file.fileno(), msvcrt.LK_LOCK, 1)
            except (ImportError, OSError):
                pass
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self._file is not None:
            try:
                import fcntl
                fcntl.flock(self._file.fileno(), fcntl.LOCK_UN)
            except (ImportError, OSError):
                try:
                    import msvcrt
                    msvcrt.locking(self._file.fileno(), msvcrt.LK_UNLCK, 1)
                except (ImportError, OSError):
                    pass
            self._file.close()
            self._file = None


# --- SQLite WAL Reservation Journal ---

class ReservationJournal:
    """Coordinates monotonic sequence reservation using SQLite in WAL mode with isolation_level=None."""

    def __init__(self, evidence_dir: Path | str) -> None:
        self.evidence_dir = Path(evidence_dir).resolve()
        self.evidence_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db_path = self.evidence_dir / "journal.sqlite"

        # One SQLite connection is shared by the actor's worker threads; the
        # actor's process lock serializes all mutations.
        self.conn = sqlite3.connect(
            str(self.db_path),
            timeout=30.0,
            isolation_level=None,
            check_same_thread=False,
        )
        self._init_db()
    def _init_db(self) -> None:
        cur = self.conn.cursor()
        cur.execute("PRAGMA journal_mode = WAL;")
        cur.execute("PRAGMA synchronous = NORMAL;")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS reservations (
                seq INTEGER PRIMARY KEY,
                event_key TEXT UNIQUE NOT NULL,
                entity_id TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS counters (
                kind TEXT PRIMARY KEY,
                current_val INTEGER NOT NULL
            );
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ledger_head (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                last_seq INTEGER NOT NULL,
                head_hash TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)
        cur.execute("""
            INSERT OR IGNORE INTO counters (kind, current_val) VALUES
                ('global_seq', 0),
                ('E', 0),
                ('F', 0),
                ('P', 0),
                ('WI', 0),
                ('unk', 0);
        """)
        self.conn.commit()

    def reserve(self, event_key: str, entity_prefix: str = "E") -> dict[str, Any]:
        """Reserve monotonic sequence number and entity ID."""
        cur = self.conn.cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            # Check for duplicate event_key
            cur.execute("SELECT seq, entity_id, status FROM reservations WHERE event_key = ?;", (event_key,))
            existing = cur.fetchone()
            if existing:
                seq_ex, entity_ex, status_ex = existing
                self.conn.rollback()
                raise ValueError(
                    f"Duplicate event_key '{event_key}' already exists in reservations (seq: {seq_ex}, status: {status_ex})."
                )
            # Increment global sequence
            cur.execute("UPDATE counters SET current_val = current_val + 1 WHERE kind = 'global_seq';")
            cur.execute("SELECT current_val FROM counters WHERE kind = 'global_seq';")
            seq = cur.fetchone()[0]

            # Increment entity counter
            cur.execute("UPDATE counters SET current_val = current_val + 1 WHERE kind = ?;", (entity_prefix,))
            if cur.rowcount == 0:
                cur.execute("INSERT INTO counters (kind, current_val) VALUES (?, 1);", (entity_prefix,))
                entity_count = 1
            else:
                cur.execute("SELECT current_val FROM counters WHERE kind = ?;", (entity_prefix,))
                entity_count = cur.fetchone()[0]

            entity_id = f"{entity_prefix}-{str(entity_count).zfill(6)}"
            now = datetime.now(timezone.utc).isoformat()

            cur.execute(
                "INSERT INTO reservations (seq, event_key, entity_id, status, created_at) VALUES (?, ?, ?, 'reserved', ?);",
                (seq, event_key, entity_id, now),
            )
            self.conn.commit()
            return {
                "seq": seq,
                "event_key": event_key,
                "entity_id": entity_id,
                "status": "reserved",
            }
        except Exception:
            self.conn.rollback()
            raise

    def commit_transaction(self, seq: int, head_hash: str) -> None:
        """Mark reservation committed and update ledger_head in an atomic transaction."""
        cur = self.conn.cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            cur.execute("UPDATE reservations SET status = 'committed' WHERE seq = ?;", (seq,))
            now = datetime.now(timezone.utc).isoformat()
            cur.execute(
                """
                INSERT INTO ledger_head (id, last_seq, head_hash, updated_at)
                VALUES (1, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    last_seq = excluded.last_seq,
                    head_hash = excluded.head_hash,
                    updated_at = excluded.updated_at;
                """,
                (seq, head_hash, now),
            )
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def rollback_transaction(self, seq: int) -> None:
        """Mark reservation failed."""
        cur = self.conn.cursor()
        cur.execute("BEGIN IMMEDIATE;")
        try:
            cur.execute("UPDATE reservations SET status = 'failed' WHERE seq = ?;", (seq,))
            self.conn.commit()
        except Exception:
            self.conn.rollback()

    def update_head(self, seq: int, head_hash: str) -> None:
        """Update ledger_head without modifying reservation status."""
        cur = self.conn.cursor()
        now = datetime.now(timezone.utc).isoformat()
        cur.execute(
            """
            INSERT INTO ledger_head (id, last_seq, head_hash, updated_at)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                last_seq = excluded.last_seq,
                head_hash = excluded.head_hash,
                updated_at = excluded.updated_at;
            """,
            (seq, head_hash, now),
        )
        self.conn.commit()

    def get_head(self) -> tuple[int, str] | None:
        """Get (last_seq, head_hash) from ledger_head."""
        cur = self.conn.cursor()
        cur.execute("SELECT last_seq, head_hash FROM ledger_head WHERE id = 1;")
        row = cur.fetchone()
        return (row[0], row[1]) if row else None

    def close(self) -> None:
        """Close SQLite connection."""
        self.conn.close()


# --- Ledger Actor ---

class LedgerActor:
    """Append-only cryptographic evidence ledger coordinator."""

    def __init__(self, evidence_dir: Path | str) -> None:
        self.evidence_dir = Path(evidence_dir).resolve()
        self.evidence_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.ledger_path = self.evidence_dir / "ledger.jsonl"
        self.journal = ReservationJournal(self.evidence_dir)
        self._lock = threading.Lock()

    def get_head_prev_hash(self) -> tuple[int, str]:
        """Inspect disk ledger.jsonl and return (last_seq, prev_hash)."""
        if not self.ledger_path.is_file():
            return 0, GENESIS_PREV_HASH

        content = self.ledger_path.read_text(encoding="utf-8")
        lines = [ln for ln in content.split("\n") if ln.strip()]
        if not lines:
            return 0, GENESIS_PREV_HASH

        last_line = lines[-1]
        parsed = json.loads(last_line)
        line_with_lf = last_line if last_line.endswith("\n") else f"{last_line}\n"
        h = sha256_string(line_with_lf)
        return int(parsed["seq"]), h

    def append_event(
        self,
        engagement_id: str,
        event_key: str,
        kind: str,
        session_id: str,
        actor: str,
        data: Any,
        entity_prefix: str = "E",
    ) -> dict[str, Any]:
        """Atomically reserve sequence, record receipt, and commit ledger entry."""
        with self._lock:
            with ProcessFileLock(self.evidence_dir / ".ledger.lock"):
                reservation = self.journal.reserve(event_key, entity_prefix)
                try:
                    _, prev_hash = self.get_head_prev_hash()

                    record: dict[str, Any] = {
                        "schema_version": 1,
                        "engagement_id": engagement_id,
                        "seq": reservation["seq"],
                        "event_key": reservation["event_key"],
                        "kind": kind,
                        "entity_id": reservation["entity_id"],
                        "session_id": session_id,
                        "actor": actor,
                        "recorded_at": datetime.now(timezone.utc).isoformat(),
                        "prev_hash": prev_hash,
                        "data": data if data is not None else {},
                    }

                    # Serialize identical to TS JSON.stringify (no extra spaces)
                    line = json.dumps(record, separators=(",", ":")) + "\n"

                    with open(self.ledger_path, "a", encoding="utf-8") as f:
                        f.write(line)
                        f.flush()
                        os.fsync(f.fileno())

                    try:
                        os.chmod(self.ledger_path, 0o600)
                    except OSError:
                        pass

                    line_hash = sha256_string(line)
                    self.journal.commit_transaction(reservation["seq"], line_hash)
                    return record
                except Exception:
                    self.journal.rollback_transaction(reservation["seq"])
                    raise

    def close(self) -> None:
        """Close journal resources."""
        self.journal.close()
