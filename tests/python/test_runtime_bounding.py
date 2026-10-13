"""Tests for output bounding engine and character-safe budget enforcement."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from arsenal.storage import (
    BOUNDING_LIMITS,
    bound_and_store,
    bound_output,
    truncate_head_to_byte_budget,
    truncate_tail_to_byte_budget,
)


class TestRuntimeBounding(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.evidence_dir = Path(self.temp_dir.name) / "evidence"
        self.evidence_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_unbounded_small_output(self) -> None:
        small_text = "Line 1\nLine 2\nLine 3"
        res = bound_output(small_text, self.evidence_dir)
        self.assertFalse(res["isBounded"])
        self.assertEqual(res["content"], small_text)
        self.assertEqual(res["originalLines"], 3)
        self.assertIsNone(res["artifactPath"])

    def test_bounding_oversized_lines_spills_raw_artifact(self) -> None:
        # Generate 600 lines (limit is 500)
        lines = [f"Output line {i:04d}: test payload execution details" for i in range(600)]
        big_text = "\n".join(lines)

        res = bound_output(big_text, self.evidence_dir)
        self.assertTrue(res["isBounded"])
        self.assertIsNotNone(res["artifactPath"])
        self.assertIsNotNone(res["artifactHash"])

        # Check raw spilled artifact on disk
        spilled_file = self.evidence_dir / "raw" / f"{res['artifactHash']}.txt"
        self.assertTrue(spilled_file.is_file())
        self.assertEqual(spilled_file.read_text(encoding="utf-8"), big_text)

        # Check delivered bounding notice
        self.assertIn("[OUTPUT BOUNDED:", res["content"])
        self.assertIn("lines spilled to", res["content"])

        # Check that total delivered bytes <= MAX_DELIVERED_BYTES (4096)
        delivered_bytes = len(res["content"].encode("utf-8"))
        self.assertLessEqual(delivered_bytes, BOUNDING_LIMITS.MAX_DELIVERED_BYTES)

    def test_codepoint_safe_truncation_without_replacement_chars(self) -> None:
        # Multi-byte UTF-8 string (Vietnamese + emoji)
        multibyte_str = "Hệ thống kiểm tra bảo mật Arsenal 🛡️ 🔥" * 2000
        res = bound_output(multibyte_str, self.evidence_dir)

        self.assertFalse(res["hasReplacementChars"])
        self.assertNotIn("\uFFFD", res["content"])
        delivered_bytes = len(res["content"].encode("utf-8"))
        self.assertLessEqual(delivered_bytes, BOUNDING_LIMITS.MAX_DELIVERED_BYTES)

    def test_truncate_head_and_tail_byte_budget(self) -> None:
        sample = "Xin chào các chuyên gia an ninh mạng"
        # Truncate to 10 bytes: ensure valid UTF-8 and <= 10 bytes
        head = truncate_head_to_byte_budget(sample, 10)
        self.assertLessEqual(len(head.encode("utf-8")), 10)
        self.assertNotIn("\uFFFD", head)

        tail = truncate_tail_to_byte_budget(sample, 10)
        self.assertLessEqual(len(tail.encode("utf-8")), 10)
        self.assertNotIn("\uFFFD", tail)


if __name__ == "__main__":
    unittest.main()
