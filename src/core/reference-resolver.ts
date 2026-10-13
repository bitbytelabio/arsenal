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
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Root } from "mdast";

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
  anchor?: string;
  startIndex: number;
  endIndex: number;
  line: number;
  column: number;
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
  /** Document path relative to skill directory (e.g. "SKILL.md", "references/foo.md"). */
  documentRelPath?: string;
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
const STRICT_PATH_PREFIXES = ["scripts/", "references/", "templates/", "support/", "assets/"];

const EXTERNAL_WORKSPACE_PREREQUISITES: Record<string, string> = {
  "assets/index.android.bundle": "Unpacked React Native APK workspace input (assets/index.android.bundle)",
  "assets/bin/Data/Managed/Metadata/global-metadata.dat": "Unpacked Unity IL2CPP APK/IPA workspace input (global-metadata.dat)",
  "assets/dispatchblock.png": "External obpo-plugin repository documentation diagram (assets/dispatchblock.png)",
  "scripts/decode_stacktrace.sh": "Linux kernel source-tree script prerequisite (./scripts/decode_stacktrace.sh)",
  "scripts/getArch.sh": "Firmadyne toolkit workspace script prerequisite (./scripts/getArch.sh)",
  "scripts/tar2db.py": "Firmadyne toolkit workspace script prerequisite (./scripts/tar2db.py)",
  "scripts/makeImage.sh": "Firmadyne toolkit workspace script prerequisite (./scripts/makeImage.sh)",
  "scripts/inferNetwork.sh": "Firmadyne toolkit workspace script prerequisite (./scripts/inferNetwork.sh)",
};
const LOCAL_HELPER_NAMES = new Set<string>([
  "agent.py",
  "process.py",
  "recon.sh",
  "recon.ps1",
  "run-supervisor.py",
  "watchdog.ps1",
  "decode.sh",
  "decode.ps1",
  "frida-run.sh",
  "frida-run.ps1",
  "rebuild-sign-install.sh",
  "rebuild-sign-install.ps1",
  "manifest-summary.ps1",
  "setup.ps1",
  "review_case.py",
  "render_diagram.py",
  "create_sample_diagrams.py",
  "install-autostart.ps1",
  "IdaOpenHelpers.ps1",
  "start.ps1",
  "open.ps1",
  "recover.ps1",
  "start-gui.ps1",
  "Deploy-ADHoneytokens.ps1",
  "audit_smb_signing.ps1",
  "detect_ntlm_relay.py",
  "detect_dcom_lateral_movement.py",
  "article30_parser.py",
  "article30_validator.py",
  "generate_ropa_report.py",
]);

function stripDotPrefix(target: string): string {
  return target.replace(/\\/g, "/").replace(/^<SKILL_ROOT>\/?/i, "").replace(/^\.\//, "").replace(/^\.\.\//, "");
}

/** A citation whose status must be resolved against the shipped tree (never exempted). */
export function isStrictPathCitation(target: string): boolean {
  const t = stripDotPrefix(target);
  return !t.endsWith("/") && STRICT_PATH_PREFIXES.some((p) => t.startsWith(p));
}

function isDnsOrHostnameToken(token: string): boolean {
  const lower = token.toLowerCase();
  if (
    lower === "transfer.sh" ||
    lower === "crt.sh" ||
    lower === "platform.sh" ||
    lower === "interact.sh" ||
    lower === "shodan.io"
  ) {
    return true;
  }
  if (/^[a-z0-9*-]+(?:\.[a-z0-9*-]+)+\.sh$/i.test(token)) {
    return true;
  }
  return false;
}

/**
 * Checks if a token represents an environment variable, command flag, or system path
 * that should not be resolved as a repository support file.
 */
export function isSystemOrCommandToken(token: string): boolean {
  if (token.startsWith("skill://") || isStrictPathCitation(token)) {
    return false;
  }
  if (isDnsOrHostnameToken(token) || /^[a-zA-Z]:\\/.test(token)) {
    return true;
  }
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
]);

const SYSTEM_TOOLS = new Set([
  "secretsdump.py", "mimikatz", "pypykatz", "procdump", "sqlmap", "nmap",
  "radamsa", "afl-tmin", "afl-fuzz", "ghidra", "idapro", "ida", "radare2", "r2",
  "jadx", "apktool", "frida", "objection", "gdb", "lldb", "checksec", "readelf",
  "objdump", "binwalk", "volatility", "volatility3", "wireshark", "tshark",
  "burpsuite", "curl", "wget", "impacket", "rubeus", "bloodhound",
  "getnthash.py", "gettgtpkinit.py", "log2timeline.py", "parse_beacon_config.py",
  "getnpusers.py", "getuserspns.py", "atexec.py", "dcomexec.py", "getst.py",
  "gettgt.py", "linpeas.sh", "winpeas.bat", "ntlmrelayx.py", "restorepassword.py",
  "rpcdump.py", "smbexec.py", "ticketconverter.py", "wmiexec.py", "pinfo.py",
  "psort.py", "psteal.py", "firmwalker.sh", "odat", "bootlocal.sh",
  "linux_mitigation_scanner.sh", "fat.py", "mongobleed.py", "scanner.py",
  "token_sandbox_analyzer.py",
  "linenum.sh", "testssl.sh", "1768.py", "dpapi.py",
  "packetwhisper.py", "crack.sh", "grammar.py", "refresh_token.py", "shell.sh",
  "linkfinder.py", "petitpotam.py", "jamfexplorer.py", "smuggler.py",
  "zap-full-scan.py", "h2csmuggler", "record_rr.py", "repro.sh",
  "pywhisker.py", "pypi_scan.py", "printerbug.py", "dementor.py",
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

  const normalizedTarget = target.replace(/\\/g, "/").replace(/^\.\//, "");
  const externalPrerequisite = EXTERNAL_WORKSPACE_PREREQUISITES[normalizedTarget];
  if (externalPrerequisite) {
    return { status: "documented-prerequisite", resolution: externalPrerequisite };
  }

  if ( /^evidence\/E-[A-Za-z0-9_-]+\.md$/i.test(normalizedTarget)) {
    return { status: "documented-prerequisite", resolution: `Engagement case evidence artifact ${target}` };
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

  const lowerTarget = normalizedTarget.toLowerCase();
  const baseName = path.basename(lowerTarget);
  const exactBase = path.basename(normalizedTarget);

  if (LOCAL_HELPER_NAMES.has(exactBase) || LOCAL_HELPER_NAMES.has(baseName)) {
    return null;
  }

  if (
    SYSTEM_TOOLS.has(lowerTarget) ||
    SYSTEM_TOOLS.has(baseName) ||
    normalizedTarget.endsWith(".rule") ||
    normalizedTarget.endsWith(".rules") ||
    normalizedTarget.endsWith(".yar") ||
    normalizedTarget.includes("best64")
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
    target.includes("calc.exe") ||
    target.includes("sample.bin") ||
    target.includes("target.apk") ||
    target.includes("patched.apk") ||
    target.includes("app.apk") ||
    target === "./..." ||
    lowerTarget.startsWith("week") ||
    lowerTarget.includes("rogue") ||
    lowerTarget.startsWith("data/link")
  ) {
    return { status: "documented-prerequisite", resolution: `Lab exercise target ${target}` };
  }

  if (
    !normalizedTarget.includes("/") &&
    (lowerTarget.endsWith(".py") || lowerTarget.endsWith(".sh") || lowerTarget.endsWith(".ps1"))
  ) {
    return {
      status: "documented-prerequisite",
      resolution: `External command tool or prerequisite ${target}`,
    };
  }

  return null;
}

/**
 * Extracts candidate file, script, and link references from markdown content.
 * Uses structural markdown line & span parsing (markdown link target,
 * inline-code span, code-block path token).
 */
function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function getLineAndColumn(lineStarts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid]! <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = Math.max(0, high);
  const lineStart = lineStarts[lineIndex] ?? 0;
  return { line: lineIndex + 1, column: offset - lineStart + 1 };
}

export function slugifyHeading(headingText: string): string {
  return headingText
    .toLowerCase()
    .trim()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getNodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { value?: unknown; children?: unknown[] };
  if (typeof n.value === "string") {
    return n.value;
  }
  if (Array.isArray(n.children)) {
    return n.children.map(getNodeText).join("");
  }
  return "";
}

function extractHtmlAnchors(htmlSnippet: string): Set<string> {
  const anchors = new Set<string>();
  try {
    const rewriter = new HTMLRewriter().on("*", {
      element(el) {
        const id = el.getAttribute("id");
        if (id) anchors.add(id.toLowerCase());
        const name = el.getAttribute("name");
        if (name) anchors.add(name.toLowerCase());
      },
    });
    rewriter.transform(htmlSnippet);
  } catch {
    // ignore malformed fragment
  }
  return anchors;
}

export function extractDocumentAnchors(content: string): Set<string> {
  const anchors = new Set<string>();
  let tree: Root;
  try {
    tree = fromMarkdown(content);
  } catch {
    return anchors;
  }

  const slugCounts = new Map<string, number>();

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; value?: unknown; children?: unknown[] };
    if (n.type === "heading") {
      const text = getNodeText(n);
      const baseSlug = slugifyHeading(text);
      const gfmSlug = text
        .toLowerCase()
        .trim()
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/<[^>]+>/g, "")
        .replace(/[^\p{L}\p{N}_\s-]/gu, "")
        .replace(/\s/g, "-")
        .replace(/^-+|-+$/g, "");
      if (baseSlug) {
        anchors.add(baseSlug);
        const count = slugCounts.get(baseSlug) ?? 0;
        if (count > 0) {
          anchors.add(`${baseSlug}-${count}`);
        }
        slugCounts.set(baseSlug, count + 1);
      }
      if (gfmSlug && gfmSlug !== baseSlug) {
        anchors.add(gfmSlug);
        const gCount = slugCounts.get(gfmSlug) ?? 0;
        if (gCount > 0) {
          anchors.add(`${gfmSlug}-${gCount}`);
        }
        slugCounts.set(gfmSlug, gCount + 1);
      }
    } else if (n.type === "html" && typeof n.value === "string") {
      const cleanedHtml = n.value.replace(/(?:^|\r?\n)[ \t]*(?:`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?(?:\r?\n[ \t]*(?:`{3,}|~{3,})[ \t]*(?=\r?\n|$)|$)/g, "\n");
      for (const a of extractHtmlAnchors(cleanedHtml)) {
        anchors.add(a);
      }
    }

    if (Array.isArray(n.children) && n.type !== "code" && n.type !== "inlineCode") {
      for (const child of n.children) {
        walk(child);
      }
    }
  }

  walk(tree);
  return anchors;
}

export interface CommandToken {
  raw: string;
  text: string;
  startOffset: number;
  endOffset: number;
  column: number;
}

export function tokenizeCommandLine(line: string, lineStartOffset: number): CommandToken[] {
  const tokens: CommandToken[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i]!)) i++;
    if (i >= line.length) break;
    if (line[i] === "#") break;

    const start = i;
    let text = "";
    let inQuote: string | null = null;

    while (i < line.length) {
      const ch = line[i]!;
      if (inQuote) {
        if (ch === inQuote) {
          inQuote = null;
        } else if (
          ch === "\\" &&
          i + 1 < line.length &&
          (line[i + 1] === '"' || line[i + 1] === "'" || line[i + 1] === "\\")
        ) {
          i++;
          text += line[i]!;
        } else {
          text += ch;
        }
      } else {
        if (ch === '"' || ch === "'") {
          inQuote = ch;
        } else if (/\s/.test(ch)) {
          break;
        } else if (
          ch === "\\" &&
          i + 1 < line.length &&
          (line[i + 1] === '"' || line[i + 1] === "'" || line[i + 1] === " ")
        ) {
          i++;
          text += line[i]!;
        } else {
          text += ch;
        }
      }
      i++;
    }
    const end = i;
    tokens.push({
      raw: line.slice(start, end),
      text,
      startOffset: lineStartOffset + start,
      endOffset: lineStartOffset + end,
      column: start + 1,
    });
  }
  return tokens;
}

function parseUrlTargetAndAnchor(rawUrl: string): { target: string; anchor?: string } | null {
  const targetWithAnchor = rawUrl.trim();
  if (!targetWithAnchor) return null;
  if (
    targetWithAnchor.startsWith("http://") ||
    targetWithAnchor.startsWith("https://") ||
    targetWithAnchor.startsWith("mailto:")
  ) {
    return null;
  }

  let target = targetWithAnchor;
  let anchor: string | undefined;
  const hashIdx = targetWithAnchor.indexOf("#");
  if (hashIdx !== -1) {
    target = targetWithAnchor.slice(0, hashIdx).trim();
    anchor = targetWithAnchor.slice(hashIdx + 1).split("?")[0]?.trim() || undefined;
  }
  const qIdx = target.indexOf("?");
  if (qIdx !== -1) {
    target = target.slice(0, qIdx).trim();
  }

  if (!target && !anchor) return null;
  if (target && /^\d+$/.test(target)) return null;
  return { target, anchor };
}

export function extractSkillReferences(content: string): ExtractedSkillReference[] {
  const results: ExtractedSkillReference[] = [];
  const seen = new Set<string>();
  const lineStarts = computeLineStarts(content);

  let tree: Root;
  try {
    tree = fromMarkdown(content);
  } catch {
    return results;
  }

  interface DefEntry {
    identifier: string;
    url: string;
    position?: {
      start: { line: number; column: number; offset?: number };
      end: { line: number; column: number; offset?: number };
    };
  }

  const definitions = new Map<string, DefEntry>();
  const referencedDefinitions = new Set<string>();

  function collectDefinitions(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as {
      type?: string;
      identifier?: string;
      url?: string;
      position?: DefEntry["position"];
      children?: unknown[];
    };
    if (n.type === "definition" && typeof n.identifier === "string" && typeof n.url === "string") {
      definitions.set(n.identifier.toLowerCase(), {
        identifier: n.identifier,
        url: n.url,
        position: n.position,
      });
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children) collectDefinitions(child);
    }
  }

  collectDefinitions(tree);

  function emitLinkReference(
    rawUrl: string,
    pos?: {
      start: { line: number; column: number; offset?: number };
      end: { line: number; column: number; offset?: number };
    }
  ): void {
    if (!pos || pos.start.offset === undefined || pos.end.offset === undefined) return;
    const parsed = parseUrlTargetAndAnchor(rawUrl);
    if (!parsed) return;
    const raw = content.slice(pos.start.offset, pos.end.offset);
    const dedupeKey = `link:${pos.start.offset}:${parsed.target}:${parsed.anchor ?? ""}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      results.push({
        raw,
        kind: "markdown-link",
        target: parsed.target,
        anchor: parsed.anchor,
        startIndex: pos.start.offset,
        endIndex: pos.end.offset,
        line: pos.start.line,
        column: pos.start.column,
      });
    }
  }

  function walkNodes(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as {
      type?: string;
      lang?: string | null;
      url?: string;
      identifier?: string;
      value?: string;
      position?: {
        start: { line: number; column: number; offset?: number };
        end: { line: number; column: number; offset?: number };
      };
      children?: unknown[];
    };

    if ((n.type === "link" || n.type === "image") && typeof n.url === "string") {
      emitLinkReference(n.url, n.position);
    } else if (
      (n.type === "linkReference" || n.type === "imageReference") &&
      typeof n.identifier === "string"
    ) {
      const key = n.identifier.toLowerCase();
      const def = definitions.get(key);
      if (def) {
        referencedDefinitions.add(key);
        emitLinkReference(def.url, n.position);
      }
    } else if (n.type === "inlineCode" && typeof n.value === "string" && n.position) {
      const startOff = n.position.start.offset ?? 0;
      const endOff = n.position.end.offset ?? startOff + n.value.length;
      const rawSlice = content.slice(startOff, endOff);
      const backtickLen = rawSlice.match(/^`+/)?.[0].length ?? 1;
      const valueStartOffset = startOff + backtickLen;
      const trimmed = n.value.trim();

      if (trimmed === "skill://") {
        // Bare scheme mention in prose (e.g. `skill://`), not a concrete resource reference
      } else if (trimmed.startsWith("skill://")) {
        const loc = getLineAndColumn(lineStarts, valueStartOffset);
        let anchor: string | undefined;
        const hashIdx = trimmed.indexOf("#");
        if (hashIdx !== -1) {
          anchor = trimmed.slice(hashIdx + 1).split("?")[0]?.trim() || undefined;
        }
        const dedupeKey = `code:${valueStartOffset}:${trimmed}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          results.push({
            raw: rawSlice,
            kind: "inline-code",
            target: trimmed,
            anchor,
            startIndex: startOff,
            endIndex: endOff,
            line: loc.line,
            column: loc.column,
          });
        }
      } else {
        const tokens = tokenizeCommandLine(n.value, valueStartOffset);
        for (const tok of tokens) {
          let clean = tok.text.replace(/^["'([{<]+|["')\]}>,;]+$/g, "").trim();
          clean = clean.replace(/:\d+$/, "");
          if (!clean) continue;
          if (clean.startsWith("skill://")) {
            const loc = getLineAndColumn(lineStarts, tok.startOffset);
            let anchor: string | undefined;
            const hashIdx = clean.indexOf("#");
            if (hashIdx !== -1) {
              anchor = clean.slice(hashIdx + 1).split("?")[0]?.trim() || undefined;
            }
            const dedupeKey = `code:${tok.startOffset}:${clean}`;
            if (!seen.has(dedupeKey)) {
              seen.add(dedupeKey);
              results.push({
                raw: tok.raw,
                kind: "inline-code",
                target: clean,
                anchor,
                startIndex: tok.startOffset,
                endIndex: tok.endOffset,
                line: loc.line,
                column: loc.column,
              });
            }
            continue;
          }

          const isRepoPath =
            clean.startsWith("scripts/") ||
            clean.startsWith("../") ||
            clean.startsWith("./") ||
            clean.startsWith("vendor/") ||
            clean.startsWith("upstream/") ||
            clean.startsWith("<SKILL_ROOT>") ||
            clean.startsWith("references/") ||
            clean.startsWith("templates/") ||
            clean.startsWith("assets/") ||
            clean.startsWith("support/") ||
            clean.startsWith("rules/") ||
            clean.startsWith("data/") ||
            clean.startsWith("ops/") ||
            clean.endsWith(".md") ||
            clean.endsWith(".py") ||
            clean.endsWith(".sh") ||
            clean.endsWith(".ps1") ||
            clean.endsWith(".yar");

          if (clean.length > 2 && !isSystemOrCommandToken(clean) && isRepoPath) {
            const loc = getLineAndColumn(lineStarts, tok.startOffset);
            const dedupeKey = `code:${tok.startOffset}:${clean}`;
            if (!seen.has(dedupeKey)) {
              seen.add(dedupeKey);
              results.push({
                raw: tokens.length === 1 ? rawSlice : tok.raw,
                kind: "inline-code",
                target: clean,
                startIndex: tokens.length === 1 ? startOff : tok.startOffset,
                endIndex: tokens.length === 1 ? endOff : tok.endOffset,
                line: loc.line,
                column: loc.column,
              });
            }
          }
        }
      }
    } else if (n.type === "code" && typeof n.value === "string" && n.position) {
      const lang = (n.lang ?? "").trim().toLowerCase();
      const isShellBlock =
        lang === "" ||
        lang === "bash" ||
        lang === "sh" ||
        lang === "zsh" ||
        lang === "shell" ||
        lang === "console" ||
        lang === "powershell" ||
        lang === "ps1" ||
        lang === "pwsh" ||
        lang === "cmd" ||
        lang === "bat";

      const lines = n.value.split("\n");
      for (let li = 0; li < lines.length; li++) {
        const lineNum = n.position.start.line + 1 + li;
        const lineStartOffset = lineStarts[lineNum - 1] ?? 0;
        const nextOffset = lineStarts[lineNum] !== undefined ? lineStarts[lineNum]! - 1 : content.length;
        const lineContent = content.slice(lineStartOffset, nextOffset).replace(/\r$/, "");
        const trimmedLine = lineContent.trim();
        if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) continue;
        // Skip formatted ASCII/Markdown table rows in code blocks
        if ((trimmedLine.match(/\|/g)?.length ?? 0) >= 2 && !trimmedLine.includes("||")) continue;

        const tokens = tokenizeCommandLine(lineContent, lineStartOffset);
        for (const tok of tokens) {
          let clean = tok.text.replace(/^["'([{<]+|["')\]}>,;]+$/g, "").trim();
          clean = clean.replace(/:\d+$/, "");
          if (clean.length <= 2) continue;

          if (clean.startsWith("skill://")) {
            let anchor: string | undefined;
            const hashIdx = clean.indexOf("#");
            if (hashIdx !== -1) {
              anchor = clean.slice(hashIdx + 1).split("?")[0]?.trim() || undefined;
            }
            const dedupeKey = `codeblock:${tok.startOffset}:${clean}`;
            if (!seen.has(dedupeKey)) {
              seen.add(dedupeKey);
              results.push({
                raw: tok.raw,
                kind: "code-block",
                target: clean,
                anchor,
                startIndex: tok.startOffset,
                endIndex: tok.endOffset,
                line: lineNum,
                column: tok.column,
              });
            }
            continue;
          }

          if (isSystemOrCommandToken(clean)) continue;

          const isExplicitStrict = isStrictPathCitation(clean);
          const isBareScript =
            isShellBlock &&
            !clean.includes("/") &&
            !clean.includes("\\") &&
            (clean.endsWith(".py") || clean.endsWith(".sh") || clean.endsWith(".ps1"));

          if (!isExplicitStrict && !isBareScript) continue;

          const dedupeKey = `codeblock:${tok.startOffset}:${clean}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            results.push({
              raw: tok.raw,
              kind: "code-block",
              target: clean,
              startIndex: tok.startOffset,
              endIndex: tok.endOffset,
              line: lineNum,
              column: tok.column,
            });
          }
        }
      }
    }

    if (Array.isArray(n.children)) {
      for (const child of n.children) {
        walkNodes(child);
      }
    }
  }

  walkNodes(tree);

  // Emit any unreferenced definitions so dangling definitions are still caught
  for (const [key, def] of definitions.entries()) {
    if (!referencedDefinitions.has(key)) {
      emitLinkReference(def.url, def.position);
    }
  }

  return results;
}

function verifyAssetWithinSkill(
  treeRoot: string,
  skillId: string,
  targetAsset: string
): { valid: boolean; absPath: string; error?: string } {
  const resolvedTreeRoot = path.resolve(treeRoot);
  const resolvedSkillDir = path.resolve(resolvedTreeRoot, skillId);
  const absPath = path.resolve(resolvedSkillDir, targetAsset);
  if (! resolvedSkillDir.startsWith(resolvedTreeRoot + path.sep)) {
    return {
      valid: false,
      absPath,
      error: `Skill path '${skillId}' escapes tree root`,
    };
  }
  if (!absPath.startsWith(resolvedSkillDir + path.sep)) {
    return {
      valid: false,
      absPath,
      error: `Asset path '${targetAsset}' escapes skill directory`,
    };
  }
  if (!fs.existsSync(resolvedSkillDir) || !fs.existsSync(absPath)) {
    return {
      valid: false,
      absPath,
      error: `Asset not found: ${targetAsset}`,
    };
  }
  try {
    const realTreeRoot = fs.realpathSync(resolvedTreeRoot);
    const realSkillDir = fs.realpathSync(resolvedSkillDir);
    if (!realSkillDir.startsWith(realTreeRoot + path.sep)) {
      return {
        valid: false,
        absPath,
        error: `Skill directory '${skillId}' symlink escapes tree root`,
      };
    }
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      return {
        valid: false,
        absPath,
        error: `Asset '${targetAsset}' is a directory, not a regular file`,
      };
    }
    const realTarget = fs.realpathSync(absPath);
    if (!realTarget.startsWith(realSkillDir + path.sep)) {
      return {
        valid: false,
        absPath,
        error: `Asset '${targetAsset}' symlink escapes skill directory`,
      };
    }
    return { valid: true, absPath };
  } catch (err) {
    return {
      valid: false,
      absPath,
      error: `Failed to verify asset '${targetAsset}': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function isFileInside(tree: string, skillId: string, rel: string): string | null {
  const check = verifyAssetWithinSkill(tree, skillId, rel);
  return check.valid ? check.absPath : null;
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

  const trees = [ctx.shippedTree, ctx.builtTree].filter((t): t is string => Boolean(t));
  const citingDocRel = ctx.documentRelPath ?? "SKILL.md";
  const docRelDir = path.dirname(citingDocRel);

  // Case A: Same-document anchor link [Text](#anchor)
  if (citation.kind === "markdown-link" && !target && citation.anchor) {
    for (const tree of trees) {
      const citingDocAbs = path.join(tree, ctx.skillId, citingDocRel);
      if (fs.existsSync(citingDocAbs)) {
        try {
          const content = fs.readFileSync(citingDocAbs, "utf-8");
          const anchors = extractDocumentAnchors(content);
          if (!anchors.has(citation.anchor.toLowerCase())) {
            return {
              ...base,
              status: "dangling",
              diagnosticReason: `Anchor '#${citation.anchor}' not found in document '${citingDocRel}'`,
            };
          }
          return {
            ...base,
            status: "resolved-shipped",
            shippedRelPath: citingDocRel,
            resolution: `Document anchor '#${citation.anchor}'`,
          };
        } catch {
          // fall through
        }
      }
    }
    return {
      ...base,
      status: "dangling",
      diagnosticReason: `Anchor '#${citation.anchor}' targets missing document '${citingDocRel}'`,
    };
  }

  // Case B: Canonical skill:// URI
  if (target.startsWith("skill://")) {
    const parsed = parseSkillUri(target);
    if (!parsed.valid) {
      return {
        ...base,
        status: "dangling",
        diagnosticReason: parsed.error ?? "Invalid skill URI",
      };
    }
    const targetAsset = parsed.subpath ? parsed.subpath : "SKILL.md";
    let matchedTree: string | null = null;
    let lastError: string | undefined;
    for (const tree of trees) {
      const skillDir = path.join(tree, parsed.skillId);
      if (!fs.existsSync(skillDir)) continue;
      const check = verifyAssetWithinSkill(tree, parsed.skillId, targetAsset);
      if (check.valid) {
        matchedTree = tree;
        break;
      } else {
        lastError = check.error;
      }
    }
    if (!matchedTree) {
      let skillExists = false;
      for (const tree of trees) {
        if (fs.existsSync(path.join(tree, parsed.skillId))) {
          skillExists = true;
          break;
        }
      }
      if (!skillExists) {
        return {
          ...base,
          status: "dangling",
          diagnosticReason: `Referenced skill '${parsed.skillId}' not found`,
        };
      }
      return {
        ...base,
        status: "dangling",
        diagnosticReason: lastError ?? `Asset '${targetAsset}' not found in skill '${parsed.skillId}'`,
      };
    }
    const anc = citation.anchor || parsed.anchor;
    if (anc && (targetAsset.endsWith(".md") || targetAsset.endsWith(".markdown"))) {
      try {
        const assetContent = fs.readFileSync(path.join(matchedTree, parsed.skillId, targetAsset), "utf-8");
        const anchors = extractDocumentAnchors(assetContent);
        if (!anchors.has(anc.toLowerCase())) {
          return {
            ...base,
            status: "dangling",
            diagnosticReason: `Anchor '#${anc}' not found in '${parsed.skillId}/${targetAsset}'`,
          };
        }
      } catch {
        // ignore read error
      }
    }

    const isSelf = parsed.skillId === ctx.skillId;
    return {
      ...base,
      status: isSelf ? "resolved-shipped" : "resolved-cross-skill",
      canonicalSkill: parsed.skillId,
      shippedRelPath: targetAsset,
      resolution: isSelf ? targetAsset : `arsenal skill_load ${parsed.skillId}`,
    };
  }

  // Case C: Root-relative markdown links (/exploit/..., /pentest/...)
  if (citation.kind === "markdown-link" && (target.startsWith("/") || path.isAbsolute(target))) {
    return {
      ...base,
      status: "dangling",
      diagnosticReason: `Broken root-relative link '${target}' is not shipped in corpus`,
    };
  }

  // Host paths / pattern literals for code-block or inline-code
  if (target.length === 0 || target.startsWith("/") || path.isAbsolute(target)) {
    return { ...base, status: "resolved-system", resolution: "Host system path" };
  }
  if (/[[\](){}^$*+?|]/.test(target) || target.includes('"') || target.includes("'")) {
    return { ...base, status: "resolved-system", resolution: "Pattern or code literal" };
  }

  // Case D: Document-relative resolution against the citing playbook directory
  let docRelTarget = target;
  if (docRelDir && docRelDir !== "." && !target.startsWith("..") && !target.startsWith("./")) {
    docRelTarget = path.normalize(path.join(docRelDir, target)).replace(/\\/g, "/");
  } else if (docRelDir && docRelDir !== "." && (target.startsWith("./") || target.startsWith("../"))) {
    docRelTarget = path.normalize(path.join(docRelDir, target)).replace(/\\/g, "/");
  }

  let matchedRelPath: string | null = null;
  let matchedTree: string | null = null;
  for (const tree of trees) {
    if (isFileInside(tree, ctx.skillId, docRelTarget)) {
      matchedRelPath = docRelTarget;
      matchedTree = tree;
      break;
    }
    if (
      citation.kind !== "markdown-link" &&
      docRelTarget !== target &&
      (target.startsWith("scripts/") || target.startsWith("templates/")) &&
      isFileInside(tree, ctx.skillId, target)
    ) {
      matchedRelPath = target;
      matchedTree = tree;
      break;
    }
    // Also check templates/<base> or scripts/<base> when target is a single script name
    if (!target.includes("/")) {
      if (isFileInside(tree, ctx.skillId, `templates/${target}`)) {
        matchedRelPath = `templates/${target}`;
        matchedTree = tree;
        break;
      }
      if (isFileInside(tree, ctx.skillId, `scripts/${target}`)) {
        matchedRelPath = `scripts/${target}`;
        matchedTree = tree;
        break;
      }
    }
  }

  if (matchedRelPath && matchedTree) {
    if (citation.anchor && (matchedRelPath.endsWith(".md") || matchedRelPath.endsWith(".markdown"))) {
      try {
        const abs = path.join(matchedTree, ctx.skillId, matchedRelPath);
        const content = fs.readFileSync(abs, "utf-8");
        const anchors = extractDocumentAnchors(content);
        if (!anchors.has(citation.anchor.toLowerCase())) {
          return {
            ...base,
            status: "dangling",
            diagnosticReason: `Anchor '#${citation.anchor}' not found in '${matchedRelPath}'`,
          };
        }
      } catch {
        // ignore read error
      }
    }
    return { ...base, status: "resolved-shipped", shippedRelPath: matchedRelPath };
  }

  // Case E: Another shipped playbook directory (Strict: no implicit domain prefixing)
  const candidates = crossSkillCandidates(target);
  for (const tree of trees) {
    for (const c of candidates) {
      if (isFileInside(tree, c, "SKILL.md")) {
        return { ...base, status: "resolved-cross-skill", canonicalSkill: c, resolution: `arsenal skill_load ${c}` };
      }
    }
  }

  // Case F: Recognized system path / command / tool token; documented prerequisite (never for explicit markdown links/definitions)
  if (citation.kind !== "markdown-link") {
    const classified = classifyNonFileCitation(target);
    if (classified) {
      return { ...base, status: classified.status, resolution: classified.resolution };
    }
  }
  // Case G: Dangling
  return {
    ...base,
    status: "dangling",
    diagnosticReason: `Referenced file '${target}' is not shipped with playbook '${ctx.skillId}'`,
  };
}

export interface CitationDiagnostic {
  skill: string;
  file?: string;
  line?: number;
  column?: number;
  raw: string;
  target: string;
  reason: string;
}

export interface CitationCategoryCounts {
  resolved_shipped: number;
  resolved_cross_skill: number;
  resolved_system: number;
  resolved_tool: number;
  documented_prerequisite: number;
  dangling: number;
}

export interface CitationAuditResult {
  playbooks_scanned: number;
  dangling_count: number;
  category_counts: CitationCategoryCounts;
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
  const category_counts: CitationCategoryCounts = {
    resolved_shipped: 0,
    resolved_cross_skill: 0,
    resolved_system: 0,
    resolved_tool: 0,
    documented_prerequisite: 0,
    dangling: 0,
  };
  let scanned = 0;

  if (!fs.existsSync(treeDir)) {
    return { playbooks_scanned: 0, dangling_count: 0, category_counts, dangling, resolutions };
  }
  function findMarkdownFilesRecursively(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        results.push(...findMarkdownFilesRecursively(full));
      } else if (ent.isFile() && (ent.name.endsWith(".md") || ent.name.endsWith(".markdown"))) {
        results.push(full);
      }
    }
    return results.sort((a, b) => a.localeCompare(b));
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
    const skillDir = path.join(treeDir, skillId);
    if (!fs.existsSync(skillDir)) continue;
    scanned++;
    const mdFiles = findMarkdownFilesRecursively(skillDir);
    for (const mdFile of mdFiles) {
      const docRelPath = path.relative(skillDir, mdFile).replace(/\\/g, "/");
      const content = fs.readFileSync(mdFile, "utf-8");
      for (const citation of extractSkillReferences(content)) {
        const resolution = resolveCitation(citation, {
          skillId,
          shippedTree: treeDir,
          builtTree: opts.builtTree,
          admittedSkills,
          documentRelPath: docRelPath,
        });
        resolutions.push(resolution);
        if (resolution.status === "resolved-shipped") category_counts.resolved_shipped++;
        else if (resolution.status === "resolved-cross-skill") category_counts.resolved_cross_skill++;
        else if (resolution.status === "resolved-system") category_counts.resolved_system++;
        else if (resolution.status === "resolved-tool") category_counts.resolved_tool++;
        else if (resolution.status === "documented-prerequisite") category_counts.documented_prerequisite++;
        else if (resolution.status === "dangling") {
          const key = `${skillId}\u0000${docRelPath}\u0000${citation.line ?? 1}\u0000${resolution.target.replace(/\\/g, "/")}`;
          if (danglingKeys.has(key)) continue;
          danglingKeys.add(key);
          category_counts.dangling++;
          dangling.push({
            skill: skillId,
            file: docRelPath,
            line: citation.line ?? 1,
            column: citation.column,
            raw: resolution.raw,
            target: resolution.target,
            reason: resolution.diagnosticReason ?? "unresolved",
          });
        }
      }
    }
  }

  dangling.sort(
    (a, b) =>
      a.skill.localeCompare(b.skill) ||
      (a.file ?? "").localeCompare(b.file ?? "") ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.target.localeCompare(b.target)
  );
  return { playbooks_scanned: scanned, dangling_count: dangling.length, category_counts, dangling, resolutions };
}

export interface ParsedSkillUri {
  valid: boolean;
  skillId: string;
  subpath: string;
  anchor?: string;
  raw: string;
  error?: string;
}

export function parseSkillUri(uri: string): ParsedSkillUri {
  if (!uri.startsWith("skill://")) {
    return { valid: false, skillId: "", subpath: "", raw: uri, error: "URI must start with skill://" };
  }
  const withoutScheme = uri.slice("skill://".length);
  if (withoutScheme.includes("skill://")) {
    return {
      valid: false,
      skillId: "",
      subpath: "",
      raw: uri,
      error: "Malformed skill URI contains nested 'skill://'",
    };
  }

  if (/%(?:2e|2f|5c)/i.test(withoutScheme)) {
    return {
      valid: false,
      skillId: "",
      subpath: "",
      raw: uri,
      error: "Malformed skill URI contains encoded traversal or separator components",
    };
  }

  let decoded: string;
  try {
    decoded = decodeURI(withoutScheme);
  } catch {
    return {
      valid: false,
      skillId: "",
      subpath: "",
      raw: uri,
      error: "Malformed skill URI contains invalid percent encoding",
    };
  }

  const hashIdx = decoded.indexOf("#");
  let pathPart = decoded;
  let anchor: string | undefined;
  if (hashIdx !== -1) {
    pathPart = decoded.slice(0, hashIdx);
    anchor = decoded.slice(hashIdx + 1).trim() || undefined;
  }

  const slashIdx = pathPart.indexOf("/");
  const skillId = slashIdx === -1 ? pathPart : pathPart.slice(0, slashIdx);
  const subpath = slashIdx === -1 ? "" : pathPart.slice(slashIdx + 1);

  if (!skillId) {
    return { valid: false, skillId: "", subpath: "", raw: uri, error: "Empty skill identifier in skill URI" };
  }

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillId)) {
    return {
      valid: false,
      skillId,
      subpath,
      anchor,
      raw: uri,
      error: `Invalid skill identifier '${skillId}' in skill URI`,
    };
  }

  if (subpath) {
    const segments = subpath.replace(/\\/g, "/").split("/");
    for (const seg of segments) {
      if (seg === "." || seg === ".." || seg.length === 0) {
        return {
          valid: false,
          skillId,
          subpath,
          anchor,
          raw: uri,
          error: `Path traversal or dot components not allowed in skill URI subpath: contains '${seg || "/"}'`,
        };
      }
    }
  }

  return {
    valid: true,
    skillId,
    subpath,
    anchor,
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
  const targetRel = parsed.subpath ? parsed.subpath : "SKILL.md";
  const check = verifyAssetWithinSkill(corpusDir, parsed.skillId, targetRel);
  if (!check.valid) {
    return {
      resolvedPath: check.absPath,
      exists: false,
      error: check.error ?? `Asset not found: ${targetRel} in skill ${parsed.skillId}`,
    };
  }
  const targetPath = check.absPath;

  if (parsed.anchor && (targetRel.endsWith(".md") || targetRel.endsWith(".markdown"))) {
    try {
      const content = fs.readFileSync(targetPath, "utf-8");
      const anchors = extractDocumentAnchors(content);
      if (!anchors.has(parsed.anchor.toLowerCase())) {
        return {
          resolvedPath: targetPath,
          exists: false,
          error: `Anchor '#${parsed.anchor}' not found in asset ${targetRel} of skill ${parsed.skillId}`,
        };
      }
    } catch {
      // ignore read error
    }
  }

  return {
    resolvedPath: targetPath,
    exists: true,
  };
}
