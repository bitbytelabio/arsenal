/**
 * Analytical Entities: Propositions, Work Items, and Residual Unknowns
 * Implements data-model.md §Proposition, WorkItem and ResidualUnknown & T051
 */

export interface Proposition {
  id: string; // P-xxxxxx
  statement: string; // explicitly labeled inference
  author: string;
  evidence_ids: string[];
  finding_ids: string[];
  state: "proposed" | "supported" | "refuted" | "superseded";
  confidence_explanation: string;
  supersedes_id?: string;
}

export interface WorkItem {
  id: string; // WI-xxxxxx
  objective: string;
  assigned_role: string;
  linked_propositions: string[];
  linked_findings: string[];
  linked_evidence: string[];
  linked_unknowns: string[];
  state: "pending" | "active" | "blocked" | "completed" | "cancelled" | "failed";
  outcome_evidence_id?: string;
  outcome_reason?: string;
}

export interface ResidualUnknown {
  id: string; // unk-xxxxxx
  question: string;
  origin_claim: string;
  impact: string;
  resolution_work_item_id?: string;
  state: "open" | "resolved";
  resolution_evidence_id?: string;
  resolution_rationale?: string;
}

export function createProposition(params: {
  id: string;
  statement: string;
  author: string;
  evidence_ids: string[];
  finding_ids?: string[];
  confidence_explanation: string;
}): Proposition {
  return {
    id: params.id,
    statement: params.statement,
    author: params.author,
    evidence_ids: params.evidence_ids,
    finding_ids: params.finding_ids ?? [],
    state: "proposed",
    confidence_explanation: params.confidence_explanation,
  };
}

export function createWorkItem(params: {
  id: string;
  objective: string;
  assigned_role: string;
  linked_propositions?: string[];
  linked_findings?: string[];
  linked_evidence?: string[];
  linked_unknowns?: string[];
}): WorkItem {
  return {
    id: params.id,
    objective: params.objective,
    assigned_role: params.assigned_role,
    linked_propositions: params.linked_propositions ?? [],
    linked_findings: params.linked_findings ?? [],
    linked_evidence: params.linked_evidence ?? [],
    linked_unknowns: params.linked_unknowns ?? [],
    state: "pending",
  };
}

export function createResidualUnknown(params: {
  id: string;
  question: string;
  origin_claim: string;
  impact: string;
  resolution_work_item_id?: string;
}): ResidualUnknown {
  return {
    id: params.id,
    question: params.question,
    origin_claim: params.origin_claim,
    impact: params.impact,
    resolution_work_item_id: params.resolution_work_item_id,
    state: "open",
  };
}

export function resolveResidualUnknown(
  unknownEntity: ResidualUnknown,
  resolutionEvidenceId: string,
  rationale: string
): ResidualUnknown {
  return {
    ...unknownEntity,
    state: "resolved",
    resolution_evidence_id: resolutionEvidenceId,
    resolution_rationale: rationale,
  };
}
