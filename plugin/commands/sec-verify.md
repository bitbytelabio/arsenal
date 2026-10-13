# /sec-verify: Independent Oracle Verification Dispatch

Dispatch the independent `sec-verifier` specialist to validate or refute a candidate security finding using deterministic mathematical and logical oracles.

---

## Usage

```text
/sec-verify --finding <finding-id> [--oracle <oracle-type>] [--evidence <receipt-id>]
```

## Description
Under Arsenal Constitution Principle IV (Independent Verification), no specialist may self-certify its own findings. This command mobilizes `sec-verifier` to evaluate candidate vulnerabilities against falsifiable conditions before any finding is promoted to an executive deliverable.

## Workflow

1. **Finding & Evidence Ingestion**:
   - Load finding record from `.omp/arsenal/findings.jsonl` (or active case files).
   - Retrieve referenced evidence receipts from `evidence/ledger.jsonl`.

2. **Verification Hypothesis Formulation**:
   - Define explicit pass/fail conditions for deterministic replay.
   - Select appropriate oracle:
     - `timing_differential`: Statistical analysis of response latency differences to confirm blind injection or side channels.
     - `authz_matrix`: Automated privilege cross-check across user roles to confirm broken access control / IDOR.
     - `path_traversal`: Proof of filesystem boundary escape with deterministic artifact retrieval.

3. **Oracle Execution**:
   - Execute `arsenal oracle verify --file <request.json> --json` within the isolated 8-turn verification budget.
   - Record verification transcript and raw output receipts to ledger.

4. **Verdict Classification**:
   - Classify outcome into the canonical 5-status taxonomy:
     - `validated`: Finding reproduced deterministically; promotes to confirmed vulnerability.
     - `unvalidated`: Insufficient evidence or unreproducible; remains hypothesis.
     - `rejected`: Proven false positive or defensive control confirmed effective.
     - `partial`: Vulnerability present but mitigated or with reduced impact.
     - `error`: Verification failed due to environmental or connectivity issues.
   - Update finding record and output verification receipt.
