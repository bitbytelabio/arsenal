"""Engagement scope parsing, schema validation, target attribution, and CLI handling."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from arsenal.common import Context, ExitCodes
from arsenal.storage import sha256_string

DOMAINS = {"re", "webapp", "mobile", "red"}
AUTH_STATUSES = {"incomplete", "granted", "expired", "revoked"}
try:
    from arsenal.schemas import schema, validate
    SCOPE_SCHEMA: dict[str, Any] = schema("SCOPE_SCHEMA")
except Exception:
    SCOPE_SCHEMA = {}
    validate = None


def parse_scope(json_or_path: str | Path) -> dict[str, Any]:
    """Parse and strictly validate a scope JSON document or path using JSON Schema."""
    if isinstance(json_or_path, Path):
        content = json_or_path.read_text(encoding="utf-8")
    else:
        candidate = str(json_or_path)
        try:
            content = Path(candidate).read_text(encoding="utf-8") if len(candidate) < 4096 and Path(candidate).is_file() else candidate
        except OSError:
            content = candidate

    try:
        doc = json.loads(content)
    except Exception as e:
        raise ValueError(f"Scope JSON parsing failed: {e}") from e

    if not isinstance(doc, dict):
        raise ValueError("Scope document must be a JSON object.")

    if validate is not None:
        errors = validate("SCOPE_SCHEMA", doc)
        if errors:
            raise ValueError(f"Scope validation failed: {'; '.join(errors)}")
    else:
        # Direct validation fallback
        required_keys = [
            "schema_version",
            "engagement_id",
            "name",
            "created_at",
            "domain",
            "auth",
            "in_scope",
            "out_of_scope",
            "disallowed_actions",
            "window",
        ]
        missing = [k for k in required_keys if k not in doc]
        if missing:
            raise ValueError(f"Scope document missing required fields: {', '.join(missing)}")
        if doc.get("schema_version") != 1:
            raise ValueError(f"Unsupported schema_version: {doc.get('schema_version')}, expected 1")
        if doc.get("domain") not in DOMAINS:
            raise ValueError(f"Invalid domain: '{doc.get('domain')}', expected one of {sorted(DOMAINS)}")
        auth = doc.get("auth")
        if not isinstance(auth, dict) or "status" not in auth or "ready_for_act" not in auth:
            raise ValueError("Scope auth section must include 'status' and 'ready_for_act'")
        if auth["status"] not in AUTH_STATUSES:
            raise ValueError(f"Invalid auth status: '{auth['status']}', expected one of {sorted(AUTH_STATUSES)}")
        window = doc.get("window")
        if not isinstance(window, dict) or "start" not in window or "end" not in window:
            raise ValueError("Scope window section must include 'start' and 'end'")

    window = doc["window"]
    try:
        start_dt = datetime.fromisoformat(window["start"].replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(window["end"].replace("Z", "+00:00"))
        if start_dt >= end_dt:
            raise ValueError("Scope window invalid: start time must precede end time.")
    except Exception as e:
        if "start time must precede end time" in str(e):
            raise
        raise ValueError(f"Invalid date in scope window: {e}") from e

    budget = doc.get("budget_usd")
    if budget is not None:
        try:
            num = float(budget)
            if num <= 0:
                raise ValueError("Scope budget_usd invalid: must be a positive decimal number or null.")
        except Exception as e:
            raise ValueError("Scope budget_usd invalid: must be a positive decimal number or null.") from e

    return doc

def matches_selector(target: str, selector: str) -> bool:
    """Check if target matches a wildcard, prefix, or URL selector."""
    if selector == "*" or selector == target:
        return True

    if selector.endswith("/*"):
        prefix = selector[:-1]
        if target.startswith(prefix) or target == selector[:-2]:
            return True

    if selector.endswith("*"):
        prefix = selector[:-1]
        if target.startswith(prefix):
            return True

    if selector.startswith("*."):
        suffix = selector[1:]
        if target.endswith(suffix) or target == selector[2:]:
            return True

    # URL-aware hostname matching
    try:
        parsed = urlparse(target if "://" in target else f"http://{target}")
        hostname = parsed.hostname or ""
        host = parsed.netloc or ""
        if hostname == selector or host == selector:
            return True
        if selector.startswith("*."):
            suffix = selector[1:]
            if hostname.endswith(suffix) or hostname == selector[2:]:
                return True
    except Exception:
        pass

    return target == selector


def attribute_target(target: str, scope: dict[str, Any]) -> dict[str, Any]:
    """Attribute target against declared scope. Exclusions win first; empty inclusions mean incomplete."""
    normalized = target.strip()
    if not normalized:
        return {
            "status": "unknown",
            "reason": "Target is empty or undefined.",
        }

    # Exclusions win first
    for exclusion in scope.get("out_of_scope", []):
        if matches_selector(normalized, str(exclusion)):
            return {
                "status": "out_of_scope",
                "matchingSelector": str(exclusion),
                "reason": f"Target explicitly matches out-of-scope selector: '{exclusion}'",
            }

    # Empty inclusions mean incomplete scope
    in_scope = scope.get("in_scope", [])
    if not in_scope:
        return {
            "status": "unknown",
            "reason": "Scope has no defined in-scope selectors; empty inclusion is incomplete scope.",
        }

    for inclusion in in_scope:
        if matches_selector(normalized, str(inclusion)):
            return {
                "status": "in_scope",
                "matchingSelector": str(inclusion),
                "reason": f"Target matches in-scope selector: '{inclusion}'",
            }

    return {
        "status": "unknown",
        "reason": "Target did not match any in-scope or out-of-scope selectors.",
    }


def resolve_active_scope(workspace_dir: Path | str | None = None) -> dict[str, Any]:
    """Resolve active scope from environment or workspace files."""
    wk = Path(workspace_dir).resolve() if workspace_dir else Path.cwd().resolve()
    candidate_paths: list[Path] = []

    env_scope = os.environ.get("ARSENAL_SCOPE_FILE")
    if env_scope:
        candidate_paths.append(Path(env_scope).resolve())

    candidate_paths.append(wk / ".omp" / "scope.json")
    candidate_paths.append(wk / ".omp" / "arsenal" / "scope.json")

    for cand in candidate_paths:
        if cand.is_file():
            try:
                raw = cand.read_text(encoding="utf-8")
                doc = parse_scope(raw)
                h = sha256_string(raw)
                return {
                    "scope": doc,
                    "scopeSha256": h,
                    "scopePath": str(cand),
                }
            except Exception:
                continue

    return {"scope": None, "scopeSha256": None, "scopePath": None}


def check_scope_or_prompt(
    target: str,
    workspace_dir: Path | str | None = None,
    prompt_callback: Callable[[str], str] | None = None,
) -> dict[str, Any]:
    """Check scope attribution with interactive fallback."""
    resolved = resolve_active_scope(workspace_dir)
    scope = resolved.get("scope")
    if scope:
        attr = attribute_target(target, scope)
        if attr["status"] == "in_scope":
            return {
                "allowed": True,
                "action": "proceed",
                "target": target,
                "reason": f"Target matches in_scope selector: {attr.get('matchingSelector')}",
            }
        if attr["status"] == "out_of_scope":
            return {
                "allowed": False,
                "action": "abort",
                "target": target,
                "reason": f"Target is explicitly OUT OF SCOPE: {attr.get('matchingSelector')}",
            }

    scope_path = resolved.get("scopePath")
    prompt_text = f"Target '{target}' is not registered in active scope ({scope_path or 'missing'}). Add target to scope, proceed conditionally, or abort? [add/proceed/abort]"
    answer = prompt_callback(prompt_text) if prompt_callback else "proceed"
    norm = answer.strip().lower()

    if norm in ("add",):
        return {
            "allowed": True,
            "action": "added",
            "target": target,
            "reason": "Target dynamically added to active scope by operator",
        }
    if norm in ("proceed", "yes", "y"):
        return {
            "allowed": True,
            "action": "proceed",
            "target": target,
            "reason": "Operator authorized conditional execution",
        }
    return {
        "allowed": False,
        "action": "abort",
        "target": target,
        "reason": "Operator aborted out-of-scope operation",
    }


def create_default_scope(auth_ref: str = "Authorized Operator") -> dict[str, Any]:
    """Create a default skeleton scope document."""
    now = datetime.now(timezone.utc).isoformat()
    return {
        "schema_version": 1,
        "engagement_id": "eng-default",
        "name": "Active Security Engagement",
        "created_at": now,
        "domain": "webapp",
        "auth": {
            "status": "granted",
            "basis": "Client Authorization",
            "reference": auth_ref,
            "ready_for_act": True,
        },
        "in_scope": [],
        "out_of_scope": [],
        "disallowed_actions": ["dos"],
        "window": {
            "start": now,
            "end": datetime.fromtimestamp(datetime.now().timestamp() + 86400 * 30, tz=timezone.utc).isoformat(),
            "timezone": "UTC",
        },
    }


def handle_scope(ctx: Context) -> int:
    """CLI handler for 'arsenal scope'."""
    subcommand = ctx.subcommand or "show"
    arsenal_path = ctx.repo_root / ".omp" / "arsenal" / "scope.json"
    legacy_path = ctx.repo_root / ".omp" / "scope.json"
    scope_path = arsenal_path if arsenal_path.exists() else (legacy_path if legacy_path.exists() else arsenal_path)
    engagement_path = ctx.repo_root / ".omp" / "engagement.json"

    if subcommand == "add":
        target = ctx.values.get("target") or (ctx.positionals[0] if ctx.positionals else None)
        exclude = ctx.values.get("exclude")
        auth_ref = ctx.values.get("auth") or "Authorized Operator"

        current_scope: dict[str, Any]
        if scope_path.is_file():
            try:
                current_scope = parse_scope(scope_path)
            except Exception:
                current_scope = create_default_scope(str(auth_ref))
        else:
            current_scope = create_default_scope(str(auth_ref))

        if target and target not in current_scope["in_scope"]:
            current_scope["in_scope"].append(str(target))
        if exclude and exclude not in current_scope["out_of_scope"]:
            current_scope["out_of_scope"].append(str(exclude))

        scope_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        scope_path.write_text(json.dumps(current_scope, indent=2), encoding="utf-8")
        try:
            os.chmod(scope_path, 0o600)
        except OSError:
            pass

        data = {
            "scopePath": str(scope_path),
            "addedTarget": target,
            "addedExclude": exclude,
            "inScope": current_scope["in_scope"],
            "outOfScope": current_scope["out_of_scope"],
        }
        if not ctx.is_json:
            print(f"[arsenal scope add] Updated scope at '{scope_path}':")
            if target:
                print(f" + In-Scope: {target}")
            if exclude:
                print(f" - Out-of-Scope: {exclude}")
        return ctx.result(data, code=ExitCodes.SUCCESS)

    # Show / inspect
    if not scope_path.is_file():
        msg = f"No scope file found at '{scope_path}'. Run 'arsenal scope add --target <url>' first."
        return ctx.fail(msg, code=ExitCodes.ENVIRONMENT_UNAVAILABLE)

    try:
        scope_doc = parse_scope(scope_path)
    except Exception as e:
        return ctx.fail(f"Error parsing scope: {e}", code=ExitCodes.CHECK_FAILURE)

    engagement_doc: dict[str, Any] = {}
    if engagement_path.is_file():
        try:
            engagement_doc = json.loads(engagement_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    scope_data = {
        "engagement_id": scope_doc["engagement_id"],
        "name": scope_doc["name"],
        "domain": scope_doc["domain"],
        "auth_status": scope_doc["auth"]["status"],
        "ready_for_act": scope_doc["auth"]["ready_for_act"],
        "basis": scope_doc["auth"].get("basis"),
        "reference": scope_doc["auth"].get("reference"),
        "in_scope": scope_doc["in_scope"],
        "out_of_scope": scope_doc["out_of_scope"],
        "disallowed_actions": scope_doc["disallowed_actions"],
        "window": scope_doc["window"],
        "budget_usd": scope_doc.get("budget_usd"),
        "charter_path": scope_doc.get("charter_path"),
        "engagement_status": engagement_doc.get("status", "unknown"),
    }

    if not ctx.is_json:
        print("=" * 80)
        print("                     ENGAGEMENT SCOPE & AUTHORIZATION                           ")
        print("=" * 80)
        print(f"Engagement ID : {scope_doc['engagement_id']}")
        print(f"Name          : {scope_doc['name']}")
        print(f"Domain        : {scope_doc['domain']}")
        print(f"Auth Status   : {scope_doc['auth']['status'].upper()} (ready_for_act: {scope_doc['auth']['ready_for_act']})")
        print(f"Signatory Ref : {scope_doc['auth'].get('reference') or 'None'}")
        print(f"Auth Basis    : {scope_doc['auth'].get('basis') or 'None'}")
        print(f"Budget (USD)  : {scope_doc.get('budget_usd') or 'None'}")
        print(f"Window        : {scope_doc['window']['start']} -> {scope_doc['window']['end']} ({scope_doc['window']['timezone']})")
        print("-" * 80)
        print(f"In-Scope Targets ({len(scope_doc['in_scope'])}):")
        if not scope_doc["in_scope"]:
            print("  (none defined - incomplete scope)")
        for t in scope_doc["in_scope"]:
            print(f"  + {t}")
        print(f"Out-of-Scope Exclusions ({len(scope_doc['out_of_scope'])}):")
        if not scope_doc["out_of_scope"]:
            print("  (none defined)")
        for e in scope_doc["out_of_scope"]:
            print(f"  - {e}")
        print(f"Disallowed Actions ({len(scope_doc['disallowed_actions'])}):")
        for d in scope_doc["disallowed_actions"]:
            print(f"  ! {d}")
        print("=" * 80)

    return ctx.result(scope_data, code=ExitCodes.SUCCESS)


handle = handle_scope
