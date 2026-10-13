"""GDPR Article 30 compliance tools.

Ports article30_parser.py, article30_validator.py, and generate_ropa_report.py
into centralized Python CLI commands.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from arsenal.common import Context, ExitCodes

KEYWORDS = {
    "purposes": ["purpose", "why we process", "reason for processing", "use of data"],
    "data_subjects": ["customer", "employee", "user", "visitor", "subscriber", "data subject"],
    "personal_data": ["name", "email", "address", "phone", "ip address", "device id", "location", "biometric"],
    "recipients": ["processor", "vendor", "third party", "recipient", "share with", "disclose to"],
    "retention": ["retention period", "keep for", "store for", "delete after", "retain until"],
    "transfers": ["transfer to", "country", "outside eu", "outside eea", "international transfer"],
    "security": ["encryption", "access control", "security measure", "pseudonymization", "tls", "mfa"],
}

MANDATORY_FIELDS = [
    "purposes",
    "data_subjects",
    "personal_data_categories",
    "recipients",
]


def extract_text(file_path: Path) -> str:
    """Extract text from markdown, txt, or JSON file."""
    if file_path.suffix.lower() == ".json":
        data = json.loads(file_path.read_text(encoding="utf-8"))
        return json.dumps(data, indent=2)
    return file_path.read_text(encoding="utf-8", errors="replace")


def parse_article30(input_path: str | Path, mode: str = "auto") -> dict[str, Any]:
    """Parse DPA / privacy policy files and extract Article 30 fields."""
    p = Path(input_path).resolve()
    if not p.exists():
        raise FileNotFoundError(f"Input path does not exist: {p}")

    files = [p] if p.is_file() else [f for f in p.rglob("*") if f.is_file() and f.suffix.lower() in (".md", ".txt", ".json")]

    activities = []
    for f in files:
        text = extract_text(f)
        text_lower = text.lower()
        extracted: dict[str, Any] = {
            "source_file": f.name,
            "parsed_date": datetime.now(timezone.utc).isoformat(),
            "purposes": [],
            "data_subjects": [],
            "personal_data_categories": [],
            "recipients": [],
            "international_transfers": [],
            "retention_period": None,
            "security_measures": [],
        }

        for kw in KEYWORDS["purposes"]:
            if kw in text_lower:
                extracted["purposes"].append(f"Processing associated with {kw}")
        for kw in KEYWORDS["data_subjects"]:
            if kw in text_lower and kw not in extracted["data_subjects"]:
                extracted["data_subjects"].append(kw)
        for kw in KEYWORDS["personal_data"]:
            if kw in text_lower and kw not in extracted["personal_data_categories"]:
                extracted["personal_data_categories"].append(kw)
        for kw in KEYWORDS["recipients"]:
            if kw in text_lower and kw not in extracted["recipients"]:
                extracted["recipients"].append(kw)
        for kw in KEYWORDS["transfers"]:
            if kw in text_lower and kw not in extracted["international_transfers"]:
                extracted["international_transfers"].append(kw)
        for kw in KEYWORDS["security"]:
            if kw in text_lower and kw not in extracted["security_measures"]:
                extracted["security_measures"].append(kw)

        activities.append(extracted)

    return {
        "organization": {
            "name": "Target Organization",
            "controller_contact": "dpo@example.com",
            "dpo_contact": "dpo@example.com",
            "generated_date": datetime.now(timezone.utc).isoformat(),
        },
        "processing_activities": activities,
    }


def validate_article30(ropa_data: dict[str, Any], strict: bool = False) -> dict[str, Any]:
    """Validate RoPA structure against GDPR Article 30 mandatory fields."""
    activities = ropa_data.get("processing_activities", [])
    total_issues = 0
    results = []

    for idx, act in enumerate(activities, 1):
        act_id = act.get("source_file", f"Activity #{idx}")
        issues = []
        for field in MANDATORY_FIELDS:
            val = act.get(field)
            if not val:
                issues.append({"severity": "ERROR", "field": field, "message": f"Missing mandatory field: {field}"})
            elif isinstance(val, list) and len(val) == 0:
                issues.append({"severity": "ERROR", "field": field, "message": f"Empty list for mandatory field: {field}"})

        total_issues += len(issues)
        results.append({"activity": act_id, "issues": issues, "valid": len(issues) == 0})

    valid = total_issues == 0
    return {
        "valid": valid,
        "total_activities": len(activities),
        "total_issues": total_issues,
        "details": results,
    }


def generate_ropa_report(ropa_data: dict[str, Any]) -> str:
    """Generate Markdown report from RoPA structure."""
    org = ropa_data.get("organization", {})
    activities = ropa_data.get("processing_activities", [])

    lines = [
        "# Article 30 Records of Processing Activities",
        "",
        f"**Organization**: {org.get('name', 'N/A')}",
        f"**Controller Contact**: {org.get('controller_contact', 'N/A')}",
        f"**Total Processing Activities**: {len(activities)}",
        "",
        "---",
        "",
    ]

    for idx, act in enumerate(activities, 1):
        lines.append(f"## Activity {idx}: {act.get('source_file', 'Activity')}")
        lines.append("")
        lines.append(f"### Purposes of Processing")
        purposes = act.get("purposes", [])
        lines.extend([f"- {p}" for p in purposes] if purposes else ["*[None specified]*"])
        lines.append("")

        lines.append(f"### Categories of Data Subjects")
        ds = act.get("data_subjects", [])
        lines.extend([f"- {s}" for s in ds] if ds else ["*[None specified]*"])
        lines.append("")

        lines.append(f"### Categories of Personal Data")
        pd_cat = act.get("personal_data_categories", [])
        lines.extend([f"- {c}" for c in pd_cat] if pd_cat else ["*[None specified]*"])
        lines.append("")

        lines.append(f"### Recipients")
        rec = act.get("recipients", [])
        lines.extend([f"- {r}" for r in rec] if rec else ["*[None specified]*"])
        lines.append("")

    return "\n".join(lines)


def handle(ctx: Context) -> int:
    """CLI handler for 'arsenal scripts gdpr/*'."""
    action = ctx.subcommand or ""
    if "/" in action:
        action = action.split("/", 1)[1]

    argv = list(ctx.positionals)
    if ctx.remainder:
        argv.extend(ctx.remainder)

    try:
        if action == "article30-parser":
            parser = argparse.ArgumentParser(prog="arsenal scripts gdpr/article30-parser")
            parser.add_argument("--input", "-i", required=True, help="Input contract or policy path")
            parser.add_argument("--output", "-o", default="", help="Output RoPA JSON file path")
            args, _ = parser.parse_known_args(argv)

            ropa = parse_article30(args.input)
            if args.output:
                Path(args.output).write_text(json.dumps(ropa, indent=2), encoding="utf-8")
            if not ctx.is_json:
                print(f"Parsed {len(ropa['processing_activities'])} processing activities.")
                if args.output:
                    print(f"Saved to {args.output}")
            return ctx.result(ropa, code=ExitCodes.SUCCESS)

        elif action == "article30-validator":
            parser = argparse.ArgumentParser(prog="arsenal scripts gdpr/article30-validator")
            parser.add_argument("--ropa", "-r", required=True, help="Path to RoPA JSON file")
            parser.add_argument("--strict", action="store_true", help="Strict validation")
            args, _ = parser.parse_known_args(argv)

            p = Path(args.ropa).resolve()
            if not p.is_file():
                return ctx.fail(f"RoPA file not found: {args.ropa}", code=ExitCodes.CLI_USAGE_ERROR)
            data = json.loads(p.read_text(encoding="utf-8"))
            val_res = validate_article30(data, strict=args.strict)

            if not ctx.is_json:
                status = "PASS" if val_res["valid"] else "FAIL"
                print(f"RoPA Validation [{status}]: {val_res['total_issues']} issues found.")
            code = ExitCodes.SUCCESS if val_res["valid"] else ExitCodes.CHECK_FAILURE
            return ctx.result(val_res, code=code)

        elif action == "generate-ropa-report":
            parser = argparse.ArgumentParser(prog="arsenal scripts gdpr/generate-ropa-report")
            parser.add_argument("--input", "-i", required=True, help="Input RoPA JSON file")
            parser.add_argument("--output", "-o", default="", help="Output Markdown report file")
            args, _ = parser.parse_known_args(argv)

            p = Path(args.input).resolve()
            if not p.is_file():
                return ctx.fail(f"RoPA file not found: {args.input}", code=ExitCodes.CLI_USAGE_ERROR)
            data = json.loads(p.read_text(encoding="utf-8"))
            md = generate_ropa_report(data)

            if args.output:
                Path(args.output).write_text(md, encoding="utf-8")
            if not ctx.is_json:
                print("Article 30 RoPA Report generated successfully.")
                if args.output:
                    print(f"Saved to {args.output}")
            return ctx.result({"markdown": md}, code=ExitCodes.SUCCESS)

        else:
            return ctx.fail(f"Unknown gdpr command: '{action}'", code=ExitCodes.CLI_USAGE_ERROR)

    except Exception as exc:
        return ctx.fail(str(exc), code=ExitCodes.CLI_USAGE_ERROR)
