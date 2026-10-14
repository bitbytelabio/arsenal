/**
 * tests/us8-budget.test.ts
 * Independent acceptance test for User Story 8: Control Spend and Finish Responsibly
 */

import { describe, expect, it } from "bun:test";
import { BudgetTracker } from "../plugin/extensions/budget.ts";
import { createBudgetRecord } from "../src/core/budget.ts";
import { createContextCheckpoint } from "../src/core/context-checkpoint.ts";

describe("User Story 8: Financial Budget & Spend Governor", () => {
  it("accumulates spend across 4 buckets and fires warnings at 70%, 85%, 95%", () => {
    const tracker = new BudgetTracker(10.0); // $10 budget

    // Spend $5 (50%) -> no warning
    const r1 = tracker.recordTurnSpend({
      input: 1000000, // $3
      output: 100000, // $1.5
      cacheRead: 1000000, // $0.3
      cacheWrite: 50000, // $0.1875
    });
    expect(r1.warning).toBeUndefined();
    expect(tracker.totalSpendUsd).toBeGreaterThanOrEqual(4.9);

    // Spend another $2.5 -> reaches > 70% ($7.5) -> NOTICE warning
    const r2 = tracker.recordTurnSpend({
      input: 500000,
      output: 70000,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(r2.warning).toBeDefined();
    expect(r2.warning!.level).toBe("NOTICE");
    expect(r2.warning!.threshold).toBe(70);

    // Spend another $1.5 -> reaches > 85% ($9.0) -> URGENT warning
    const r3 = tracker.recordTurnSpend({
      input: 500000,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(r3.warning).toBeDefined();
    expect(r3.warning!.level).toBe("URGENT");
    expect(r3.warning!.threshold).toBe(85);

    // Spend another $1.0 -> reaches > 95% ($10.0) -> CRITICAL warning
    const r4 = tracker.recordTurnSpend({
      input: 350000,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(r4.warning).toBeDefined();
    expect(r4.warning!.level).toBe("CRITICAL");
    expect(r4.warning!.threshold).toBe(95);
  });

  it("enforces subagent budget reserve at >= 90% spend", () => {
    const tracker = new BudgetTracker(10.0);
    tracker.totalSpendUsd = 9.2; // 92% spend

    // Exploratory roles are blocked
    const blockWeb = tracker.shouldBlockExploratorySpawn("arsenal-web");
    expect(blockWeb.block).toBe(true);
    expect(blockWeb.reason).toContain("Subagent budget reserve active");

    const blockRe = tracker.shouldBlockExploratorySpawn("arsenal-reverse");
    expect(blockRe.block).toBe(true);

    // arsenal-verifier is permitted!
    const allowVer = tracker.shouldBlockExploratorySpawn("arsenal-verifier");
    expect(allowVer.block).toBeUndefined();
    expect(allowVer.note).toContain("Prioritizing verifier task");
  });

  it("persists budget records formatted to 12 decimal places", () => {
    const record = createBudgetRecord({
      engagement_id: "ENG-US8",
      allowance_usd: "10.00",
      known_spend: 9.123456789012,
      token_totals: { input: 1000, output: 200, cacheRead: 50, cacheWrite: 10 },
      reserve_active: true,
      warned_bands: [70, 85, 90],
    });

    expect(record.known_spend_usd).toBe("9.123456789012");
    expect(record.reserve_active).toBe(true);
  });

  it("creates context checkpoint preserving governance boundaries", () => {
    const chk = createContextCheckpoint({
      charter_sha256: "0".repeat(64),
      scope_revision_sha256: "0".repeat(64),
      frozen_rule_refs: ["rules/epistemic-constraints.md"],
      summary_artifact_id: "art-summary-01",
      evidence_ids: ["E-000001", "E-000002"],
      first_retained_turn_id: "turn-01",
      last_two_interaction_turns: ["turn-09", "turn-10"],
      unresolved_unknown_ids: ["unk-000001"],
      ledger_head_hash: "0".repeat(64),
    });

    expect(chk.unresolved_unknown_ids).toContain("unk-000001");
    expect(chk.last_two_interaction_turns.length).toBe(2);
  });
});
