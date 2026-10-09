# /sec-report: Deliverable Report Compiler

Compile verified assessment findings and evidence receipts into executive reports, technical appendices, and SARIF audit artifacts.

---

## Usage

```text
/sec-report [--min-severity <info|low|medium|high|critical>] [--format <markdown|json|sarif>] [--output <path>]
```

## Description
This command synthesizes engagement observations into formal deliverables. It adheres strictly to the Epistemic Reporting Discipline: only findings independently validated by `sec-verifier` appear as confirmed vulnerabilities in executive conclusions.

---

## Defaults & Behavior
- **Default Output Destination**: If `--output` is not specified, the report is saved to `.omp/arsenal/reports/report-<timestamp>.md`.
- **Terminal Summary**: When invoked without flags, it compiles the Markdown deliverable file and streams an executive summary directly to standard output.
- **Default Severity Filter**: `low` (excludes informational noise unless explicitly requested).
- **Default Format**: `markdown` (supports `json` and `sarif`).

---

## Report Structure

1. **Executive Summary**:
   - Assessment metadata (Engagement ID, Target, Date, Ledger Head Hash).
   - Confirmed Vulnerability Matrix: strictly `validated` findings, sorted by severity (Critical → High → Medium → Low).
   - Executive risk posture and remediation prioritization.

2. **Technical Finding Details**:
   - Each finding includes: Title, Severity, CWE, Affected Target / Location, Detailed Description, Remediation Steps.
   - Verifiable Cryptographic Link: Every finding displays linked SHA-256 evidence ledger receipt hashes (`E-001`...).

3. **Investigation Audit & Incomplete Research**:
   - Transparently catalogs unvalidated hypotheses, refuted claims, and unresolved variables (`unk-*`).
   - Ensures clients have full visibility into tested areas where vulnerabilities were not present.

4. **Cryptographic Ledger Appendix**:
   - Evidence ledger sequence range, head hash, and receipt audit log confirming unbroken chain of custody.
