"""Cryptographic evidence ledger verification, ingestion, and consolidation."""

from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes
from arsenal.storage import (
    GENESIS_PREV_HASH,
    LedgerActor,
    safe_write_file,
    sha256_bytes,
    sha256_string,
    verify_artifact_integrity,
    verify_hash_chain,
)


def handle_evidence(ctx: Context) -> int:
    """CLI dispatcher for 'arsenal evidence'."""
    subcommand = ctx.subcommand or "verify"
    evidence_dir = ctx.repo_root / "evidence"
    ledger_path = evidence_dir / "ledger.jsonl"
    journal_path = evidence_dir / "journal.sqlite"

    # --- Verify Subcommand ---
    if subcommand == "verify":
        if not ledger_path.is_file():
            if not ctx.is_json:
                print("[evidence verify] Empty ledger (no ledger.jsonl found).")
            return ctx.result(
                {"clean": True, "recordsVerified": 0, "note": "Empty ledger."},
                code=ExitCodes.SUCCESS,
            )

        raw_ledger = ledger_path.read_text(encoding="utf-8")
        lines = [ln for ln in raw_ledger.split("\n") if ln.strip()]

        # 1. Verify ledger head against journal if journal.sqlite exists
        if journal_path.is_file():
            try:
                conn = sqlite3.connect(f"file:{journal_path}?mode=ro", uri=True)
                cur = conn.cursor()
                cur.execute("SELECT last_seq, head_hash FROM ledger_head WHERE id = 1;")
                row = cur.fetchone()
                conn.close()

                if row:
                    last_seq, head_hash = row
                    if len(lines) != last_seq:
                        msg = f"Ledger record count mismatch: ledger has {len(lines)} records, journal committed {last_seq}"
                        if not ctx.is_json:
                            print(f"[CRITICAL] {msg}", file=sys.stderr)
                        return ctx.result({}, code=ExitCodes.INTEGRITY_COMPROMISED, errors=[msg])

                    last_line = lines[-1]
                    last_line_with_lf = last_line if last_line.endswith("\n") else f"{last_line}\n"
                    actual_head_hash = sha256_string(last_line_with_lf)
                    if actual_head_hash != head_hash.lower():
                        msg = f"Ledger head hash compromised: expected {head_hash}, observed {actual_head_hash}"
                        if not ctx.is_json:
                            print(f"[CRITICAL] {msg}", file=sys.stderr)
                        return ctx.result({}, code=ExitCodes.INTEGRITY_COMPROMISED, errors=[msg])
            except Exception:
                # Read-only check failure or uninitialized table; proceed to hash chain check
                pass

        # 2. Verify hash chain continuity
        chain_valid, total_records, failed_idx, chain_err = verify_hash_chain(lines)
        if not chain_valid:
            msg = f"Ledger hash chain compromised: {chain_err or 'Broken prev_hash chain'}"
            if not ctx.is_json:
                print(f"[CRITICAL] {msg}", file=sys.stderr)
            return ctx.result(
                {"recordsVerified": total_records},
                code=ExitCodes.INTEGRITY_COMPROMISED,
                errors=[msg],
            )

        # 3. Verify sequence monotonicity and artifact integrity
        expected_seq = 1
        for i, raw_line in enumerate(lines):
            try:
                record = json.loads(raw_line)
            except Exception:
                msg = f"Corrupt JSON at line {i + 1}"
                return ctx.result({}, code=ExitCodes.INTEGRITY_COMPROMISED, errors=[msg])

            seq = record.get("seq")
            if seq != expected_seq:
                msg = f"Sequence gap or non-monotonic sequence at record {i + 1}: expected {expected_seq}, got {seq}"
                if not ctx.is_json:
                    print(f"[CRITICAL] {msg}", file=sys.stderr)
                return ctx.result({}, code=ExitCodes.INTEGRITY_COMPROMISED, errors=[msg])
            expected_seq += 1

            artifacts = (record.get("data") or {}).get("artifacts", [])
            for art in artifacts:
                art_rel = art.get("path")
                art_sha = art.get("sha256")
                if art_rel and art_sha:
                    art_full = (ctx.repo_root / art_rel).resolve()
                    if not verify_artifact_integrity(art_full, art_sha):
                        msg = f"Artifact integrity failure: file '{art_rel}' missing or altered (expected sha256: {art_sha})"
                        if not ctx.is_json:
                            print(f"[CRITICAL] {msg}", file=sys.stderr)
                        return ctx.result({}, code=ExitCodes.INTEGRITY_COMPROMISED, errors=[msg])

        if not ctx.is_json:
            print(
                f"[evidence verify passed] Verified {len(lines)} ledger records and all linked artifacts. Zero gaps, zero corruption."
            )
        return ctx.result({"clean": True, "recordsVerified": len(lines)}, code=ExitCodes.SUCCESS)

    # --- Add Subcommand ---
    if subcommand == "add":
        is_write = bool(ctx.values.get("write"))
        file_path_str = ctx.values.get("file") or (ctx.positionals[0] if ctx.positionals else None)

        if not file_path_str:
            return ctx.fail("Artifact file not specified. Specify valid --file <path>.", code=ExitCodes.CLI_USAGE_ERROR)

        file_path = Path(str(file_path_str)).resolve()
        if not file_path.is_file():
            return ctx.fail(f"Artifact file '{file_path}' not found. Specify valid --file <path>.", code=ExitCodes.CLI_USAGE_ERROR)

        file_bytes = file_path.read_bytes()
        file_hash = sha256_bytes(file_bytes)
        ext = file_path.suffix.lstrip(".") or "bin"
        dest_rel = f"evidence/raw/{file_hash}.{ext}"
        dest_full = ctx.repo_root / dest_rel

        metadata: dict[str, Any] = {}
        meta_val = ctx.values.get("metadata")
        if meta_val:
            try:
                metadata = json.loads(str(meta_val))
            except Exception:
                pass

        # Determine seq and prev_hash
        seq = 1
        prev_hash = GENESIS_PREV_HASH
        if ledger_path.is_file():
            raw_lines = [ln for ln in ledger_path.read_text(encoding="utf-8").split("\n") if ln.strip()]
            if raw_lines:
                last_line = raw_lines[-1]
                last_rec = json.loads(last_line)
                seq = int(last_rec["seq"]) + 1
                prev_hash = sha256_string(last_line if last_line.endswith("\n") else f"{last_line}\n")

        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        event_record: dict[str, Any] = {
            "schema_version": 1,
            "engagement_id": str(metadata.get("engagement_id") or "ENG-MANUAL"),
            "seq": seq,
            "event_key": f"evt-manual-{int(time.time() * 1000)}",
            "kind": "evidence_receipt",
            "entity_id": f"E-{str(seq).zfill(6)}",
            "session_id": str(metadata.get("session_id") or "sess-manual"),
            "actor": str(metadata.get("role") or "operator"),
            "recorded_at": now_iso,
            "prev_hash": prev_hash,
            "data": {
                "tool_name": "manual_import",
                "requested_target": str(metadata.get("target") or file_path),
                "observed_endpoint": str(metadata.get("target") or file_path),
                "scope_attribution": "in_scope",
                "scope_revision_sha256": "0" * 64,
                "artifacts": [
                    {
                        "artifact_id": f"art-{str(seq).zfill(6)}",
                        "path": dest_rel,
                        "media_type": "application/octet-stream",
                        "byte_length": len(file_bytes),
                        "sha256": file_hash,
                        "fidelity": "raw",
                    }
                ],
                "capture_gap": None,
            },
        }

        if not is_write:
            if not ctx.is_json:
                print(f"[evidence add preview] Planned evidence import: {file_path} -> {dest_rel}")
            return ctx.result({"plannedReceipt": event_record}, code=ExitCodes.SUCCESS)

        # Write raw artifact
        safe_write_file(dest_full, file_bytes, write=True, force=True, mode=0o600)

        # Append to ledger
        actor = LedgerActor(evidence_dir)
        record = actor.append_event(
            engagement_id=str(metadata.get("engagement_id") or "ENG-MANUAL"),
            event_key=f"evt-manual-{int(time.time() * 1000)}",
            kind="evidence_receipt",
            entity_prefix="E",
            session_id=str(metadata.get("session_id") or "sess-manual"),
            actor=str(metadata.get("role") or "operator"),
            data=event_record["data"],
        )
        actor.close()

        if not ctx.is_json:
            print(f"[evidence add] Imported artifact and committed receipt #{record['seq']} to ledger.")
        return ctx.result({"receipt": record}, code=ExitCodes.SUCCESS)

    # --- Consolidate Subcommand ---
    if subcommand == "consolidate":
        case_root_raw = ctx.values.get("case-root") or ctx.values.get("case_root") or ctx.values.get("caseRoot")
        evidence_ids_raw = ctx.values.get("evidence-ids") or ctx.values.get("evidence_ids") or ctx.values.get("evidenceIds")
        finding_id_raw = ctx.values.get("finding-id") or ctx.values.get("finding_id") or ctx.values.get("findingId")
        title_raw = ctx.values.get("title")
        description_raw = ctx.values.get("description")
        severity_raw = ctx.values.get("severity")
        status_raw = ctx.values.get("status")
        confidence_raw = ctx.values.get("confidence")
        location_raw = ctx.values.get("location")
        is_write = bool(ctx.values.get("write")) or ctx.mode == "write"

        if not case_root_raw:
            return ctx.fail("Error: Missing required option: --case-root <path>", code=ExitCodes.CLI_USAGE_ERROR)
        if not evidence_ids_raw:
            return ctx.fail("Error: no Evidence IDs provided", code=ExitCodes.CLI_USAGE_ERROR)
        if not finding_id_raw:
            return ctx.fail("Error: Missing required option: --finding-id <id>", code=ExitCodes.CLI_USAGE_ERROR)
        if not title_raw:
            return ctx.fail("Error: Missing required option: --title <title>", code=ExitCodes.CLI_USAGE_ERROR)
        if not description_raw:
            return ctx.fail("Error: Missing required option: --description <text>", code=ExitCodes.CLI_USAGE_ERROR)

        case_root_path = Path(str(case_root_raw)).resolve()

        try:
            from arsenal.cases import consolidate_evidence
            result = consolidate_evidence({
                "case_root": str(case_root_path),
                "evidence_ids": str(evidence_ids_raw),
                "finding_id": str(finding_id_raw),
                "title": str(title_raw),
                "description": str(description_raw),
                "severity": str(severity_raw) if severity_raw else None,
                "status": str(status_raw) if status_raw else None,
                "confidence": str(confidence_raw) if confidence_raw else None,
                "location": str(location_raw) if location_raw else None,
                "write": is_write,
            })

            if not ctx.is_json:
                if not is_write:
                    print(
                        f"[evidence consolidate preview] Planned consolidation of {result.get('consolidated_count', 0)} "
                        f"evidence items into {result.get('finding_id')}:"
                    )
                    for msg in result.get("messages", []):
                        print(f"  {msg}")
                    print("Run with --write to persist changes.")
                else:
                    for msg in result.get("messages", []):
                        print(msg)

            return ctx.result(result, code=ExitCodes.SUCCESS)
        except Exception as e:
            raw_msg = str(e)
            is_not_found = "not found" in raw_msg.lower()
            code = ExitCodes.CHECK_FAILURE if is_not_found else ExitCodes.CLI_USAGE_ERROR
            formatted_msg = raw_msg if raw_msg.startswith("Error:") else f"Error: {raw_msg}"
            return ctx.fail(formatted_msg, code=code)

    # --- Exec Subcommand Alias ---
    if subcommand == "exec":
        from arsenal.tools import handle_exec
        return handle_exec(ctx)

    return ctx.fail(f"Unknown evidence subcommand: '{subcommand}'", code=ExitCodes.CLI_USAGE_ERROR)


handle = handle_evidence
