/**
 * Engagement Resumption Engine
 * Implements data-model.md §8 & T043
 * Reconstructs active engagement state from append-only ledger without rewriting earlier receipts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256String } from "./hash.ts";
import type { LedgerEventRecord } from "./ledger.ts";

export interface ReconstructedEngagementState {
  engagement_id: string;
  last_seq: number;
  head_hash: string;
  total_records: number;
  evidence_ids: string[];
  finding_ids: string[];
  proposition_ids: string[];
  work_item_ids: string[];
  unknown_ids: string[];
  active_unknowns: string[];
  known_spend_usd: string;
}

export function resumeEngagement(evidenceDir: string): ReconstructedEngagementState {
  const ledgerPath = path.join(evidenceDir, "ledger.jsonl");
  if (!fs.existsSync(ledgerPath)) {
    return {
      engagement_id: "NONE",
      last_seq: 0,
      head_hash: "0".repeat(64),
      total_records: 0,
      evidence_ids: [],
      finding_ids: [],
      proposition_ids: [],
      work_item_ids: [],
      unknown_ids: [],
      active_unknowns: [],
      known_spend_usd: "0.000000000000",
    };
  }

  const raw = fs.readFileSync(ledgerPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  let engagementId = "ENG-UNKNOWN";
  let lastSeq = 0;
  let headHash = "0".repeat(64);

  const evidenceIds: string[] = [];
  const findingIds: string[] = [];
  const propositionIds: string[] = [];
  const workItemIds: string[] = [];
  const unknownIds: string[] = [];
  const resolvedUnknowns: Record<string, true> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const rec = JSON.parse(line) as LedgerEventRecord;
    engagementId = rec.engagement_id;
    lastSeq = rec.seq;

    if (rec.entity_id) {
      if (rec.entity_id.startsWith("E-")) evidenceIds.push(rec.entity_id);
      if (rec.entity_id.startsWith("F-")) findingIds.push(rec.entity_id);
      if (rec.entity_id.startsWith("P-")) propositionIds.push(rec.entity_id);
      if (rec.entity_id.startsWith("WI-")) workItemIds.push(rec.entity_id);
      if (rec.entity_id.startsWith("unk-")) unknownIds.push(rec.entity_id);
    }

    if (rec.kind === "unknown_resolved" && rec.entity_id) {
      resolvedUnknowns[rec.entity_id] = true;
    }

    headHash = sha256String(`${line}\n`);
  }

  const activeUnknowns = unknownIds.filter((u) => !resolvedUnknowns[u]);

  return {
    engagement_id: engagementId,
    last_seq: lastSeq,
    head_hash: headHash,
    total_records: lines.length,
    evidence_ids: evidenceIds,
    finding_ids: findingIds,
    proposition_ids: propositionIds,
    work_item_ids: workItemIds,
    unknown_ids: unknownIds,
    active_unknowns: activeUnknowns,
    known_spend_usd: "0.000000000000",
  };
}
