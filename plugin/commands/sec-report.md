# /sec-report: Generate Validated Assessment Report

Generate the engagement executive summary, SARIF audit file, and evidence report.

## Invariant Rules
1. Only findings with status \`validated\` appear in the Executive Summary as confirmed vulnerabilities.
2. Unvalidated, partial, rejected, and error findings are segregated into the "Investigation Audit & Incomplete Research" section.
3. Every finding links to an immutable evidence receipt in \`evidence/ledger.jsonl\`.
4. Outputs are derived from the fixed ledger head hash.
