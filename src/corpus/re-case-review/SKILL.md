---
name: re-case-review
description: Reviews engagement cases for scope readiness, evidence completeness, and finding validity.
domain: re
category: binary-analysis
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-case-review/SKILL.md
---
# Evidence Graph Review

Use this skill when a reverse engineering, forensics, CTF, or authorized security case needs a defensible handoff. It audits the existing `work/<case>/` package without changing the case or touching a target.

## Scope

This skill covers:

- Scope metadata and target-activity readiness
- Evidence record structure and reproducibility fields
- References from work items and timeline entries to Evidence
- Structured Findings and Paths in report Markdown
- Optional SHA-256 verification for case-local artifacts
- A Markdown or JSON review result for a report handoff

It MUST NOT perform reconnaissance, exploitation, dynamic instrumentation, or target changes. Those actions belong to the routed analysis skill and require the case scope gate.

## ACTION REQUIRED

1. `NOW`: read `skill://re-case-review/support/field-journal/precedent-reverse.md` and confirm that this is a review of an existing authorized case package.
2. `NOW`: confirm the case path and choose read-only review mode.
3. `NEXT`: read `tool-index` (workstation tool inventory); this skill uses only Python 3 standard library and does not require bootstrap.
4. `NEXT`: run `arsenal case review --case-root <case-root> --format markdown`.
5. `ACT`: resolve every error, then rerun the review before claiming a handoff is complete.

## Tool dependencies

| Tool | Required | Purpose | Auto-bootstrap |
|------|----------|---------|---------------|
| Python 3.9+ | Yes | Runs the read-only case review script | No, use the platform Python installation |

No network access or third-party package is required.

## Workflow

### Phase 1: Intake

Run the review against the existing case directory:

```bash
python3 case review work/<case> --format markdown
```

Confirm that `scope.md`, `timeline.md`, `workitems.md`, and `evidence/` are present. A non-strict review reports scope warnings while a strict review treats warnings as handoff blockers.

## Recommended Next Steps (Select one)

1. Fix authorization, scope, or network_profile fields in scope.md
2. Continue checking reproducibility commands and provenance in Evidence records
3. Export current review results and attach to the interim report
4. Switch to JSON output to integrate with CI or other review tools
5. Pause and first confirm the review scope

### Phase 2: Traceability

Review the checks for:

- Evidence IDs that do not exist
- Findings without `evidence_ids`
- Paths without an allowed `path_type` or Evidence reference
- Work items and timeline entries pointing to unknown Evidence
- Unlinked Evidence records
- Validated Findings with low confidence

An offline observation may use `repro_command: n/a` only when its `notes` field explicitly documents the offline limitation.

Use JSON when another tool needs stable fields:

```bash
python3 case review work/<case> --format json
```

## Recommended Next Steps (Select one)

1. Supplement missing Evidence records and preserve raw commands
2. Bind candidate Findings to Evidence and rerun the review
3. Add P-ids and Path steps for call chains or attack paths
4. Generate a Markdown handoff summary
5. Switch back to PRIMARY skill to continue analysis

### Phase 3: Fixity verification

When an Evidence record contains both `content_hash` and `artifact_path`, verify the case-local artifact:

```bash
python3 case review work/<case> --verify-hashes --strict
```

The script accepts `sha256:<64 hex characters>` and checks that the artifact remains inside the case root. A hash mismatch is a hard failure.

The PowerShell Evidence helper can record a hash while appending a record:

```powershell
# Append evidence record via Arsenal CLI:
arsenal scripts append-evidence -CaseRoot work\<case> -Id E-001 -Title "Sample hash" -ReproCommand "sha256sum evidence/sample.bin" -ArtifactPath "evidence\sample.bin"
```

## Recommended Next Steps (Select one)

1. Resolve hash mismatch or replace contaminated working copies
2. Add SHA-256 and artifact_path for unpinned raw artifacts
3. Proceed to the Report Generation phase
4. Export JSON results for CI archiving
5. Pause and request human review

### Phase 4: Handoff

Use strict mode before a final report or specialist handoff:

```bash
arsenal case review work/<case> --strict --format markdown > work/<case>/report/case-review.md
```

The command is read-only with respect to the case unless shell redirection is explicitly used to save its output. The review is not legal advice and does not replace organizational evidence handling procedures.

## Recommended Next Steps (Select one)

1. Pass validated review results to `re-docs-generator/` to generate the formal report
2. Return to PRIMARY skill to gather new analysis evidence
3. Archive Markdown and JSON review results
4. Pause and request human review

## Language behavior contract

- Internal reasoning, tool selection, and phase control: English.
- User-visible messages, section labels, reports, and next-step menus: Chinese unless the user requests another language.
- Default bilingual labels place Chinese first and English second, separated by `/`.

## Bootstrap boundary

This skill has no third-party dependency. If Python 3 is unavailable, the only allowed recovery action is the repository bootstrap path when a Python capability is registered for the current platform. If no such capability is registered, stop and report the missing runtime. Do not guess executable paths, download packages, or perform a manual install from inside this skill.

## Routing context

**Upstream entry**: any reverse, forensics, CTF, or authorized security skill that has produced a case package.

**Downstream exit**: `re-docs-generator/` for a formal report, or the original PRIMARY skill when the graph is incomplete.

**Related modules**: `skill://re-case-review/support/ops/evidence-finding-path.md`, `skill://re-case-review/support/ops/timeline-workitem.md`, `re-digital-forensics/`, `re-reverse-engineering/`, and `re-docs-generator/`.

## References

- [NIST SP 800-86: Guide to Integrating Forensic Techniques into Incident Response](https://csrc.nist.gov/pubs/sp/800/86/final)
- [SWGDE Best Practices for Computer Forensic Acquisitions](https://www.swgde.org/documents/published-complete-listing/17-f-002-2-1/)
- [SWGDE Best Practices for Archiving Digital and Multimedia Evidence](https://www.swgde.org/documents/published-complete-listing/19-f-003-best-practices-for-archiving-digital-and-multimedia-evidence/)

## Task Completion Checklist

- [ ] Have I reviewed scope.md, timeline.md, workitems.md, and evidence/?
- [ ] Do all Findings reference existing Evidence?
- [ ] Do all Paths include a valid path_type and Evidence reference?
- [ ] Was hash verification executed, or was the reason for skipping documented?
- [ ] Was the review rerun in strict mode and the review result saved?
