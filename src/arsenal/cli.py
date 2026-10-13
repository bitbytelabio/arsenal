"""Arsenal CLI dispatcher and argument parsing engine."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from arsenal.common import Context, ExitCodes, VERSION, create_json_envelope, emit_json
from arsenal.workspace import find_workspace_root


class CLIArgumentError(Exception):
    """Raised when command line arguments violate syntax or option contracts."""
    pass


class ArsenalArgumentParser(argparse.ArgumentParser):
    """ArgumentParser that raises CLIArgumentError instead of hard sys.exit."""

    def error(self, message: str) -> None:
        raise CLIArgumentError(message)


def build_cli_parser() -> ArsenalArgumentParser:
    """Build the official argparse-based CLI argument parser with command subparsers."""
    # Shared parent parser for all global options with SUPPRESS defaults
    parent = argparse.ArgumentParser(add_help=False)
    parent.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--write", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--force", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--check", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--repo", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--profile", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--dir", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--preset", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--name", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--out", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--output", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--server", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--file", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--metadata", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--source", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--live", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--fix", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--schema", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--drift", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--mcp", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--tools", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--smoke", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--hint", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--scenario", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--workspace", type=str, default=argparse.SUPPRESS)
    parent.add_argument("-h", "--help", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--target", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--skill", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--from", "--from_", dest="from_path", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--slug", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--domain", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--prompt-file", "--prompt_file", dest="prompt_file", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--check-determinism", "--check_determinism", action="store_true", default=argparse.SUPPRESS, dest="check_determinism")
    parent.add_argument("--language", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--domains", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--apply-tier-a", "--apply_tier_a", action="store_true", default=argparse.SUPPRESS, dest="apply_tier_a")
    parent.add_argument("--apply-alias", "--apply_alias", dest="apply_alias", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--map", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--case-root", "--case_root", "--caseRoot", dest="case_root", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--strict", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--verify-hashes", "--verify_hashes", action="store_true", default=argparse.SUPPRESS, dest="verify_hashes")
    parent.add_argument("--format", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--apk", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--uri", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--min-severity", "--min_severity", dest="min_severity", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--exclude", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--auth", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--expire", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--depth", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--phase", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--finding", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--finding-id", "--finding_id", "--findingId", dest="finding_id", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--oracle", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--oracle-type", "--oracle_type", "--type", dest="oracle_type", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--params", "--parameters", dest="parameters", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--evidence-ids", "--evidence_ids", "--evidenceIds", dest="evidence_ids", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--title", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--description", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--severity", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--status", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--confidence", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--location", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--cwe", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--remediation", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--safe-mode", action="store_true", default=argparse.SUPPRESS, dest="safe_mode")
    parent.add_argument("--no-safe-mode", action="store_false", dest="safe_mode", default=argparse.SUPPRESS)
    parent.add_argument("--verbose", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--show", action="store_true", default=argparse.SUPPRESS)
    parent.add_argument("--scope", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--no-ledger-commit", "--no_ledger_commit", action="store_true", default=argparse.SUPPRESS, dest="no_ledger_commit")
    parent.add_argument("--timeout", type=int, default=argparse.SUPPRESS)
    parent.add_argument("--timeout-ms", "--timeout_ms", type=int, default=argparse.SUPPRESS, dest="timeout_ms")
    parent.add_argument("--cwd", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--query", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--category", type=str, default=argparse.SUPPRESS)
    parent.add_argument("--limit", type=int, default=argparse.SUPPRESS)
    parent.add_argument("--offset", type=int, default=argparse.SUPPRESS)

    root = ArsenalArgumentParser(prog="arsenal", parents=[parent], add_help=False)
    sub = root.add_subparsers(dest="family")

    # 1. scripts: captures script_id and forwards remaining arguments as REMAINDER without swallowing flags
    p_scripts = sub.add_parser("scripts", add_help=False)
    p_scripts.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    p_scripts.add_argument("--repo", type=str, default=argparse.SUPPRESS)
    p_scripts.add_argument("--profile", type=str, default=argparse.SUPPRESS)
    p_scripts.add_argument("--list", action="store_true", default=argparse.SUPPRESS)
    p_scripts.add_argument("-h", "--help", action="store_true", default=argparse.SUPPRESS)
    p_scripts.add_argument("script_id", nargs="?", default=None)
    p_scripts.add_argument("script_args", nargs=argparse.REMAINDER)

    # 2. exec: captures command arguments as REMAINDER
    p_exec = sub.add_parser("exec", parents=[parent], add_help=False)
    p_exec.add_argument("exec_cmd", nargs=argparse.REMAINDER)

    # 3. evidence
    p_ev = sub.add_parser("evidence", parents=[parent], add_help=False)
    p_ev.add_argument("subcommand", nargs="?", default="verify")
    p_ev.add_argument("extra_positionals", nargs="*")

    # 4. context
    p_ctx = sub.add_parser("context", parents=[parent], add_help=False)
    p_ctx.add_argument("subcommand", nargs="?", default=None)

    # 5. init
    p_init = sub.add_parser("init", parents=[parent], add_help=False)
    p_init.add_argument("target", nargs="?", default=None)

    # 6. scope
    p_scope = sub.add_parser("scope", parents=[parent], add_help=False)
    p_scope.add_argument("subcommand", nargs="?", default="show")
    p_scope.add_argument("target_pos", nargs="?", default=None)

    # 7. tools
    p_tools = sub.add_parser("tools", parents=[parent], add_help=False)
    p_tools.add_argument("subcommand", nargs="?", default="check")
    p_tools.add_argument("tool_args", nargs="*")

    # 8. doctor
    sub.add_parser("doctor", parents=[parent], add_help=False)

    # 9. case
    p_case = sub.add_parser("case", parents=[parent], add_help=False)
    p_case.add_argument("subcommand", nargs="?", default=None)
    p_case.add_argument("case_args", nargs="*")

    # 10. report
    p_rep = sub.add_parser("report", parents=[parent], add_help=False)
    p_rep.add_argument("subcommand", nargs="?", default=None)
    p_rep.add_argument("report_args", nargs="*")

    # 11. build
    p_bld = sub.add_parser("build", parents=[parent], add_help=False)
    p_bld.add_argument("subcommand", nargs="?", default=None)
    p_bld.add_argument("build_args", nargs="*")

    # 12. skills & vendor
    p_sk = sub.add_parser("skills", parents=[parent], add_help=False)
    p_sk.add_argument("subcommand", nargs="?", default=None)
    p_sk.add_argument("skill_args", nargs="*")

    p_ven = sub.add_parser("vendor", parents=[parent], add_help=False)
    p_ven.add_argument("subcommand", nargs="?", default=None)
    p_ven.add_argument("vendor_args", nargs="*")

    # 13. profile, plugin, mcp
    p_prof = sub.add_parser("profile", parents=[parent], add_help=False)
    p_prof.add_argument("subcommand", nargs="?", default=None)
    p_prof.add_argument("profile_args", nargs="*")

    p_plug = sub.add_parser("plugin", parents=[parent], add_help=False)
    p_plug.add_argument("subcommand", nargs="?", default=None)
    p_plug.add_argument("plugin_args", nargs="*")

    p_mcp = sub.add_parser("mcp", parents=[parent], add_help=False)
    p_mcp.add_argument("subcommand", nargs="?", default=None)
    p_mcp.add_argument("mcp_args", nargs="*")

    # 14. apk & oracle
    p_apk = sub.add_parser("apk", parents=[parent], add_help=False)
    p_apk.add_argument("subcommand", nargs="?", default="inspect")
    p_apk.add_argument("apk_args", nargs="*")

    p_orc = sub.add_parser("oracle", parents=[parent], add_help=False)
    p_orc.add_argument("subcommand", nargs="?", default="verify")
    p_orc.add_argument("oracle_args", nargs="*")

    return root


def parse_cli_args(args: list[str]) -> tuple[dict[str, object], list[str], list[str]]:
    """Parse command line arguments using official stdlib argparse."""
    remainder: list[str] = []
    main_args = args

    if "--" in args:
        dash_idx = args.index("--")
        main_args = args[:dash_idx]
        remainder = args[dash_idx + 1 :]

    parser = build_cli_parser()
    parsed = parser.parse_args(main_args)

    values: dict[str, object] = {}
    for k, v in vars(parsed).items():
        if v is not None:
            values[k] = v
            values[k.replace("_", "-")] = v

    if getattr(parsed, "from_path", None) is not None:
        values["from"] = parsed.from_path
        values["from_"] = parsed.from_path

    positionals: list[str] = []
    if parsed.family:
        positionals.append(parsed.family)

        if parsed.family == "scripts":
            if parsed.script_id:
                positionals.append(parsed.script_id)
            if parsed.script_args:
                positionals.extend(parsed.script_args)
        elif parsed.family == "exec":
            if getattr(parsed, "exec_cmd", None):
                positionals.extend(parsed.exec_cmd)
        else:
            subcmd = getattr(parsed, "subcommand", None) or getattr(parsed, "target", None)
            if subcmd:
                positionals.append(subcmd)
            for attr in (
                "target_pos",
                "extra_positionals",
                "tool_args",
                "case_args",
                "report_args",
                "build_args",
                "skill_args",
                "vendor_args",
                "profile_args",
                "plugin_args",
                "mcp_args",
                "apk_args",
                "oracle_args",
            ):
                val = getattr(parsed, attr, None)
                if val:
                    if isinstance(val, list):
                        positionals.extend(val)
                    else:
                        positionals.append(val)
    values.setdefault("safe_mode", True)
    values.setdefault("safe-mode", True)
    is_json = bool(values.get("json")) or ("--json" in args)
    values["json"] = is_json
    values.setdefault("write", False)
    values.setdefault("check", False)
    values.setdefault("force", False)

    return values, positionals, remainder


def print_help(is_json: bool, mode: str) -> None:
    """Print top-level usage help or emit JSON envelope."""
    families = [
        "build",
        "profile",
        "context",
        "init",
        "scope",
        "plugin",
        "doctor",
        "tools",
        "evidence",
        "skills",
        "mcp",
        "vendor",
        "case",
        "report",
        "scripts",
        "exec",
        "apk",
        "oracle",
    ]
    if is_json:
        emit_json(
            create_json_envelope(
                command="arsenal",
                exit_code=ExitCodes.SUCCESS,
                mode=mode,
                data={"families": families},
            )
        )
    else:
        print(f"""Arsenal Security Engagement Harness v{VERSION}
Usage: arsenal <family> <command> [options]

Families:
  build      Compile SSOT plugin distribution
  profile    Manage operator profile (install, verify)
  context    Inspect and verify engagement context layers
  init       Scaffold or check target engagement repository
  scope      Inspect engagement authorization and scope
  plugin     Plugin lifecycle commands (link, pack)
  doctor     Run environment and system health diagnostics
  tools      Scan and check security binaries
  evidence   Capture, import, and audit cryptographic evidence
  skills     Route, index, and check guidance playbooks
  mcp        Manage and verify MCP tool bridges
  vendor     Vendor corpus sync and audit
  case       Review and audit case integrity and evidence graph
  report     Generate deliverables (Markdown, SARIF, JSON)
  scripts    Execute operational playbook scripts
  exec       Execute binary directly with evidence capture
  apk        Native APK manifest and component inspection
  oracle     Deterministic verification oracles

Global Options:
  --json                  Output in structured JSON envelope
  --write                 Authorize filesystem writes / modifications
  --force                 Force overwrite / clobber unmanaged content
  --check                 Report-only check mode (never mutates)
  --profile <path>        Path to operator profile directory
  --repo <path>           Path to engagement target repository
  --preset <preset>       Filter/scope by preset or domain (re, webapp, mobile, red)
  --case-root <path>      Path to case workspace root directory
  --strict                Treat warnings as a failed review
  --verify-hashes         Verify SHA-256 content_hash values against artifact_path
  --format <fmt>          Output format (markdown, json)
  -h, --help              Show usage information
""")


def dispatch(ctx: Context) -> int:
    """Dispatch parsed context to the designated command family handler."""
    family = ctx.family.lower()

    # CoreRuntime directly owned families
    if family == "evidence":
        from arsenal.evidence import handle as handle_evidence
        return handle_evidence(ctx)
    if family == "context":
        from arsenal.workspace import handle_context
        return handle_context(ctx)
    if family == "init":
        from arsenal.workspace import handle_init
        return handle_init(ctx)
    if family == "scope":
        from arsenal.scope import handle_scope
        return handle_scope(ctx)
    if family == "tools":
        from arsenal.tools import handle_tools
        return handle_tools(ctx)
    if family == "doctor":
        from arsenal.tools import handle_doctor
        return handle_doctor(ctx)
    if family == "exec":
        from arsenal.tools import handle_exec
        return handle_exec(ctx)

    # Lazy domain families
    if family == "case":
        from arsenal.cases import handle as handle_cases
        return handle_cases(ctx)

    if family == "report":
        from arsenal.reports import handle as handle_reports
        return handle_reports(ctx)

    if family in ("skills", "vendor"):
        from arsenal.skills import handle as handle_skills
        return handle_skills(ctx)

    if family == "scripts":
        from arsenal.scripts import handle as handle_scripts
        return handle_scripts(ctx)

    if family in ("apk", "oracle"):
        from arsenal.analysis import handle as handle_analysis
        return handle_analysis(ctx)

    if family == "build":
        from arsenal.build import handle as handle_build
        return handle_build(ctx)

    if family in ("profile", "plugin", "mcp"):
        from arsenal.installer import handle as handle_installer
        return handle_installer(ctx)

    # Unknown command family
    return ctx.fail(f"Unrecognized command family: '{ctx.family}'", code=ExitCodes.CLI_USAGE_ERROR)


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint for 'arsenal'."""
    raw_args = list(sys.argv[1:] if argv is None else argv)

    # Fast help or empty invocation
    if not raw_args or "-h" in raw_args or "--help" in raw_args:
        is_json = "--json" in raw_args
        print_help(is_json, mode="preview")
        return ExitCodes.SUCCESS

    try:
        values, positionals, remainder = parse_cli_args(raw_args)
    except CLIArgumentError as e:
        is_json = "--json" in raw_args
        if is_json:
            emit_json(
                create_json_envelope(
                    command=" ".join(raw_args),
                    exit_code=ExitCodes.CLI_USAGE_ERROR,
                    mode="preview",
                    data={},
                    errors=[str(e)],
                )
            )
        else:
            print(f"Error: {e}", file=sys.stderr)
        return ExitCodes.CLI_USAGE_ERROR

    is_json = bool(values.get("json"))
    mode = "check" if values.get("check") else ("write" if values.get("write") else "preview")

    if not positionals:
        print_help(is_json, mode)
        return ExitCodes.SUCCESS

    family = positionals[0]
    subcommand = positionals[1] if len(positionals) > 1 else None
    rest_positionals = positionals[2:] if len(positionals) > 2 else []

    # Repo root resolution: --repo points to target; default to upward search from cwd
    repo_val = values.get("repo")
    if repo_val:
        repo_root = Path(str(repo_val)).resolve()
    else:
        repo_root = find_workspace_root(Path.cwd())

    # Profile dir resolution
    profile_val = values.get("profile") or values.get("dir")
    if profile_val:
        profile_dir = Path(str(profile_val)).resolve()
    else:
        profile_dir = Path.home() / ".omp" / "profiles" / "arsenal" / "agent"

    ctx = Context(
        family=family,
        subcommand=subcommand,
        positionals=rest_positionals,
        values=values,
        repo_root=repo_root,
        profile_dir=profile_dir,
        mode=mode,
        is_json=is_json,
        raw_args=raw_args,
        remainder=remainder,
    )

    try:
        return dispatch(ctx)
    except Exception as e:
        return ctx.fail(str(e), code=ExitCodes.CLI_USAGE_ERROR)


if __name__ == "__main__":
    sys.exit(main())
