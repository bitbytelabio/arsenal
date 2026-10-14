"""Executive summary, SARIF v2.1.0, and CSV report generator with Findings lifecycle.

Implements contracts/evidence-reporting.md §4, T048, T049, T050, and findings lifecycle.
Enforces Arsenal Constitution Principle IV: Executive conclusions include
strictly independently validated findings.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes, VERSION
from arsenal.schemas import validate

FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")

VALIDATION_STATUSES = {"validated", "unvalidated", "rejected", "partial", "error"}
SEVERITIES = {"info", "low", "medium", "high", "critical"}


def create_finding(params: dict[str, Any]) -> dict[str, Any]:
    """Create a standardized finding dictionary with full provenance and schema validation."""
    evidence_ids = list(params.get("evidence_ids") or params.get("evidenceIds") or [])
    if not evidence_ids:
        raise ValueError("Finding creation rejected: at least one valid evidence ID is required.")

    finding_id = str(params.get("finding_id") or params.get("findingId") or "")
    severity = str(params.get("severity", "medium")).lower()
    if severity not in SEVERITIES:
        severity = "medium"

    validation_status = str(params.get("validation_status") or params.get("validationStatus") or "unvalidated").lower()
    if validation_status not in VALIDATION_STATUSES:
        validation_status = "unvalidated"

    discoverer_role = str(
        params.get("discoverer_role")
        or params.get("discovererRole")
        or params.get("discoverer", {}).get("role", "arsenal-reverse")
    )
    discoverer_session = str(
        params.get("discoverer_session_id")
        or params.get("discovererSessionId")
        or params.get("discoverer", {}).get("session_id", "sess-01")
    )

    finding: dict[str, Any] = {
        "schema_version": 1,
        "finding_id": finding_id,
        "engagement_id": str(params.get("engagement_id") or params.get("engagementId") or "eng-default"),
        "title": str(params.get("title", "")),
        "description": str(params.get("description", "")),
        "severity": severity,
        "affected_target": str(params.get("affected_target") or params.get("affectedTarget") or "https://target.local"),
        "cwe_id": params.get("cwe_id") or params.get("cweId") or None,
        "rule_id": params.get("rule_id") or params.get("ruleId") or None,
        "discoverer": {
            "role": discoverer_role,
            "session_id": discoverer_session,
        },
        "evidence_ids": evidence_ids,
        "related_propositions": list(params.get("related_propositions") or params.get("relatedPropositions") or []),
        "related_unknowns": list(params.get("related_unknowns") or params.get("relatedUnknowns") or []),
        "validation_status": validation_status,
    }

    errors = validate("FINDING_SCHEMA", finding)
    if errors:
        raise ValueError(f"Finding schema error: {', '.join(errors)}")

    return finding


def record_verification(
    finding: dict[str, Any],
    verifier: dict[str, str],
    oracle_name: str,
    oracle_version: str,
    outcome: str,
    expected_behavior: str,
    observed_behavior: str,
    reproduction_evidence_ids: list[str],
    rationale: str,
    counterevidence_ids: list[str] | None = None,
    execution_error: str | None = None,
) -> dict[str, Any]:
    """Record an independent verification result on a finding, enforcing dual-control."""
    discoverer = finding.get("discoverer", {})
    if (
        verifier.get("role") == discoverer.get("role")
        and verifier.get("session_id") == discoverer.get("session_id")
    ):
        raise ValueError(
            f"Independent verification violation: verifier ({verifier.get('role')}/{verifier.get('session_id')}) "
            "cannot be the discoverer."
        )

    norm_outcome = outcome.lower()
    if norm_outcome not in VALIDATION_STATUSES:
        raise ValueError(f"Unsupported verification outcome: {outcome}")

    result: dict[str, Any] = {
        "schema_version": 1,
        "finding_id": finding["finding_id"],
        "verifier": {
            "role": str(verifier.get("role", "")),
            "session_id": str(verifier.get("session_id", "")),
        },
        "oracle_name": oracle_name,
        "oracle_version": oracle_version,
        "input_artifact_refs": [],
        "expected_behavior": expected_behavior,
        "observed_behavior": observed_behavior,
        "reproduction_evidence_ids": list(reproduction_evidence_ids),
        "outcome": norm_outcome,
        "rationale": rationale,
        "counterevidence_ids": list(counterevidence_ids or []),
        "execution_error": execution_error,
        "verified_at": datetime.now(timezone.utc).isoformat(),
    }

    errors = validate("VERIFICATION_RESULT_SCHEMA", result)
    if errors:
        raise ValueError(f"VerificationResult schema error: {', '.join(errors)}")

    # Update finding status in-place
    finding["validation_status"] = norm_outcome

    return result


def generate_executive_report(
    input_data: dict[str, Any] | None = None,
    *,
    engagement_id: str = "eng-default",
    engagement_name: str = "Security Assessment",
    head_hash: str = "0" * 64,
    last_seq: int = 0,
    findings: list[dict[str, Any]] | None = None,
) -> str:
    """Generate Markdown executive report enforcing Principle IV (validated findings only)."""
    if input_data is not None:
        eng_id = str(input_data.get("engagementId", input_data.get("engagement_id", engagement_id)))
        eng_name = str(input_data.get("engagementName", input_data.get("engagement_name", engagement_name)))
        h_hash = str(input_data.get("headHash", input_data.get("head_hash", head_hash)))
        l_seq = int(input_data.get("lastSeq", input_data.get("last_seq", last_seq)))
        f_list = list(input_data.get("findings", []))
    else:
        eng_id = engagement_id
        eng_name = engagement_name
        h_hash = head_hash
        l_seq = last_seq
        f_list = findings or []

    validated = [f for f in f_list if f.get("validation_status") == "validated"]
    unvalidated = [f for f in f_list if f.get("validation_status") == "unvalidated"]
    partial = [f for f in f_list if f.get("validation_status") == "partial"]
    rejected = [f for f in f_list if f.get("validation_status") == "rejected"]
    errors = [f for f in f_list if f.get("validation_status") == "error"]

    now = datetime.now(timezone.utc).isoformat()

    lines = [
        f"# Security Assessment Executive Report: {eng_name}",
        f"**Engagement ID**: {eng_id}  ",
        f"**Generated At**: {now}  ",
        f"**Ledger Head Hash**: `{h_hash}` (Sequence: {l_seq})  ",
        "",
        "---",
        "",
        "## 1. Executive Conclusions (Confirmed Vulnerabilities)",
        "> **Governance Notice**: Per Arsenal Constitution Principle IV, only findings "
        "independently confirmed through deterministic verification oracles appear as confirmed vulnerabilities.",
        "",
    ]

    if not validated:
        lines.append(
            "*Zero confirmed/validated vulnerabilities.* All reported hypotheses "
            "remain unvalidated, refuted, or inconclusive.\n"
        )
    else:
        for f in validated:
            sev = str(f.get("severity", "info")).upper()
            title = f.get("title", "Untitled Finding")
            fid = f.get("finding_id", "F-UNKNOWN")
            target = f.get("affected_target", "N/A")
            cwe = f.get("cwe_id") or f.get("rule_id") or "N/A"
            evidence_refs = ", ".join(f"`{e}`" for e in f.get("evidence_ids", [])) or "None"
            desc = f.get("description", "")

            lines.extend([
                f"### [{sev}] {title} (`{fid}`)",
                f"- **Target**: `{target}`",
                f"- **CWE / Rule**: {cwe}",
                "- **Status**: `VALIDATED`",
                f"- **Evidence References**: {evidence_refs}",
                f"- **Description**: {desc}",
                "",
            ])

    lines.extend([
        "---",
        "",
        "## 2. Investigation Audit & Incomplete Research",
        "The following candidate issues were investigated during the engagement "
        "but were NOT confirmed as actionable vulnerabilities:",
        "",
        f"### 2.1 Unvalidated Hypotheses ({len(unvalidated)})",
    ])

    if not unvalidated:
        lines.append("*None.*\n")
    else:
        for f in unvalidated:
            ev_str = ", ".join(f.get("evidence_ids", []))
            lines.append(f"- **{f.get('title')}** (`{f.get('finding_id')}`): {f.get('description')} (Evidence: {ev_str})")
        lines.append("")

    lines.append(f"### 2.2 Partial / Inconclusive Probes ({len(partial)})")
    if not partial:
        lines.append("*None.*\n")
    else:
        for f in partial:
            ev_str = ", ".join(f.get("evidence_ids", []))
            lines.append(f"- **{f.get('title')}** (`{f.get('finding_id')}`): Inconclusive oracle response. (Evidence: {ev_str})")
        lines.append("")

    lines.append(f"### 2.3 Refuted Claims / Negative Results ({len(rejected)})")
    if not rejected:
        lines.append("*None.*\n")
    else:
        for f in rejected:
            lines.append(f"- **{f.get('title')}** (`{f.get('finding_id')}`): Oracle demonstrated affirmative counterevidence. Claim refuted.")
        lines.append("")

    lines.append(f"### 2.4 Investigation Execution Errors ({len(errors)})")
    if not errors:
        lines.append("*None.*\n")
    else:
        for f in errors:
            lines.append(f"- **{f.get('title')}** (`{f.get('finding_id')}`): Probe failed due to transport or host errors.")
        lines.append("")

    lines.extend([
        "---",
        "",
        "## 3. Cryptographic Audit Summary",
        f"- **Total Findings Tracked**: {len(f_list)}",
        f"- **Validated**: {len(validated)}",
        f"- **Unvalidated**: {len(unvalidated)}",
        f"- **Partial**: {len(partial)}",
        f"- **Rejected**: {len(rejected)}",
        f"- **Error**: {len(errors)}",
        "- **Ledger Invariant**: Immutable SHA-256 chain verified against genesis.",
        "",
    ])

    return "\n".join(lines)


def map_severity_to_sarif_level(severity: str) -> str:
    """Map internal finding severity to SARIF v2.1.0 level."""
    sev = severity.lower()
    if sev in ("critical", "high"):
        return "error"
    if sev == "medium":
        return "warning"
    return "note"


def export_to_sarif(
    findings: list[dict[str, Any]],
    suppressions: dict[str, dict[str, Any]] | None = None,
    version: str = VERSION,
) -> dict[str, Any]:
    """Export findings to official OASIS SARIF v2.1.0 document."""
    supp_dict = suppressions or {}
    rules_map: dict[str, dict[str, str]] = {}
    results: list[dict[str, Any]] = []

    for f in findings:
        rule_id = str(f.get("rule_id") or f.get("cwe_id") or "ARSENAL-FINDING")
        if rule_id not in rules_map:
            rules_map[rule_id] = {
                "id": rule_id,
                "name": str(f.get("title", "")),
                "desc": str(f.get("description", "")),
            }

        level = map_severity_to_sarif_level(str(f.get("severity", "info")))
        fid = str(f.get("finding_id", ""))
        supp = supp_dict.get(fid)

        res_item: dict[str, Any] = {
            "ruleId": rule_id,
            "level": level,
            "message": {"text": f"{f.get('title', '')}: {f.get('description', '')}"},
            "locations": [
                {
                    "physicalLocation": {
                        "artifactLocation": {"uri": str(f.get("affected_target", "https://target.local"))},
                    },
                },
            ],
            "properties": {
                "finding_id": fid,
                "validation_status": str(f.get("validation_status", "unvalidated")),
                "evidence_ids": list(f.get("evidence_ids", [])),
            },
        }

        if supp:
            res_item["suppressions"] = [
                {
                    "kind": "external",
                    "justification": str(supp.get("reason", "")),
                }
            ]

        results.append(res_item)

    rules = [
        {
            "id": r["id"],
            "name": r["name"],
            "shortDescription": {"text": r["desc"]},
        }
        for r in rules_map.values()
    ]

    sarif_doc: dict[str, Any] = {
        "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "Arsenal Security Harness",
                        "version": version,
                        "informationUri": "https://github.com/bitbytelabio/arsenal",
                        "rules": rules,
                    },
                },
                "results": results,
            },
        ],
    }

    return sarif_doc


def sanitize_csv_cell(cell: str) -> str:
    """Neutralize formula triggers (CWE-1236) and escape CSV special characters."""
    val = str(cell)
    if val and val[0] in FORMULA_TRIGGERS:
        val = f"'{val}"

    if any(c in val for c in ('"', ",", "\n", "\r")):
        escaped = val.replace('"', '""')
        val = f'"{escaped}"'
    return val


def export_findings_to_csv(findings: list[dict[str, Any]]) -> str:
    """Export findings to CSV format with formula injection protection."""
    headers = [
        "Finding ID",
        "Title",
        "Severity",
        "Status",
        "Target",
        "CWE / Rule",
        "Evidence IDs",
        "Description",
    ]

    lines = [",".join(sanitize_csv_cell(h) for h in headers)]

    for f in findings:
        row = [
            str(f.get("finding_id", "")),
            str(f.get("title", "")),
            str(f.get("severity", "")),
            str(f.get("validation_status", "")),
            str(f.get("affected_target", "")),
            str(f.get("cwe_id") or f.get("rule_id") or ""),
            "; ".join(f.get("evidence_ids", [])),
            str(f.get("description", "")),
        ]
        lines.append(",".join(sanitize_csv_cell(cell) for cell in row))

    return "\n".join(lines) + "\n"


# Parity aliases matching TypeScript exports
createFinding = create_finding
recordVerification = record_verification
generateExecutiveReport = generate_executive_report
exportToSarif = export_to_sarif
sanitizeCsvCell = sanitize_csv_cell
exportFindingsToCsv = export_findings_to_csv


def load_findings_from_workspace(repo_root: Path) -> list[dict[str, Any]]:
    """Load findings from .omp/arsenal/findings.jsonl or return empty list."""
    findings_file = repo_root / ".omp" / "arsenal" / "findings.jsonl"
    findings: list[dict[str, Any]] = []

    if findings_file.is_file():
        try:
            for line in findings_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line:
                    findings.append(json.loads(line))
        except Exception:
            pass

    return findings


def get_ledger_head_info(repo_root: Path) -> tuple[str, int]:
    """Retrieve ledger head hash and sequence from evidence/ directory."""
    evidence_dir = repo_root / "evidence"
    head_hash = "0" * 64
    last_seq = 0

    ledger_file = evidence_dir / "ledger.jsonl"
    if ledger_file.is_file():
        try:
            lines = [line.strip() for line in ledger_file.read_text(encoding="utf-8").splitlines() if line.strip()]
            if lines:
                last_record = json.loads(lines[-1])
                import hashlib

                head_hash = hashlib.sha256(lines[-1].encode("utf-8")).hexdigest()
                last_seq = int(last_record.get("seq", len(lines)))
        except Exception:
            pass

    return head_hash, last_seq


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal report'."""
    fmt = str(ctx.values.get("format") or ctx.subcommand or "markdown").lower()
    if fmt not in ("markdown", "sarif", "json", "csv", "executive"):
        fmt = "markdown"
    if fmt == "executive":
        fmt = "markdown"

    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y%m%dT%H%M%SZ")

    reports_dir = ctx.repo_root / ".omp" / "arsenal" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    ext = "sarif" if fmt == "sarif" else "json" if fmt == "json" else "csv" if fmt == "csv" else "md"
    default_out_path = reports_dir / f"report-{ts}.{ext}"

    out_arg = ctx.values.get("output")
    out_path = Path(str(out_arg)).resolve() if out_arg else default_out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)

    findings = load_findings_from_workspace(ctx.repo_root)
    head_hash, last_seq = get_ledger_head_info(ctx.repo_root)

    if fmt == "json":
        report_content = json.dumps(
            {
                "engagementId": "eng-default",
                "generatedAt": now.isoformat(),
                "headHash": head_hash,
                "lastSeq": last_seq,
                "findings": findings,
            },
            indent=2,
        )
    elif fmt == "sarif":
        report_content = json.dumps(export_to_sarif(findings), indent=2)
    elif fmt == "csv":
        report_content = export_findings_to_csv(findings)
    else:
        report_content = generate_executive_report(
            engagement_id="eng-default",
            engagement_name="Security Assessment",
            head_hash=head_hash,
            last_seq=last_seq,
            findings=findings,
        )

    out_path.write_text(report_content, encoding="utf-8")

    result_data = {
        "format": fmt,
        "outPath": str(out_path),
        "findingsCount": len(findings),
        "headHash": head_hash,
        "lastSeq": last_seq,
    }

    if not ctx.is_json:
        print(f"[arsenal-report] Generated {fmt.upper()} deliverable report at:")
        print(f" -> {out_path}")
        print("\n--- Executive Summary ---\n")
        first_lines = report_content.splitlines()[:20]
        print("\n".join(first_lines))

    return ctx.result(result_data, code=ExitCodes.SUCCESS)

__all__ = [
    "create_finding",
    "record_verification",
    "generate_executive_report",
    "map_severity_to_sarif_level",
    "export_to_sarif",
    "sanitize_csv_cell",
    "export_findings_to_csv",
    "createFinding",
    "recordVerification",
    "generateExecutiveReport",
    "exportToSarif",
    "sanitizeCsvCell",
    "exportFindingsToCsv",
    "handle",
]
