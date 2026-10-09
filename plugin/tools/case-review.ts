/**
 * case_review Registered Tool
 * Port of vendor/reverse-skill/scripts/review_case.py
 *
 * Upstream: zhaoxuya520/reverse-skill (cab634bd855fc287f6e420c1f36fd1a6b9245960)
 * License: MIT
 * Copyright (c) 2026 zhaoxuya520
 *
 * Case-consistency linting over E-/WI-/F-/P- identifiers, field values,
 * enum sets, and section structure per contracts/skill-standard.md §2.5.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256File } from "../../src/core/hash.ts";

export const EVIDENCE_ID = /\bE-[A-Za-z0-9][A-Za-z0-9_-]*\b/g;
export const WORKITEM_ID = /\bWI-[A-Za-z0-9][A-Za-z0-9_-]*\b/g;
export const FINDING_ID = /\bF-[A-Za-z0-9][A-Za-z0-9_-]*\b/g;
export const PATH_ID = /\bP-[A-Za-z0-9][A-Za-z0-9_-]*\b/g;

export const WORKITEM_ID_EXACT = /^WI-[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const FIELD_LINE = /^\s*-\s+([A-Za-z0-9_]+):\s*(.*)$/;
export const SECTION_HEADING = /^#{2,6}\s+(.+?)\s*$/;
export const EVIDENCE_HEADING = /^###\s+(E-[A-Za-z0-9][A-Za-z0-9_-]*)\b/m;
export const FINDING_HEADING = /^###\s+(F-[A-Za-z0-9][A-Za-z0-9_-]*)\b/m;
export const PATH_HEADING = /^###\s+(P-[A-Za-z0-9][A-Za-z0-9_-]*)\b/m;

export const SEVERITIES: Record<string, true> = {
  critical: true,
  high: true,
  medium: true,
  low: true,
  info: true,
  "n/a": true,
  "n/a_re": true,
};

export const EVIDENCE_STATUSES: Record<string, true> = {
  observed: true,
  candidate: true,
  validated: true,
  false_positive: true,
  accepted_risk: true,
  superseded: true,
};

export const WORKITEM_STATUSES: Record<string, true> = {
  pending: true,
  in_progress: true,
  blocked: true,
  done: true,
  completed: true,
  cancelled: true,
};

export const PATH_TYPES: Record<string, true> = {
  attack: true,
  callflow: true,
  solve: true,
};

export const NETWORK_MODES: Record<string, true> = {
  offline: true,
  lab_only: true,
  authorized_target_only: true,
  unrestricted_lab: true,
};

export interface ReviewIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  path: string;
}

export interface ScopeReviewResult {
  auth_status: string;
  network_mode: string;
  ready_for_act: string;
  assets: string[];
}

export interface CaseReviewSummary {
  errors: number;
  warnings: number;
  evidence: number;
  workitems: number;
  timeline_events: number;
  findings: number;
  paths: number;
}

export interface TraceabilityEntry {
  workitems: number;
  timeline: number;
  reports: number;
}

export interface CaseReviewReport {
  status: "PASS" | "WARN" | "FAIL";
  case_root: string;
  generated_at: string;
  scope?: ScopeReviewResult;
  summary: CaseReviewSummary;
  issues: ReviewIssue[];
  traceability: Record<string, TraceabilityEntry>;
}

export interface CaseReviewInput {
  case_root: string;
  strict?: boolean;
  verify_hashes?: boolean;
  format?: "markdown" | "json";
}

export interface CaseReviewOutput extends CaseReviewReport {
  markdown: string;
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function readTextUtf8Sig(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1);
  }
  return content;
}


export function fieldValue(text: string, name: string): string {
  const lines = splitLines(text);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const match = FIELD_LINE.exec(line);
    if (!match || match[1] !== name) {
      continue;
    }
    const value = match[2]!.trim();
    if (value !== "|") {
      return value;
    }
    const block: string[] = [];
    for (let continuationIndex = index + 1; continuationIndex < lines.length; continuationIndex++) {
      const continuation = lines[continuationIndex]!;
      if (FIELD_LINE.test(continuation)) {
        break;
      }
      if (SECTION_HEADING.test(continuation)) {
        break;
      }
      if (continuation.trim()) {
        block.push(continuation.trim());
      }
    }
    return block.join("\n").trim();
  }
  return "";
}

export function sectionText(text: string, title: string): string {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^##\\s+${escapedTitle}\\s*$`, "m");
  const headingMatch = headingPattern.exec(text);
  if (!headingMatch) return "";

  let startIndex = headingMatch.index + headingMatch[0].length;
  if (text.startsWith("\r\n", startIndex)) {
    startIndex += 2;
  } else if (text.startsWith("\n", startIndex)) {
    startIndex += 1;
  }

  const nextHeadingPattern = /^##\s/m;
  const remaining = text.slice(startIndex);
  const nextMatch = nextHeadingPattern.exec(remaining);

  if (nextMatch) {
    return remaining.slice(0, nextMatch.index);
  }
  return remaining;
}

export function idsIn(value: string | undefined | null, pattern: RegExp): string[] {
  if (!value) return [];
  const matches = value.match(new RegExp(pattern.source, "g"));
  if (!matches) return [];
  return Array.from(new Set(matches)).sort();
}

function issue(
  issues: ReviewIssue[],
  level: "error" | "warning",
  code: string,
  message: string,
  filePath = ""
): void {
  issues.push({ level, code, message, path: filePath });
}

export function relativePath(root: string, targetPath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join("/");
  }
  return targetPath.split(path.sep).join("/");
}

export function splitTableRow(line: string): string[] {
  const stripped = line.trim();
  if (!stripped.startsWith("|") || !stripped.endsWith("|")) {
    return [];
  }
  return stripped
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

export function parseWorkitems(
  root: string,
  issues: ReviewIssue[]
): {
  records: Record<string, { status: string; evidence_ids: string[] }>;
  references: Array<[string, string]>;
} {
  const workitemsPath = path.join(root, "workitems.md");
  const records: Record<string, { status: string; evidence_ids: string[] }> = {};
  const references: Array<[string, string]> = [];

  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(workitemsPath);
  } catch {
    // missing
  }

  if (!stat || !stat.isFile()) {
    issue(issues, "error", "workitems.missing", "workitems.md is missing", "workitems.md");
    return { records, references };
  }

  const lines = splitLines(readTextUtf8Sig(workitemsPath));
  for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
    const line = lines[lineNumber - 1]!;
    const cells = splitTableRow(line);
    if (cells.length < 8 || !WORKITEM_ID_EXACT.test(cells[0]!)) {
      continue;
    }
    const workitemId = cells[0]!;
    const status = cells[5]!.toLowerCase();
    if (!WORKITEM_STATUSES[status]) {
      issue(
        issues,
        "error",
        "workitem.status",
        "unsupported work item status: " + status,
        "workitems.md:" + lineNumber
      );
    }
    const evidenceIds = idsIn(cells[6]!, EVIDENCE_ID);
    records[workitemId] = { status, evidence_ids: evidenceIds };
    for (const evidenceId of evidenceIds) {
      references.push([evidenceId, "workitems.md:" + lineNumber]);
    }
  }

  if (Object.keys(records).length === 0) {
    issue(issues, "warning", "workitems.empty", "no work item rows were found", "workitems.md");
  }

  return { records, references };
}

export function parseTimeline(
  root: string,
  issues: ReviewIssue[]
): {
  events: number;
  references: Array<[string, string]>;
} {
  const timelinePath = path.join(root, "timeline.md");
  const references: Array<[string, string]> = [];
  let events = 0;

  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(timelinePath);
  } catch {
    // missing
  }

  if (!stat || !stat.isFile()) {
    issue(issues, "error", "timeline.missing", "timeline.md is missing", "timeline.md");
    return { events, references };
  }

  const lines = splitLines(readTextUtf8Sig(timelinePath));
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.startsWith("## ") || !line.includes("|")) {
      continue;
    }
    events++;
    let end = lines.length;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex++) {
      if (lines[nextIndex]!.startsWith("## ")) {
        end = nextIndex;
        break;
      }
    }
    const body = lines.slice(index, end).join("\n");
    const evidenceIds = idsIn(fieldValue(body, "evidence_ids"), EVIDENCE_ID);
    for (const evidenceId of evidenceIds) {
      references.push([evidenceId, "timeline.md:" + (index + 1)]);
    }
  }

  if (events === 0) {
    issue(
      issues,
      "warning",
      "timeline.empty",
      "no append-only timeline events were found",
      "timeline.md"
    );
  }

  return { events, references };
}

export function parseScope(
  root: string,
  issues: ReviewIssue[],
  strict = false
): ScopeReviewResult {
  const scopePath = path.join(root, "scope.md");
  const result: ScopeReviewResult = {
    auth_status: "",
    network_mode: "",
    ready_for_act: "",
    assets: [],
  };

  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(scopePath);
  } catch {
    // missing
  }

  if (!stat || !stat.isFile()) {
    issue(issues, "error", "scope.missing", "scope.md is missing", "scope.md");
    return result;
  }

  const text = readTextUtf8Sig(scopePath);
  const auth = sectionText(text, "auth");
  const scopeSection = sectionText(text, "in_scope");
  const network = sectionText(text, "network_profile");
  const signoff = sectionText(text, "signoff");

  result.auth_status = fieldValue(auth, "status").toLowerCase();
  result.network_mode = fieldValue(network, "mode").toLowerCase();
  result.ready_for_act = fieldValue(signoff, "ready_for_act").toLowerCase();

  const assetsHeading = /^\s*-\s+assets:\s*(?:\r?\n|$)/m;
  const assetsMatch = assetsHeading.exec(scopeSection);
  if (assetsMatch) {
    const startIndex = assetsMatch.index + assetsMatch[0].length;
    const remaining = scopeSection.slice(startIndex);
    const nextTopField = /^-\s+[A-Za-z0-9_]+:/m;
    const nextMatch = nextTopField.exec(remaining);
    const body = nextMatch ? remaining.slice(0, nextMatch.index) : remaining;

    const lines = splitLines(body);
    for (const line of lines) {
      if (/^\s+-\s+\S+/.test(line)) {
        const stripped = line.trim();
        const assetValue = stripped.slice(2).trim();
        if (assetValue !== "[]") {
          result.assets.push(assetValue);
        }
      }
    }
  }

  if (!result.auth_status) {
    issue(issues, "error", "scope.auth_missing", "auth.status is missing", "scope.md");
  } else if (!["pending", "granted", "denied", "unknown"].includes(result.auth_status)) {
    issue(
      issues,
      "error",
      "scope.auth_invalid",
      "unsupported auth.status: " + result.auth_status,
      "scope.md"
    );
  }

  if (!result.network_mode) {
    issue(issues, "error", "scope.network_missing", "network_profile.mode is missing", "scope.md");
  } else if (!NETWORK_MODES[result.network_mode]) {
    issue(
      issues,
      "error",
      "scope.network_invalid",
      "unsupported network mode: " + result.network_mode,
      "scope.md"
    );
  }

  if (!result.ready_for_act) {
    issue(issues, "error", "scope.ready_missing", "signoff.ready_for_act is missing", "scope.md");
  } else if (!["true", "false"].includes(result.ready_for_act)) {
    issue(
      issues,
      "error",
      "scope.ready_invalid",
      "ready_for_act must be true or false",
      "scope.md"
    );
  }

  if (result.network_mode !== "offline" && result.assets.length === 0) {
    issue(
      issues,
      "error",
      "scope.assets_missing",
      "in_scope.assets is empty for a network case",
      "scope.md"
    );
  }

  if (result.auth_status !== "granted" || result.ready_for_act !== "true") {
    const message = "scope is not ready for target ACT";
    if (strict && result.network_mode !== "offline") {
      issue(issues, "error", "scope.not_ready", message, "scope.md");
    } else {
      issue(issues, "warning", "scope.not_ready", message, "scope.md");
    }
  }

  return result;
}

export function reportSections(
  text: string,
  headingPattern: RegExp
): Array<{ id: string; body: string }> {
  const globalPattern = new RegExp(headingPattern.source, "gm");
  const matches: Array<{ id: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = globalPattern.exec(text)) !== null) {
    matches.push({ id: m[1]!, start: m.index, end: m.index + m[0].length });
  }

  const sections: Array<{ id: string; body: string }> = [];
  const nextHeadingPattern = /^#{1,3}\s+/m;
  for (const match of matches) {
    const after = text.slice(match.end);
    const nextMatch = nextHeadingPattern.exec(after);
    const end = nextMatch ? match.end + nextMatch.index : text.length;
    sections.push({ id: match.id, body: text.slice(match.start, end) });
  }
  return sections;
}

function findFilesRecursive(dir: string, extension: string): string[] {
  const results: string[] = [];
  function walk(current: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results.sort();
}

export function parseReports(
  root: string,
  issues: ReviewIssue[]
): {
  findings: Array<{ id: string; status: string; evidence_ids: string[]; path: string }>;
  paths: Array<{ id: string; path_type: string; evidence_ids: string[]; path: string }>;
  references: Array<[string, string]>;
} {
  const findingRecords: Array<{ id: string; status: string; evidence_ids: string[]; path: string }> = [];
  const pathRecords: Array<{ id: string; path_type: string; evidence_ids: string[]; path: string }> = [];
  const references: Array<[string, string]> = [];

  const reportRoot = path.join(root, "report");
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(reportRoot);
  } catch {
    // missing
  }

  const reportFiles = stat && stat.isDirectory() ? findFilesRecursive(reportRoot, ".md") : [];
  if (reportFiles.length === 0) {
    issue(issues, "warning", "report.missing", "no Markdown report was found", "report");
    return { findings: findingRecords, paths: pathRecords, references };
  }

  for (const reportPath of reportFiles) {
    const text = readTextUtf8Sig(reportPath);
    const displayPath = relativePath(root, reportPath);

    for (const { id: findingId, body } of reportSections(text, FINDING_HEADING)) {
      const status = fieldValue(body, "status").toLowerCase();
      const confidence = fieldValue(body, "confidence").toLowerCase();
      const evidenceIds = idsIn(fieldValue(body, "evidence_ids"), EVIDENCE_ID);
      const required = ["severity", "evidence_ids", "confidence", "location", "status"];
      for (const field of required) {
        if (!fieldValue(body, field)) {
          issue(
            issues,
            "error",
            "finding.field_missing",
            findingId + " is missing " + field,
            displayPath
          );
        }
      }
      if (!["candidate", "validated", "false_positive", "accepted_risk", "superseded"].includes(status)) {
        issue(
          issues,
          "error",
          "finding.status",
          findingId + " has unsupported status",
          displayPath
        );
      }
      if (status === "validated" && confidence === "low") {
        issue(
          issues,
          "error",
          "finding.confidence",
          findingId + " is validated with low confidence",
          displayPath
        );
      }
      if (evidenceIds.length === 0) {
        issue(
          issues,
          "error",
          "finding.evidence_missing",
          findingId + " has no evidence_ids",
          displayPath
        );
      }
      for (const evidenceId of evidenceIds) {
        references.push([evidenceId, displayPath]);
      }
      findingRecords.push({ id: findingId, status, evidence_ids: evidenceIds, path: displayPath });
    }

    for (const { id: pathId, body } of reportSections(text, PATH_HEADING)) {
      const pathType = fieldValue(body, "path_type").toLowerCase();
      const evidenceIds = idsIn(body, EVIDENCE_ID);
      if (!PATH_TYPES[pathType]) {
        issue(
          issues,
          "error",
          "path.type",
          pathId + " has unsupported path_type",
          displayPath
        );
      }
      if (evidenceIds.length === 0) {
        issue(
          issues,
          "error",
          "path.evidence_missing",
          pathId + " has no evidence reference",
          displayPath
        );
      }
      for (const evidenceId of evidenceIds) {
        references.push([evidenceId, displayPath]);
      }
      pathRecords.push({ id: pathId, path_type: pathType, evidence_ids: evidenceIds, path: displayPath });
    }
  }

  return { findings: findingRecords, paths: pathRecords, references };
}

export function normalizeHash(value: string): string {
  let normalized = value.trim().toLowerCase();
  if (normalized.startsWith("sha256:")) {
    normalized = normalized.slice(7);
  }
  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }
  return "";
}


export function verifyArtifact(
  root: string,
  artifactPathStr: string,
  expectedHash: string,
  issues: ReviewIssue[],
  displayPath: string
): void {
  if (!artifactPathStr) {
    issue(
      issues,
      "warning",
      "artifact.path_missing",
      "content_hash is recorded without artifact_path",
      displayPath
    );
    return;
  }
  let candidate = artifactPathStr;
  if (!path.isAbsolute(candidate)) {
    candidate = path.join(root, candidate);
  }
  candidate = path.resolve(candidate);
  const rel = path.relative(path.resolve(root), candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    issue(
      issues,
      "warning",
      "artifact.outside_case",
      "artifact_path points outside the case root",
      displayPath
    );
    return;
  }
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(candidate);
  } catch {
    // missing
  }
  if (!stat || !stat.isFile()) {
    issue(issues, "error", "artifact.missing", "artifact_path does not exist", displayPath);
    return;
  }
  const digest = sha256File(candidate);
  if (digest !== expectedHash) {
    issue(
      issues,
      "error",
      "artifact.hash_mismatch",
      "artifact SHA-256 does not match content_hash",
      displayPath
    );
  }
}

export function parseEvidence(
  root: string,
  workitems: Record<string, unknown>,
  issues: ReviewIssue[],
  verifyHashes = false
): {
  records: Record<string, { severity: string; status: string; artifact_path: string }>;
  references: Array<[string, string]>;
} {
  const evidenceRoot = path.join(root, "evidence");
  const records: Record<string, { severity: string; status: string; artifact_path: string }> = {};
  const references: Array<[string, string]> = [];

  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(evidenceRoot);
  } catch {
    // missing
  }

  if (!stat || !stat.isDirectory()) {
    issue(issues, "error", "evidence.dir_missing", "evidence directory is missing", "evidence");
    return { records, references };
  }

  const evidenceFiles: string[] = [];
  try {
    const entries = fs.readdirSync(evidenceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith("E-") && entry.name.endsWith(".md") && entry.name !== "INDEX.md") {
        evidenceFiles.push(path.join(evidenceRoot, entry.name));
      }
    }
  } catch {
    // readdir error
  }
  evidenceFiles.sort();

  if (evidenceFiles.length === 0) {
    issue(issues, "warning", "evidence.empty", "no Evidence records were found", "evidence");
  }

  for (const evidencePath of evidenceFiles) {
    const evidenceId = path.parse(evidencePath).name;
    const text = readTextUtf8Sig(evidencePath);
    const displayPath = relativePath(root, evidencePath);

    const headingMatch = EVIDENCE_HEADING.exec(text);
    if (!headingMatch) {
      issue(
        issues,
        "error",
        "evidence.heading_missing",
        "Evidence record has no matching heading",
        displayPath
      );
    } else if (headingMatch[1] !== evidenceId) {
      issue(
        issues,
        "error",
        "evidence.heading_mismatch",
        "Evidence heading does not match its filename",
        displayPath
      );
    }

    const severity = fieldValue(text, "severity").toLowerCase();
    let status = fieldValue(text, "status").toLowerCase();
    if (status.startsWith("superseded by")) {
      status = "superseded";
    }
    const reproCommand = fieldValue(text, "repro_command");
    const notes = fieldValue(text, "notes").toLowerCase();
    const linkedWorkitems = idsIn(fieldValue(text, "linked_workitem"), WORKITEM_ID);
    const contentHashValue = fieldValue(text, "content_hash");
    const artifactPath = fieldValue(text, "artifact_path");

    if (!SEVERITIES[severity]) {
      issue(
        issues,
        "error",
        "evidence.severity",
        "unsupported severity: " + severity,
        displayPath
      );
    }
    if (!EVIDENCE_STATUSES[status]) {
      issue(
        issues,
        "error",
        "evidence.status",
        "unsupported status: " + status,
        displayPath
      );
    }

    const offlineNote = ["offline", "离线", "not applicable"].some((marker) => notes.includes(marker));
    if (!reproCommand || (["n/a", "n/a_re"].includes(reproCommand.toLowerCase()) && !offlineNote)) {
      issue(
        issues,
        "error",
        "evidence.repro_missing",
        "Evidence requires a reproducible command or documented offline limitation",
        displayPath
      );
    }

    const expectedHash = contentHashValue.toLowerCase() !== "n/a" ? normalizeHash(contentHashValue) : "";
    if (contentHashValue.toLowerCase() !== "n/a" && !expectedHash) {
      issue(
        issues,
        "error",
        "evidence.hash_invalid",
        "content_hash must be SHA-256",
        displayPath
      );
    }
    if (verifyHashes && expectedHash) {
      verifyArtifact(root, artifactPath, expectedHash, issues, displayPath);
    }
    for (const workitemId of linkedWorkitems) {
      if (!(workitemId in workitems)) {
        issue(
          issues,
          "error",
          "evidence.workitem_missing",
          "linked work item does not exist: " + workitemId,
          displayPath
        );
      }
    }
    records[evidenceId] = { severity, status, artifact_path: artifactPath };
  }

  return { records, references };
}

export function buildTraceability(
  evidenceIds: string[],
  references: Array<[string, string]>
): Record<string, TraceabilityEntry> {
  const sortedIds = Array.from(new Set(evidenceIds)).sort();
  const graph: Record<string, TraceabilityEntry> = {};
  for (const id of sortedIds) {
    graph[id] = { workitems: 0, timeline: 0, reports: 0 };
  }
  for (const [evidenceId, source] of references) {
    if (!graph[evidenceId]) {
      continue;
    }
    if (source.startsWith("workitems.md:")) {
      graph[evidenceId].workitems += 1;
    } else if (source.startsWith("timeline.md:")) {
      graph[evidenceId].timeline += 1;
    } else {
      graph[evidenceId].reports += 1;
    }
  }
  return graph;
}

export function reviewCase(
  caseRoot: string,
  options: { strict?: boolean; verify_hashes?: boolean } = {}
): CaseReviewReport {
  const strict = Boolean(options.strict);
  const verifyHashes = Boolean(options.verify_hashes);
  const resolvedRoot = path.resolve(caseRoot);
  const issues: ReviewIssue[] = [];

  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(resolvedRoot);
  } catch {
    // missing
  }

  if (!stat || !stat.isDirectory()) {
    issue(issues, "error", "case.missing", "case root does not exist", resolvedRoot);
    return {
      status: "FAIL",
      case_root: resolvedRoot,
      generated_at: new Date().toISOString(),
      summary: {
        errors: 1,
        warnings: 0,
        evidence: 0,
        workitems: 0,
        timeline_events: 0,
        findings: 0,
        paths: 0,
      },
      issues,
      traceability: {},
    };
  }

  const { records: workitems, references: workitemRefs } = parseWorkitems(resolvedRoot, issues);
  const { events: timelineEvents, references: timelineRefs } = parseTimeline(resolvedRoot, issues);
  const scope = parseScope(resolvedRoot, issues, strict);
  const { records: evidence, references: evidenceRefs } = parseEvidence(
    resolvedRoot,
    workitems,
    issues,
    verifyHashes
  );
  const { findings, paths, references: reportRefs } = parseReports(resolvedRoot, issues);
  const references = [...workitemRefs, ...timelineRefs, ...evidenceRefs, ...reportRefs];

  for (const [evidenceId, source] of references) {
    if (!(evidenceId in evidence)) {
      issue(
        issues,
        "error",
        "reference.unknown_evidence",
        "reference points to missing Evidence: " + evidenceId,
        source
      );
    }
  }

  const traceability = buildTraceability(Object.keys(evidence), references);
  for (const [evidenceId, links] of Object.entries(traceability)) {
    if (links.workitems === 0 && links.timeline === 0 && links.reports === 0) {
      issue(
        issues,
        "warning",
        "evidence.unlinked",
        "Evidence is not referenced by a work item, timeline, or report",
        "evidence/" + evidenceId + ".md"
      );
    }
  }

  const errors = issues.filter((item) => item.level === "error").length;
  const warnings = issues.filter((item) => item.level === "warning").length;
  const status: "PASS" | "WARN" | "FAIL" =
    errors > 0 || (strict && warnings > 0)
      ? "FAIL"
      : warnings > 0
        ? "WARN"
        : "PASS";

  return {
    status,
    case_root: resolvedRoot,
    generated_at: new Date().toISOString(),
    scope,
    summary: {
      errors,
      warnings,
      evidence: Object.keys(evidence).length,
      workitems: Object.keys(workitems).length,
      timeline_events: timelineEvents,
      findings: findings.length,
      paths: paths.length,
    },
    issues,
    traceability,
  };
}

export function renderMarkdown(report: CaseReviewReport): string {
  const summary = report.summary;
  const lines: string[] = [
    "# Case review",
    "",
    "- status: " + report.status,
    "- case_root: " + report.case_root,
    "- generated_at: " + report.generated_at,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|---|---:|",
  ];
  for (const key of ["errors", "warnings", "evidence", "workitems", "timeline_events", "findings", "paths"] as const) {
    lines.push("| " + key + " | " + String(summary[key]) + " |");
  }

  lines.push("", "## Checks", "", "| Level | Code | Location | Detail |", "|---|---|---|---|");
  if (report.issues.length > 0) {
    for (const item of report.issues) {
      const location = item.path.replace(/\|/g, "\\|");
      const detail = item.message.replace(/\|/g, "\\|");
      lines.push("| " + item.level + " | " + item.code + " | " + location + " | " + detail + " |");
    }
  } else {
    lines.push("| pass | none | n/a | No review issues found |");
  }

  lines.push("", "## Traceability", "", "| Evidence | Work items | Timeline | Reports |", "|---|---:|---:|---:|");
  const traceKeys = Object.keys(report.traceability);
  if (traceKeys.length > 0) {
    for (const evidenceId of traceKeys.sort()) {
      const links = report.traceability[evidenceId]!;
      lines.push(
        "| " + evidenceId + " | " + links.workitems + " | " + links.timeline + " | " + links.reports + " |"
      );
    }
  } else {
    lines.push("| n/a | 0 | 0 | 0 |");
  }
  return lines.join("\n") + "\n";
}

export async function caseReview(input: CaseReviewInput): Promise<CaseReviewOutput> {
  const report = reviewCase(input.case_root, {
    strict: input.strict,
    verify_hashes: input.verify_hashes,
  });
  const markdown = renderMarkdown(report);
  return {
    ...report,
    markdown,
  };
}

export const case_review = caseReview;
