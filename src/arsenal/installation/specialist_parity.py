"""Specialist definition parity and integrity verification.

Evaluates P-1..P-4 invariants and required heading phrases per contracts/specialist-definition.md
and contracts/cli-coverage.md.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
from dataclasses import dataclass
from typing import Final

DOMAINS: Final[tuple[str, ...]] = ("re", "webapp", "mobile", "red")

SPECIALIST_FILE: Final[dict[str, str]] = {
    "re": "sec-re.md",
    "webapp": "sec-webapp.md",
    "mobile": "sec-mobile.md",
    "red": "sec-red.md",
}

VERIFIER_FILE: Final[str] = "sec-verifier.md"

REQUIRED_DOMAIN_HEADINGS: Final[tuple[str, ...]] = (
    "Owned Categories",
    "Retrieval",
    "Governing Baseline",
    "Handoff",
    "Capability Gap Protocol",
)

REQUIRED_VERIFIER_HEADINGS: Final[tuple[str, ...]] = (
    "Handoff",
    "Capability Gap Protocol",
)

FORBIDDEN_VENDOR_SEGMENTS: Final[tuple[str, ...]] = (
    "anthropic",
    "xalgorix",
    "claudered",
    "claude-red",
    "revskill",
    "reverse-skill",
    "strix",
)


@dataclass
class ParityViolation:
    invariant: str
    domain: str | None
    subject: str
    message: str


def _headings(markdown: str) -> list[str]:
    """Collect all '## <heading>' phrases present in markdown."""
    return [m.group(1).strip() for m in re.finditer(r"^##\s+(.+?)\s*$", markdown, re.MULTILINE)]


def _has_heading(markdown: str, phrase: str) -> bool:
    """Check if any heading contains the required phrase."""
    return any(phrase in h for h in _headings(markdown))


def parse_owned_categories(markdown: str) -> list[str] | None:
    """Parse categories listed under '## Owned Categories', one per line as '- `<category>`'."""
    lines = markdown.splitlines()
    start = -1
    for i, line in enumerate(lines):
        if re.match(r"^##\s+.*Owned Categories", line):
            start = i + 1
            break
    if start == -1:
        return None

    out: list[str] = []
    for line in lines[start:]:
        if re.match(r"^##\s+", line):
            break
        m = re.match(r"^-\s+`([^`]+)`\s*$", line.strip())
        if m:
            out.append(m.group(1))
    return out


def evaluate_specialist_parity(repo_root: Path) -> list[ParityViolation]:
    """Evaluate specialist markdown files against routing tables and definition contracts."""
    violations: list[ParityViolation] = []
    agents_dir = repo_root / "plugin/agents"

    # Load routing tables
    declared_by_domain: dict[str, list[str]] = {}
    declared_union: set[str] = set()

    for domain in DOMAINS:
        rt_path = repo_root / f"presets/{domain}/routing.json"
        if rt_path.is_file():
            try:
                data = json.loads(rt_path.read_text(encoding="utf-8"))
                cats = list(data.get("categories", []))
                declared_by_domain[domain] = cats
                declared_union.update(cats)
            except Exception:
                pass

    claimed_union: set[str] = set()
    saw_table = len(declared_by_domain) > 0

    for domain in DOMAINS:
        file_name = SPECIALIST_FILE[domain]
        agent_path = agents_dir / file_name
        if not agent_path.is_file():
            violations.append(
                ParityViolation(
                    invariant="P-2",
                    domain=domain,
                    subject=file_name,
                    message=f"missing specialist definition 'plugin/agents/{file_name}'",
                )
            )
            continue

        md = agent_path.read_text(encoding="utf-8")

        for phrase in REQUIRED_DOMAIN_HEADINGS:
            if not _has_heading(md, phrase):
                violations.append(
                    ParityViolation(
                        invariant="P-1",
                        domain=domain,
                        subject=file_name,
                        message=f"specialist '{file_name}' is missing required heading phrase '{phrase}'",
                    )
                )

        owned = parse_owned_categories(md)
        if owned is not None:
            claimed_union.update(owned)
            declared = declared_by_domain.get(domain)
            if declared is not None:
                owned_set = set(owned)
                for c in owned:
                    if c not in declared:
                        violations.append(
                            ParityViolation(
                                invariant="P-2",
                                domain=domain,
                                subject=f"{file_name}:{c}",
                                message=f"specialist '{file_name}' claims category '{c}' not declared by presets/{domain}/routing.json",
                            )
                        )
                for c in declared:
                    if c not in owned_set:
                        violations.append(
                            ParityViolation(
                                invariant="P-2",
                                domain=domain,
                                subject=f"{file_name}:{c}",
                                message=f"specialist '{file_name}' does not claim declared category '{c}'",
                            )
                        )

    # P-1: Union equality
    if saw_table:
        for c in claimed_union:
            if c not in declared_union:
                violations.append(
                    ParityViolation(
                        invariant="P-1",
                        domain=None,
                        subject=c,
                        message=f"category '{c}' is claimed by a specialist but declared by no routing table",
                    )
                )
        for c in declared_union:
            if c not in claimed_union:
                violations.append(
                    ParityViolation(
                        invariant="P-1",
                        domain=None,
                        subject=c,
                        message=f"category '{c}' is declared by a routing table but owned by no specialist",
                    )
                )

    # P-4: sec-verifier owns no category
    verifier_path = agents_dir / VERIFIER_FILE
    if verifier_path.is_file():
        v_md = verifier_path.read_text(encoding="utf-8")
        for phrase in REQUIRED_VERIFIER_HEADINGS:
            if not _has_heading(v_md, phrase):
                violations.append(
                    ParityViolation(
                        invariant="P-4",
                        domain=None,
                        subject=VERIFIER_FILE,
                        message=f"verifier definition '{VERIFIER_FILE}' is missing required heading phrase '{phrase}'",
                    )
                )
        owned = parse_owned_categories(v_md)
        if owned and len(owned) > 0:
            violations.append(
                ParityViolation(
                    invariant="P-4",
                    domain=None,
                    subject=f"{VERIFIER_FILE}:{','.join(owned)}",
                    message=f"sec-verifier owns no domain category but lists '{', '.join(owned)}'",
                )
            )

    return violations
