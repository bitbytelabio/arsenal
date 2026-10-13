"""Per-skill and corpus-level normalization pipeline.

Implements specs/002-refactor-skill-corpus, contracts/skill-standard.md.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any, Final

from arsenal.corpus.frontmatter import (
    bound_description,
    normalize_description,
    parse_skill_document,
    serialize_skill_document,
    validate_canonical_skill_frontmatter,
)
from arsenal.corpus.manifest import (
    compare_manifest_entries,
    compute_manifest_summary,
    serialize_corpus_manifest,
    sha256_file,
)
from arsenal.corpus.naming import (
    FORBIDDEN_VENDOR_SEGMENTS,
    SkillDomain,
    derive_skill_id,
    derive_skill_slug,
    is_valid_skill_domain,
    parse_skill_id,
)

DECLARED_DOMAIN_CATEGORIES: Final[dict[str, tuple[str, ...]]] = {
    "re": (
        "binary-analysis",
        "decompilation",
        "exploitation",
        "forensics",
        "firmware",
        "cryptography",
    ),
    "mobile": (
        "apk-analysis",
        "ios-analysis",
        "instrumentation",
        "repackaging",
    ),
    "webapp": (
        "injection",
        "traversal",
        "authz",
        "api",
        "client-side",
        "application-security",
        "security-operations",
        "threat-intelligence",
        "endpoint-security",
        "container-security",
        "ot-ics",
        "devsecops",
        "vulnerability-management",
        "compliance",
        "reconnaissance",
        "ai-security",
    ),
    "red": (
        "active-directory",
        "privesc",
        "evasion",
        "network",
        "cloud-security",
        "wireless",
        "threat-intelligence",
        "c2-operations",
        "social-engineering",
        "credential-access",
        "persistence",
        "reconnaissance",
    ),
}


def get_declared_domain_categories(domain: str, repo_root: Path = Path(".")) -> list[str]:
    """Read declared categories for domain from presets/<domain>/routing.json, with fallback."""
    routing_path = repo_root / f"presets/{domain}/routing.json"
    if routing_path.is_file():
        try:
            data = json.loads(routing_path.read_text(encoding="utf-8"))
            cats = data.get("categories")
            if isinstance(cats, list) and all(isinstance(c, str) for c in cats):
                return cats
        except Exception:
            pass
    return list(DECLARED_DOMAIN_CATEGORIES.get(domain, ()))


def normalize_skill_category(
    domain: str,
    upstream_category: str = "",
    slug: str = "",
) -> str:
    """Normalize upstream skill category to domain's closed set."""
    if not is_valid_skill_domain(domain):
        raise ValueError(f"Invalid skill domain '{domain}'. Must be re, webapp, mobile, or red.")

    c = (upstream_category or "").lower().strip()
    s = (slug or "").lower().strip()

    if domain == "re":
        if any(w in c or w in s for w in ("crypto", "certificate", "tls", "aes", "rsa", "hashcat", "hsm", "signatures")):
            return "cryptography"
        if any(w in c or w in s for w in ("forensic", "memory", "event-log", "hindsight", "artifact", "kape")):
            return "forensics"
        if any(w in c or w in s for w in ("firmware", "hardware", "chipsec", "uefi", "iot")):
            return "firmware"
        if any(w in c or w in s for w in ("exploit", "pwn", "fuzz", "patch-diff", "overflow", "rop", "heap")):
            return "exploitation"
        if any(w in c or w in s for w in ("decompil", "ida", "ghidra", "radare", "binary-ninja")):
            return "decompilation"
        return "binary-analysis"

    if domain == "mobile":
        if any(w in c or w in s for w in ("ios", "ipa", "macho", "keychain")):
            return "ios-analysis"
        if any(w in s for w in ("frida", "objection", "hook", "pinning", "pinnin", "instrumentation")):
            return "instrumentation"
        if any(w in s for w in ("repack", "smali")):
            return "repackaging"
        return "apk-analysis"

    if domain == "webapp":
        if any(w in s for w in ("sqli", "sql-injection", "xss", "csrf", "ssrf", "ssti", "xxe", "deserializ", "command-injection", "ldap-injection", "template-injection", "injection")):
            return "injection"
        if any(w in s for w in ("path-traversal", "directory-traversal", "lfi", "rfi", "file-inclusion", "traversal")):
            return "traversal"
        if any(w in s for w in ("auth", "jwt", "session", "oauth", "sso", "saml", "idor", "access-control", "privilege-escalation")):
            return "authz"
        if any(w in s for w in ("api", "graphql", "rest", "grpc", "websocket", "endpoint", "swagger", "openapi")):
            return "api"
        if any(w in s for w in ("dom", "cors", "csp", "postmessage", "client-side", "prototype-pollution", "clickjacking", "browser")):
            return "client-side"
        if any(w in s for w in ("threat-intel", "threat-intelligence", "apt", "adversary", "yara", "sigma", "hunting")):
            return "threat-intelligence"
        if any(w in s for w in ("container", "docker", "k8s", "kubernetes", "podman")):
            return "container-security"
        if any(w in s for w in ("ci-cd", "cicd", "pipeline", "git", "github", "gitlab", "devsecops")):
            return "devsecops"
        if any(w in s for w in ("ot", "ics", "scada", "plc", "modbus")):
            return "ot-ics"
        if any(w in s for w in ("compliance", "pci", "hipaa", "iso27001", "gdpr", "soc2", "audit")):
            return "compliance"
        if any(w in s for w in ("recon", "subdomain", "dns", "osint", "whois", "shodan", "scanning", "enumeration")):
            return "reconnaissance"
        if any(w in s for w in ("ai", "llm", "prompt-injection", "agentic", "model")):
            return "ai-security"
        return "application-security"

    if domain == "red":
        if any(w in s for w in ("ad-", "active-directory", "kerberoast", "bloodhound", "kerberos", "ldap", "domain-controller", "gpo", "mimikatz", "ntlm", "smb", "adcs")):
            return "active-directory"
        if any(w in s for w in ("privesc", "privilege-escalation", "elevation", "uac-bypass", "sudo", "suid")):
            return "privesc"
        if any(w in s for w in ("evasion", "edr", "antivirus", "amisi", "obfuscation", "unhooking")):
            return "evasion"
        if any(w in s for w in ("network", "port-scanning", "tunneling", "pivoting", "proxy", "vpn", "traffic")):
            return "network"
        if any(w in s for w in ("cloud", "aws", "azure", "gcp", "iam", "s3")):
            return "cloud-security"
        if any(w in s for w in ("wifi", "wireless", "802.11", "wpa", "bluetooth", "ble")):
            return "wireless"
        if any(w in s for w in ("c2", "cobalt-strike", "command-and-control", "payload", "implant", "beacon")):
            return "c2-operations"
        if any(w in s for w in ("phishing", "social-engineering", "pretexting", "spearphishing")):
            return "social-engineering"
        if any(w in s for w in ("credential", "dumping", "lsass", "sam", "keylogger", "password-spray")):
            return "credential-access"
        if any(w in s for w in ("persistence", "backdoor", "scheduled-task", "service-installation", "registry-run")):
            return "persistence"
        if any(w in s for w in ("recon", "osint", "discovery", "footprinting")):
            return "reconnaissance"
        return "active-directory"

    return "binary-analysis"


def sanitize_body_vendor_tokens(body: str) -> str:
    """Sanitize forbidden vendor tokens in markdown body prose."""
    cleaned = body.strip()
    for token in FORBIDDEN_VENDOR_SEGMENTS:
        pattern = re.compile(rf"(?i)(?<=^|[^a-zA-Z0-9])({re.escape(token)})(?=[^a-zA-Z0-9]|$)", re.IGNORECASE)

        def repl(match: re.Match[str]) -> str:
            matched_str = match.group(1).lower()
            replacement = "arsenal"
            if matched_str == "strix":
                replacement = "scanner"
            elif matched_str == "anthropic":
                replacement = "ai-provider"
            elif "claude" in matched_str:
                replacement = "red-team"
            elif "revskill" in matched_str:
                replacement = "reverse"
            if match.group(1).isupper():
                replacement = replacement.upper()
            elif match.group(1)[0].isupper():
                replacement = replacement.capitalize()
            return replacement

        cleaned = pattern.sub(repl, cleaned)
    return cleaned


def normalize_skill_document(
    content: str,
    domain: SkillDomain,
    technique_slug: str,
    source: str = "arsenal-local",
    source_path: str = "",
    source_rev: str | None = None,
    license: str = "Apache-2.0",
) -> dict[str, Any]:
    """Normalize a single skill document according to standard specifications."""
    errors: list[str] = []
    canonical_id = derive_skill_id(domain, technique_slug)

    parsed = parse_skill_document(content)
    raw_data = parsed["data"] if parsed else {}
    body_content = parsed["body"] if parsed else content

    slug_for_category = derive_skill_slug(technique_slug, domain)
    upstream_category = str(raw_data.get("category", ""))
    category = normalize_skill_category(domain, upstream_category, slug_for_category)

    raw_desc = str(raw_data.get("description", ""))
    if not raw_desc:
        desc_match = re.search(r"^##\s+Description\s*\n+([^\n#]+)", body_content, re.MULTILINE)
        raw_desc = desc_match.group(1).strip() if desc_match else ""

    bounded_desc = bound_description(raw_desc or f"Security analysis methodology for {canonical_id}.")
    if len(bounded_desc) < 40:
        bounded_desc = bounded_desc.ljust(40, ".")

    cleaned_body = sanitize_body_vendor_tokens(body_content)

    canonical_frontmatter = {
        "name": canonical_id,
        "description": bounded_desc,
        "domain": domain,
        "category": category,
        "hide": True,
        "license": license,
        "metadata": {
            "manifest_entry": f"src/corpus/{canonical_id}/SKILL.md",
        },
    }

    valid_fm, fm_errors = validate_canonical_skill_frontmatter(canonical_frontmatter)
    if not valid_fm:
        errors.extend(fm_errors)

    serialized = serialize_skill_document(canonical_frontmatter, cleaned_body)
    import hashlib
    content_hash = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    content_bytes = len(serialized.encode("utf-8"))

    manifest_entry = {
        "path": source_path or f"skills/{canonical_id}/SKILL.md",
        "source": source,
        "source_rev": source_rev,
        "license": license,
        "status": "admitted",
        "destination_path": f"src/corpus/{canonical_id}/SKILL.md",
        "sha256": content_hash,
        "bytes": content_bytes,
        "source_path": source_path or f"skills/{canonical_id}/SKILL.md",
        "source_sha256": content_hash,
    }

    return {
        "canonicalId": canonical_id,
        "domain": domain,
        "category": category,
        "description": bounded_desc,
        "frontmatter": canonical_frontmatter,
        "body": cleaned_body,
        "serialized": serialized,
        "sha256": content_hash,
        "bytes": content_bytes,
        "manifestEntry": manifest_entry,
        "valid": len(errors) == 0,
        "errors": errors,
    }


def normalize_corpus(
    repo_root: Path,
    write: bool = False,
    domain_filter: str | None = None,
) -> dict[str, Any]:
    """Normalize all skills in src/corpus/ and update MANIFEST.json."""
    corpus_dir = repo_root / "src/corpus"
    manifest_path = corpus_dir / "MANIFEST.json"

    errors: list[str] = []
    changes: list[dict[str, Any]] = []

    previous_manifest: dict[str, Any] | None = None
    if manifest_path.is_file():
        try:
            previous_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as e:
            errors.append(f"Failed to read existing MANIFEST.json: {e}")

    candidate_results: list[dict[str, Any]] = []
    if corpus_dir.is_dir():
        for d in sorted(corpus_dir.iterdir()):
            if not d.is_dir():
                continue
            skill_file = d / "SKILL.md"
            if not skill_file.is_file():
                continue

            content = skill_file.read_text(encoding="utf-8")
            parsed_id = parse_skill_id(d.name)
            domain = parsed_id[0] if parsed_id else "re"

            if domain_filter and domain != domain_filter:
                continue

            # Lookup existing entry
            existing_entry = None
            if previous_manifest:
                dest = f"src/corpus/{d.name}/SKILL.md"
                existing_entry = next(
                    (f for f in previous_manifest.get("files", []) if f.get("destination_path") == dest),
                    None,
                )

            norm = normalize_skill_document(
                content=content,
                domain=domain,
                technique_slug=d.name,
                source=existing_entry.get("source", "arsenal-local") if existing_entry else "arsenal-local",
                source_path=existing_entry.get("path", f"skills/{d.name}/SKILL.md") if existing_entry else f"skills/{d.name}/SKILL.md",
                source_rev=existing_entry.get("source_rev") if existing_entry else None,
                license=existing_entry.get("license", "Apache-2.0") if existing_entry else "Apache-2.0",
            )

            if existing_entry and "support_files" in existing_entry:
                norm["manifestEntry"]["support_files"] = existing_entry["support_files"]

            if not norm["valid"]:
                errors.extend(f"[{d.name}] {e}" for e in norm["errors"])

            candidate_results.append(norm)

            if write and norm["serialized"] != content:
                skill_file.write_text(norm["serialized"], encoding="utf-8")
                changes.append({"skill": d.name, "updated": True})

    all_files = [c["manifestEntry"] for c in candidate_results]
    all_files.sort(key=lambda f: (f.get("path", ""), f.get("source", "")))

    summary = compute_manifest_summary(all_files)
    manifest = {
        "schema_version": 1,
        "generator": "arsenal",
        "created_at": None,
        "summary": summary,
        "sources": previous_manifest.get("sources", {}) if previous_manifest else {},
        "files": all_files,
    }

    if write and manifest_path.parent.is_dir():
        manifest_path.write_text(serialize_corpus_manifest(manifest), encoding="utf-8")

    return {
        "summary": summary,
        "totalConsidered": summary["total_considered"],
        "admitted": summary["admitted"],
        "deduplicated": summary["deduplicated"],
        "quarantined": summary["quarantined"],
        "excluded": summary["excluded"],
        "manifest": manifest,
        "changes": changes,
        "errors": errors,
    }
