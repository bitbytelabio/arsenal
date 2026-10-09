import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { LedgerActor } from "../src/core/ledger.ts";
import { GENESIS_PREV_HASH, sha256String } from "../src/core/hash.ts";

describe("Evidence Ledger Integration & Cryptographic Continuity", () => {
  test("appends sequential events with unbroken hash chain", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-ledger-test-"));
    try {
      const ledger = new LedgerActor(tmpDir);

      const event1 = await ledger.appendEvent({
        engagement_id: "eng-test-001",
        event_key: "tool:apk_inspect:start",
        kind: "tool_execution",
        session_id: "sess-01",
        actor: "sec-mobile",
        data: { apk: "sample.apk" },
      });

      expect(event1.seq).toBe(1);
      expect(event1.prev_hash).toBe(GENESIS_PREV_HASH);

      const event2 = await ledger.appendEvent({
        engagement_id: "eng-test-001",
        event_key: "tool:apk_inspect:result",
        kind: "tool_result",
        session_id: "sess-01",
        actor: "sec-mobile",
        data: { packageName: "com.example.vulnerableapp", debuggable: true },
      });

      expect(event2.seq).toBe(2);
      expect(event2.prev_hash).not.toBe(GENESIS_PREV_HASH);

      // Verify chain integrity in ledger.jsonl
      const ledgerFile = path.join(tmpDir, "ledger.jsonl");
      expect(fs.existsSync(ledgerFile)).toBe(true);

      const lines = fs
        .readFileSync(ledgerFile, "utf-8")
        .split("\n")
        .filter((l) => l.trim().length > 0);

      expect(lines.length).toBe(2);
      const parsed1 = JSON.parse(lines[0]!);
      const parsed2 = JSON.parse(lines[1]!);

      expect(parsed1.seq).toBe(1);
      expect(parsed2.seq).toBe(2);
      expect(parsed2.prev_hash).toBe(sha256String(`${lines[0]}\n`));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
