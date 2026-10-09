# /sec-engage: Initialize Security Assessment Engagement

Engage the Arsenal security assessment harness.

## Workflow Instructions
1. Explicitly select the \`master\` role (@lead) as the orchestrator.
2. The \`master\` agent inspects \`.omp/scope.json\` and \`.omp/charter.md\` to understand authorized scope.
3. The \`master\` agent decomposes the assessment objective and dispatches the appropriate domain specialist:
   - \`sec-re\` for reverse engineering, binary triage, and exploit analysis
   - \`sec-webapp\` for web applications, APIs, and client-side vulnerabilities
   - \`sec-mobile\` for Android APK and iOS IPA assessments
   - \`sec-red\` for network penetration and Active Directory testing
   - \`sec-verifier\` for independent replication and oracle testing
4. All specialist operations capture immutable cryptographic evidence receipts into \`evidence/ledger.jsonl\`.
