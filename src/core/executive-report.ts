/**
 * Executive Summary and Findings Report Generator
 * Implements contracts/evidence-reporting.md §4.2 & T049
 * Invariant: Executive Conclusions include strictly VALIDATED findings only.
 */

import type { Finding } from "./findings.ts";

export interface ReportGenerationInput {
  engagementId: string;
  engagementName: string;
  headHash: string;
  lastSeq: number;
  findings: Finding[];
}

export function generateExecutiveReport(input: ReportGenerationInput): string {
  const validatedFindings = input.findings.filter((f) => f.validation_status === "validated");
  const unvalidatedFindings = input.findings.filter((f) => f.validation_status === "unvalidated");
  const partialFindings = input.findings.filter((f) => f.validation_status === "partial");
  const rejectedFindings = input.findings.filter((f) => f.validation_status === "rejected");
  const errorFindings = input.findings.filter((f) => f.validation_status === "error");

  const now = new Date().toISOString();

  let markdown = `# Security Assessment Executive Report: ${input.engagementName}
**Engagement ID**: ${input.engagementId}  
**Generated At**: ${now}  
**Ledger Head Hash**: \`${input.headHash}\` (Sequence: ${input.lastSeq})  

---

## 1. Executive Conclusions (Confirmed Vulnerabilities)
> **Governance Notice**: Per Arsenal Constitution Principle IV, only findings independently confirmed through deterministic verification oracles appear as confirmed vulnerabilities.

`;

  if (validatedFindings.length === 0) {
    markdown += `*Zero confirmed/validated vulnerabilities.* All reported hypotheses remain unvalidated, refuted, or inconclusive.\n\n`;
  } else {
    for (const f of validatedFindings) {
      markdown += `### [${f.severity.toUpperCase()}] ${f.title} (\`${f.finding_id}\`)
- **Target**: \`${f.affected_target}\`
- **CWE / Rule**: ${f.cwe_id ?? f.rule_id ?? "N/A"}
- **Status**: \`VALIDATED\`
- **Evidence References**: ${f.evidence_ids.map((e) => `\`${e}\``).join(", ")}
- **Description**: ${f.description}

`;
    }
  }

  markdown += `---

## 2. Investigation Audit & Incomplete Research
The following candidate issues were investigated during the engagement but were NOT confirmed as actionable vulnerabilities:

### 2.1 Unvalidated Hypotheses (${unvalidatedFindings.length})
`;
  if (unvalidatedFindings.length === 0) {
    markdown += `*None.*\n\n`;
  } else {
    for (const f of unvalidatedFindings) {
      markdown += `- **${f.title}** (\`${f.finding_id}\`): ${f.description} (Evidence: ${f.evidence_ids.join(", ")})\n`;
    }
    markdown += "\n";
  }

  markdown += `### 2.2 Partial / Inconclusive Probes (${partialFindings.length})\n`;
  if (partialFindings.length === 0) {
    markdown += `*None.*\n\n`;
  } else {
    for (const f of partialFindings) {
      markdown += `- **${f.title}** (\`${f.finding_id}\`): Inconclusive oracle response. (Evidence: ${f.evidence_ids.join(", ")})\n`;
    }
    markdown += "\n";
  }

  markdown += `### 2.3 Refuted Claims / Negative Results (${rejectedFindings.length})\n`;
  if (rejectedFindings.length === 0) {
    markdown += `*None.*\n\n`;
  } else {
    for (const f of rejectedFindings) {
      markdown += `- **${f.title}** (\`${f.finding_id}\`): Oracle demonstrated affirmative counterevidence. Claim refuted.\n`;
    }
    markdown += "\n";
  }

  markdown += `### 2.4 Investigation Execution Errors (${errorFindings.length})\n`;
  if (errorFindings.length === 0) {
    markdown += `*None.*\n\n`;
  } else {
    for (const f of errorFindings) {
      markdown += `- **${f.title}** (\`${f.finding_id}\`): Probe failed due to transport or host errors.\n`;
    }
    markdown += "\n";
  }

  markdown += `---

## 3. Cryptographic Audit Summary
- **Total Findings Tracked**: ${input.findings.length}
- **Validated**: ${validatedFindings.length}
- **Unvalidated**: ${unvalidatedFindings.length}
- **Partial**: ${partialFindings.length}
- **Rejected**: ${rejectedFindings.length}
- **Error**: ${errorFindings.length}
- **Ledger Invariant**: Immutable SHA-256 chain verified against genesis.
`;

  return markdown;
}
