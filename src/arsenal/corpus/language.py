"""Deterministic English-residue detection per research.md R10 and contracts/skill-standard.md §2.

Scans content for CJK ranges, fullwidth characters, and Vietnamese diacritics/words.
Skips fenced code blocks to avoid false positives on binary/exploit payloads.
"""

from __future__ import annotations

from pathlib import Path
import re
from typing import Any, Final

CJK_RANGE_REGEX: Final[re.Pattern[str]] = re.compile(r"[\u3000-\u9fff]")
FULLWIDTH_RANGE_REGEX: Final[re.Pattern[str]] = re.compile(r"[\uff00-\uffef]")
CJK_OR_FULLWIDTH_REGEX: Final[re.Pattern[str]] = re.compile(r"[\u3000-\u9fff\uff00-\uffef]")

VIETNAMESE_DIACRITICS_REGEX: Final[re.Pattern[str]] = re.compile(
    r"[ăâđêôơưĂÂĐÊÔƠƯ\u1ea0-\u1ef9àáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵÀÁẢÃẠÈÉẺẼẸÌÍỈĨỊÒÓỎÕỌÙÚỦŨỤỲÝỶỸỴ]"
)

VIETNAMESE_FUNCTION_WORDS: Final[tuple[str, ...]] = (
    "không",
    "được",
    "người",
    "phải",
    "cần",
    "thực",
)

VIETNAMESE_FUNCTION_WORDS_REGEX: Final[re.Pattern[str]] = re.compile(
    r"(?:^|[^\w])(không|được|người|phải|cần|thực)(?=[^\w]|$)",
    re.IGNORECASE,
)


def detect_language_violations_in_line(
    line: str,
    line_number: int,
    file_path: str = "",
) -> list[dict[str, Any]]:
    """Check a single line of text for language residue."""
    violations: list[dict[str, Any]] = []

    cjk = CJK_RANGE_REGEX.search(line)
    if cjk:
        violations.append({
            "file": file_path,
            "line": line_number,
            "type": "cjk",
            "match": cjk.group(0),
            "lineContent": line.strip(),
        })

    fullwidth = FULLWIDTH_RANGE_REGEX.search(line)
    if fullwidth:
        violations.append({
            "file": file_path,
            "line": line_number,
            "type": "fullwidth",
            "match": fullwidth.group(0),
            "lineContent": line.strip(),
        })

    viet_diacritic = VIETNAMESE_DIACRITICS_REGEX.search(line)
    if viet_diacritic:
        violations.append({
            "file": file_path,
            "line": line_number,
            "type": "vietnamese_diacritic",
            "match": viet_diacritic.group(0),
            "lineContent": line.strip(),
        })

    viet_word = VIETNAMESE_FUNCTION_WORDS_REGEX.search(line)
    if viet_word:
        violations.append({
            "file": file_path,
            "line": line_number,
            "type": "vietnamese_function_word",
            "match": viet_word.group(1),
            "lineContent": line.strip(),
        })

    return violations


def is_code_or_payload_snippet(snippet: str) -> bool:
    """Check if snippet looks like code, syntax or payload."""
    trimmed = snippet.strip()
    symbols = ("=", "(", ")", "{", "}", "[", "]", ";", "->", "=>", "$", "\\", "/")
    if any(s in trimmed for s in symbols):
        return True
    if (trimmed.startswith('"') and trimmed.endswith('"')) or (
        trimmed.startswith("'") and trimmed.endswith("'")
    ):
        return True
    code_keywords = (
        "const",
        "let",
        "var",
        "def",
        "function",
        "import",
        "export",
        "class",
        "if",
        "return",
        "print",
        "curl",
        "grep",
        "cat",
        "python",
        "bash",
        "sh",
    )
    if any(re.match(rf"^{kw}\b", trimmed) for kw in code_keywords):
        return True
    return False


def detect_language_violations_in_text(
    content: str,
    file_path: str = "",
) -> list[dict[str, Any]]:
    """Analyze string content line-by-line, skipping fenced code blocks."""
    lines = content.splitlines()
    violations: list[dict[str, Any]] = []

    in_code_block = False
    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_code_block = not in_code_block
            continue

        if in_code_block:
            continue

        # Check line for violations
        line_violations = detect_language_violations_in_line(line, idx, file_path)
        violations.extend(line_violations)

    return violations


def detect_language_violations_in_file(file_path: Path | str) -> list[dict[str, Any]]:
    """Inspect a file on disk and return language violations."""
    p = Path(file_path)
    if not p.is_file():
        return []
    content = p.read_text(encoding="utf-8", errors="replace")
    return detect_language_violations_in_text(content, str(p))


def report_language_residue(file_paths: list[Path | str]) -> dict[str, list[dict[str, Any]]]:
    """Evaluate multiple files and produce report keyed by file path."""
    report: dict[str, list[dict[str, Any]]] = {}
    for fp in file_paths:
        v = detect_language_violations_in_file(fp)
        if v:
            report[str(fp)] = v
    return report


def has_language_residue(text: str) -> bool:
    """Fast boolean check if content contains any non-English residue."""
    return bool(
        CJK_OR_FULLWIDTH_REGEX.search(text)
        or VIETNAMESE_DIACRITICS_REGEX.search(text)
        or VIETNAMESE_FUNCTION_WORDS_REGEX.search(text)
    )


def is_english_only(text: str) -> bool:
    """Return True if text is clean English."""
    return not has_language_residue(text)
