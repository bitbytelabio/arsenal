# /sec-finding: Structured Vulnerability Logger

Record an identified vulnerability and bind it directly to verifiable cryptographic evidence receipts in the ledger.

---

## Usage

```text
/sec-finding --title <title> --severity <info|low|medium|high|critical> --location <endpoint|path> --cwe <cwe-id> --evidence <receipt-id,...> [--remediation <text>]
```

## Description
This command creates a standardized vulnerability finding record. Every finding must link to at least one valid SHA-256 evidence receipt recorded during tool execution.

## Workflow

1. **Parameter Validation**:
   - Assert all required fields are present: `title` (5–150 characters), `severity`, `location`, `cwe` (`CWE-xxx`), and `evidence` (receipt IDs).
   - Validate that each cited evidence receipt exists in `evidence/ledger.jsonl`.

2. **Epistemic Classification**:
   - Set initial epistemic status:
     - `E` (Empirical observation) if direct proof was captured in evidence.
     - `P` (Analytical inference) if inferred from configuration or secondary indicators.
   - Set initial validation status to `unvalidated` pending independent verification by `sec-verifier`.

3. **Persistence**:
   - Append structured JSON record to `.omp/arsenal/findings.jsonl`.
   - Output confirmation card displaying finding ID, severity badge, and linked evidence hashes.
