/**
 * Role Architecture & Dispatch Validation Engine
 * Implements data-model.md §OperatingProfile, Role and Override & T033
 */

export const CANONICAL_ROLES: Record<string, true> = {
  master: true,
  "arsenal-reverse": true,
  "arsenal-web": true,
  "arsenal-mobile": true,
  "arsenal-redteam": true,
  "arsenal-verifier": true,
};

export const MASTER_ALLOWED_CHILDREN: Record<string, true> = {
  "arsenal-reverse": true,
  "arsenal-web": true,
  "arsenal-mobile": true,
  "arsenal-redteam": true,
  "arsenal-verifier": true,
};

export interface RoleInvocationRecord {
  role: string;
  session_id: string;
  parent_session_id: string | null;
  requested_model_role: string;
  resolved_model: string;
  purpose: string;
  routing_note?: string;
  started_at: string;
  ended_at?: string;
  completed_turns: number;
}

export function isValidRole(role: string): boolean {
  return Boolean(CANONICAL_ROLES[role]);
}

export function validateRoleSpawn(
  parentRole: string,
  childRole: string
): { allowed: boolean; reason?: string } {
  if (!isValidRole(parentRole)) {
    return { allowed: false, reason: `Unknown parent role: '${parentRole}'` };
  }
  if (!isValidRole(childRole)) {
    return { allowed: false, reason: `Unknown child role: '${childRole}'` };
  }

  // Only master may spawn children
  if (parentRole !== "master") {
    return {
      allowed: false,
      reason: `Specialist role '${parentRole}' declares spawns: []. Recursive subagent delegation is forbidden.`,
    };
  }

  if (!MASTER_ALLOWED_CHILDREN[childRole]) {
    return {
      allowed: false,
      reason: `Master role may only spawn canonical arsenal-* specialist roles. Spawn of '${childRole}' denied.`,
    };
  }

  return { allowed: true };
}

export function createRoleInvocation(
  role: string,
  sessionId: string,
  parentSessionId: string | null,
  requestedModelRole: string,
  resolvedModel: string,
  purpose: string,
  routingNote?: string
): RoleInvocationRecord {
  return {
    role,
    session_id: sessionId,
    parent_session_id: parentSessionId,
    requested_model_role: requestedModelRole,
    resolved_model: resolvedModel,
    purpose,
    routing_note: routingNote,
    started_at: new Date().toISOString(),
    completed_turns: 0,
  };
}
