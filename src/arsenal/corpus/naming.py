"""Identifier policy and word-boundary safe slug derivation for Arsenal skills.

Conforms to contracts/skill-standard.md §1, research.md R1, and Task T006.
"""

from __future__ import annotations

import re
from typing import Final, Literal

SkillDomain = Literal["re", "webapp", "mobile", "red"]

SKILL_DOMAINS: Final[tuple[SkillDomain, ...]] = ("re", "webapp", "mobile", "red")
DOMAINS: Final[tuple[SkillDomain, ...]] = SKILL_DOMAINS

# Standard skill identifier grammar: ^(re|webapp|mobile|red)-[a-z0-9]+(-[a-z0-9]+)*$
SKILL_ID_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^(re|webapp|mobile|red)-[a-z0-9]+(-[a-z0-9]+)*$"
)
MAX_SKILL_ID_LENGTH: Final[int] = 64

# Router identifier pattern (exempt from the standard domain prefix format)
ROUTER_ID_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^arsenal-(re|webapp|mobile|red)-router$"
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

DECLARED_ABBREVIATIONS: Final[dict[str, str]] = {
    "reverse-engineering": "reverse",
    "vulnerability": "vuln",
    "implementing": "impl",
    "assessment": "assess",
    "configuration": "config",
}

FORBIDDEN_MULTI_SEGMENTS: Final[tuple[tuple[str, str], ...]] = (
    ("claude", "red"),
    ("reverse", "skill"),
)

FORBIDDEN_SINGLE_SEGMENTS: Final[frozenset[str]] = frozenset({
    "anthropic",
    "xalgorix",
    "claudered",
    "revskill",
    "strix",
})


def is_valid_skill_domain(domain: str) -> bool:
    """Validate whether domain is one of the four admitted skill domains."""
    return domain in SKILL_DOMAINS


def is_router_skill_id(skill_id: str) -> bool:
    """Check whether identifier is an arsenal router identifier."""
    return bool(ROUTER_ID_PATTERN.match(skill_id) and len(skill_id) <= MAX_SKILL_ID_LENGTH)


def contains_forbidden_vendor_token(skill_id: str) -> bool:
    """Test whether identifier contains any forbidden vendor token as a whole hyphen-delimited segment."""
    segs = [s for s in skill_id.lower().split("-") if s]

    for i in range(len(segs) - 1):
        for w1, w2 in FORBIDDEN_MULTI_SEGMENTS:
            if segs[i] == w1 and segs[i + 1] == w2:
                return True

    for seg in segs:
        if seg in FORBIDDEN_SINGLE_SEGMENTS:
            return True

    return False


def remove_forbidden_vendor_segments(slug: str) -> str:
    """Remove forbidden vendor segments from a hyphen-separated slug."""
    segs = [s for s in slug.lower().split("-") if s]
    changed = True

    while changed:
        changed = False
        # Check multi-segment tokens first
        for i in range(len(segs) - 1):
            for w1, w2 in FORBIDDEN_MULTI_SEGMENTS:
                if segs[i] == w1 and segs[i + 1] == w2:
                    del segs[i : i + 2]
                    changed = True
                    break
            if changed:
                break

        if changed:
            continue

        # Check single segment tokens
        for i in range(len(segs)):
            if segs[i] in FORBIDDEN_SINGLE_SEGMENTS:
                del segs[i]
                changed = True
                break

    return "-".join(segs)


def apply_declared_abbreviations(slug: str) -> str:
    """Substitute whole words in a slug using the declared abbreviation table."""
    segs = [s for s in slug.lower().split("-") if s]
    result: list[str] = []
    i = 0
    while i < len(segs):
        cur = segs[i]
        next_seg = segs[i + 1] if i + 1 < len(segs) else None

        if cur == "reverse" and next_seg == "engineering":
            result.append("reverse")
            i += 2
        elif cur in DECLARED_ABBREVIATIONS:
            result.append(DECLARED_ABBREVIATIONS[cur])
            i += 1
        else:
            result.append(cur)
            i += 1

    return "-".join(result)


def is_valid_skill_id(skill_id: str) -> bool:
    """Check whether identifier strictly conforms to the skill identifier policy."""
    if is_router_skill_id(skill_id):
        return True
    if len(skill_id) > MAX_SKILL_ID_LENGTH:
        return False
    if not SKILL_ID_PATTERN.match(skill_id):
        return False
    if contains_forbidden_vendor_token(skill_id):
        return False
    return True


def validate_skill_id(skill_id: str) -> tuple[bool, list[str]]:
    """Validate a skill identifier and return (valid, errors)."""
    errors: list[str] = []
    if is_router_skill_id(skill_id):
        return True, []

    if len(skill_id) > MAX_SKILL_ID_LENGTH:
        errors.append(
            f"Identifier exceeds maximum length of {MAX_SKILL_ID_LENGTH} characters (received {len(skill_id)})"
        )

    if not SKILL_ID_PATTERN.match(skill_id):
        domain_prefix = skill_id.split("-")[0] if "-" in skill_id else ""
        if not domain_prefix or not is_valid_skill_domain(domain_prefix):
            errors.append("Identifier must start with a valid domain prefix (re, webapp, mobile, red)")
        else:
            errors.append(
                "Identifier does not match grammar ^(re|webapp|mobile|red)-[a-z0-9]+(-[a-z0-9]+)*$"
            )

    if contains_forbidden_vendor_token(skill_id):
        errors.append("Identifier contains forbidden vendor token(s) as a whole segment")

    return len(errors) == 0, errors


def parse_skill_id(skill_id: str) -> tuple[SkillDomain, str] | None:
    """Parse an identifier into (domain, slug) or None if invalid."""
    if not SKILL_ID_PATTERN.match(skill_id):
        return None
    dash_index = skill_id.find("-")
    domain = skill_id[:dash_index]
    slug = skill_id[dash_index + 1 :]
    return domain, slug  # type: ignore[return-value]


def derive_skill_slug(technique_slug: str, domain: SkillDomain | None = None) -> str:
    """Derive a normalized capability slug from a technique slug with word-boundary safety."""
    slug = technique_slug.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")

    if domain and slug.startswith(f"{domain}-"):
        slug = slug[len(domain) + 1 :]

    slug = remove_forbidden_vendor_segments(slug)

    domain_len = (len(domain) + 1) if domain else 0
    max_total_len = MAX_SKILL_ID_LENGTH

    words = [w for w in slug.split("-") if w]
    if not words:
        return ""

    def total_len(w_list: list[str]) -> int:
        return domain_len + len("-".join(w_list))

    # Drop whole trailing words if exceeding limit
    while len(words) > 1 and total_len(words) > max_total_len:
        words.pop()

    # Apply abbreviations if still over limit
    if total_len(words) > max_total_len:
        joined = "-".join(words)
        abbreviated = apply_declared_abbreviations(joined)
        words = [w for w in abbreviated.split("-") if w]
        while len(words) > 1 and total_len(words) > max_total_len:
            words.pop()

    return "-".join(words)


def derive_skill_id(domain: SkillDomain, technique_slug: str) -> str:
    """Derive a canonical, compliant skill identifier: <domain>-<capability-slug>."""
    if not is_valid_skill_domain(domain):
        raise ValueError(
            f"Invalid skill domain '{domain}'. Must be one of: {', '.join(SKILL_DOMAINS)}"
        )

    slug = derive_skill_slug(technique_slug, domain)
    if not slug:
        raise ValueError(
            f"Cannot derive a valid capability slug from '{technique_slug}' for domain '{domain}'"
        )

    skill_id = f"{domain}-{slug}"
    if len(skill_id) > MAX_SKILL_ID_LENGTH and "-" in slug:
        words = slug.split("-")
        while len(words) > 1 and len(f"{domain}-{'-'.join(words)}") > MAX_SKILL_ID_LENGTH:
            words.pop()
        return f"{domain}-{'-'.join(words)}"

    return skill_id
