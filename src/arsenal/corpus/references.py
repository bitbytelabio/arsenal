"""Shipped-first citation extraction, resolution, auditing, and materialization.

Uses markdown-it-py AST for structural link and reference token walking.
Implements contracts/reference-materialization.md §2-§3, tools/migrate-skill-uris.ts,
and src/core/{reference-resolver,skill-references}.ts.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import shutil
from typing import Any, Final
from markdown_it import MarkdownIt

PROSE_NON_CITATIONS: Final[frozenset[str]] = frozenset({
    "support/support",
    "scripts/macros/DLLs",
    "scripts/binaries",
})

STRICT_PATH_PREFIXES: Final[tuple[str, ...]] = (
    "scripts/",
    "references/",
    "templates/",
    "support/",
    "assets/",
)

EXTERNAL_WORKSPACE_PREREQUISITES: Final[dict[str, str]] = {
    "assets/index.android.bundle": "Unpacked React Native APK workspace input (assets/index.android.bundle)",
    "assets/bin/Data/Managed/Metadata/global-metadata.dat": "Unpacked Unity IL2CPP APK/IPA workspace input (global-metadata.dat)",
    "assets/dispatchblock.png": "External obpo-plugin repository documentation diagram (assets/dispatchblock.png)",
    "scripts/decode_stacktrace.sh": "Linux kernel source-tree script prerequisite (./scripts/decode_stacktrace.sh)",
    "scripts/getArch.sh": "Firmadyne toolkit workspace script prerequisite (./scripts/getArch.sh)",
    "scripts/tar2db.py": "Firmadyne toolkit workspace script prerequisite (./scripts/tar2db.py)",
    "scripts/makeImage.sh": "Firmadyne toolkit workspace script prerequisite (./scripts/makeImage.sh)",
    "scripts/inferNetwork.sh": "Firmadyne toolkit workspace script prerequisite (./scripts/inferNetwork.sh)",
}

REGISTERED_TOOLS: Final[frozenset[str]] = frozenset({
    "evidence_exec",
    "consolidate_evidence",
    "case_review",
    "skill_search",
    "skill_list",
    "skill_load",
    "skill_route",
    "arsenal",
})

CASE_ARTIFACTS: Final[frozenset[str]] = frozenset({
    "scope.md",
    "timeline.md",
    "workitems.md",
    "report.md",
    "case-review.md",
    "findings.md",
    "fuzzing_report.md",
    "scope.yaml",
    "SKILL.md",
    "./SKILL.md",
    "idor_hunter.md",
    "ssrf_redirect_hunter.md",
    "penetration_test_report.md",
})

SYSTEM_TOOLS: Final[frozenset[str]] = frozenset({
    "secretsdump.py",
    "mimikatz",
    "pypykatz",
    "procdump",
    "sqlmap",
    "nmap",
    "radamsa",
    "afl-tmin",
    "afl-fuzz",
    "ghidra",
    "idapro",
    "ida",
    "radare2",
    "r2",
    "jadx",
    "apktool",
    "frida",
    "objection",
    "gdb",
    "lldb",
    "checksec",
    "readelf",
    "objdump",
    "binwalk",
    "volatility",
    "volatility3",
    "wireshark",
    "tshark",
    "burpsuite",
    "curl",
    "wget",
    "impacket",
    "rubeus",
    "bloodhound",
    "linpeas.sh",
    "winpeas.bat",
    "ntlmrelayx.py",
})


def parse_skill_uri(uri: str) -> dict[str, Any]:
    """Parse and validate canonical skill:// URI."""
    if not uri.startswith("skill://"):
        return {"valid": False, "skillId": "", "subpath": "", "error": "Not a skill URI"}

    without_scheme = uri[len("skill://") :]
    if "skill://" in without_scheme:
        return {"valid": False, "skillId": "", "subpath": "", "error": "Malformed skill URI contains nested 'skill://'"}

    # Anchor extraction
    anchor = None
    if "#" in without_scheme:
        path_part, anchor = without_scheme.split("#", 1)
        anchor = anchor.strip() or None
    else:
        path_part = without_scheme

    parts = path_part.split("/", 1)
    skill_id = parts[0]
    subpath = parts[1] if len(parts) > 1 else ""

    if not skill_id:
        return {"valid": False, "skillId": "", "subpath": "", "error": "Empty skill identifier in skill URI"}

    if not re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", skill_id):
        return {"valid": False, "skillId": skill_id, "subpath": subpath, "error": f"Invalid skill identifier '{skill_id}' in skill URI"}

    if subpath:
        for seg in subpath.replace("\\", "/").split("/"):
            if seg in (".", "..") or not seg:
                return {
                    "valid": False,
                    "skillId": skill_id,
                    "subpath": subpath,
                    "error": f"Path traversal or dot components not allowed in skill URI subpath: contains '{seg or '/'}'",
                }

    return {
        "valid": True,
        "skillId": skill_id,
        "subpath": subpath,
        "anchor": anchor,
        "raw": uri,
    }


def resolve_skill_uri(uri: str, corpus_dir: Path) -> dict[str, Any]:
    """Resolve a skill:// URI to a local filesystem path and verify existence."""
    parsed = parse_skill_uri(uri)
    if not parsed.get("valid"):
        return {"exists": False, "error": parsed.get("error")}

    skill_id = parsed["skillId"]
    subpath = parsed["subpath"] or "SKILL.md"

    skill_dir = corpus_dir / skill_id
    if not skill_dir.is_dir():
        return {"exists": False, "error": f"Skill not found: {skill_id}", "skillId": skill_id}

    target = (skill_dir / subpath).resolve()
    if not str(target).startswith(str(skill_dir.resolve())):
        return {"exists": False, "error": f"Path traversal denied: '{subpath}' escapes skill directory", "skillId": skill_id}

    if not target.is_file():
        return {"exists": False, "error": f"Asset not found: {subpath} in skill {skill_id}", "skillId": skill_id, "resolvedPath": str(target)}

    return {
        "exists": True,
        "skillId": skill_id,
        "assetPath": subpath,
        "resolvedPath": str(target),
    }


def normalize_ref(raw_url: str, skill_id: str) -> str | None:
    """Normalize a relative reference to a canonical skill:// URI."""
    u = raw_url.strip()
    if "://" in u:
        return None
    u = re.sub(r"^<SKILL_ROOT>/?", "", u, flags=re.IGNORECASE).lstrip("./")
    if u.startswith("references/") or u.startswith("support/"):
        return f"skill://{skill_id}/{u}"
    return None


def migrate_skill_content(skill_id: str, content: str) -> tuple[str, int]:
    """Batch convert relative reference citations to canonical skill:// URIs using markdown-it-py."""
    md = MarkdownIt()
    try:
        tokens = md.parse(content)
    except Exception:
        return content, 0

    count = 0
    updated = content
    replacements: list[tuple[str, str]] = []

    for token in tokens:
        if token.type == "inline" and token.children:
            for child in token.children:
                if child.type in ("link_open", "image"):
                    attrs = dict(child.attrs) if isinstance(child.attrs, list) else (child.attrs or {})
                    href = attrs.get("href") or attrs.get("src")
                    if isinstance(href, str):
                        canonical = normalize_ref(href, skill_id)
                        if canonical and canonical != href:
                            replacements.append((href, canonical))

    for old_url, new_url in replacements:
        pattern = re.compile(rf"(\]\(\s*){re.escape(old_url)}(\s*[\)])")
        new_content, n = pattern.subn(rf"\g<1>{new_url}\g<2>", updated)
        if n > 0:
            updated = new_content
            count += n

    return updated, count


def is_strict_path_citation(target: str) -> bool:
    """Check if target begins with a strict support directory prefix."""
    norm = target.replace("\\", "/").lstrip("./")
    return any(norm.startswith(prefix) for prefix in STRICT_PATH_PREFIXES)


def classify_citation(
    raw: str,
    target: str,
    skill_id: str,
    shipped_tree: Path,
    admitted_skills: set[str],
) -> tuple[str, str | None]:
    """Classify citation status (resolved-shipped, cross-skill, tool, prerequisite, or dangling)."""
    norm = target.replace("\\", "/").strip().lstrip("./")

    if norm in PROSE_NON_CITATIONS:
        return "documented-prerequisite", f"Non-citation prose '{norm}'"

    if norm in EXTERNAL_WORKSPACE_PREREQUISITES:
        return "documented-prerequisite", EXTERNAL_WORKSPACE_PREREQUISITES[norm]

    if norm.startswith("evidence/E-") and norm.endswith(".md"):
        return "documented-prerequisite", f"Engagement case evidence artifact {norm}"

    if norm in REGISTERED_TOOLS:
        return "resolved-tool", f"Registered capability {norm}"

    if norm in CASE_ARTIFACTS or norm.endswith("-report.md"):
        return "documented-prerequisite", f"Engagement case artifact {norm}"

    base = Path(norm).name.lower()
    if norm.lower() in SYSTEM_TOOLS or base in SYSTEM_TOOLS or norm.endswith((".rule", ".rules", ".yar")):
        return "resolved-system", f"System tool or rule {norm}"

    # Cross-skill citation
    if raw.startswith("skill://"):
        parsed = parse_skill_uri(raw)
        if not parsed.get("valid"):
            return "dangling", parsed.get("error")
        target_skill = parsed["skillId"]
        subpath = parsed["subpath"] or "SKILL.md"
        target_path = shipped_tree / target_skill / subpath
        if target_path.is_file():
            return "resolved-cross-skill", str(target_path)
        return "dangling", f"Target asset '{subpath}' not found in skill '{target_skill}'"

    # Shipped local file
    if is_strict_path_citation(norm) or norm.endswith((".md", ".sh", ".py", ".ps1", ".txt", ".json", ".yaml", ".yml")):
        local_path = (shipped_tree / skill_id / norm).resolve()
        if str(local_path).startswith(str((shipped_tree / skill_id).resolve())) and local_path.is_file():
            return "resolved-shipped", str(local_path)
        if is_strict_path_citation(norm):
            return "dangling", f"Shipped support file '{norm}' does not exist in skill directory"

    # General command or URL
    if "://" in raw or raw.startswith(("http://", "https://", "ftp://")):
        return "resolved-system", f"External URL {raw}"

    return "documented-prerequisite", f"Contextual token {norm}"


def audit_citations(
    tree_dir: Path,
    skill_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Audit citations across playbooks in tree_dir, returning detailed metrics and dangling diagnostics."""
    if not tree_dir.is_dir():
        return {
            "playbooks_scanned": 0,
            "dangling_count": 0,
            "category_counts": {
                "resolved_shipped": 0,
                "resolved_cross_skill": 0,
                "resolved_system": 0,
                "resolved_tool": 0,
                "documented_prerequisite": 0,
                "dangling": 0,
            },
            "dangling": [],
            "resolutions": [],
        }

    all_dirs = sorted([d.name for d in tree_dir.iterdir() if d.is_dir() and (d / "SKILL.md").is_file()])
    target_ids = skill_ids if skill_ids is not None else all_dirs
    admitted_skills = set(all_dirs)

    scanned = 0
    dangling: list[dict[str, Any]] = []
    resolutions: list[dict[str, Any]] = []
    category_counts = {
        "resolved_shipped": 0,
        "resolved_cross_skill": 0,
        "resolved_system": 0,
        "resolved_tool": 0,
        "documented_prerequisite": 0,
        "dangling": 0,
    }

    md_engine = MarkdownIt()

    for skill_id in target_ids:
        skill_dir = tree_dir / skill_id
        if not skill_dir.is_dir():
            continue
        scanned += 1

        for md_file in sorted(skill_dir.rglob("*.md")):
            doc_rel = md_file.relative_to(skill_dir).as_posix()
            content = md_file.read_text(encoding="utf-8", errors="replace")

            try:
                tokens = md_engine.parse(content)
            except Exception:
                continue

            for token in tokens:
                if token.type != "inline" or not token.children:
                    continue
                for child in token.children:
                    raw_target = None
                    raw_text = ""
                    if child.type in ("link_open", "image"):
                        attrs = dict(child.attrs) if isinstance(child.attrs, list) else (child.attrs or {})
                        raw_target = attrs.get("href") or attrs.get("src")
                        raw_text = raw_target or ""
                    elif child.type == "code_inline":
                        code_val = child.content.strip()
                        if is_strict_path_citation(code_val):
                            raw_target = code_val
                            raw_text = code_val

                    if not raw_target:
                        continue

                    status, reason = classify_citation(
                        raw_text,
                        raw_target,
                        skill_id,
                        tree_dir,
                        admitted_skills,
                    )

                    rec = {
                        "skill": skill_id,
                        "file": doc_rel,
                        "line": token.map[0] + 1 if token.map else 1,
                        "raw": raw_text,
                        "target": raw_target,
                        "status": status,
                        "reason": reason,
                    }
                    resolutions.append(rec)
                    if status in category_counts:
                        category_counts[status] += 1

                    if status == "dangling":
                        dangling.append({
                            "skill": skill_id,
                            "file": doc_rel,
                            "line": token.map[0] + 1 if token.map else 1,
                            "column": 1,
                            "raw": raw_text,
                            "target": raw_target,
                            "reason": reason,
                        })

    dangling.sort(key=lambda d: (d["skill"], d.get("file", ""), d.get("line", 0), d.get("raw", "")))

    return {
        "playbooks_scanned": scanned,
        "dangling_count": len(dangling),
        "category_counts": category_counts,
        "dangling": dangling,
        "resolutions": resolutions,
    }


def plan_corpus_reference_materialization(
    repo_root: Path,
    preview: bool = True,
) -> dict[str, Any]:
    """Materialize missing support assets from upstream sources into src/corpus."""
    corpus_dir = repo_root / "src/corpus"
    manifest_path = corpus_dir / "MANIFEST.json"

    if not manifest_path.is_file():
        return {"totalSkillsConsidered": 0, "totalSupportFilesMaterialized": 0, "totalDanglingReferences": 0}

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    audit_res = audit_citations(corpus_dir)
    dangling_list = audit_res["dangling"]

    materialized_count = 0

    if not preview:
        from arsenal.corpus.manifest import serialize_corpus_manifest

        # Map each skill to its manifest entry
        entries_by_skill = {}
        for entry in manifest.get("files", []):
            dest = entry.get("destination_path", "")
            if dest.startswith("src/corpus/"):
                sk = dest[len("src/corpus/") :].split("/")[0]
                entries_by_skill[sk] = entry

        for dang in dangling_list:
            sk_id = dang["skill"]
            target = dang["target"].lstrip("./")
            entry = entries_by_skill.get(sk_id)
            if not entry:
                continue

            src = entry.get("source")
            src_path = entry.get("source_path") or entry.get("path")
            if not src or not src_path:
                continue

            up_skill_dir = (repo_root / "upstream" / src / Path(src_path).parent).resolve()
            candidate_file = up_skill_dir / target
            if not candidate_file.is_file():
                # Try references/ or scripts/ relative to upstream sourceRoot
                candidate_file = repo_root / "upstream" / src / target

            if candidate_file.is_file():
                dest_file = corpus_dir / sk_id / target
                dest_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(candidate_file, dest_file)
                h = hashlib.sha256(dest_file.read_bytes()).hexdigest()
                size = dest_file.stat().st_size

                support_files = entry.setdefault("support_files", [])
                if not any(sf.get("path") == target for sf in support_files):
                    support_files.append({
                        "path": target,
                        "source_path": f"{Path(src_path).parent}/{target}",
                        "sha256": h,
                        "bytes": size,
                    })
                materialized_count += 1

        manifest_path.write_text(serialize_corpus_manifest(manifest), encoding="utf-8")

    return {
        "totalSkillsConsidered": audit_res["playbooks_scanned"],
        "totalSupportFilesMaterialized": materialized_count,
        "totalDanglingReferences": len(dangling_list),
    }
