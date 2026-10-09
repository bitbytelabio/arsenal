/**
 * CSV Exporter with Formula Injection Defense (CWE-1236)
 * Implements contracts/evidence-reporting.md §4.3 & T050
 * Neutralizes formula triggers (=, +, -, @, \t, \r) in spreadsheet exports.
 */

import type { Finding } from "./findings.ts";

const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

export function sanitizeCsvCell(cell: string): string {
  let val = cell;
  // If first character is a formula trigger, prepend single quote
  if (val.length > 0 && FORMULA_TRIGGERS.includes(val.charAt(0))) {
    val = `'${val}`;
  }

  // Escape double quotes
  if (val.includes('"') || val.includes(",") || val.includes("\n") || val.includes("\r")) {
    val = `"${val.replace(/"/g, '""')}"`;
  }

  return val;
}

export function exportFindingsToCsv(findings: Finding[]): string {
  const headers = [
    "Finding ID",
    "Title",
    "Severity",
    "Status",
    "Target",
    "CWE / Rule",
    "Evidence IDs",
    "Description",
  ];

  const lines = [headers.map(sanitizeCsvCell).join(",")];

  for (const f of findings) {
    const row = [
      f.finding_id,
      f.title,
      f.severity,
      f.validation_status,
      f.affected_target,
      f.cwe_id ?? f.rule_id ?? "",
      f.evidence_ids.join("; "),
      f.description,
    ];
    lines.push(row.map(sanitizeCsvCell).join(","));
  }

  return lines.join("\n") + "\n";
}
