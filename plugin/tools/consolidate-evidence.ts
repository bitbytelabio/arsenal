/**
 * consolidate_evidence Registered Tool
 * Ported from vendor/reverse-skill/scripts/consolidate_evidence.py
 * Copyright (c) 2026 zhaoxuya520 (MIT License)
 *
 * Marks evidence/E-*.md files as superseded by a finding ID and appends
 * finding blocks to report/report.md within a case workspace.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ConsolidateEvidenceInput {
  case_root?: string;
  caseRoot?: string;
  evidence_ids?: string[] | string;
  evidenceIds?: string[] | string;
  finding_id?: string;
  findingId?: string;
  title: string;
  description: string;
  severity?: string;
  status?: string;
  confidence?: string;
  location?: string;
  write?: boolean;
}

export interface ConsolidateEvidenceOutput {
  success: boolean;
  finding_id: string;
  consolidated_count: number;
  evidence_ids: string[];
  report_path: string;
  modified_files: string[];
  finding_block: string;
  write: boolean;
  messages: string[];
}

/**
 * Marks an evidence markdown document as superseded by the given finding ID.
 * Matches Python consolidate_evidence.py mark_superseded logic:
 * 1. If `- status: ...` line exists, replace it with `- status: superseded by <finding_id>`
 * 2. Else if `---` delimiter exists, replace first `---` with `---\n- status: superseded by <finding_id>`
 * 3. Otherwise append `- status: superseded by <finding_id>` at the end.
 */
export function markSuperseded(content: string, findingId: string): string {
  const clean = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const statusTest = /^-\s*status:\s*.*$/m;
  if (statusTest.test(clean)) {
    return clean.replace(/^-\s*status:\s*.*$/gm, `- status: superseded by ${findingId}`);
  }
  const frontmatterTest = /^---\s*$/m;
  if (frontmatterTest.test(clean)) {
    return clean.replace(/^---\s*$/m, `---\n- status: superseded by ${findingId}`);
  }
  return clean.trimEnd() + `\n- status: superseded by ${findingId}\n`;
}

/**
 * Builds the Markdown finding block to append to the case report.
 */
export function buildFindingBlock(params: {
  findingId: string;
  title: string;
  severity: string;
  status: string;
  confidence: string;
  location: string;
  evidenceIds: string[];
  description: string;
  consolidatedAt: string;
}): string {
  return (
    `### ${params.findingId}\n` +
    `- title: ${params.title}\n` +
    `- severity: ${params.severity}\n` +
    `- status: ${params.status}\n` +
    `- confidence: ${params.confidence}\n` +
    `- location: ${params.location}\n` +
    `- evidence_ids: ${params.evidenceIds.join(", ")}\n` +
    `- consolidated_at: ${params.consolidatedAt}\n\n` +
    `${params.description}\n`
  );
}

/**
 * Generates updated report markdown content.
 * Matches Python consolidate_evidence.py report update behavior:
 * If report exists and lacks "## Findings", append "## Findings\n".
 * Then append "\n\n" + block.
 * If report does not exist, initialize with "# Case Report\n\n## Findings\n\n" + block.
 */
export function updateReportContent(existingContent: string | null, block: string): string {
  if (existingContent !== null && existingContent !== undefined) {
    const clean = existingContent.charCodeAt(0) === 0xfeff ? existingContent.slice(1) : existingContent;
    let content = clean;
    if (!content.includes("## Findings")) {
      content = content.trimEnd() + "\n\n## Findings\n";
    }
    return content.trimEnd() + "\n\n" + block;
  }
  return `# Case Report\n\n## Findings\n\n${block}`;
}

/**
 * Consolidates evidence items into a finding.
 * Validates inputs and paths, marks evidence files as superseded,
 * and appends the finding block to report/report.md.
 * Report-only by default; set input.write = true to persist changes to disk.
 */
export async function consolidateEvidence(
  input: ConsolidateEvidenceInput,
  caseRootOverride?: string
): Promise<ConsolidateEvidenceOutput> {
  const rawCaseRoot = input.case_root ?? input.caseRoot ?? caseRootOverride;
  if (!rawCaseRoot || typeof rawCaseRoot !== "string" || rawCaseRoot.trim().length === 0) {
    throw new Error("consolidate_evidence: 'case_root' is required.");
  }
  const caseRoot = path.resolve(rawCaseRoot.trim());
  if (!fs.existsSync(caseRoot)) {
    throw new Error(`consolidate_evidence: case_root directory '${caseRoot}' does not exist.`);
  }

  const rawEvidenceIds = input.evidence_ids ?? input.evidenceIds;
  if (!rawEvidenceIds) {
    throw new Error("Error: no Evidence IDs provided");
  }

  const ids: string[] = (
    Array.isArray(rawEvidenceIds)
      ? rawEvidenceIds
      : String(rawEvidenceIds).split(",")
  )
    .map((id) => (typeof id === "string" ? id.trim() : String(id).trim()))
    .filter((id) => id.length > 0);

  if (ids.length === 0) {
    throw new Error("Error: no Evidence IDs provided");
  }

  const findingId = (input.finding_id ?? input.findingId ?? "").trim();
  if (!findingId) {
    throw new Error("consolidate_evidence: 'finding_id' is required.");
  }

  const title = (input.title ?? "").trim();
  if (!title) {
    throw new Error("consolidate_evidence: 'title' is required.");
  }

  const description = (input.description ?? "").trim();
  if (!description) {
    throw new Error("consolidate_evidence: 'description' is required.");
  }

  const severity = (input.severity ?? "medium").trim();
  const status = (input.status ?? "validated").trim();
  const confidence = (input.confidence ?? "medium").trim();
  const location = (input.location ?? "see evidence_ids").trim();
  const isWrite = Boolean(input.write);

  const evidenceDir = path.join(caseRoot, "evidence");
  for (const eid of ids) {
    const f = path.join(evidenceDir, `${eid}.md`);
    if (!fs.existsSync(f)) {
      throw new Error(`Error: ${f} not found`);
    }
  }

  const modifiedEvidence: Array<{ path: string; id: string; oldContent: string; newContent: string }> = [];
  for (const eid of ids) {
    const f = path.join(evidenceDir, `${eid}.md`);
    const content = fs.readFileSync(f, "utf-8");
    const updated = markSuperseded(content, findingId);
    modifiedEvidence.push({
      path: f,
      id: eid,
      oldContent: content,
      newContent: updated,
    });
  }

  const reportDir = path.join(caseRoot, "report");
  const reportFile = path.join(reportDir, "report.md");
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const block = buildFindingBlock({
    findingId,
    title,
    severity,
    status,
    confidence,
    location,
    evidenceIds: ids,
    description,
    consolidatedAt: ts,
  });

  const existingReport = fs.existsSync(reportFile) ? fs.readFileSync(reportFile, "utf-8") : null;
  const newReportContent = updateReportContent(existingReport, block);

  if (isWrite) {
    // Write evidence files
    for (const item of modifiedEvidence) {
      fs.writeFileSync(item.path, item.newContent, "utf-8");
    }

    // Ensure report directory exists and write report
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(reportFile, newReportContent, "utf-8");
  }

  const messages = [
    ...ids.map((eid) => `Marked ${eid} as superseded`),
    `Successfully consolidated ${ids.length} evidence items into ${findingId}`,
  ];

  return {
    success: true,
    finding_id: findingId,
    consolidated_count: ids.length,
    evidence_ids: ids,
    report_path: path.relative(caseRoot, reportFile),
    modified_files: [
      ...modifiedEvidence.map((m) => path.relative(caseRoot, m.path)),
      path.relative(caseRoot, reportFile),
    ],
    finding_block: block,
    write: isWrite,
    messages,
  };
}

export const executeConsolidateEvidence = consolidateEvidence;
