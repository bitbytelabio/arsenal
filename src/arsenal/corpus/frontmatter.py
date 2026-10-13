"""YAML-aware frontmatter parser, serializer, and validator for Arsenal skills.

Eliminates ad-hoc regex parsing using PyYAML with stable key ordering.
Uses canonical JSON Schema definitions from arsenal.schemas.
"""

from __future__ import annotations

import re
from typing import Any, Final
import yaml

from arsenal.schemas import schema, validate

CANONICAL_KEY_ORDER: Final[tuple[str, ...]] = (
    "name",
    "description",
    "domain",
    "category",
    "hide",
    "license",
    "metadata",
)


def get_skill_frontmatter_schema() -> dict[str, Any]:
    """Retrieve canonical SKILL_FRONTMATTER_SCHEMA document."""
    return schema("SKILL_FRONTMATTER_SCHEMA")  # type: ignore[return-value]


def split_frontmatter(content: str) -> tuple[str, str] | None:
    """Split a markdown document into (raw_frontmatter, body).

    Preserves exact body bytes following the closing --- delimiter.
    """
    normalized = content[1:] if content.startswith("\ufeff") else content
    if not normalized.startswith("---"):
        return None

    first_line_end = normalized.find("\n")
    if first_line_end == -1:
        return None

    first_line = normalized[:first_line_end].strip()
    if first_line != "---":
        return None

    rest = normalized[first_line_end + 1 :]
    match = re.search(r"(?:^|\r?\n)---\s*(?:\r?\n|$)", rest)
    if not match:
        return None

    raw_frontmatter = rest[: match.start()]
    body = rest[match.end() :]
    return raw_frontmatter, body


def normalize_description(raw: str) -> str:
    """Normalize a description scalar.

    Joins folded/block lines, collapses whitespace, strips matching quotes.
    """
    s = str(raw).strip()
    while (s.startswith('"') and s.endswith('"') and len(s) >= 2) or (
        s.startswith("'") and s.endswith("'") and len(s) >= 2
    ):
        s = s[1:-1].strip()
    return re.sub(r"\s+", " ", s)


def bound_description(description: str, max_length: int = 300) -> str:
    """Bound a description to max_length (default 300).

    Uses sentence boundary trimming if length > max_length; falls back
    to word boundary + '…' if no valid sentence boundary exists before limit.
    """
    normalized = normalize_description(description)
    if len(normalized) <= max_length:
        return normalized

    # Find last sentence boundary at or before max_length
    sentence_pattern = re.compile(r"[.!?。！？](?:\s+|$)")
    last_sentence_end = -1
    for m in sentence_pattern.finditer(normalized):
        end = m.start() + 1
        if end <= max_length:
            last_sentence_end = end
        else:
            break

    if last_sentence_end >= 40:
        return normalized[:last_sentence_end].strip()

    target_len = max_length - 1
    truncated = normalized[:target_len]
    last_space = truncated.rfind(" ")
    word_boundary = truncated[:last_space] if last_space > 0 else truncated
    cleaned = re.sub(r"[,\s;:.-]+$", "", word_boundary)
    return f"{cleaned}…"


def parse_skill_document(content: str) -> dict[str, Any] | None:
    """Generic parser for full Markdown skill document.

    Returns dict with keys 'data', 'body', 'raw_frontmatter' or None.
    """
    split = split_frontmatter(content)
    if not split:
        return None
    raw_fm, body = split

    try:
        raw_data = yaml.safe_load(raw_fm)
    except Exception:
        return None

    if not isinstance(raw_data, dict):
        return None

    data = dict(raw_data)
    if "description" in data and isinstance(data["description"], str):
        data["description"] = normalize_description(data["description"])

    return {
        "data": data,
        "body": body,
        "raw_frontmatter": raw_fm,
    }


def parse_skill_frontmatter(input_str: str) -> dict[str, Any] | None:
    """Generic parser for frontmatter from either Markdown content or raw YAML."""
    normalized = input_str[1:] if input_str.startswith("\ufeff") else input_str
    if normalized.startswith("---"):
        parsed = parse_skill_document(normalized)
        return parsed["data"] if parsed else None

    try:
        raw_data = yaml.safe_load(normalized)
    except Exception:
        return None

    if not isinstance(raw_data, dict):
        return None

    data = dict(raw_data)
    if "description" in data and isinstance(data["description"], str):
        data["description"] = normalize_description(data["description"])

    return data


def order_frontmatter_keys(obj: dict[str, Any]) -> dict[str, Any]:
    """Order frontmatter keys deterministically according to canon."""
    ordered: dict[str, Any] = {}
    for key in CANONICAL_KEY_ORDER:
        if key in obj:
            if key == "metadata" and isinstance(obj["metadata"], dict):
                meta_obj = obj["metadata"]
                ordered_meta: dict[str, Any] = {}
                if "manifest_entry" in meta_obj:
                    ordered_meta["manifest_entry"] = meta_obj["manifest_entry"]
                for k in sorted(meta_obj.keys()):
                    if k != "manifest_entry":
                        ordered_meta[k] = meta_obj[k]
                ordered["metadata"] = ordered_meta
            else:
                ordered[key] = obj[key]

    for k in sorted(obj.keys()):
        if k not in CANONICAL_KEY_ORDER:
            ordered[k] = obj[k]

    return ordered


def serialize_skill_frontmatter(data: dict[str, Any]) -> str:
    """Deterministic YAML frontmatter serializer with stable key ordering."""
    ordered = order_frontmatter_keys(data)
    return yaml.safe_dump(ordered, sort_keys=False, width=float("inf"))


def serialize_skill_document(frontmatter: dict[str, Any], body: str) -> str:
    """Serialize full Markdown skill document, preserving body bytes."""
    yaml_content = serialize_skill_frontmatter(frontmatter)
    if not yaml_content.endswith("\n"):
        yaml_content = f"{yaml_content}\n"
    return f"---\n{yaml_content}---\n{body}"


def validate_canonical_skill_frontmatter(data: Any) -> tuple[bool, list[str]]:
    """Validate frontmatter against canonical SKILL_FRONTMATTER_SCHEMA via arsenal.schemas."""
    errors = validate("SKILL_FRONTMATTER_SCHEMA", data)
    return len(errors) == 0, errors
