/**
 * arsenal evidence handler
 * Implements T041, T042 & User Story 4
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { consolidateEvidence } from "../../plugin/tools/consolidate-evidence.ts";
import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import type { CommandContext } from "./router.ts";
import {
  GENESIS_PREV_HASH,
  sha256File,
  sha256String,
  verifyArtifactIntegrity,
  verifyHashChain,
} from "../core/hash.ts";
import { safeWriteFile } from "../core/fs-safe.ts";
import { Database } from "bun:sqlite";
import { LedgerActor } from "../core/ledger.ts";


export async function handleEvidence(ctx: CommandContext): Promise<number> {
  const subCommand = ctx.subCommand ?? "verify";
  const evidenceDir = path.join(ctx.repoRoot, "evidence");
  const ledgerPath = path.join(evidenceDir, "ledger.jsonl");

  if (subCommand === "verify") {
    if (!fs.existsSync(ledgerPath)) {
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.SUCCESS,
            "check",
            { clean: true, recordsVerified: 0, note: "Empty ledger." }
          )
        );
      } else {
        console.log(`[evidence verify] Empty ledger (no ledger.jsonl found).`);
      }
      return EXIT_CODES.SUCCESS;
    }

    const rawLedger = fs.readFileSync(ledgerPath, "utf-8");
    const lines = rawLedger.split("\n").filter((l) => l.trim().length > 0);

    // 1. Verify ledger head against journal if journal.sqlite exists
    const journalPath = path.join(evidenceDir, "journal.sqlite");
    if (fs.existsSync(journalPath)) {
      try {
        const db = new Database(journalPath, { readonly: true });
        const row = db.query("SELECT last_seq, head_hash FROM ledger_head WHERE id = 1;").get() as {
          last_seq: number;
          head_hash: string;
        } | null;
        db.close();

        if (row) {
          if (lines.length !== row.last_seq) {
            const msg = `Ledger record count mismatch: ledger has ${lines.length} records, journal committed ${row.last_seq}`;
            if (ctx.isJson) {
              emitJson(
                createJsonEnvelope(
                  ctx.rawArgs.join(" "),
                  EXIT_CODES.INTEGRITY_COMPROMISED,
                  "check",
                  {},
                  [],
                  [msg]
                )
              );
            } else {
              console.error(`[CRITICAL] ${msg}`);
            }
            return EXIT_CODES.INTEGRITY_COMPROMISED;
          }

          const lastLine = lines[lines.length - 1]!;
          const lastLineWithLf = lastLine.endsWith("\n") ? lastLine : `${lastLine}\n`;
          const actualHeadHash = sha256String(lastLineWithLf);
          if (actualHeadHash !== row.head_hash) {
            const msg = `Ledger head hash compromised: expected ${row.head_hash}, observed ${actualHeadHash}`;
            if (ctx.isJson) {
              emitJson(
                createJsonEnvelope(
                  ctx.rawArgs.join(" "),
                  EXIT_CODES.INTEGRITY_COMPROMISED,
                  "check",
                  {},
                  [],
                  [msg]
                )
              );
            } else {
              console.error(`[CRITICAL] ${msg}`);
            }
            return EXIT_CODES.INTEGRITY_COMPROMISED;
          }
        }
      } catch {
        // Journal read-only check failed or table absent, proceed to chain check
      }
    }

    const chainCheck = verifyHashChain(lines);
    if (!chainCheck.valid) {
      const msg = `Ledger hash chain compromised: ${chainCheck.error ?? "Broken prev_hash chain"}`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.INTEGRITY_COMPROMISED,
            "check",
            { recordsVerified: chainCheck.totalRecords },
            [],
            [msg]
          )
        );
      } else {
        console.error(`[CRITICAL] ${msg}`);
      }
      return EXIT_CODES.INTEGRITY_COMPROMISED;
    }

    // 2. Verify sequence monotonicity and artifact integrity
    let expectedSeq = 1;
    for (let i = 0; i < lines.length; i++) {
      const record = JSON.parse(lines[i]!) as {
        seq: number;
        data?: {
          artifacts?: Array<{ path: string; sha256: string }>;
        };
      };

      if (record.seq !== expectedSeq) {
        const msg = `Sequence gap or non-monotonic sequence at record ${i + 1}: expected ${expectedSeq}, got ${record.seq}`;
        if (ctx.isJson) {
          emitJson(
            createJsonEnvelope(
              ctx.rawArgs.join(" "),
              EXIT_CODES.INTEGRITY_COMPROMISED,
              "check",
              {},
              [],
              [msg]
            )
          );
        } else {
          console.error(`[CRITICAL] ${msg}`);
        }
        return EXIT_CODES.INTEGRITY_COMPROMISED;
      }
      expectedSeq++;

      if (record.data?.artifacts) {
        for (const art of record.data.artifacts) {
          const artFullPath = path.resolve(ctx.repoRoot, art.path);
          if (!verifyArtifactIntegrity(artFullPath, art.sha256)) {
            const msg = `Artifact integrity failure: file '${art.path}' missing or altered (expected sha256: ${art.sha256})`;
            if (ctx.isJson) {
              emitJson(
                createJsonEnvelope(
                  ctx.rawArgs.join(" "),
                  EXIT_CODES.INTEGRITY_COMPROMISED,
                  "check",
                  {},
                  [],
                  [msg]
                )
              );
            } else {
              console.error(`[CRITICAL] ${msg}`);
            }
            return EXIT_CODES.INTEGRITY_COMPROMISED;
          }
        }
      }
    }

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          "check",
          { clean: true, recordsVerified: lines.length }
        )
      );
    } else {
      console.log(`[evidence verify passed] Verified ${lines.length} ledger records and all linked artifacts. Zero gaps, zero corruption.`);
    }
    return EXIT_CODES.SUCCESS;
  }

  if (subCommand === "add") {
    const isWrite = Boolean(ctx.values.write);
    const filePath = ctx.values.file as string | undefined;

    if (!filePath || !fs.existsSync(filePath)) {
      const msg = `Artifact file '${filePath ?? ""}' not found. Specify valid --file <path>.`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CLI_USAGE_ERROR,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    const fileBytes = fs.readFileSync(filePath);
    const hash = sha256File(filePath);
    const ext = path.extname(filePath).replace(/^\./, "") || "bin";
    const destRel = path.join("evidence", "raw", `${hash}.${ext}`);
    const destFull = path.join(ctx.repoRoot, destRel);

    let metadata: Record<string, unknown> = {};
    if (ctx.values.metadata) {
      try {
        metadata = JSON.parse(ctx.values.metadata as string) as Record<string, unknown>;
      } catch {
        // ignore invalid json metadata
      }
    }

    // Determine seq and prev_hash
    let seq = 1;
    let prevHash = GENESIS_PREV_HASH;
    if (fs.existsSync(ledgerPath)) {
      const rawLedger = fs.readFileSync(ledgerPath, "utf-8");
      const lines = rawLedger.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1]!;
        const lastRec = JSON.parse(lastLine) as { seq: number };
        seq = lastRec.seq + 1;
        prevHash = sha256String(`${lastLine}\n`);
      }
    }

    const eventRecord = {
      schema_version: 1,
      engagement_id: (metadata.engagement_id as string) ?? "ENG-MANUAL",
      seq,
      event_key: `evt-manual-${Date.now()}`,
      kind: "evidence_receipt",
      entity_id: `E-${String(seq).padStart(6, "0")}`,
      session_id: (metadata.session_id as string) ?? "sess-manual",
      actor: (metadata.role as string) ?? "operator",
      recorded_at: new Date().toISOString(),
      prev_hash: prevHash,
      data: {
        tool_name: "manual_import",
        requested_target: (metadata.target as string) ?? filePath,
        observed_endpoint: (metadata.target as string) ?? filePath,
        scope_attribution: "in_scope",
        scope_revision_sha256: "0".repeat(64),
        artifacts: [
          {
            artifact_id: `art-${String(seq).padStart(6, "0")}`,
            path: destRel,
            media_type: "application/octet-stream",
            byte_length: fileBytes.byteLength,
            sha256: hash,
            fidelity: "raw",
          },
        ],
        capture_gap: null,
      },
    };

    if (!isWrite) {
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.SUCCESS,
            "preview",
            { plannedReceipt: eventRecord }
          )
        );
      } else {
        console.log(`[evidence add preview] Planned evidence import: ${filePath} -> ${destRel}`);
      }
      return EXIT_CODES.SUCCESS;
    }

    // Write raw artifact
    safeWriteFile(destFull, fileBytes, { write: true, force: true, mode: 0o600 });

    // Append to ledger using LedgerActor
    const ledgerActor = new LedgerActor(evidenceDir);
    const record = await ledgerActor.appendEvent({
      engagement_id: (metadata.engagement_id as string) ?? "ENG-MANUAL",
      event_key: `evt-manual-${Date.now()}`,
      kind: "evidence_receipt",
      entity_prefix: "E",
      session_id: (metadata.session_id as string) ?? "sess-manual",
      actor: (metadata.role as string) ?? "operator",
      data: eventRecord.data,
    });
    ledgerActor.close();

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          "write",
          { receipt: record }
        )
      );
    } else {
      console.log(`[evidence add] Imported artifact and committed receipt #${record.seq} to ledger.`);
    }
    return EXIT_CODES.SUCCESS;
  }

  if (subCommand === "consolidate") {
    let parsedValues: Record<string, unknown> = {};
    try {
      const parsed = parseArgs({
        args: ctx.rawArgs,
        options: {
          "case-root": { type: "string" },
          "case_root": { type: "string" },
          caseRoot: { type: "string" },
          "evidence-ids": { type: "string" },
          "evidence_ids": { type: "string" },
          evidenceIds: { type: "string" },
          "finding-id": { type: "string" },
          "finding_id": { type: "string" },
          findingId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          severity: { type: "string" },
          status: { type: "string" },
          confidence: { type: "string" },
          location: { type: "string" },
          write: { type: "boolean", default: false },
          json: { type: "boolean", default: false },
        },
        allowPositionals: true,
        strict: false,
      });
      parsedValues = parsed.values as Record<string, unknown>;
    } catch {
      // Fallback to ctx.values if parseArgs fails
    }

    const caseRootRaw =
      (parsedValues["case-root"] as string | undefined) ??
      (parsedValues["case_root"] as string | undefined) ??
      (parsedValues.caseRoot as string | undefined) ??
      (ctx.values["case-root"] as string | undefined) ??
      (ctx.values["case_root"] as string | undefined) ??
      (ctx.values.caseRoot as string | undefined);

    const evidenceIdsRaw =
      (parsedValues["evidence-ids"] as string | undefined) ??
      (parsedValues["evidence_ids"] as string | undefined) ??
      (parsedValues.evidenceIds as string | undefined) ??
      (ctx.values["evidence-ids"] as string | undefined) ??
      (ctx.values["evidence_ids"] as string | undefined) ??
      (ctx.values.evidenceIds as string | undefined);

    const findingIdRaw =
      (parsedValues["finding-id"] as string | undefined) ??
      (parsedValues["finding_id"] as string | undefined) ??
      (parsedValues.findingId as string | undefined) ??
      (ctx.values["finding-id"] as string | undefined) ??
      (ctx.values["finding_id"] as string | undefined) ??
      (ctx.values.findingId as string | undefined);

    const titleRaw =
      (parsedValues.title as string | undefined) ??
      (ctx.values.title as string | undefined);

    const descriptionRaw =
      (parsedValues.description as string | undefined) ??
      (ctx.values.description as string | undefined);

    const severityRaw =
      (parsedValues.severity as string | undefined) ??
      (ctx.values.severity as string | undefined);

    const statusRaw =
      (parsedValues.status as string | undefined) ??
      (ctx.values.status as string | undefined);

    const confidenceRaw =
      (parsedValues.confidence as string | undefined) ??
      (ctx.values.confidence as string | undefined);

    const locationRaw =
      (parsedValues.location as string | undefined) ??
      (ctx.values.location as string | undefined);

    const isWrite =
      Boolean(ctx.values.write) ||
      Boolean(parsedValues.write) ||
      ctx.mode === "write";

    if (!caseRootRaw) {
      const msg = "Error: Missing required option: --case-root <path>";
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CLI_USAGE_ERROR,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(msg);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    if (!evidenceIdsRaw) {
      const msg = "Error: no Evidence IDs provided";
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CLI_USAGE_ERROR,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(msg);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    if (!findingIdRaw) {
      const msg = "Error: Missing required option: --finding-id <id>";
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CLI_USAGE_ERROR,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(msg);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    if (!titleRaw) {
      const msg = "Error: Missing required option: --title <title>";
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CLI_USAGE_ERROR,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(msg);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    if (!descriptionRaw) {
      const msg = "Error: Missing required option: --description <text>";
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CLI_USAGE_ERROR,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(msg);
      }
      return EXIT_CODES.CLI_USAGE_ERROR;
    }

    const resolvedCaseRoot = path.isAbsolute(caseRootRaw)
      ? caseRootRaw
      : fs.existsSync(path.resolve(process.cwd(), caseRootRaw))
        ? path.resolve(process.cwd(), caseRootRaw)
        : path.resolve(ctx.repoRoot, caseRootRaw);

    try {
      const result = await consolidateEvidence({
        case_root: resolvedCaseRoot,
        evidence_ids: evidenceIdsRaw,
        finding_id: findingIdRaw,
        title: titleRaw,
        description: descriptionRaw,
        severity: severityRaw,
        status: statusRaw,
        confidence: confidenceRaw,
        location: locationRaw,
        write: isWrite,
      });

      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.SUCCESS,
            isWrite ? "write" : "preview",
            result
          )
        );
      } else {
        if (!isWrite) {
          console.log(
            `[evidence consolidate preview] Planned consolidation of ${result.consolidated_count} evidence items into ${result.finding_id}:`
          );
          for (const msg of result.messages) {
            console.log(`  ${msg}`);
          }
          console.log(`Run with --write to persist changes.`);
        } else {
          for (const msg of result.messages) {
            console.log(msg);
          }
        }
      }
      return EXIT_CODES.SUCCESS;
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const isNotFound = rawMsg.includes("not found");
      const exitCode = isNotFound ? EXIT_CODES.CHECK_FAILURE : EXIT_CODES.CLI_USAGE_ERROR;
      const formattedMsg = rawMsg.startsWith("Error:") ? rawMsg : `Error: ${rawMsg}`;

      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            exitCode,
            ctx.mode,
            {},
            [],
            [formattedMsg]
          )
        );
      } else {
        console.error(formattedMsg);
      }
      return exitCode;
    }
  }

  return EXIT_CODES.CLI_USAGE_ERROR;
}
