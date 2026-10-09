/**
 * Cryptographic Append-Only Ledger Actor
 * Implements contracts/evidence-reporting.md §2 & T036
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { GENESIS_PREV_HASH, sha256String } from "./hash.ts";
import { ReservationJournal } from "./journal.ts";
import type { Reservation } from "./journal.ts";
import { AsyncMutex } from "./concurrency.ts";

export interface LedgerEventRecord<T = unknown> {
  schema_version: 1;
  engagement_id: string;
  seq: number;
  event_key: string;
  kind: string;
  entity_id: string | null;
  session_id: string;
  actor: string;
  recorded_at: string;
  prev_hash: string;
  data: T;
}

export class LedgerActor {
  private evidenceDir: string;
  private ledgerPath: string;
  private journal: ReservationJournal;
  private mutex = new AsyncMutex();

  constructor(evidenceDir: string) {
    this.evidenceDir = path.resolve(evidenceDir);
    fs.mkdirSync(this.evidenceDir, { recursive: true, mode: 0o700 });
    this.ledgerPath = path.join(this.evidenceDir, "ledger.jsonl");
    this.journal = new ReservationJournal(this.evidenceDir);
  }

  public getHeadPrevHash(): { lastSeq: number; prevHash: string } {
    if (!fs.existsSync(this.ledgerPath)) {
      return { lastSeq: 0, prevHash: GENESIS_PREV_HASH };
    }

    const content = fs.readFileSync(this.ledgerPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return { lastSeq: 0, prevHash: GENESIS_PREV_HASH };
    }

    const lastLine = lines[lines.length - 1]!;
    const lastParsed = JSON.parse(lastLine) as { seq: number };
    const hash = sha256String(`${lastLine}\n`);
    return { lastSeq: lastParsed.seq, prevHash: hash };
  }

  public async appendEvent<T = unknown>(params: {
    engagement_id: string;
    event_key: string;
    kind: string;
    entity_prefix?: string;
    session_id: string;
    actor: string;
    data: T;
  }): Promise<LedgerEventRecord<T>> {
    return this.mutex.runExclusive(() => {
      const prefix = params.entity_prefix ?? "E";
      const reservation: Reservation = this.journal.reserve(params.event_key, prefix);

      try {
        const { prevHash } = this.getHeadPrevHash();

        const record: LedgerEventRecord<T> = {
          schema_version: 1,
          engagement_id: params.engagement_id,
          seq: reservation.seq,
          event_key: reservation.event_key,
          kind: params.kind,
          entity_id: reservation.entity_id,
          session_id: params.session_id,
          actor: params.actor,
          recorded_at: new Date().toISOString(),
          prev_hash: prevHash,
          data: params.data,
        };

        const line = JSON.stringify(record) + "\n";
        fs.appendFileSync(this.ledgerPath, line, { encoding: "utf-8", mode: 0o600 });
        try {
          fs.chmodSync(this.ledgerPath, 0o600);
        } catch {
          // Non-POSIX fallback
        }

        const lineHash = sha256String(line);
        this.journal.commitTransaction(reservation.seq, lineHash);
        return record;
      } catch (err: unknown) {
        this.journal.rollbackTransaction(reservation.seq);
        throw err;
      }
    });
  }

  public close(): void {
    this.journal.close();
  }
}
