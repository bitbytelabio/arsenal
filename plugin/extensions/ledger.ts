/**
 * Evidence Ledger Runtime Extension
 * Implements contracts/runtime.md §2.3, §2.5 & T039, T081
 * Hooks tool_result post-execution middleware to commit immutable receipts into ledger.jsonl
 */

import * as path from "node:path";
import { LedgerActor } from "../../src/core/ledger.ts";
import { sha256String } from "../../src/core/hash.ts";
import { attributeTarget, resolveActiveScope } from "../../src/core/scope.ts";

export interface ToolResultEvent {
  toolName: string;
  toolCallId: string;
  content: Array<{ type: string; text?: string; data?: unknown }>;
  details?: unknown;
  isError?: boolean;
  input?: Record<string, unknown>;
}

export interface ExtensionApi {
  on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) => void;
}

export default function ledgerExtension(pi: ExtensionApi): void {
  let ledger: LedgerActor | null = null;
  let ledgerEvidenceDir: string | null = null;
  const inFlightCommits: Array<Promise<unknown>> = [];

  function getLedger(): LedgerActor {
    const currentEvidenceDir = path.resolve(process.cwd(), "evidence");
    if (!ledger || ledgerEvidenceDir !== currentEvidenceDir) {
      ledger = new LedgerActor(currentEvidenceDir);
      ledgerEvidenceDir = currentEvidenceDir;
    }
    return ledger;
  }

  pi.on("tool_result", async (rawEvent: unknown, rawCtx: unknown) => {
    const event = rawEvent as ToolResultEvent;
    const ctx = rawCtx as {
      agent?: { name?: string; id?: string };
      sessionManager?: { getSessionId?: () => string };
    };

    const actor = ctx.agent?.name ?? "sec-webapp";
    const sessionId = ctx.sessionManager?.getSessionId?.() ?? ctx.agent?.id ?? "sess-default";

    // Extract raw text for artifact calculation
    const textBlocks = (event.content || [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string);
    const combinedText = textBlocks.join("\n");
    const textHash = sha256String(combinedText);

    const targetUrl =
      typeof event.input?.url === "string"
        ? event.input.url
        : typeof event.input?.target === "string"
          ? event.input.target
          : typeof event.input?.path === "string"
            ? event.input.path
            : event.toolName;

    const commitPromise = (async () => {
      try {
        const { scope, scopeSha256 } = resolveActiveScope(process.cwd());

        let scopeAttribution: "in_scope" | "out_of_scope" | "unknown" = "unknown";
        let scopeRevisionSha256: string | null = null;
        let attributionReason: string | null = "No active engagement scope.json found in workspace";
        let matchingSelector: string | null = null;

        if (scope && scopeSha256) {
          const attr = attributeTarget(targetUrl, scope);
          scopeAttribution = attr.status;
          scopeRevisionSha256 = scopeSha256;
          attributionReason = attr.reason;
          matchingSelector = attr.matchingSelector ?? null;
        }

        const engagementId = scope?.engagement_id ?? "ENG-ACTIVE";

        const act = getLedger();
        await act.appendEvent({
          engagement_id: engagementId,
          event_key: `evt-tool-${event.toolCallId || Date.now()}`,
          kind: "evidence_receipt",
          entity_prefix: "E",
          session_id: sessionId,
          actor,
          data: {
            tool_name: event.toolName,
            requested_target: targetUrl,
            observed_endpoint: targetUrl,
            scope_attribution: scopeAttribution,
            scope_revision_sha256: scopeRevisionSha256,
            attribution_reason: attributionReason,
            matching_selector: matchingSelector,
            artifacts: [
              {
                artifact_id: `art-${event.toolCallId || Date.now()}`,
                path: `evidence/raw/${textHash}.txt`,
                media_type: "text/plain",
                byte_length: Buffer.byteLength(combinedText, "utf-8"),
                sha256: textHash,
                fidelity: "tool_result",
              },
            ],
            capture_gap: event.isError ? "Tool execution indicated error" : null,
          },
        });
      } catch (err: unknown) {
        console.error("[ledgerExtension] Failed to record tool result receipt:", err);
      }
    })();

    inFlightCommits.push(commitPromise);
    await commitPromise;
  });

  // Session lifecycle hooks
  pi.on("session_stop", async () => {
    // Await all in-flight commits before allowing session shutdown
    await Promise.allSettled(inFlightCommits);
    if (ledger) {
      ledger.close();
      ledger = null;
    }
  });

  pi.on("agent_end", async () => {
    await Promise.allSettled(inFlightCommits);
  });
}
