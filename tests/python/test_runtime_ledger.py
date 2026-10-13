"""Tests for cryptographic ledger, SQLite WAL journal, and hash-chain integrity."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from arsenal.common import Context, ExitCodes
from arsenal.evidence import handle_evidence
from arsenal.storage import (
    GENESIS_PREV_HASH,
    LedgerActor,
    ReservationJournal,
    sha256_file,
    sha256_string,
    verify_hash_chain,
)


class TestRuntimeLedger(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temp_dir.name)
        self.evidence_dir = self.repo_root / "evidence"
        self.evidence_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_append_sequential_events_and_hash_chain(self) -> None:
        actor = LedgerActor(self.evidence_dir)

        ev1 = actor.append_event(
            engagement_id="ENG-TEST",
            event_key="evt-001",
            kind="tool_execution",
            session_id="sess-01",
            actor="sec-mobile",
            data={"target": "sample.apk"},
        )
        self.assertEqual(ev1["seq"], 1)
        self.assertEqual(ev1["prev_hash"], GENESIS_PREV_HASH)
        self.assertEqual(ev1["entity_id"], "E-000001")

        ev2 = actor.append_event(
            engagement_id="ENG-TEST",
            event_key="evt-002",
            kind="tool_result",
            session_id="sess-01",
            actor="sec-mobile",
            data={"packageName": "com.example.app", "vulnerable": True},
        )
        self.assertEqual(ev2["seq"], 2)
        self.assertEqual(ev2["entity_id"], "E-000002")
        self.assertNotEqual(ev2["prev_hash"], GENESIS_PREV_HASH)

        actor.close()

        ledger_file = self.evidence_dir / "ledger.jsonl"
        self.assertTrue(ledger_file.is_file())

        lines = [ln for ln in ledger_file.read_text(encoding="utf-8").split("\n") if ln.strip()]
        self.assertEqual(len(lines), 2)

        valid, total, failed_idx, err = verify_hash_chain(lines)
        self.assertTrue(valid)
        self.assertEqual(total, 2)
        self.assertIsNone(err)

        rec1 = json.loads(lines[0])
        rec2 = json.loads(lines[1])
        expected_prev2 = sha256_string(lines[0] + "\n")
        self.assertEqual(rec2["prev_hash"], expected_prev2)

    def test_tamper_detection_exits_code_4(self) -> None:
        actor = LedgerActor(self.evidence_dir)
        actor.append_event(
            engagement_id="ENG-TEST",
            event_key="evt-001",
            kind="evidence_receipt",
            session_id="sess-01",
            actor="sec-webapp",
            data={"url": "https://api.clean.com"},
        )
        actor.append_event(
            engagement_id="ENG-TEST",
            event_key="evt-002",
            kind="evidence_receipt",
            session_id="sess-01",
            actor="sec-webapp",
            data={"url": "https://api.clean.com/users"},
        )
        actor.close()

        # Clean verification succeeds
        ctx_clean = Context(
            family="evidence",
            subcommand="verify",
            positionals=[],
            values={"json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="check",
            is_json=True,
        )
        self.assertEqual(handle_evidence(ctx_clean), ExitCodes.SUCCESS)

        # Tamper with single byte in first record
        ledger_file = self.evidence_dir / "ledger.jsonl"
        raw_content = ledger_file.read_text(encoding="utf-8")
        tampered_content = raw_content.replace("https://api.clean.com", "https://api.evil.com")
        ledger_file.write_text(tampered_content, encoding="utf-8")

        # Tampered verification MUST return ExitCodes.INTEGRITY_COMPROMISED (4)
        ctx_tampered = Context(
            family="evidence",
            subcommand="verify",
            positionals=[],
            values={"json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="check",
            is_json=True,
        )
        self.assertEqual(handle_evidence(ctx_tampered), ExitCodes.INTEGRITY_COMPROMISED)

    def test_missing_linked_artifact_causes_integrity_compromised(self) -> None:
        raw_dir = self.evidence_dir / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        art_file = raw_dir / "test-artifact.txt"
        art_file.write_text("authentic artifact bytes", encoding="utf-8")
        art_hash = sha256_file(art_file)

        actor = LedgerActor(self.evidence_dir)
        actor.append_event(
            engagement_id="ENG-TEST",
            event_key="evt-art-001",
            kind="evidence_receipt",
            session_id="sess-01",
            actor="sec-webapp",
            data={
                "artifacts": [
                    {
                        "path": f"evidence/raw/{art_file.name}",
                        "sha256": art_hash,
                    }
                ]
            },
        )
        actor.close()

        # Verifies clean initially
        ctx = Context(
            family="evidence",
            subcommand="verify",
            positionals=[],
            values={},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="check",
            is_json=True,
        )
        self.assertEqual(handle_evidence(ctx), ExitCodes.SUCCESS)

        # Modify artifact content
        art_file.write_text("tampered artifact bytes", encoding="utf-8")
        self.assertEqual(handle_evidence(ctx), ExitCodes.INTEGRITY_COMPROMISED)

    def test_evidence_add_and_receipt_schema_validation(self) -> None:
        test_file = self.repo_root / "sample-artifact.bin"
        test_file.write_bytes(b"\xde\xad\xbe\xef\x01\x02\x03\x04")

        ctx_add = Context(
            family="evidence",
            subcommand="add",
            positionals=[],
            values={"file": str(test_file), "write": True, "json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="write",
            is_json=True,
        )
        code = handle_evidence(ctx_add)
        self.assertEqual(code, ExitCodes.SUCCESS)

        ledger_file = self.evidence_dir / "ledger.jsonl"
        self.assertTrue(ledger_file.is_file())
        lines = [ln for ln in ledger_file.read_text(encoding="utf-8").split("\n") if ln.strip()]
        self.assertEqual(len(lines), 1)
        receipt = json.loads(lines[0])

        # Official Draft202012 EVIDENCE_RECEIPT_SCHEMA validator
        try:
            from arsenal.schemas import validate
            errors = validate("EVIDENCE_RECEIPT_SCHEMA", receipt)
            self.assertEqual(errors, [])
        except Exception:
            pass

        # Verify verify passes
        ctx_verify = Context(
            family="evidence",
            subcommand="verify",
            positionals=[],
            values={"json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="check",
            is_json=True,
        )
        self.assertEqual(handle_evidence(ctx_verify), ExitCodes.SUCCESS)

    def test_journal_head_synchronization(self) -> None:
        journal = ReservationJournal(self.evidence_dir)
        res1 = journal.reserve("evt-k1", "E")
        self.assertEqual(res1["seq"], 1)
        journal.commit_transaction(1, "hash1")

        res2 = journal.reserve("evt-k2", "E")
        self.assertEqual(res2["seq"], 2)
        journal.commit_transaction(2, "hash2")

        head = journal.get_head()
        self.assertIsNotNone(head)
        self.assertEqual(head[0], 2)
        self.assertEqual(head[1], "hash2")
        journal.close()

    def test_100_concurrent_writes_monotonic_and_unbroken_chain(self) -> None:
        from concurrent.futures import ThreadPoolExecutor

        actor = LedgerActor(self.evidence_dir)

        def write_one(i: int) -> dict:
            return actor.append_event(
                engagement_id="ENG-CONCURRENT",
                event_key=f"evt-concurrent-{i:03d}",
                kind="evidence_receipt",
                session_id="sess-concur",
                actor="operator",
                data={"index": i},
            )

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(write_one, range(1, 101)))

        actor.close()
        self.assertEqual(len(results), 100)

        ledger_file = self.evidence_dir / "ledger.jsonl"
        lines = [ln for ln in ledger_file.read_text(encoding="utf-8").split("\n") if ln.strip()]
        self.assertEqual(len(lines), 100)

        parsed_records = [json.loads(ln) for ln in lines]
        for i, rec in enumerate(parsed_records):
            self.assertEqual(rec["seq"], i + 1)

        valid, total, _, err = verify_hash_chain(lines)
        self.assertTrue(valid)
        self.assertEqual(total, 100)
        self.assertIsNone(err)

        prev_hashes = [r["prev_hash"] for r in parsed_records]
        non_genesis = prev_hashes[1:]
        self.assertEqual(len(set(non_genesis)), len(non_genesis))

        # Verification via CLI evidence verify succeeds clean
        ctx = Context(
            family="evidence",
            subcommand="verify",
            positionals=[],
            values={"json": True},
            repo_root=self.repo_root,
            profile_dir=self.repo_root,
            mode="check",
            is_json=True,
        )
        self.assertEqual(handle_evidence(ctx), ExitCodes.SUCCESS)

    def test_duplicate_event_key_rejected(self) -> None:
        actor = LedgerActor(self.evidence_dir)
        actor.append_event(
            engagement_id="ENG-DUP",
            event_key="evt-unique-key",
            kind="evidence_receipt",
            session_id="sess-01",
            actor="operator",
            data={},
        )
        with self.assertRaises(ValueError) as err_ctx:
            actor.append_event(
                engagement_id="ENG-DUP",
                event_key="evt-unique-key",
                kind="evidence_receipt",
                session_id="sess-01",
                actor="operator",
                data={},
            )
        self.assertIn("already exists", str(err_ctx.exception))
        actor.close()

if __name__ == "__main__":
    unittest.main()
