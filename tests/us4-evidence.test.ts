/**
 * tests/us4-evidence.test.ts
 * Independent acceptance test for User Story 4: Preserve and Audit Evidence Across Sessions
 */

import { describe, expect, it } from "bun:test";
import { LedgerActor } from "../src/core/ledger.ts";
import { executeEvidenceCommand } from "../plugin/tools/evidence-exec.ts";
import { resumeEngagement } from "../src/core/resumption.ts";
import { verifyHashChain } from "../src/core/hash.ts";
import * as fs from "node:fs";
import * as path from "node:path";

describe("User Story 4: Cryptographic Ledger & Evidence Infrastructure", () => {
  const scratchRepo = path.resolve("tests/fixtures/us4-repo");
  const scratchEvidence = path.join(scratchRepo, "evidence");

  it("appends ledger events with valid cryptographic hash chain", async () => {
    fs.rmSync(scratchRepo, { recursive: true, force: true });
    fs.mkdirSync(scratchEvidence, { recursive: true });

    const actor = new LedgerActor(scratchEvidence);

    // Event 1
    const ev1 = await actor.appendEvent({
      engagement_id: "ENG-US4-TEST",
      event_key: "evt-001",
      kind: "evidence_receipt",
      entity_prefix: "E",
      session_id: "sess-01",
      actor: "sec-webapp",
      data: { target: "https://api.target.com", action: "probe" },
    });
    expect(ev1.seq).toBe(1);
    expect(ev1.entity_id).toBe("E-000001");
    expect(ev1.prev_hash).toBe("0000000000000000000000000000000000000000000000000000000000000000");

    // Event 2
    const ev2 = await actor.appendEvent({
      engagement_id: "ENG-US4-TEST",
      event_key: "evt-002",
      kind: "finding_created",
      entity_prefix: "F",
      session_id: "sess-01",
      actor: "sec-webapp",
      data: { title: "SQLi confirmed" },
    });
    expect(ev2.seq).toBe(2);
    expect(ev2.entity_id).toBe("F-000001");
    expect(ev2.prev_hash).not.toBe(ev1.prev_hash);

    actor.close();

    // Verify ledger via CLI
    const verifyProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "evidence",
      "verify",
      "--repo",
      scratchRepo,
      "--json",
    ]);
    expect(verifyProc.exitCode).toBe(0);
  });

  it("handles 100 simultaneous async writes without race condition or broken hash chain (T010)", async () => {
    const stressRepo = path.resolve("tests/fixtures/us4-stress-repo");
    const stressEvidence = path.join(stressRepo, "evidence");
    fs.rmSync(stressRepo, { recursive: true, force: true });
    fs.mkdirSync(stressEvidence, { recursive: true });

    const actor = new LedgerActor(stressEvidence);

    // Dispatch 100 simultaneous async writes
    const tasks = Array.from({ length: 100 }, (_, i) =>
      actor.appendEvent({
        engagement_id: "ENG-STRESS",
        event_key: `evt-concurrent-${i + 1}`,
        kind: "evidence_receipt",
        entity_prefix: "E",
        session_id: "sess-concurrent",
        actor: "sec-webapp",
        data: { iteration: i + 1, timestamp: Date.now() },
      })
    );

    const results = await Promise.all(tasks);
    actor.close();

    expect(results.length).toBe(100);

    // Verify all 100 records appear on disk
    const ledgerFile = path.join(stressEvidence, "ledger.jsonl");
    expect(fs.existsSync(ledgerFile)).toBe(true);
    const content = fs.readFileSync(ledgerFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(100);

    // Verify strictly monotonic sequences
    const parsedRecords = lines.map((l) => JSON.parse(l));
    for (let i = 0; i < parsedRecords.length; i++) {
      expect(parsedRecords[i].seq).toBe(i + 1);
    }

    // Verify hash chain continuity
    const chainCheck = verifyHashChain(lines);
    expect(chainCheck.valid).toBe(true);

    // Verify zero duplicate prev_hash (except genesis for seq 1)
    const prevHashes = parsedRecords.map((r) => r.prev_hash);
    const nonGenesisHashes = prevHashes.slice(1);
    const uniqueNonGenesis = new Set(nonGenesisHashes);
    expect(uniqueNonGenesis.size).toBe(nonGenesisHashes.length);

    // Verify via CLI evidence verify
    const verifyProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "evidence",
      "verify",
      "--repo",
      stressRepo,
      "--json",
    ]);
    expect(verifyProc.exitCode).toBe(0);
    const output = JSON.parse(verifyProc.stdout.toString());
    expect(output.status).toBe("success");

    fs.rmSync(stressRepo, { recursive: true, force: true });
  });

  it("executes binaries via evidence_exec capturing exact raw streams", async () => {
    const execRes = await executeEvidenceCommand(
      { argv: ["echo", "un-truncated binary output stream"] },
      scratchEvidence
    );
    expect(execRes.exitCode).toBe(0);
    expect(execRes.stdout).toContain("un-truncated binary output stream");
    expect(execRes.stdout_artifact).toBeDefined();

    // Verify artifact file on disk
    const artFile = path.resolve(scratchEvidence, "raw", `${execRes.stdout_artifact!.sha256}.txt`);
    expect(fs.existsSync(artFile)).toBe(true);
    expect(fs.readFileSync(artFile, "utf-8").trim()).toBe("un-truncated binary output stream");
  });

  it("detects 1-byte tamper via evidence verify and exits code 4", () => {
    const ledgerFile = path.join(scratchEvidence, "ledger.jsonl");
    const raw = fs.readFileSync(ledgerFile, "utf-8");

    // Tamper with one character in the first record
    const tampered = raw.replace("https://api.target.com", "https://evil.target.com");
    fs.writeFileSync(ledgerFile, tampered, "utf-8");

    const tamperProc = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "evidence",
      "verify",
      "--repo",
      scratchRepo,
      "--json",
    ]);
    expect(tamperProc.exitCode).toBe(4); // Exit code 4: INTEGRITY_COMPROMISED

    // Restore clean
    fs.writeFileSync(ledgerFile, raw, "utf-8");
  });

  it("resumes engagement state reconstructing findings and active unknowns", () => {
    const resumed = resumeEngagement(scratchEvidence);
    expect(resumed.engagement_id).toBe("ENG-US4-TEST");
    expect(resumed.last_seq).toBe(2);
    expect(resumed.evidence_ids).toContain("E-000001");
    expect(resumed.finding_ids).toContain("F-000001");

    fs.rmSync(scratchRepo, { recursive: true, force: true });
  });

  it("ensures read-only verification does NOT create SQLite sidecars", () => {
    const readOnlyDir = path.resolve("tests/fixtures/readonly-check");
    fs.rmSync(readOnlyDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(readOnlyDir, "evidence"), { recursive: true });

    // Run evidence verify on empty repo
    const ver = Bun.spawnSync([
      "bun",
      "--no-env-file",
      "run",
      "bin/arsenal.ts",
      "evidence",
      "verify",
      "--repo",
      readOnlyDir,
      "--json",
    ]);
    expect(ver.exitCode).toBe(0);

    // Verify that NO journal.sqlite or WAL sidecars were created!
    expect(fs.existsSync(path.join(readOnlyDir, "evidence", "journal.sqlite"))).toBe(false);
    expect(fs.existsSync(path.join(readOnlyDir, "evidence", "journal.sqlite-wal"))).toBe(false);

    fs.rmSync(readOnlyDir, { recursive: true, force: true });
  });
});
