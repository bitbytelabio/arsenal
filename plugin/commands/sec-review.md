# /sec-review: Engagement Case File Integrity Auditor

Audit active assessment case files for evidence continuity, orphaned receipts, and cryptographic consistency across all 37 validation codes.

---

## Usage

```text
/sec-review [--strict] [--verify-hashes] [--fix]
```

## Description
Executes the native `case_review` verification engine against the current engagement case directory. Asserts that the assessment is ready for final reporting by verifying that all findings are backed by evidence receipts, no broken cryptographic hash chains exist, and scope constraints were strictly maintained.

## Workflow

1. **Case Directory Discovery**:
   - Locate active case root (e.g., `work/<case>`, `.omp/arsenal/`, or repository root).
   - Assert presence of required case files (`timeline.md`, `workitems.md`, `scope.json`).

2. **Validation Engine Execution**:
   - Run audit across all 37 canonical validation codes:
     - Evidence continuity: every finding links to valid ledger entries (`E-001`...); no orphaned receipts.
     - Hash chain verification: every entry's `prev_hash` matches the SHA-256 of the prior record.
     - Scope compliance: no actions executed outside declared in-scope targets.
     - Role parity: actions attributed to legitimate specialist roles.

3. **Reporting & Remediation**:
   - Return structured audit table showing test status per validation category.
   - If `--fix` is passed, automatically repair minor formatting inconsistencies or re-index unlinked non-critical records.
