# [Date] [Project Short Name]

## Scenario Classification
<!-- APK Reversing / JS Signature / Binary Analysis / Penetration Testing / CTF / Packet Capture / Other -->

## Target Overview
<!-- One-sentence summary of the analysis objective -->

## Scope Summary (Sanitized)
<!-- auth.basis / network_profile.mode / in_scope asset types (never write real domains or IPs) -->
- auth_basis:
- network_profile:
- asset_types: []

## Roles
<!-- lead / cie / cpe / cre / ... see skill://webapp-pentest-tools/support/ops/role-map.md -->
- lead_role: lead
- specialists: []

## Complete Execution Chain
<!-- End-to-end steps from receiving the target to final output, including dead ends and pivots -->

1. ...
2. ...
3. ...

## Evidence Chain Summary (Sanitized)
<!-- Up to 3 entries: E-id + command pattern + conclusion type; full evidence stays in the user case workspace -->
<!-- Fields align with skill://re-case-review/templates/review_case.py contract (see below) -->
| E-id | severity | status | source_type | Reusable Command Pattern | Linked Finding |
|------|----------|--------|-------------|--------------------------|----------------|
| E-001 | info | observed | command | `checksec --file=./pwn1` | F-001 |
| E-002 | high | validated | command | `python3 exploit.py REMOTE` | F-001 |

> **Contract Alignment (`skill://re-case-review/templates/review_case.py`)**: When a case produces a standalone evidence directory (`./evidence/E-xxx.md`), each evidence record must satisfy the `skill://re-case-review/templates/review_case.py` schema or `--strict` verification will FAIL:
>
> - Heading: `### E-xxx` (must match the evidence record filename, e.g., `E-001` -> `### E-001`)
> - `- severity:` in `critical` / `high` / `medium` / `low` / `info` / `n/a`
> - `- status:` in `observed` / `candidate` / `validated` / `false_positive` / `accepted_risk`
> - `- repro_command:` required (offline scenarios may note `offline` in `notes` for exemption)
> - `- content_hash:` sha256 or `n/a`; when sha256 is provided, pair with `- artifact_path:` (case-relative path)
> - `- linked_workitem:` optional; referenced `WI-xxx` must exist
>
> Self-check (resolve helper from `skill://re-case-review/templates/review_case.py` to local `./review_case.py` first):
> `python3 ./review_case.py <case_root> --verify-hashes --strict`

## Finding / Path Summary
- top_finding:
- path_type: attack | callflow | solve
- path_one_liner:

## Pitfalls & Troubleshooting

| Issue | Root Cause | Solution | Time Spent |
|-------|------------|----------|------------|
| ... | ... | ... | ... |

## Toolchain Notes
<!-- Which tools were used, what worked well, pitfalls, and version compatibility notes -->

## Key Code / Commands

```text
<!-- Paste key reusable commands, hook scripts, or decryption logic -->
```

## Suggested Package Improvements
<!-- Was routing accurate? Was bootstrap missing a capability? Should documentation or manifest entries be updated? -->

## Reusable Patterns / Script Snippets
<!-- Paste reusable Frida hooks, decryption routines, or bypass scripts produced during the engagement -->

## Evolution Actions
<!-- Actual updates performed after writing back this journal entry -->
- [ ] Updated routing matrix (`skill://re-reverse-engineering/support/routing.md`)
- [ ] Updated tool-index
- [ ] Updated `skill://re-reverse-engineering/support/scripts/bootstrap-manifest.json`
- [ ] Updated specialist skill documentation
- [ ] Added pitfalls record
- [ ] No package updates required

## Environment Information
<!-- Record key environment details -->
- OS:
- Tool versions:
- Target platform / version:

## Sanitization Requirements

> **This file may be synchronized to remote repositories and MUST be sanitized. Full specification: [`anonymization.md`](skill://re-reverse-engineering/support/field-journal/anonymization.md) (master placeholder table + leak detection patterns).**

- Target domain / IP: replace with `{target_domain}` / `{target_ip}` (see `skill://re-reverse-engineering/support/field-journal/anonymization.md`)
- Real URL paths: preserve structure, replace domain
- Tokens / Cookies / Passwords / JWTs / API keys: replace with `{token}` / `{password}` / `{api_key}`
- Usernames / Phone numbers / Emails: replace with `{username}` / `{phone}` / `{user_email}`
- Internal IPs / ports: retain only the first two octets (`10.0.x.x`)
- Vulnerability payloads: keep technical structure, replace target-specific identifiers (e.g., `?id={user_id}`)

Run the **Mandatory Field-Journal Pre-Commit Checklist** at the end of `skill://re-reverse-engineering/support/field-journal/anonymization.md` before committing.

## Index Synchronization (Final Step Before Commit)

After completing this journal entry, synchronize `skill://re-reverse-engineering/support/field-journal/_index.md`:

1. Add a row under the corresponding "By Scenario Classification" subsection (including date and keywords)
2. Append the filename under the matching technique in "High-Frequency Success Patterns (By Technique)"
3. Append the filename under the matching target entity in "Entity Inverted Index (By Target Signature)"
4. Update the total count and "Last Updated" date under "Statistics"
