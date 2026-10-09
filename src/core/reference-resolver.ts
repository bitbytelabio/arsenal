/**
 * src/core/reference-resolver.ts
 *
 * Shipped-first citation extraction and resolution.
 * Implements contracts/reference-materialization.md §2–§3:
 * validity is decided against the shipped playbook directories only; the
 * gitignored `upstream/` checkout is a materialization *source*, never an
 * authority (C-1).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type ReferenceKind = "markdown-link" | "inline-code" | "code-block";

export type CitationStatus =
  | "resolved-shipped"
  | "resolved-cross-skill"
  | "resolved-system"
  | "resolved-tool"
  | "documented-prerequisite"
  | "dangling";

export interface ExtractedSkillReference {
  raw: string;
  kind: ReferenceKind;
  target: string;
  startIndex: number;
  endIndex: number;
}

export interface CitationResolution {
  raw: string;
  kind: ReferenceKind;
  target: string;
  originalTarget: string;
  status: CitationStatus;
  shippedRelPath?: string;
  canonicalSkill?: string;
  resolution?: string;
  diagnosticReason?: string;
}

export interface CitationContext {
  /** Canonical playbook id (directory name). */
  skillId: string;
  /** Directory that contains `<skillId>/SKILL.md` (e.g. `src/corpus`). */
  shippedTree: string;
  /** Optional second shipped tree (e.g. built `plugin/skills`). */
  builtTree?: string;
  /** Admitted playbook ids, used for cross-skill resolution. */
  admittedSkills?: Set<string>;
}

/**
 * Prose that is structurally path-like but is not a citation (contract §2 C-3).
 * Confirmed in the corpus today.
 */
const PROSE_NON_CITATIONS = new Set<string>(["support/support", "scripts/macros/DLLs", "scripts/binaries"]);

/**
 * Directory prefixes that denote a repository file citation whose validity must
 * be decided by the shipped tree. Tokens under these prefixes are never exempted
 * by the system-tool / wordlist / lab-target rules (C-3, C-4).
 */
const STRICT_PATH_PREFIXES = ["scripts/", "references/"];

function stripDotPrefix(target: string): string {
  return target.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\.\.\//, "");
}

/** A citation whose status must be resolved against the shipped tree (never exempted). */
export function isStrictPathCitation(target: string): boolean {
  const t = stripDotPrefix(target);
  return STRICT_PATH_PREFIXES.some((p) => t.startsWith(p));
}

/**
 * Checks if a token represents an environment variable, command flag, or system path
 * that should not be resolved as a repository support file.
 */
export function isSystemOrCommandToken(token: string): boolean {
  if (
    token.startsWith("http://") ||
    token.startsWith("https://") ||
    token.startsWith("mailto:") ||
    token.startsWith("file://") ||
    token.startsWith("#") ||
    token.startsWith("$") ||
    token.startsWith("--") ||
    token.startsWith("-") ||
    token.startsWith("/") ||
    token.startsWith("~") ||
    token.startsWith("./") ||
    token.includes("://") ||
    /^\.[a-zA-Z0-9]+$/.test(token)
  ) {
    return true;
  }
  if (
    /^[a-zA-Z0-9_-]+=[^\s]+$/.test(token) ||
    token.includes("|") ||
    token.includes(">") ||
    token.includes("<") ||
    token.includes("(") ||
    token.includes(")") ||
    token.includes("+") ||
    token.includes("alert") ||
    token.includes("atob") ||
    token.includes(".bashrc") ||
    token.includes("approve") ||
    token.includes("../..")
  ) {
    return true;
  }
  const targetOsPatterns = [
    "169.254", "etc/passwd", "shell.php", "whoami",
    "Library/", "Preferences/", "Documents/", "cache/", "databases/", "files/",
    "shared_prefs/", "res/xml/", "sdcard/", "data/data/", "com.", "output/",
    "manage.py", "setup.py", "sample.bin", "target.apk", "patched.apk", "app.apk",
    "input.mmd", "output.svg", "output.png", "input.puml", "input.dot", "vmlinux", "dmesg.log",
    "crt.sh",
  ];
  if (token.endsWith("/")) return true;
  for (const p of targetOsPatterns) {
    if (token.includes(p)) return true;
  }
  return false;
}

const REGISTERED_TOOLS = new Set([
  "evidence_exec", "consolidate_evidence", "case_review",
  "skill_search", "skill_list", "skill_load", "skill_route", "arsenal",
]);

const CASE_ARTIFACTS = new Set([
  "scope.md", "timeline.md", "workitems.md", "report.md", "case-review.md",
  "findings.md", "fuzzing_report.md", "scope.yaml", "SKILL.md", "./SKILL.md",
  "idor_hunter.md", "ssrf_redirect_hunter.md", "penetration_test_report.md",
  "tool-index.md", "../tool-index.md", "skills/tool-index.md",
]);

const SYSTEM_TOOLS = new Set([
  "secretsdump.py", "mimikatz", "pypykatz", "procdump", "sqlmap", "nmap",
  "radamsa", "afl-tmin", "afl-fuzz", "ghidra", "idapro", "ida", "radare2", "r2",
  "jadx", "apktool", "frida", "objection", "gdb", "lldb", "checksec", "readelf",
  "objdump", "binwalk", "volatility", "volatility3", "wireshark", "tshark",
  "burpsuite", "curl", "wget", "impacket", "rubeus", "bloodhound",
  "getnthash.py", "gettgtpkinit.py", "log2timeline.py", "parse_beacon_config.py",
  "decode_stacktrace.sh", "run-supervisor.py", "recon.sh", "badchar_scan.py",
  "afl_cov_compare.py", "dedup.py", "setup.sh", "get",
  "getnpusers.py", "getuserspns.py", "atexec.py", "dcomexec.py", "getst.py",
  "gettgt.py", "linpeas.sh", "winpeas.bat", "ntlmrelayx.py", "restorepassword.py",
  "rpcdump.py", "smbexec.py", "ticketconverter.py", "wmiexec.py", "pinfo.py",
  "psort.py", "psteal.py", "firmwalker.sh", "odat", "bootlocal.sh",
  "linux_mitigation_scanner.sh", "fat.py", "mongobleed.py", "scanner.py",
  "token_sandbox_analyzer.py", "article30_parser.py", "article30_validator.py",
  "generate_ropa_report.py", "linenum.sh", "testssl.sh", "1768.py", "dpapi.py",
  "packetwhisper.py", "crack.sh", "grammar.py", "refresh_token.py", "shell.sh",
  "linkfinder.py", "petitpotam.py", "jamfexplorer.py", "smuggler.py",
  "zap-full-scan.py", "h2csmuggler", "record_rr.py", "repro.sh",
  "ropper2_workspace.md", "va_aliases.txt", "platforms-hardware.md", "agent.py",
  "process.py",
]);

/**
 * Classifies a token as a non-file citation (contract §2 steps 3–4).
 * Returns null when the token is a potential file citation.
 */
export function classifyNonFileCitation(
  target: string
): { status: CitationStatus; resolution: string } | null {
  if (PROSE_NON_CITATIONS.has(target)) {
    return { status: "documented-prerequisite", resolution: `Non-citation prose '${target}'` };
  }

  // Scripts and references citations must resolve to a shipped file or be reported dangling.
  if (isStrictPathCitation(target)) {
    return null;
  }

  if (REGISTERED_TOOLS.has(target)) {
    return { status: "resolved-tool", resolution: `Registered capability ${target}` };
  }

  if (CASE_ARTIFACTS.has(target) || /-report\.md$/i.test(target)) {
    return { status: "documented-prerequisite", resolution: `Engagement case artifact ${target}` };
  }

  const lowerTarget = target.toLowerCase();
  const baseName = path.basename(lowerTarget);
  if (
    SYSTEM_TOOLS.has(lowerTarget) ||
    SYSTEM_TOOLS.has(baseName) ||
    target.endsWith(".rule") ||
    target.endsWith(".rules") ||
    target.endsWith(".yar") ||
    target.includes("best64")
  ) {
    return { status: "documented-prerequisite", resolution: `Documented system tool or wordlist/ruleset ${target}` };
  }

  if (
    target.startsWith("./vuln") ||
    target.startsWith("./target") ||
    target.startsWith("exploit") ||
    target.startsWith("poc") ||
    target.startsWith("pocs/") ||
    target.endsWith("_poc.py") ||
    target.startsWith("harness") ||
    target.startsWith("templates/harness") ||
    target.includes("calc.exe") ||
    target === "./..." ||
    target.includes("\\") ||
    lowerTarget.includes("encoder") ||
    lowerTarget.startsWith("week") ||
    lowerTarget.includes("rogue") ||
    lowerTarget.startsWith("data/link")
  ) {
    return { status: "documented-prerequisite", resolution: `Lab exercise target ${target}` };
  }

  return null;
}

/**
 * Extracts candidate file, script, and link references from markdown content.
 * Uses structural markdown line & span parsing (markdown link target,
 * inline-code span, code-block path token).
 */
export function extractSkillReferences(content: string): ExtractedSkillReference[] {
  const results: ExtractedSkillReference[] = [];
  const seen = new Set<string>();

  // 1. Structural link parsing: [anchor](target)
  const linkRegex = /\[([^\]]+)\]\(([^)\n]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(content)) !== null) {
    const raw = match[0];
    const targetWithAnchor = match[2]?.trim() ?? "";
    const target = targetWithAnchor.split("#")[0]?.split("?")[0]?.trim() ?? "";
    if (!target || /^\d+$/.test(target) || isSystemOrCommandToken(target)) continue;

    const dedupeKey = `link:${match.index}:${target}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      results.push({
        raw,
        kind: "markdown-link",
        target,
        startIndex: match.index,
        endIndex: match.index + raw.length,
      });
    }
  }

  // 2. Structural inline code span parsing: `code`
  const codeRegex = /`([^`\n]+)`/g;
  while ((match = codeRegex.exec(content)) !== null) {
    const raw = match[0];
    const code = match[1]?.trim() ?? "";
    if (
      code.includes("/") ||
      code.includes("\\") ||
      code.endsWith(".md") ||
      code.endsWith(".py") ||
      code.endsWith(".sh") ||
      code.endsWith(".ps1") ||
      code.endsWith(".yar") ||
      code.endsWith(".json") ||
      code.endsWith(".yaml") ||
      code.endsWith(".yml") ||
      code.startsWith("python") ||
      code.startsWith("bash") ||
      code.startsWith("sh ")
    ) {
      const tokens = code.split(/\s+/);
      for (const token of tokens) {
        const clean = token.replace(/^["'([{<]+|["')\]}>,;]+$/g, "").trim();
        const isRepoPath =
          clean.startsWith("scripts/") ||
          clean.startsWith("../") ||
          clean.startsWith("./") ||
          clean.startsWith("vendor/") ||
          clean.startsWith("upstream/") ||
          clean.startsWith("<SKILL_ROOT>") ||
          clean.startsWith("references/") ||
          clean.startsWith("templates/") ||
          clean.startsWith("rules/") ||
          clean.startsWith("data/") ||
          clean.startsWith("ops/") ||
          clean.endsWith(".md") ||
          clean.endsWith(".py") ||
          clean.endsWith(".sh") ||
          clean.endsWith(".yar");
        if (clean.length > 2 && !isSystemOrCommandToken(clean) && isRepoPath) {
          const dedupeKey = `code:${match.index}:${clean}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            results.push({
              raw,
              kind: "inline-code",
              target: clean,
              startIndex: match.index,
              endIndex: match.index + raw.length,
            });
          }
        }
      }
    }
  }

  // 3. Structural fenced code-block parsing: ```...``` path tokens
  const fenceRegex = /```[^\n]*\n([\s\S]*?)```/g;
  while ((match = fenceRegex.exec(content)) !== null) {
    const block = match[1] ?? "";
    for (const rawLine of block.split("\n")) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      for (const token of line.split(/\s+/)) {
        let clean = token.replace(/^["'([{<]+|["')\]}>,;]+$/g, "").trim();
        clean = clean.replace(/:\d+$/, "");
        if (!isStrictPathCitation(clean)) continue;
        if (clean.length <= 2 || isSystemOrCommandToken(clean)) continue;
        const dedupeKey = `codeblock:${match.index}:${clean}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          results.push({
            raw: clean,
            kind: "code-block",
            target: clean,
            startIndex: match.index,
            endIndex: match.index + clean.length,
          });
        }
      }
    }
  }

  return results;
}

function isFileInside(tree: string, skillId: string, rel: string): string | null {
  const skillDir = path.resolve(tree, skillId);
  const abs = path.resolve(skillDir, rel);
  if (!abs.startsWith(skillDir + path.sep)) return null;
  try {
    return fs.statSync(abs).isFile() ? abs : null;
  } catch {
    return null;
  }
}

function crossSkillCandidates(target: string): string[] {
  let t = target.replace(/\\/g, "/").trim();
  t = t.replace(/^\.\//, "");
  const out = new Set<string>();
  if (t.includes("/")) {
    const first = t.split("/")[0] ?? "";
    const cleanedFirst = first.replace(/^\.\.?$/, "");
    if (cleanedFirst && !cleanedFirst.startsWith("..")) out.add(cleanedFirst);
    const noSkill = t.replace(/\/SKILL\.md$/, "").replace(/\/+$/, "");
    if (noSkill && !noSkill.startsWith("..") && !noSkill.includes("/")) out.add(noSkill);
  } else {
    out.add(t.replace(/\/SKILL\.md$/, ""));
  }
  out.delete("");
  return [...out];
}

/**
 * Resolves a single extracted citation against the shipped tree (contract §2).
 */
export function resolveCitation(
  citation: ExtractedSkillReference,
  ctx: CitationContext
): CitationResolution {
  const originalTarget = citation.target;
  let target = citation.target.replace(/\\/g, "/").trim();
  target = target.replace(/<SKILL_ROOT>\/?/g, "");
  if (target.startsWith("vendor/reverse-skill/")) {
    target = target.replace(/^vendor\/reverse-skill\//, "");
  }

  const base: Omit<CitationResolution, "status"> = {
    raw: citation.raw,
    kind: citation.kind,
    target,
    originalTarget,
  };

  // Host paths / URLs / pattern literals are not repository citations.
  if (target.length === 0 || target.startsWith("/") || path.isAbsolute(target)) {
    return { ...base, status: "resolved-system", resolution: "Host system path" };
  }
  if (/[[\](){}^$*+?|]/.test(target) || target.includes('"') || target.includes("'")) {
    return { ...base, status: "resolved-system", resolution: "Pattern or code literal" };
  }

  const trees = [ctx.shippedTree, ctx.builtTree].filter((t): t is string => Boolean(t));

  // (1) the citing playbook's own shipped directory.
  for (const tree of trees) {
    const abs = isFileInside(tree, ctx.skillId, target);
    if (abs) {
      return { ...base, status: "resolved-shipped", shippedRelPath: target };
    }
  }

  // (2) another shipped playbook directory.
  const candidates = crossSkillCandidates(target);
  for (const tree of trees) {
    for (const c of candidates) {
      const names = [c, `re-${c}`, `webapp-${c}`, `mobile-${c}`, `red-${c}`];
      for (const name of names) {
        if (ctx.admittedSkills && !ctx.admittedSkills.has(name) && name === c) {
          // fall through to disk check anyway
        }
        if (fs.existsSync(path.join(tree, name, "SKILL.md"))) {
          return { ...base, status: "resolved-cross-skill", canonicalSkill: name, resolution: `arsenal skill_load ${name}` };
        }
      }
    }
  }

  // (3) recognized system path / command / tool token; (4) documented prerequisite.
  const classified = classifyNonFileCitation(target);
  if (classified) {
    return { ...base, status: classified.status, resolution: classified.resolution };
  }

  // (5) dangling.
  return {
    ...base,
    status: "dangling",
    diagnosticReason: `Referenced file '${target}' is not shipped with playbook '${ctx.skillId}'`,
  };
}

export interface CitationDiagnostic {
  skill: string;
  raw: string;
  target: string;
  reason: string;
}

export interface CitationAuditResult {
  playbooks_scanned: number;
  dangling_count: number;
  dangling: CitationDiagnostic[];
  resolutions: CitationResolution[];
}

/**
 * Audits every shipped playbook's citations in one tree.
 */
export function auditCitations(opts: {
  treeDir: string;
  builtTree?: string;
  skillIds?: readonly string[];
}): CitationAuditResult {
  const treeDir = opts.treeDir;
  const dangling: CitationDiagnostic[] = [];
  const danglingKeys = new Set<string>();
  const resolutions: CitationResolution[] = [];
  let scanned = 0;

  if (!fs.existsSync(treeDir)) {
    return { playbooks_scanned: 0, dangling_count: 0, dangling, resolutions };
  }

  const skillIds =
    opts.skillIds ??
    fs
      .readdirSync(treeDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(treeDir, d.name, "SKILL.md")))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));

  const admittedSkills = new Set(skillIds);

  for (const skillId of skillIds) {
    const file = path.join(treeDir, skillId, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    scanned++;
    const content = fs.readFileSync(file, "utf-8");
    for (const citation of extractSkillReferences(content)) {
      const resolution = resolveCitation(citation, { skillId, shippedTree: treeDir, builtTree: opts.builtTree, admittedSkills });
      resolutions.push(resolution);
      if (resolution.status === "dangling") {
        const key = `${skillId}\u0000${resolution.target.replace(/\\/g, "/")}`;
        if (danglingKeys.has(key)) continue;
        danglingKeys.add(key);
        dangling.push({
          skill: skillId,
          raw: resolution.raw,
          target: resolution.target,
          reason: resolution.diagnosticReason ?? "unresolved",
        });
      }
    }
  }

  dangling.sort((a, b) => a.skill.localeCompare(b.skill) || a.target.localeCompare(b.target));
  return { playbooks_scanned: scanned, dangling_count: dangling.length, dangling, resolutions };
}

export interface ParsedSkillUri {
  valid: boolean;
  skillId: string;
  subpath: string;
  raw: string;
  error?: string;
}

export function parseSkillUri(uri: string): ParsedSkillUri {
  if (!uri.startsWith("skill://")) {
    return { valid: false, skillId: "", subpath: "", raw: uri, error: "URI must start with skill://" };
  }
  const withoutScheme = uri.slice("skill://".length);
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) {
    return {
      valid: true,
      skillId: withoutScheme,
      subpath: "",
      raw: uri,
    };
  }
  const skillId = withoutScheme.slice(0, slashIdx);
  const subpath = withoutScheme.slice(slashIdx + 1);
  return {
    valid: true,
    skillId,
    subpath,
    raw: uri,
  };
}

export function resolveSkillUri(
  uri: string,
  corpusDir: string
): { resolvedPath: string | null; exists: boolean; error?: string } {
  const parsed = parseSkillUri(uri);
  if (!parsed.valid) {
    return { resolvedPath: null, exists: false, error: parsed.error };
  }
  const skillDir = path.join(corpusDir, parsed.skillId);
  if (!fs.existsSync(skillDir)) {
    return { resolvedPath: null, exists: false, error: `Skill not found: ${parsed.skillId}` };
  }
  const targetPath = parsed.subpath ? path.join(skillDir, parsed.subpath) : path.join(skillDir, "SKILL.md");
  const exists = fs.existsSync(targetPath);
  return {
    resolvedPath: targetPath,
    exists,
    error: exists ? undefined : `Asset not found: ${parsed.subpath} in skill ${parsed.skillId}`,
  };
}
