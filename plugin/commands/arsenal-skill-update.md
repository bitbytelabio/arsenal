---
description: Update, refine, or author specialized security skill playbooks in Arsenal with automatic build and validation gates.
handoffs:
  - label: Verify Skill Standard
    agent: master
    prompt: Run arsenal skills check and report verification results
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Fixed Execution Workflow

Follow this seven-step order strictly per `contracts/skill-lifecycle.md` §2:

### Step 1: Resolve Target
1. Search the catalog index (`plugin/catalog/skills.index.jsonl`) or run `arsenal skills route --hint "<query>"` to locate the candidate skill.
2. If ambiguous, present the candidate set to the operator; do not guess.
3. If target skill does not exist and authoring is requested, prepare for `arsenal skills new`.

### Step 2: Draft
1. Formulate the proposed `SKILL.md` update or new content.
2. Enforce `contracts/skill-standard.md` in full:
   - Identifier matches `^(re|webapp|mobile|red)-[a-z0-9]+(-[a-z0-9]+)*$` (<= 64 chars)
   - Zero forbidden vendor tokens (`anthropic`, `xalgorix`, `claudered`, `claude-red`, `revskill`, `reverse-skill`, `strix`)
   - Description is a complete single-line scalar of 40–300 characters ending with terminal punctuation
   - Professional English-only prose and action directives
   - Resolvable CLI commands, documented prerequisites, and evidence capture through `arsenal exec`

### Step 3: Present Diff
1. Display the prospective change set or preview against the canonical tier file (`src/corpus/<id>/SKILL.md` or `presets/skills/<id>/SKILL.md`).
2. Do not write to disk yet.

### Step 4: Apply
1. Apply the update using the CLI command:
   ```bash
   arsenal skills update --target <id> --from <candidate-file> --write
   ```
   Or for a new skill:
   ```bash
   arsenal skills new --domain <domain> --slug <slug> --from <candidate-file> --write
   ```

### Step 5: Rebuild Generated Distribution
1. Materialize `plugin/` distribution and catalog:
   ```bash
   arsenal build --write --force
   ```

### Step 6: Reconcile Manifest
1. Ensure the manifest entry in `src/corpus/MANIFEST.json` reflects updated `sha256`, `bytes`, and source metadata (`arsenal-local` for newly authored skills).

### Step 7: Mandatory Verification Gate
1. Execute all three quality gates:
   ```bash
   arsenal skills check
   arsenal skills scripts-audit
   arsenal skills check --language
   ```
2. Report the gate result to the operator. If any gate fails, report the failure with named diagnostics and do not claim success.
