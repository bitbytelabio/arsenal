/**
 * tests/us8-budget.test.ts
 * Independent acceptance test for User Story 8: Control Spend and Finish Responsibly
 */

import { describe, expect, it } from "bun:test";
import { BudgetTracker, estimateTokenUsageFromContent, resolveSubagentSpawnResult } from "../plugin/extensions/budget.ts";
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

  it("routes subagents to @default to uphold profile default and prevent external fallback drift", () => {
    const tracker = new BudgetTracker();

    // Specialist spawned with bare role (real OMP event shape) routes to @default
    const reSpawnBare = resolveSubagentSpawnResult({
      agent: "arsenal-reverse",
      modelRole: "reasoning",
      patterns: ["google-antigravity/claude-opus-4-6:high"],
    }, tracker);
    expect(reSpawnBare.model).toBe("@default");

    // Verifier spawned with bare role routes to @default
    const verSpawnBare = resolveSubagentSpawnResult({
      agent: "arsenal-verifier",
      modelRole: "verifier",
      patterns: ["google-antigravity/claude-sonnet-4-6:high"],
    }, tracker);
    expect(verSpawnBare.model).toBe("@default");

    // Backward-compatible with @-prefixed roles
    const reSpawnPrefixed = resolveSubagentSpawnResult({
      agent: "arsenal-reverse",
      modelRole: "@reasoning",
      patterns: ["google-antigravity/claude-opus-4-6:high"],
    }, tracker);
    expect(reSpawnPrefixed.model).toBe("@default");

    // Non-Arsenal generic task() spawn is not hijacked; respects host OMP config
    const genericTaskSpawn = resolveSubagentSpawnResult({
      agent: "task",
      invocationKind: "task",
      modelRole: "implementer",
      patterns: ["google-antigravity/gemini-3.8-flash:high"],
    }, tracker);
    expect(genericTaskSpawn.model).toBeUndefined();

    // Explicit model requested by user is preserved
    const customSpawn = resolveSubagentSpawnResult({
      agent: "arsenal-web",
      invocationKind: "task",
      patterns: ["custom-domain/specialist-model"],
    }, tracker);
    expect(customSpawn.model).toBeUndefined();
    expect(customSpawn.block).toBeUndefined();
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

  it("estimates token usage from content when provider usage is absent", () => {
    expect(estimateTokenUsageFromContent(null)).toBeNull();
    expect(estimateTokenUsageFromContent("")).toBeNull();

    const fromString = estimateTokenUsageFromContent("12345678");
    expect(fromString).toEqual({ input: 0, output: 2, cacheRead: 0, cacheWrite: 0 });

    const fromBlocks = estimateTokenUsageFromContent([
      { type: "text", text: "hello " },
      { type: "text", text: "world!" },
    ]);
    expect(fromBlocks).toEqual({ input: 0, output: 3, cacheRead: 0, cacheWrite: 0 });
  });
});
