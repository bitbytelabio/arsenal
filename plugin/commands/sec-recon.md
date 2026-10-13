# /sec-recon: Automated Attack Surface Reconnaissance

Coordinate non-destructive surface mapping and service discovery against authorized in-scope assets.

---

## Usage

```text
/sec-recon [--target <domain|ip>] [--depth <quick|deep>]
```

## Description
Executes an initial reconnaissance sweep to identify DNS records, subdomains, open ports, exposed web endpoints, TLS configurations, and framework fingerprints.

## Pre-Execution Scope Gate
Before initiating any network probes, the command validates target authorization:
1. If `.omp/arsenal/scope.json` is missing or the target is not listed in `in_scope`:
   - Prompt operator: `"Target is not registered in active scope. Add target to scope, proceed conditionally, or abort? [add/proceed/abort]"`.
   - If operator chooses `add`: update `.omp/arsenal/scope.json` and proceed.
   - If operator chooses `abort`: exit immediately without sending network traffic.

## Workflow

1. **Target Validation**:
   - Attribute target against active engagement scope boundaries.
   - Assert read-only / non-destructive testing constraints.

2. **Reconnaissance Dispatch**:
   - For web targets: Dispatch `sec-webapp` to perform authorized subdomain, HTTP header, TLS, and technology probes through `arsenal exec -- <program> <args...>`.
   - For network / infrastructure targets: Dispatch `sec-red` to probe authorized ports and services.

3. **Evidence Recording**:
   - Execute commands through `arsenal exec -- <program> <args...>` so Python persists raw outputs and appends evidence receipts.
   - Outputs are bounded ($\le 4096$ bytes) and committed to `evidence/ledger.jsonl`.

4. **Surface Synthesis**:
   - Return structured target asset inventory and cluster endpoints for subsequent specialist analysis.
