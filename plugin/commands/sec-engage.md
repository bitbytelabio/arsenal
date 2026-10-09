# /sec-engage: Phased Security Assessment Orchestrator

Initiate and coordinate a structured, multi-phase offensive security evaluation under the direction of the Master Security Orchestrator.

---

## Usage

```text
/sec-engage --target <target> [--mode <comprehensive|webapp|mobile|red|re>] [--phase <recon|exploit|verify|report>]
```

## Description
This command orchestrates an end-to-end security assessment across five disciplined phases. It mobilizes the `master` orchestrator agent to plan, delegate technical execution to domain specialists (`sec-re`, `sec-webapp`, `sec-mobile`, `sec-red`), enforce independent verification via `sec-verifier`, and compile evidence-backed deliverables.

---

## Execution Phases

### Phase 1: Scoping & Authorization Check
1. The `master` agent inspects `.omp/arsenal/scope.json`.
2. If scope is missing or the target is not listed in `in_scope`:
   - Initiate interactive scope confirmation: prompt the operator to confirm whether to add the target, proceed conditionally, or abort.
3. Establish assessment parameters: mode, turn budget, and safety constraints (`safeMode: true`).

### Phase 2: Surface Reconnaissance
1. Invoke `/sec-recon --target <target>`.
2. Map attack surfaces, open ports, web endpoints, API schemas, and technology stacks.
3. Record raw evidence outputs to `evidence/ledger.jsonl`.
4. Group identified endpoints into logical clusters for targeted specialist review.

### Phase 3: Vulnerability Assessment & Exploitation
1. The `master` agent assigns technical task slices to domain specialists:
   - Web application / API targets → `sec-webapp`
   - Mobile application packages (APK/IPA) → `sec-mobile` (invoking `apk_inspect`)
   - Compiled binaries, firmware, or protocols → `sec-re`
   - Network penetration, Active Directory, cloud services → `sec-red`
2. Specialists execute tests adhering strictly to inlined OpSec rules and Epistemic constraints (`E-*` vs `P-*`).
3. Specialists return structured JSON handoffs conforming to `contracts/handoff.json`.
4. If a handoff violates schema, `master` prompts the specialist once with error details to self-correct before logging failure.

### Phase 4: Independent Verification Gate
1. Every candidate finding at severity `low` or above is routed to `sec-verifier` via `/sec-verify`.
2. `sec-verifier` independently replicates the issue using deterministic verification oracles (`verify_oracle`).
3. Findings confirmed as `validated` are eligible for executive conclusion reporting.
4. Refuted, partial, or unverified findings are cataloged in the audit trail.

### Phase 5: Case Review & Reporting
1. Execute `/sec-review` to assert evidence continuity across all 37 validation codes.
2. Invoke `/sec-report` to generate deliverable reports (Markdown, JSON, SARIF).
3. Present executive findings summary to the operator.
