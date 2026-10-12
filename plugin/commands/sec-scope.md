# /sec-scope: Engagement Scope Management

Manage, inspect, and enforce authorized security assessment boundaries in `.omp/arsenal/scope.json`.

---

## Usage

```text
/sec-scope [--target <url|ip|cidr|package>] [--exclude <url|ip|package>] [--show] [--auth <contact>] [--expire <iso-date>] [--safe-mode <true|false>]
```

## Description
This command manages engagement boundaries to prevent accidental or unauthorized testing against out-of-scope assets. All active reconnaissance, exploitation, and automated testing tools validate target assets against the active scope before transmitting traffic.

## Workflow

1. **Inspect Existing Scope**:
   - Check if `.omp/arsenal/scope.json` (or `.omp/scope.json`) exists.
   - If `--show` is provided or no mutation flags are passed, display the active scope boundaries, in-scope targets, excluded systems, rules of engagement, and authorization metadata.

2. **Add / Modify Target Boundaries**:
   - If `--target <value>` is provided:
     - Validate format (FQDN, IPv4/IPv6, CIDR notation, or mobile package identifier).
     - Append to the `in_scope` list if not already present.
   - If `--exclude <value>` is provided:
     - Append to the `out_of_scope` exclusion list.
   - If `--auth <contact>` is provided:
     - Record the authorizing client or ticket reference in `auth.reference`.
   - If `--safe-mode <boolean>` is provided:
     - Update safety flag (when `true`, destructive exploits are strictly blocked).

3. **Commit Scope Updates**:
   - Write updated configuration atomically to `.omp/arsenal/scope.json` with POSIX mode `0600`.
   - Output summary card confirming active scope boundaries and authorization status.

---

## Safety Policy
- Any attempt to target an asset listed in `out_of_scope` or unlisted in `in_scope` triggers a mandatory confirmation gate.
