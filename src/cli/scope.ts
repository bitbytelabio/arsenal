/**
 * arsenal scope handler
 * Implements T019 & User Story 1
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import type { CommandContext } from "./router.ts";
import { parseScope } from "../core/scope.ts";
import type { ScopeDocument } from "../core/scope.ts";

export async function handleScope(ctx: CommandContext): Promise<number> {
  const scopePath = path.join(ctx.repoRoot, ".omp", "scope.json");
  const engagementPath = path.join(ctx.repoRoot, ".omp", "engagement.json");

  if (!fs.existsSync(scopePath)) {
    const errorMsg = `No scope file found at '${scopePath}'. Run 'arsenal init' first.`;
    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.ENVIRONMENT_UNAVAILABLE,
          ctx.mode,
          {},
          [],
          [errorMsg]
        )
      );
    } else {
      console.error(`Error: ${errorMsg}`);
    }
    return EXIT_CODES.ENVIRONMENT_UNAVAILABLE;
  }

  let scopeDoc: ScopeDocument;
  try {
    scopeDoc = parseScope(scopePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.CHECK_FAILURE,
          ctx.mode,
          {},
          [],
          [msg]
        )
      );
    } else {
      console.error(`Error parsing scope: ${msg}`);
    }
    return EXIT_CODES.CHECK_FAILURE;
  }

  let engagementDoc: Record<string, unknown> = {};
  if (fs.existsSync(engagementPath)) {
    try {
      engagementDoc = JSON.parse(fs.readFileSync(engagementPath, "utf-8")) as Record<string, unknown>;
    } catch {
      // Best-effort load for engagement
    }
  }

  const scopeData = {
    engagement_id: scopeDoc.engagement_id,
    name: scopeDoc.name,
    domain: scopeDoc.domain,
    auth_status: scopeDoc.auth.status,
    ready_for_act: scopeDoc.auth.ready_for_act,
    basis: scopeDoc.auth.basis,
    reference: scopeDoc.auth.reference,
    in_scope: scopeDoc.in_scope,
    out_of_scope: scopeDoc.out_of_scope,
    disallowed_actions: scopeDoc.disallowed_actions,
    window: scopeDoc.window,
    budget_usd: scopeDoc.budget_usd,
    charter_path: scopeDoc.charter_path,
    engagement_status: engagementDoc.status ?? "unknown",
  };

  if (ctx.isJson) {
    emitJson(createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.SUCCESS, ctx.mode, scopeData));
  } else {
    console.log(`================================================================================`);
    console.log(`                     ENGAGEMENT SCOPE & AUTHORIZATION                           `);
    console.log(`================================================================================`);
    console.log(`Engagement ID : ${scopeDoc.engagement_id}`);
    console.log(`Name          : ${scopeDoc.name}`);
    console.log(`Domain        : ${scopeDoc.domain}`);
    console.log(`Auth Status   : ${scopeDoc.auth.status.toUpperCase()} (ready_for_act: ${scopeDoc.auth.ready_for_act})`);
    console.log(`Signatory Ref : ${scopeDoc.auth.reference ?? "None"}`);
    console.log(`Auth Basis    : ${scopeDoc.auth.basis ?? "None"}`);
    console.log(`Budget (USD)  : ${scopeDoc.budget_usd ?? "None"}`);
    console.log(`Window        : ${scopeDoc.window.start} -> ${scopeDoc.window.end} (${scopeDoc.window.timezone})`);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`In-Scope Targets (${scopeDoc.in_scope.length}):`);
    if (scopeDoc.in_scope.length === 0) console.log(`  (none defined - incomplete scope)`);
    for (const t of scopeDoc.in_scope) console.log(`  + ${t}`);
    console.log(`Out-of-Scope Exclusions (${scopeDoc.out_of_scope.length}):`);
    if (scopeDoc.out_of_scope.length === 0) console.log(`  (none defined)`);
    for (const e of scopeDoc.out_of_scope) console.log(`  - ${e}`);
    console.log(`Disallowed Actions (${scopeDoc.disallowed_actions.length}):`);
    for (const d of scopeDoc.disallowed_actions) console.log(`  ! ${d}`);
    console.log(`================================================================================`);
  }

  return EXIT_CODES.SUCCESS;
}
