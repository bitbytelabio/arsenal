/**
 * SQLite WAL-Mode Reservation Journal
 * Implements data-model.md §8 & contracts/evidence-reporting.md §2.4
 * Coordinates monotonic sequence reservation with explicit BEGIN IMMEDIATE transactions
 * Invariant: Read-only verification MUST NOT instantiate or touch this writer store.
 */

import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

export interface Reservation {
  seq: number;
  event_key: string;
  entity_id: string;
  status: "reserved" | "ready" | "committed" | "failed";
}

export class ReservationJournal {
  private db: Database;

  constructor(evidenceDir: string) {
    fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
    const dbPath = path.join(evidenceDir, "journal.sqlite");
    this.db = new Database(dbPath, { create: true });

    // Enforce WAL mode
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run("PRAGMA synchronous = NORMAL;");

    this.initTables();
  }

  private initTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS reservations (
        seq INTEGER PRIMARY KEY,
        event_key TEXT UNIQUE NOT NULL,
        entity_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS counters (
        kind TEXT PRIMARY KEY,
        current_val INTEGER NOT NULL
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS ledger_head (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_seq INTEGER NOT NULL,
        head_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.db.run(`
      INSERT OR IGNORE INTO counters (kind, current_val) VALUES
        ('global_seq', 0),
        ('E', 0),
        ('F', 0),
        ('P', 0),
        ('WI', 0),
        ('unk', 0);
    `);
  }

  public reserve(eventKey: string, entityPrefix: string = "E"): Reservation {
    // Explicit BEGIN IMMEDIATE to acquire exclusive write lock upfront
    this.db.run("BEGIN IMMEDIATE;");
    try {
      // Increment monotonic global seq
      this.db.run("UPDATE counters SET current_val = current_val + 1 WHERE kind = 'global_seq';");
      const seqRow = this.db.query("SELECT current_val FROM counters WHERE kind = 'global_seq';").get() as {
        current_val: number;
      };
      const seq = seqRow.current_val;

      // Increment entity counter
      this.db.run("UPDATE counters SET current_val = current_val + 1 WHERE kind = ?;", [entityPrefix]);
      const entityRow = this.db.query("SELECT current_val FROM counters WHERE kind = ?;").get(entityPrefix) as {
        current_val: number;
      };
      const entityCount = entityRow.current_val;
      const entityId = `${entityPrefix}-${String(entityCount).padStart(6, "0")}`;

      const now = new Date().toISOString();
      this.db.run(
        "INSERT INTO reservations (seq, event_key, entity_id, status, created_at) VALUES (?, ?, ?, 'reserved', ?);",
        [seq, eventKey, entityId, now]
      );

      this.db.run("COMMIT;");

      return {
        seq,
        event_key: eventKey,
        entity_id: entityId,
        status: "reserved",
      };
    } catch (err: unknown) {
      try {
        this.db.run("ROLLBACK;");
      } catch {
        // Rollback on failure
      }
      throw err;
    }
  }

  public updateHead(seq: number, headHash: string): void {
    this.db.run(
      `
      INSERT INTO ledger_head (id, last_seq, head_hash, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_seq = excluded.last_seq,
        head_hash = excluded.head_hash,
        updated_at = excluded.updated_at;
    `,
      [seq, headHash, new Date().toISOString()]
    );
  }

  public commitTransaction(seq: number, headHash: string): void {
    this.db.run("BEGIN IMMEDIATE;");
    try {
      this.db.run("UPDATE reservations SET status = 'committed' WHERE seq = ?;", [seq]);
      this.db.run(
        `
        INSERT INTO ledger_head (id, last_seq, head_hash, updated_at)
        VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          last_seq = excluded.last_seq,
          head_hash = excluded.head_hash,
          updated_at = excluded.updated_at;
      `,
        [seq, headHash, new Date().toISOString()]
      );
      this.db.run("COMMIT;");
    } catch (err) {
      try {
        this.db.run("ROLLBACK;");
      } catch {
        // ignore
      }
      throw err;
    }
  }

  public rollbackTransaction(seq: number): void {
    this.db.run("BEGIN IMMEDIATE;");
    try {
      this.db.run("UPDATE reservations SET status = 'failed' WHERE seq = ?;", [seq]);
      this.db.run("COMMIT;");
    } catch {
      try {
        this.db.run("ROLLBACK;");
      } catch {
        // ignore
      }
    }
  }

  public getHead(): { lastSeq: number; headHash: string } | null {
    const row = this.db.query("SELECT last_seq, head_hash FROM ledger_head WHERE id = 1;").get() as {
      last_seq: number;
      head_hash: string;
    } | null;
    return row ? { lastSeq: row.last_seq, headHash: row.head_hash } : null;
  }

  public markCommitted(seq: number): void {
    this.db.run("UPDATE reservations SET status = 'committed' WHERE seq = ?;", [seq]);
  }

  public markFailed(seq: number): void {
    this.db.run("UPDATE reservations SET status = 'failed' WHERE seq = ?;", [seq]);
  }
  public close(): void {
    this.db.close();
  }
}
