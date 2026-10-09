/**
 * Context Checkpoint for Model Compaction
 * Implements data-model.md §ContextCheckpoint & T071
 * Preserves governance boundaries and unresolved unknowns across compaction
 */

export interface ContextCheckpoint {
  charter_sha256: string;
  scope_revision_sha256: string;
  frozen_rule_refs: string[];
  summary_artifact_id: string;
  evidence_ids: string[];
  first_retained_turn_id: string;
  last_two_interaction_turns: [string, string];
  unresolved_unknown_ids: string[];
  ledger_head_hash: string;
  created_at: string;
}

export function createContextCheckpoint(params: {
  charter_sha256: string;
  scope_revision_sha256: string;
  frozen_rule_refs: string[];
  summary_artifact_id: string;
  evidence_ids: string[];
  first_retained_turn_id: string;
  last_two_interaction_turns: [string, string];
  unresolved_unknown_ids: string[];
  ledger_head_hash: string;
}): ContextCheckpoint {
  return {
    ...params,
    created_at: new Date().toISOString(),
  };
}
