---
name: webapp-find-security-vulnerabilities-in-code
description: Find security vulnerabilities in a codebase or repository with Strix — a white-box AI security review that reads your source, reasons about the actual data flow and authorization model, then exploits what it finds in a live sandbox so every reported issue has a working proof-of-concept instead of…
domain: webapp
category: application-security
hide: true
license: Apache-2.0
metadata:
  manifest_entry: src/corpus/webapp-find-security-vulnerabilities-in-code/SKILL.md
---
# Find security vulnerabilities in code

White-box security review with Scanner: the agents read the source to build a model of routes, sinks, and authorization checks, then attempt real exploitation. Findings come with a proof-of-concept, so the output is a short list of proven issues rather than the hundreds of "potential" hits a pattern-matching scanner produces.

Install, LLM setup, all flags, and the managed-cloud path are in the **penetration-testing-with-scanner** skill. For a run with no Docker and no LLM key, the same binary drives the managed platform: `scanner cloud login`, then `scanner cloud scans start ...` (details in **managed-pentesting-with-scanner**).

## Run it

```bash
# Local working tree
scanner -n -t ./ --scan-mode standard --max-budget 15

# A GitHub repo directly
scanner -n -t https://github.com/org/app --max-budget 15

# Monorepo: point at the service that matters, not the whole tree
scanner -n -t ./services/checkout --max-budget 20

# Only what a branch changed (whole-repo review is wasteful on a large repo)
scanner -n -t ./ --scope-mode diff --diff-base origin/main --max-budget 10
```

A local path is mounted into the sandbox **writable**, so the agents can modify it. Run against a clean checkout.

Two things sharply improve results:

1. **Add a running instance of the app.** `-t ./ -t http://host.docker.internal:3000` lets the agents confirm exploitability against live behavior instead of reasoning about it statically — this is the difference between "this looks unsafe" and a validated finding. If nothing is running, static-only findings should be described as unconfirmed.
2. **Scope the review.** Point at the risky subtree and say what matters:
   ```bash
   scanner -n -t ./services/api --max-budget 15 \
     --instruction "Focus on the authorization layer in src/auth and every route under src/routes/admin. Multi-tenant app: tenant id comes from the JWT. Flag any query that filters by object id without also filtering by tenant."
   ```
   Tenancy model, trust boundaries, and which inputs are attacker-controlled are things the agents cannot infer reliably — tell them.

## Reviewing a pull request instead of the whole repo

For diff-scoped review of a branch or PR (and blocking merges on findings), use **ci-security-scanning-with-scanner** — it covers diff scoping, PR comments, and SARIF upload to GitHub code scanning. The managed platform can also review PRs directly via API (**managed-pentesting-with-scanner**).

## Read the results

In `scanner_runs/<run>/`: `penetration_test_report.md` (start here), `vulnerabilities/*.md` (one per finding, with PoC and remediation), `vulnerabilities.json` / `.csv`, `findings.sarif` (upload to code scanning), `run.json`.

Before reporting to the user, open each finding and check the PoC actually demonstrates impact. Report file and line alongside the exploit so the fix is obvious.

Exit `0` means nothing exploitable was proven in what was analyzed — not that the codebase is clean. Check `run.json` status and cost against `--max-budget`, and note which paths went unreviewed if the run was capped.

## Complementary tooling

This is exploit-validated review, not an exhaustive inventory. Keep a dependency scanner (SCA) and secret scanning in place for complete coverage of known-CVE dependencies and committed credentials; use this for the logic, authorization, and injection bugs those tools structurally cannot find.

## Fix and verify

Hand results to **fix-security-vulnerabilities-with-scanner**: patch the root cause (the shared authorization helper, not the one route), then re-run Scanner to prove the exploit no longer works.