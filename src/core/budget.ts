/**
 * Budget Record Persistence & Financial Accounting
 * Implements data-model.md §BudgetRecord and ContextCheckpoint & T070
 */

import { BUDGET_RECORD_SCHEMA, validateSchema } from "../schemas/validator.ts";

export interface BudgetRecord {
  schema_version: 1;
  engagement_id: string;
  allowance_usd: string | null;
  known_spend_usd: string;
  unknown_usage_count: number;
  token_totals: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  warned_bands: number[];
  reserve_active: boolean;
  in_flight_spawns: string[];
  ledger_head_hash: string | null;
}

export function formatUsd(amount: number): string {
  // 12 decimal places fixed formatting
  return amount.toFixed(12);
}

export function createBudgetRecord(params: {
  engagement_id: string;
  allowance_usd?: string | null;
  known_spend: number;
  unknown_usage_count?: number;
  token_totals: { input: number; output: number; cacheRead: number; cacheWrite: number };
  warned_bands?: number[];
  reserve_active?: boolean;
  in_flight_spawns?: string[];
  ledger_head_hash?: string | null;
}): BudgetRecord {
  const record: BudgetRecord = {
    schema_version: 1,
    engagement_id: params.engagement_id,
    allowance_usd: params.allowance_usd ?? null,
    known_spend_usd: formatUsd(params.known_spend),
    unknown_usage_count: params.unknown_usage_count ?? 0,
    token_totals: params.token_totals,
    warned_bands: params.warned_bands ?? [],
    reserve_active: params.reserve_active ?? false,
    in_flight_spawns: params.in_flight_spawns ?? [],
    ledger_head_hash: params.ledger_head_hash ?? null,
  };

  const valRes = validateSchema(BUDGET_RECORD_SCHEMA.$id, record);
  if (!valRes.valid) {
    throw new Error(`BudgetRecord schema error: ${valRes.errors.join(", ")}`);
  }

  return record;
}
