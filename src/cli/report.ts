/**
 * arsenal report handler
 * Implements FR-017 & /sec-report command
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import type { CommandContext } from "./router.ts";
import { generateExecutiveReport } from "../core/executive-report.ts";
import { exportToSarif } from "../core/sarif.ts";
import { LedgerActor } from "../core/ledger.ts";
import type { Finding } from "../core/findings.ts";

export async function handleReport(ctx: CommandContext): Promise<number> {
  const format = ((ctx.values.format as string) ?? "markdown").toLowerCase();
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const reportsDir = path.join(ctx.repoRoot, ".omp", "arsenal", "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const ext = format === "sarif" ? "sarif" : format === "json" ? "json" : "md";
  const defaultOutPath = path.join(reportsDir, `report-${timestamp}.${ext}`);
  const outPath = (ctx.values.output as string)
    ? path.resolve(ctx.values.output as string)
    : defaultOutPath;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Load findings from .omp/arsenal/findings.jsonl if present
  const findingsPath = path.join(ctx.repoRoot, ".omp", "arsenal", "findings.jsonl");
  const findings: Finding[] = [];
  if (fs.existsSync(findingsPath)) {
    const lines = fs
      .readFileSync(findingsPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    for (const l of lines) {
      try {
        findings.push(JSON.parse(l));
      } catch {
        // ignore malformed line
      }
    }
  }

  // Get ledger head info
  const evidenceDir = path.join(ctx.repoRoot, "evidence");
  let headHash = "0".repeat(64);
  let lastSeq = 0;
  if (fs.existsSync(evidenceDir)) {
    const ledger = new LedgerActor(evidenceDir);
    const head = ledger.getHeadPrevHash();
    headHash = head.prevHash;
    lastSeq = head.lastSeq;
  }

  let reportContent = "";
  if (format === "json") {
    reportContent = JSON.stringify(
      {
        engagementId: "eng-default",
        generatedAt: now.toISOString(),
        headHash,
        lastSeq,
        findings,
      },
      null,
      2
    );
  } else if (format === "sarif") {
    reportContent = JSON.stringify(exportToSarif(findings), null, 2);
  } else {
    reportContent = generateExecutiveReport({
      engagementId: "eng-default",
      engagementName: "Security Assessment",
      headHash,
      lastSeq,
      findings,
    });
  }

  fs.writeFileSync(outPath, reportContent, "utf-8");

  if (ctx.isJson) {
    emitJson(
      createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.SUCCESS, "write", {
        format,
        outPath,
        findingsCount: findings.length,
        headHash,
        lastSeq,
      })
    );
  } else {
    console.log(`[sec-report] Generated ${format.toUpperCase()} deliverable report at:`);
    console.log(` -> ${outPath}`);
    console.log(`\n--- Executive Summary ---\n`);
    const summaryLines = reportContent.split("\n").slice(0, 20).join("\n");
    console.log(summaryLines);
  }

  return EXIT_CODES.SUCCESS;
}
