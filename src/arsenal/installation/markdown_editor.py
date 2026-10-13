"""Non-Destructive Markdown Editor & Merger.

Implements tag-based block updates (e.g. <!-- arsenal:start --> ... <!-- arsenal:end -->)
and non-destructive markdown section/bullet merging for OMP profiles.
"""

from __future__ import annotations

import re


def has_tagged_block(content: str, tag_id: str) -> bool:
    """Check if a tagged block exists for a given tag identifier."""
    pattern = re.compile(rf"<!--\s*{re.escape(tag_id)}:start\s*-->[\s\S]*?<!--\s*{re.escape(tag_id)}:end\s*-->", re.IGNORECASE)
    return bool(pattern.search(content))


def extract_tagged_block(content: str, tag_id: str) -> str | None:
    """Extract tagged block content (including the start/end comments)."""
    pattern = re.compile(rf"<!--\s*{re.escape(tag_id)}:start\s*-->[\s\S]*?<!--\s*{re.escape(tag_id)}:end\s*-->", re.IGNORECASE)
    match = pattern.search(content)
    return match.group(0) if match else None


def replace_tagged_block(content: str, tag_id: str, new_block: str) -> tuple[bool, str]:
    """Replace a tagged block in markdown with new content."""
    pattern = re.compile(rf"<!--\s*{re.escape(tag_id)}:start\s*-->[\s\S]*?<!--\s*{re.escape(tag_id)}:end\s*-->", re.IGNORECASE)
    if pattern.search(content):
        replaced = pattern.sub(new_block.strip(), content, count=1)
        return True, replaced
    return False, content


def merge_agents_markdown(existing: str, template: str) -> str:
    """Merge AGENTS.md using tag-based blocks (<!-- arsenal:start --> ... <!-- arsenal:end -->).

    Ensures managed Arsenal orchestrator instructions are updated in-place without clobbering
    foreign tagged blocks (e.g. <!-- codebase-memory-mcp:start -->) or custom operator notes.
    """
    if not existing.strip():
        return template.rstrip() + "\n"
    if not template.strip():
        return existing.rstrip() + "\n"

    # Ensure template itself has tags
    normalized_template = template.strip()
    if not has_tagged_block(normalized_template, "arsenal"):
        normalized_template = f"<!-- arsenal:start -->\n{normalized_template}\n<!-- arsenal:end -->"
    template_arsenal_block = extract_tagged_block(normalized_template, "arsenal") or normalized_template

    # Case 1: Existing document already has <!-- arsenal:start --> ... <!-- arsenal:end -->
    if has_tagged_block(existing, "arsenal"):
        _, updated = replace_tagged_block(existing, "arsenal", template_arsenal_block)
        return updated.rstrip() + "\n"

    # Legacy or alternate tag <!-- arsenal-orchestrator:start -->
    if has_tagged_block(existing, "arsenal-orchestrator"):
        _, updated = replace_tagged_block(existing, "arsenal-orchestrator", template_arsenal_block)
        return updated.rstrip() + "\n"

    # Case 2: Untagged existing document containing Arsenal sections
    lower_existing = existing.lower()
    orchestrator_idx = lower_existing.find("# arsenal master orchestrator")

    if orchestrator_idx != -1:
        foreign_match = re.search(r"<!--\s*([a-zA-Z0-9_-]+):start\s*-->", existing[orchestrator_idx:])
        arsenal_end_idx = len(existing)
        if foreign_match and foreign_match.start() > 0:
            arsenal_end_idx = orchestrator_idx + foreign_match.start()

        before_arsenal = existing[:orchestrator_idx].rstrip()
        after_arsenal = existing[arsenal_end_idx:].lstrip()

        parts = [p for p in (before_arsenal, template_arsenal_block, after_arsenal) if p]
        return "\n\n".join(parts).rstrip() + "\n"

    # Case 3: Completely custom content; prepend Arsenal block
    return f"{template_arsenal_block}\n\n{existing.lstrip()}".rstrip() + "\n"


def normalize_rule_text(line: str) -> str:
    """Normalize rule bullet text for deduplication comparison."""
    no_bullet = re.sub(r"^\s*[-*]\s+", "", line)
    cleaned = re.sub(r"[`\"'.:;,]", "", no_bullet)
    return cleaned.strip().lower()


def merge_rules_markdown(existing: str, template: str) -> str:
    """Merge RULES.md preserving verbatim line order, custom headings, comments, and sub-bullets.

    Appends missing template rules while keeping operator custom rules intact.
    """
    if not existing.strip():
        return template.rstrip() + "\n"
    if not template.strip():
        return existing.rstrip() + "\n"

    existing_lines = existing.splitlines()
    template_lines = template.splitlines()

    existing_bullets_normalized = set()
    in_code = False
    for line in existing_lines:
        trimmed = line.strip()
        if trimmed.startswith("```") or trimmed.startswith("~~~"):
            in_code = not in_code
            continue
        if not in_code and (trimmed.startswith("-") or trimmed.startswith("*")):
            existing_bullets_normalized.add(normalize_rule_text(trimmed))

    missing_template_bullets: list[str] = []
    in_code = False
    for line in template_lines:
        trimmed = line.strip()
        if trimmed.startswith("```") or trimmed.startswith("~~~"):
            in_code = not in_code
            continue
        if not in_code and (trimmed.startswith("-") or trimmed.startswith("*")):
            norm = normalize_rule_text(trimmed)
            if norm not in existing_bullets_normalized:
                missing_template_bullets.append(line)
                existing_bullets_normalized.add(norm)

    if not missing_template_bullets:
        return existing.rstrip() + "\n"

    return existing.rstrip() + "\n" + "\n".join(missing_template_bullets) + "\n"
