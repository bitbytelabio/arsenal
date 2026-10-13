# Timeline + WorkItem / Coverage

> Replayable engagement logs (Z3r0 timeline philosophy) + Coverage tracking (WorkItem philosophy).  
> All files reside in **`work/<case>/`** (repository gitignore), and are not committed to skill package bodies.

## Directory Conventions

```text
work/<case>/
  scope.md           # Contract (ops/scope-contract.md)
  timeline.md        # Append-only; modifying historical entries is prohibited
  workitems.md       # Work items and coverage
  evidence/          # Raw artifacts (screenshots, pcap, logs)
  notes/
  report/            # Final report draft or copy
```

Initialization: run case-init via Arsenal CLI:

```powershell
arsenal scripts case-init -Hint "full pentest" -CaseName "acme-2026"
```

## timeline.md Format

Every entry is **append-only**:

```markdown
## {ISO-8601} | {role} | {phase}
- action:
- command_or_ref:
- result_summary:
- artifacts: []      # relative paths under this case
- evidence_ids: []   # E-xxx when promoted
- decision_delta: [] # only decisions changed since the previous transition
- carry_forward_refs: [scope.md] # unchanged authoritative state is referenced, not re-serialized
- next:
```

You **MUST NOT** delete or overwrite existing `##` time blocks (corrections use a new entry + `corrects: {timestamp}`).

### Decision delta boundary

`scope.md`, `workitems.md`, and existing Evidence constitute the current authoritative state. `timeline.md` records transitions without duplicating full snapshots.

- Every real stage/turn transition **MUST** write a `decision_delta`; list only decisions that genuinely changed from the previous state to the current state and affect subsequent actions. Write `[]` when there are no changes.
- Unchanged routes, auth, scope, network profiles, tool capabilities, and existing hypotheses/Evidence **MUST NOT** be re-expanded for handoffs; reference authoritative files or entries in `carry_forward_refs`.
- A consumer **MUST** first parse `carry_forward_refs`, and then apply `decision_delta` over the working context; never treat the delta as a complete state.
- A genuine decision boundary exists only when there are two or more materially different, evidence-supported branches where user choice alters the next action; deterministic transitions proceed directly without restating context solely to generate option menus.

Representative transition: For `Triage -> Static`, if auth/scope/route remain unchanged, record only `decision_delta: [phase=triage->static]`, and inherit remaining state via `carry_forward_refs: [scope.md, evidence/E-triage]`.

## workitems.md Template

```markdown
# Work Items

| ID | title | role | targets | surface | status | evidence | notes |
|----|-------|------|---------|---------|--------|----------|-------|
| WI-001 | Port scan edge | cie | {ip} | network | done | E-001 | |
| WI-002 | Auth bypass check | cpe | /api/login | web | blocked | | need creds |

status: pending | in_progress | blocked | done | cancelled

## Coverage
- [ ] Recon complete for in_scope assets
- [ ] Critical/High candidates triaged
- [ ] Validated findings have Evidence
- [ ] Path documented (attack/call/solve)
- [ ] Timeline continuous (no silent gaps >1 major phase)
- [ ] Report exported via docs-generator
- [ ] field-journal written (anonymized)
```

## attack-chain / pentest Hooks

| Skill | MUST |
|-------|------|
| `attack-chain/` | Create a case directory for multi-phase tasks; update workitems + timeline at the end of each phase |
| `pentest-tools/` | Append at least 1 timeline entry after each batch tool execution; findings → Evidence drafts |
| Other RE skills | Timeline recommended; at minimum, complete the Evidence chain before generating reports |

## Features

- Agent-friendly plain text; diff/review friendly  
- Cross-referenceable with tool-index command paths  
- Does not rely on WebSocket live streaming; paste the timeline directly into reports when needed