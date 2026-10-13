#!/usr/bin/env bun
/**
 * tools/internalize-corpus.ts
 *
 * Upstream skill corpus internalization tool.
 * Ingests skills from the five upstream source roots:
 * 1. vendor/reverse-skill/skills (MIT @ cab634b)
 * 2. upstream/xalgorix/internal/tools/skills/data (Apache-2.0 @ 911ac73)
 * 3. upstream/claude-red/Skills (MIT @ 7395128)
 * 4. upstream/strix/skills (Apache-2.0 @ f1386ca)
 * 5. upstream/Anthropic-Cybersecurity-Skills/skills (Apache-2.0 @ 54a7988)
 *
 * Enforces legal quarantine, canonical naming without vendor tokens,
 * category normalization to declared closed sets, description fidelity (40-300 chars),
 * Tier A deduplication (winner body bytes desc/source priority/path),
 * provenance in MANIFEST.json (relocated out of frontmatter),
 * and clean non-destructive cutover preserving the local operator tier (presets/skills/).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { evaluateQuarantine } from "../src/core/quarantine.ts";
import { sha256Bytes, sha256String } from "../src/core/hash.ts";
import { type SkillDomain } from "../src/core/skill-naming.ts";
import {
  normalizeSkillDocument,
  resolveTierACollisions,
  type NormalizedSkillResult,
} from "../src/core/corpus-normalize.ts";
import {
  type ManifestEntry,
  type CorpusManifest,
  type DedupGroup,
  computeManifestSummary,
  mergeCorpusManifest,
  readCorpusManifest,
  serializeCorpusManifest,
  validateCorpusManifest,
  validateSupportFileIntegrity,
} from "../src/core/skill-manifest.ts";
import { loadUpstreamSources } from "../src/core/upstream-sources.ts";
import {
  buildSkillMaterializationPlan,
  applyMaterializationPlan,
  type SkillMaterializationPlan,
} from "../src/core/skill-references.ts";
// Domain mapping for reverse-skill
const REVSKILL_DOMAINS: Record<string, SkillDomain> = {
  "apk-reverse": "re",
  "mobile-reverse": "mobile",
  "ida-reverse": "re",
  "ghidra-reverse": "re",
  "radare2": "re",
  "binary-diff": "re",
  "binary-ninja-reverse": "re",
  "protocol-reverse": "re",
  "malware-analysis": "re",
  "patch-diff-exploit": "re",
  "pwn-chain": "re",
  "dotnet-reverse": "re",
  "macos-reverse": "re",
  "go-rust-reverse": "re",
  "digital-forensics": "re",
  "dsl-vm-reverse": "re",
  "hardware-security": "re",
  "firmware-pentest": "re",
  "reverse-engineering": "re",
  "diagram-generator": "re",
  "docs-generator": "re",
  "case-review": "re",
  "js-reverse": "webapp",
  "browser-extension-reverse": "webapp",
  "src-hunter": "webapp",
  "browser-automation": "webapp",
  "thick-client": "webapp",
  "api-security": "webapp",
  "identity-federation": "webapp",
  "email-security": "webapp",
  "database-security": "webapp",
  "code-audit": "webapp",
  "pentest-tools": "webapp",
  "windows-ad": "red",
  "wifi-wireless": "red",
  "radio-sdr": "red",
  "ot-ics": "red",
  "edr-bypass-re": "red",
  "attack-chain": "red",
  "threat-intelligence": "red",
  "threat-hunting": "red",
  "supply-chain-security": "red",
  "cloud-k8s": "red",
  "llm-security": "red",
};

const REVSKILL_DESCRIPTIONS: Record<string, string> = {
  "apk-reverse": "Decompile, analyze, modify smali, repackage, and bypass Android APK defenses.",
  "mobile-reverse": "Static and dynamic reverse engineering and security assessments for Android and iOS apps.",
  "ida-reverse": "IDA Pro reverse engineering guidance for binary triage, decompilation, and vulnerability analysis.",
  "ghidra-reverse": "Open-source reverse engineering and decompilation workflows with Ghidra GUI and headless modes.",
  "radare2": "Binary analysis and disassembly workflows using radare2 command-line tooling.",
  "binary-diff": "Cross-version symbol migration and binary diffing across executable updates.",
  "binary-ninja-reverse": "Binary analysis workflows using Binary Ninja HLIL, MLIL, and LLIL representations.",
  "protocol-reverse": "Reverse engineering and parsing methodologies for custom binary and network protocols.",
  "malware-analysis": "Static, dynamic, and behavioral analysis procedures for suspicious binary samples.",
  "patch-diff-exploit": "N-day patch differential analysis to deduce vulnerabilities and develop targeted proofs of concept.",
  "pwn-chain": "End-to-end exploit engineering from binary vulnerability identification to stable delivery.",
  "dotnet-reverse": "Reverse engineering workflows for managed .NET assemblies and C# NativeAOT binaries.",
  "macos-reverse": "macOS Mach-O reverse engineering, code signing analysis, and Objective-C runtime inspection.",
  "go-rust-reverse": "Reverse engineering stripped Go and Rust binaries with runtime data reconstruction.",
  "digital-forensics": "Digital forensics analysis covering memory dumps, disk timelines, and evidence collection.",
  "dsl-vm-reverse": "Reverse engineering custom JavaScript DSLs, bytecode VMs, and non-standard runtimes.",
  "hardware-security": "Hardware interface exploration covering UART, JTAG, SPI, and bus communication dumping.",
  "firmware-pentest": "Firmware extraction, emulation, and IoT vulnerability assessment across embedded platforms.",
  "reverse-engineering": "Core reverse engineering methodology for binary understanding, data structures, and algorithms.",
  "diagram-generator": "Generates, refines, and validates architecture and attack-flow diagrams from analysis notes.",
  "docs-generator": "Produces task-oriented technical reports and documentation with structured findings.",
  "case-review": "Reviews engagement cases for scope readiness, evidence completeness, and finding validity.",
  "js-reverse": "Front-end JavaScript reverse engineering for cryptographic logic and signature extraction.",
  "browser-extension-reverse": "Reverse engineering and security review of Chrome and Firefox browser extensions.",
  "src-hunter": "Bug bounty and security research workflow covering attack surface discovery and triage.",
  "browser-automation": "Headless browser and UI automation for web vulnerability verification and interaction replay.",
  "thick-client": "Security testing for desktop thick-client applications and local IPC communication.",
  "api-security": "Security evaluation and vulnerability identification across REST, GraphQL, and WebSocket APIs.",
  "identity-federation": "Security assessment of federated identity and authentication protocols including SAML and OIDC.",
  "email-security": "Email security evaluation covering phishing inspection, SPF, DKIM, and DMARC enforcement.",
  "database-security": "Database security testing for SQL injection, privilege escalation, and misconfiguration.",
  "code-audit": "Source-code security review and SAST triage for common vulnerability patterns.",
  "pentest-tools": "Active penetration testing tools and automation for vulnerability discovery and verification.",
  "windows-ad": "Active Directory and Windows enterprise identity assessment and privilege escalation.",
  "wifi-wireless": "Wireless network assessment covering WPA handshakes, rogue APs, and protocol security.",
  "radio-sdr": "Software-defined radio security research covering signal capture and replay attacks.",
  "ot-ics": "Operational technology and ICS/SCADA security assessment across industrial protocols.",
  "edr-bypass-re": "Reverse engineering security sensors and endpoint agents to analyze bypass mechanisms.",
  "attack-chain": "Multi-stage attack path planning and execution across complex network environments.",
  "threat-intelligence": "Threat intelligence research and IOC correlation for threat actor tracking.",
  "threat-hunting": "Proactive threat hunting and detection engineering using behavioral analytics.",
  "supply-chain-security": "Software supply-chain security analysis covering dependency confusion and SBOM verification.",
  "cloud-k8s": "Cloud infrastructure and Kubernetes security review covering container escapes and IAM policies.",
  "llm-security": "Security assessment of large language model applications, prompts, and agentic workflows.",
};

export interface InternalizeCorpusOptions {
  repoRoot?: string;
  preview?: boolean;
  renameSync?: (oldPath: fs.PathLike, newPath: fs.PathLike) => void;
}

export interface InternalizeCorpusResult {
  manifest: CorpusManifest;
  admitted: NormalizedSkillResult[];
  deduplicated: Array<{
    result: NormalizedSkillResult;
    winner: NormalizedSkillResult;
    rationale: string;
  }>;
  dedupGroups: DedupGroup[];
  materializationPlans?: SkillMaterializationPlan[];
  totalSupportFiles?: number;
  totalDanglingReferences?: number;
  danglingDiagnostics?: Array<{
    skill: string;
    raw: string;
    sourceRoot: string;
    candidatePaths: string[];
    reason: string;
  }>;
}

/**
 * Executes corpus internalization.
 * When preview=true (or CLI flag --preview), runs report-only without mutating disk.
 * When preview=false (default CLI behavior), performs clean cutover on src/corpus child directories
 * and reconciles MANIFEST.json without touching presets/skills/.
 */
export function internalizeCorpus(
  options: InternalizeCorpusOptions = {}
): InternalizeCorpusResult {
  const repoRoot = options.repoRoot || ".";
  const isPreview = options.preview ?? process.argv.includes("--preview");
  const corpusDir = path.resolve(repoRoot, "src/corpus");
  const manifestPath = path.join(corpusDir, "MANIFEST.json");
  const renameFn = options.renameSync ?? fs.renameSync;

  // Load and strictly validate previous manifest before ANY destructive actions
  let previousManifest: CorpusManifest | null = null;
  if (fs.existsSync(manifestPath)) {
    try {
      previousManifest = readCorpusManifest(manifestPath);
    } catch (err) {
      throw new Error(`Refusing to internalize corpus: existing manifest at '${manifestPath}' is invalid or malformed:\n${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const prevAdmittedBySlug = new Map<string, ManifestEntry>();
  if (previousManifest) {
    for (const prev of previousManifest.files) {
      if (prev.status === "admitted" && prev.destination_path?.startsWith("src/corpus/")) {
        const slug = prev.destination_path.slice("src/corpus/".length).split("/")[0];
        if (slug) prevAdmittedBySlug.set(slug, prev);
      }
    }
  }

  const candidateResults: NormalizedSkillResult[] = [];
  const nonAdmittedEntries: ManifestEntry[] = [];
  const upstreamConfigs = loadUpstreamSources(repoRoot);
  const revSkillCfg = upstreamConfigs["reverse-skill"]!;
  const xalgCfg = upstreamConfigs["xalgorix"]!;
  const claudeCfg = upstreamConfigs["claude-red"]!;
  const strixCfg = upstreamConfigs["strix"]!;
  const anthropicCfg = upstreamConfigs["Anthropic-Cybersecurity-Skills"]!;

  // 1. Process reverse-skill (MIT) from upstream/reverse-skill
  const revSkillRoot = path.resolve(repoRoot, revSkillCfg.upstreamDir, revSkillCfg.skillsSubdir);
  if (fs.existsSync(revSkillRoot)) {
    const dirs = fs.readdirSync(revSkillRoot).sort((a, b) => a.localeCompare(b));
    for (const dir of dirs) {
      const origPath = path.join(revSkillRoot, dir, "SKILL.md");
      if (!fs.existsSync(origPath)) continue;

      const raw = fs.readFileSync(origPath, "utf-8");
      const relPath = `skills/${dir}/SKILL.md`;
      const q = evaluateQuarantine(dir, revSkillCfg.license, raw);

      if (!q.allowed || dir === "reverse-skill-router") {
        nonAdmittedEntries.push({
          path: relPath,
          source: "reverse-skill",
          source_rev: revSkillCfg.rev,
          license: revSkillCfg.license,
          status: dir === "reverse-skill-router" ? "excluded" : q.status,
          reason: dir === "reverse-skill-router" ? "Replaced by Arsenal Tier 1 domain routers" : q.reason,
          source_path: relPath,
          source_sha256: sha256String(raw),
        });
        continue;
      }

      const domain = REVSKILL_DOMAINS[dir] ?? "re";
      const desc = REVSKILL_DESCRIPTIONS[dir] || "";

      // Preserve already curated/translated English content if present in src/corpus and proven same-revision/raw-hash
      let contentToUse = raw;
      const canonicalId = `${domain}-${dir}`;
      const canonicalDir = path.join(corpusDir, canonicalId);
      const existingFile = path.join(canonicalDir, "SKILL.md");
      const prevRevEntry = prevAdmittedBySlug.get(canonicalId);
      const rawHash = sha256String(raw);
      const revPreserved = Boolean(
        prevRevEntry &&
        prevRevEntry.source_rev &&
        prevRevEntry.source_rev === revSkillCfg.rev &&
        prevRevEntry.source_sha256 &&
        prevRevEntry.source_sha256 === rawHash
      );
      if (fs.existsSync(existingFile) && (!previousManifest || revPreserved)) {
        contentToUse = fs.readFileSync(existingFile, "utf-8");
      }
      const normalized = normalizeSkillDocument({
        content: contentToUse,
        domain,
        techniqueSlug: dir,
        upstreamCategory: dir,
        source: "reverse-skill",
        sourcePath: relPath,
        sourceRev: revSkillCfg.rev,
        license: revSkillCfg.license,
        sourceSha256: sha256String(raw),
      });

      if (desc) {
        normalized.frontmatter.description = desc;
        normalized.description = desc;
        normalized.manifestEntry.sha256 = sha256String(normalized.serialized);
        normalized.manifestEntry.bytes = Buffer.byteLength(normalized.serialized, "utf-8");
      }

      candidateResults.push(normalized);
    }
  }

  // 2. Process xalgorix (Apache-2.0 @ 911ac73)
  const xalgorixRoot = path.resolve(repoRoot, xalgCfg.upstreamDir, xalgCfg.skillsSubdir);
  if (fs.existsSync(xalgorixRoot)) {
    const xalgorixCategories = fs
      .readdirSync(xalgorixRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const cat of xalgorixCategories) {
      const catPath = path.join(xalgorixRoot, cat.name);
      const skillDirs = fs
        .readdirSync(catPath, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const sDir of skillDirs) {
        const sFile = path.join(catPath, sDir.name, "SKILL.md");
        if (!fs.existsSync(sFile)) continue;

        const raw = fs.readFileSync(sFile, "utf-8");
        const relPath = `${cat.name}/${sDir.name}/SKILL.md`;
        const q = evaluateQuarantine(relPath, "Apache-2.0", raw);

        if (!q.allowed) {
          nonAdmittedEntries.push({
            path: relPath,
            source: "xalgorix",
            source_rev: xalgCfg.rev,
            license: xalgCfg.license,
            status: q.status,
            reason: q.reason,
            source_path: relPath,
            source_sha256: sha256String(raw),
          });
          continue;
        }

        let domain: SkillDomain = "webapp";
        if (cat.name.includes("mobile")) {
          domain = "mobile";
        } else if (
          cat.name.includes("binary") ||
          cat.name.includes("forensics") ||
          cat.name.includes("crypto") ||
          cat.name.includes("firmware")
        ) {
          domain = "re";
        } else if (
          cat.name.includes("red") ||
          cat.name.includes("network") ||
          cat.name.includes("cloud") ||
          cat.name.includes("wireless") ||
          cat.name.includes("identity")
        ) {
          domain = "red";
        }

        const normalized = normalizeSkillDocument({
          content: raw,
          domain,
          techniqueSlug: sDir.name,
          upstreamCategory: cat.name,
          source: "xalgorix",
          sourcePath: relPath,
          sourceRev: xalgCfg.rev,
          license: xalgCfg.license,
          sourceSha256: sha256String(raw),
        });

        candidateResults.push(normalized);
      }
    }
  }

  // 3. Process claude-red (MIT @ 7395128)
  const claudeRedRoot = path.resolve(repoRoot, claudeCfg.upstreamDir, claudeCfg.skillsSubdir);
  if (fs.existsSync(claudeRedRoot)) {
    const catDirs = fs
      .readdirSync(claudeRedRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const cat of catDirs) {
      const catPath = path.join(claudeRedRoot, cat.name);
      const subEntries = fs
        .readdirSync(catPath, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const sub of subEntries) {
        let sFile = "";
        let slug = "";
        if (sub.isDirectory()) {
          sFile = path.join(catPath, sub.name, "SKILL.md");
          slug = `${cat.name}-${sub.name}`;
        } else if (sub.name.endsWith(".md")) {
          sFile = path.join(catPath, sub.name);
          slug = `${cat.name}-${sub.name.replace(/\.md$/, "")}`;
        }
        if (!sFile || !fs.existsSync(sFile)) continue;

        const raw = fs.readFileSync(sFile, "utf-8");
        const relPath = path.relative(claudeRedRoot, sFile).replace(/\\/g, "/");
        const q = evaluateQuarantine(relPath, "MIT", raw);

        if (!q.allowed) {
          nonAdmittedEntries.push({
            path: relPath,
            source: "claude-red",
            source_rev: claudeCfg.rev,
            license: claudeCfg.license,
            status: q.status,
            reason: q.reason,
            source_path: relPath,
            source_sha256: sha256String(raw),
          });
          continue;
        }

        let domain: SkillDomain = "red";
        if (cat.name === "web" || cat.name === "api" || cat.name === "auth") {
          domain = "webapp";
        } else if (cat.name === "mobile") {
          domain = "mobile";
        } else if (
          cat.name === "fuzzing" ||
          cat.name === "crypto" ||
          cat.name === "exploit-dev" ||
          cat.name === "forensics"
        ) {
          domain = "re";
        }

        const normalized = normalizeSkillDocument({
          content: raw,
          domain,
          techniqueSlug: slug,
          upstreamCategory: cat.name,
          source: "claude-red",
          sourcePath: relPath,
          sourceRev: claudeCfg.rev,
          license: claudeCfg.license,
          sourceSha256: sha256String(raw),
        });

        candidateResults.push(normalized);
      }
    }
  }

  // 4. Process strix (Apache-2.0 @ f1386ca)
  const strixRoot = path.resolve(repoRoot, strixCfg.upstreamDir, strixCfg.skillsSubdir);
  if (fs.existsSync(strixRoot)) {
    const dirs = fs
      .readdirSync(strixRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const dir of dirs) {
      const sFile = path.join(strixRoot, dir.name, "SKILL.md");
      if (!fs.existsSync(sFile)) continue;

      const raw = fs.readFileSync(sFile, "utf-8");
      const relPath = `${dir.name}/SKILL.md`;
      const q = evaluateQuarantine(relPath, "Apache-2.0", raw);

      if (!q.allowed) {
        nonAdmittedEntries.push({
          path: relPath,
          source: "strix",
          source_rev: strixCfg.rev,
          license: strixCfg.license,
          status: q.status,
          reason: q.reason,
          source_path: relPath,
          source_sha256: sha256String(raw),
        });
        continue;
      }

      const normalized = normalizeSkillDocument({
        content: raw,
        domain: "webapp",
        techniqueSlug: dir.name,
        upstreamCategory: "application-security",
        source: "strix",
        sourcePath: relPath,
        sourceRev: strixCfg.rev,
        license: strixCfg.license,
        sourceSha256: sha256String(raw),
      });

      candidateResults.push(normalized);
    }
  }

  // 5. Process Anthropic-Cybersecurity-Skills (Apache-2.0 @ 54a7988)
  const anthropicRoot = path.resolve(repoRoot, anthropicCfg.upstreamDir, anthropicCfg.skillsSubdir);
  if (fs.existsSync(anthropicRoot)) {
    const dirs = fs
      .readdirSync(anthropicRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const dir of dirs) {
      const sFile = path.join(anthropicRoot, dir.name, "SKILL.md");
      if (!fs.existsSync(sFile)) continue;

      const raw = fs.readFileSync(sFile, "utf-8");
      const relPath = `${dir.name}/SKILL.md`;
      const q = evaluateQuarantine(relPath, "Apache-2.0", raw);

      if (!q.allowed) {
        nonAdmittedEntries.push({
          path: relPath,
          source: "Anthropic-Cybersecurity-Skills",
          source_rev: anthropicCfg.rev,
          license: anthropicCfg.license,
          status: q.status,
          reason: q.reason,
          source_path: relPath,
          source_sha256: sha256String(raw),
        });
        continue;
      }

      let domain: SkillDomain = "red";
      if (dir.name.includes("android") || dir.name.includes("ios") || dir.name.includes("mobile")) {
        domain = "mobile";
      } else if (
        dir.name.includes("reverse") ||
        dir.name.includes("malware") ||
        dir.name.includes("forensics") ||
        dir.name.includes("binary") ||
        dir.name.includes("ghidra") ||
        dir.name.includes("ida") ||
        dir.name.includes("firmware")
      ) {
        domain = "re";
      } else if (
        dir.name.includes("web") ||
        dir.name.includes("api") ||
        dir.name.includes("sql") ||
        dir.name.includes("xss") ||
        dir.name.includes("csrf") ||
        dir.name.includes("graphql")
      ) {
        domain = "webapp";
      }

      const normalized = normalizeSkillDocument({
        content: raw,
        domain,
        techniqueSlug: dir.name,
        upstreamCategory: "cybersecurity",
        source: "Anthropic-Cybersecurity-Skills",
        sourcePath: relPath,
        sourceRev: anthropicCfg.rev,
        license: anthropicCfg.license,
        sourceSha256: sha256String(raw),
      });

      candidateResults.push(normalized);
    }
  }

  // Resolve Tier A collision groups
  const { admitted, deduplicated, dedupGroups } = resolveTierACollisions(candidateResults);

  // Map candidate and canonical slugs for cross-skill references
  const admittedSkillsMap = new Map<string, string>();
  for (const adm of admitted) {
    admittedSkillsMap.set(adm.canonicalId, adm.canonicalId);
    const sourcePath = adm.manifestEntry.source_path;
    if (sourcePath) {
      const parts = sourcePath.split("/");
      if (parts.length >= 2) {
        const slug = parts[parts.length - 2];
        if (slug) admittedSkillsMap.set(slug, adm.canonicalId);
      }
    }
  }

  // Build reference materialization plans for each admitted skill
  const materializationPlans: SkillMaterializationPlan[] = [];
  const danglingDiagnostics: Array<{
    skill: string;
    raw: string;
    sourceRoot: string;
    candidatePaths: string[];
    reason: string;
  }> = [];

  let totalSupportFiles = 0;
  let totalDanglingReferences = 0;

  for (const adm of admitted) {
    const existingSkillFile = path.join(corpusDir, adm.canonicalId, "SKILL.md");
    const prevEntry = prevAdmittedBySlug.get(adm.canonicalId);
    const newSrcRev = upstreamConfigs[adm.manifestEntry.source]?.rev;
    const isPreservedSameSource = Boolean(
      prevEntry &&
      prevEntry.source_rev &&
      newSrcRev &&
      prevEntry.source_rev === newSrcRev &&
      prevEntry.source_sha256 &&
      adm.manifestEntry.source_sha256 &&
      prevEntry.source_sha256 === adm.manifestEntry.source_sha256
    );
    const planningContent = isPreservedSameSource && fs.existsSync(existingSkillFile)
      ? fs.readFileSync(existingSkillFile, "utf-8")
      : adm.serialized;
    const plan = buildSkillMaterializationPlan(planningContent, {
      skillSlug: adm.canonicalId,
      source: adm.manifestEntry.source,
      sourcePath: adm.manifestEntry.source_path || adm.manifestEntry.path,
      repoRoot,
      upstreamConfig: upstreamConfigs,
      admittedSkillsMap,
    });
    materializationPlans.push(plan);

    totalSupportFiles += plan.supportFiles.length;
    totalDanglingReferences += plan.danglingReferences.length;

    for (const d of plan.danglingReferences) {
      danglingDiagnostics.push({
        skill: adm.canonicalId,
        raw: d.raw,
        sourceRoot: d.sourceRoot || "unknown",
        candidatePaths: d.candidatePaths || [],
        reason: d.diagnosticReason || "unresolved",
      });
    }

    // Update admitted serialized content and hashes
    adm.serialized = plan.rewrittenContent;
    adm.body = plan.rewrittenContent;
    adm.sha256 = sha256String(plan.rewrittenContent);
    adm.bytes = Buffer.byteLength(plan.rewrittenContent, "utf-8");

    adm.manifestEntry.sha256 = adm.sha256;
    adm.manifestEntry.bytes = adm.bytes;
    if (plan.supportFiles.length > 0) {
      adm.manifestEntry.support_files = plan.supportFiles;
    }
  }
  // previousManifest was already loaded and validated before ingestion started

  // Compile all entries
  const allEntries: ManifestEntry[] = [
    ...admitted.map((a) => a.manifestEntry),
    ...deduplicated.map((d) => d.result.manifestEntry),
    ...nonAdmittedEntries,
  ];

  const sourcesConfig: Record<string, { repo: string; rev: string; license: string }> = {
    "reverse-skill": {
      repo: revSkillCfg.repo,
      rev: revSkillCfg.rev,
      license: revSkillCfg.license,
    },
    xalgorix: {
      repo: xalgCfg.repo,
      rev: xalgCfg.rev,
      license: xalgCfg.license,
    },
    "claude-red": {
      repo: claudeCfg.repo,
      rev: claudeCfg.rev,
      license: claudeCfg.license,
    },
    strix: {
      repo: strixCfg.repo,
      rev: strixCfg.rev,
      license: strixCfg.license,
    },
    "Anthropic-Cybersecurity-Skills": {
      repo: anthropicCfg.repo,
      rev: anthropicCfg.rev,
      license: anthropicCfg.license,
    },
  };

  const rawManifest: CorpusManifest = {
    schema_version: 1,
    generator: "arsenal-corpus-internalize-v3.0.0",
    created_at: null,
    summary: computeManifestSummary(allEntries),
    sources: sourcesConfig,
    files: allEntries,
    dedup_groups: dedupGroups,
  };

  // Reconcile with local tier (IN-11)
  const finalManifest = mergeCorpusManifest(rawManifest, previousManifest);

  if (!isPreview) {
    fs.mkdirSync(corpusDir, { recursive: true });
    const admittedBySlug = new Map<string, NormalizedSkillResult>();
    const admittedBySourcePath = new Map<string, NormalizedSkillResult>();
    for (const adm of admitted) {
      admittedBySlug.set(adm.canonicalId, adm);
      if (adm.manifestEntry.source_path) {
        admittedBySourcePath.set(`${adm.manifestEntry.source}:${adm.manifestEntry.source_path}`, adm);
      }
    }

    // Preflight active sources against previous manifest
    if (previousManifest) {
      const activeSourceSet = new Set(Object.keys(sourcesConfig));
      const prevAdmittedMap = new Map<string, ManifestEntry>();

      for (const prev of previousManifest.files) {
        if (!activeSourceSet.has(prev.source)) continue;
        if (prev.status === "admitted" && prev.destination_path) {
          const prefix = "src/corpus/";
          const slug = prev.destination_path.startsWith(prefix)
            ? prev.destination_path.slice(prefix.length).split("/")[0]!
            : "";
          if (slug) prevAdmittedMap.set(slug, prev);

          const matchedCandidate = (slug && admittedBySlug.get(slug)) ||
            (prev.source_path ? admittedBySourcePath.get(`${prev.source}:${prev.source_path}`) : undefined);

          if (!matchedCandidate) {
            throw new Error(`Refusing to internalize corpus: previously admitted skill '${prev.destination_path}' from active source '${prev.source}' has no candidate admitted result in new ingestion.`);
          }

          const prevSrcRev = prev.source_rev;
          const newSrcRev = sourcesConfig[prev.source]?.rev;
          const sameRev = prevSrcRev && newSrcRev && prevSrcRev === newSrcRev;

          const prevRawSha = prev.source_sha256;
          const newRawSha = matchedCandidate.manifestEntry.source_sha256;
          const sameRawSha = prevRawSha && newRawSha && prevRawSha === newRawSha;

          if (sameRev && sameRawSha) {
            // Same proven source revision and raw hash -> preserve existing tree (SKILL + all support files)
            const existingSkillFile = path.join(corpusDir, slug, "SKILL.md");
            if (fs.existsSync(existingSkillFile)) {
              const curatedSkillContent = fs.readFileSync(existingSkillFile, "utf-8");
              matchedCandidate.serialized = curatedSkillContent;
              matchedCandidate.body = curatedSkillContent;
              matchedCandidate.sha256 = sha256String(curatedSkillContent);
              matchedCandidate.bytes = Buffer.byteLength(curatedSkillContent, "utf-8");
              matchedCandidate.manifestEntry.sha256 = matchedCandidate.sha256;
              matchedCandidate.manifestEntry.bytes = matchedCandidate.bytes;
            }
            const supportMap = new Map<string, { path: string; source_path: string; sha256: string; bytes: number }>();
            // Add existing support files from prev manifest
            for (const sf of prev.support_files || []) {
              const sfPath = path.join(corpusDir, slug, sf.path);
              if (fs.existsSync(sfPath)) {
                const sfBytes = fs.readFileSync(sfPath);
                supportMap.set(sf.path, {
                  ...sf,
                  sha256: sha256Bytes(sfBytes),
                  bytes: sfBytes.byteLength,
                });
              } else {
                supportMap.set(sf.path, { ...sf });
              }
            }
            // Merge any newly planned missing items from newPlan.items
            const candPlan = materializationPlans.find((p) => p.skillSlug === matchedCandidate.canonicalId);
            for (const item of candPlan?.items || []) {
              if (!supportMap.has(item.destRelPath)) {
                supportMap.set(item.destRelPath, { ...item.record });
              }
            }
            if (supportMap.size > 0) {
              matchedCandidate.manifestEntry.support_files = Array.from(supportMap.values()).sort((a, b) => a.path.localeCompare(b.path));
            } else {
              delete matchedCandidate.manifestEntry.support_files;
            }
            continue;
          }
          // Source revision or raw hash changed: verify if candidate would modify/remove existing canonical bytes
          if (!prevRawSha) {
            throw new Error(`Refusing to internalize corpus: legacy entry '${prev.destination_path}' lacks source_sha256 and upstream has changed.`);
          }

          const existingSkillFile = path.join(corpusDir, slug, "SKILL.md");
          const existingSkillBytes = fs.existsSync(existingSkillFile) ? fs.readFileSync(existingSkillFile) : null;
          const newSkillBytes = Buffer.from(matchedCandidate.serialized, "utf-8");

          if (!existingSkillBytes || !existingSkillBytes.equals(newSkillBytes)) {
            throw new Error(`Refusing to internalize corpus: candidate for '${slug}' modifies existing canonical SKILL.md under changed revision '${newSrcRev}'.`);
          }

          const existingSupportFiles = prev.support_files || [];
          const newPlan = materializationPlans.find((p) => p.skillSlug === matchedCandidate.canonicalId);
          const newSupportItems = newPlan?.items || [];

          const existingSupportMap = new Map<string, Buffer>();
          for (const sf of existingSupportFiles) {
            const sfPath = path.join(corpusDir, slug, sf.path);
            if (fs.existsSync(sfPath)) {
              existingSupportMap.set(sf.path, fs.readFileSync(sfPath));
            }
          }
          const newSupportMap = new Map<string, Buffer>();
          for (const item of newSupportItems) {
            let rawBytes: Buffer = item.upstreamContent ?? item.content;
            if (!item.upstreamContent && item.sourceAbsPath && fs.existsSync(item.sourceAbsPath)) {
              try {
                rawBytes = fs.readFileSync(item.sourceAbsPath);
              } catch {
                rawBytes = item.content;
              }
            }
            newSupportMap.set(item.destRelPath, rawBytes);
          }

          if (existingSupportMap.size !== newSupportMap.size) {
            throw new Error(`Refusing to internalize corpus: candidate for '${slug}' alters support file count under changed revision '${newSrcRev}'.`);
          }
          for (const [relPath, exBytes] of existingSupportMap.entries()) {
            const candBytes = newSupportMap.get(relPath);
            if (!candBytes || !exBytes.equals(candBytes)) {
              throw new Error(`Refusing to internalize corpus: candidate for '${slug}' modifies support file '${relPath}' under changed revision '${newSrcRev}'.`);
            }
          }
        }
      }
    }

    // Safe staging transaction: stage sibling directory, apply changes, and commit via atomic swap
    const stageDir = path.resolve(repoRoot, `src/corpus.__stage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const backupDir = path.resolve(repoRoot, `src/corpus.__backup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    try {
      fs.mkdirSync(stageDir, { recursive: true });

      // Copy existing corpus contents to stageDir (preserving all existing files, including unmanaged and non-enumerated sources)
      if (fs.existsSync(corpusDir)) {
        fs.cpSync(corpusDir, stageDir, { recursive: true });
      }

      // Filter materialization plans: skip overwriting preserved curated skills
      const preservedSlugs = new Set<string>();
      if (previousManifest) {
        for (const prev of previousManifest.files) {
          if (prev.status === "admitted" && prev.destination_path) {
            const prefix = "src/corpus/";
            const slug = prev.destination_path.startsWith(prefix)
              ? prev.destination_path.slice(prefix.length).split("/")[0]!
              : "";
            const matchedCandidate = slug ? admittedBySlug.get(slug) : undefined;
            if (matchedCandidate && prev.source_rev === sourcesConfig[prev.source]?.rev && prev.source_sha256 === matchedCandidate.manifestEntry.source_sha256) {
              preservedSlugs.add(slug);
            }
          }
        }
      }
      // Apply materialization plans into stageDir
      for (const plan of materializationPlans) {
        const isPreserved = preservedSlugs.has(plan.skillSlug);
        const stagedPlan: SkillMaterializationPlan = {
          ...plan,
          skillDir: path.join(stageDir, plan.skillSlug),
          rewrittenContent: isPreserved ? "" : plan.rewrittenContent,
          items: plan.items.map((item) => ({
            ...item,
            destAbsPath: path.join(stageDir, plan.skillSlug, item.destRelPath),
          })),
        };

        if (!isPreserved) {
          applyMaterializationPlan(stagedPlan, { preview: false });
        } else {
          // For preserved skills: do not overwrite existing files, but materialize any newly planned missing support files
          for (const item of stagedPlan.items) {
            if (!fs.existsSync(item.destAbsPath)) {
              fs.mkdirSync(path.dirname(item.destAbsPath), { recursive: true });
              fs.writeFileSync(item.destAbsPath, item.content);
            }
          }
        }
      }

      // Ensure preserved curated skills have their exact existing tree copied/retained in stageDir
      if (previousManifest) {
        for (const prev of previousManifest.files) {
          if (prev.status === "admitted" && prev.destination_path) {
            const prefix = "src/corpus/";
            const slug = prev.destination_path.startsWith(prefix)
              ? prev.destination_path.slice(prefix.length).split("/")[0]!
              : "";
            const matchedCandidate = slug ? admittedBySlug.get(slug) : undefined;
            if (matchedCandidate && prev.source_rev === sourcesConfig[prev.source]?.rev && prev.source_sha256 === matchedCandidate.manifestEntry.source_sha256) {
              const origSkillPath = path.join(corpusDir, slug, "SKILL.md");
              const stagedSkillPath = path.join(stageDir, slug, "SKILL.md");
              if (fs.existsSync(origSkillPath)) {
                fs.mkdirSync(path.dirname(stagedSkillPath), { recursive: true });
                fs.copyFileSync(origSkillPath, stagedSkillPath);
              }
              for (const sf of prev.support_files || []) {
                const origSf = path.join(corpusDir, slug, sf.path);
                const stagedSf = path.join(stageDir, slug, sf.path);
                if (fs.existsSync(origSf)) {
                  fs.mkdirSync(path.dirname(stagedSf), { recursive: true });
                  fs.copyFileSync(origSf, stagedSf);
                }
              }
            }
          }
        }
      }

      // Validate support file integrity of the staged tree before commit
      const supportIntegrityErrors = validateSupportFileIntegrity(finalManifest, stageDir);
      if (supportIntegrityErrors.length > 0) {
        throw new Error(`Refusing to internalize corpus: staged support files failed integrity check:\n  ${supportIntegrityErrors.join("\n  ")}`);
      }

      // Recompute manifest summary in case entries were refreshed
      finalManifest.summary = computeManifestSummary(finalManifest.files);

      // Pre-commit validation of the finalManifest before writing
      const preValidation = validateCorpusManifest(finalManifest);
      if (!preValidation.valid) {
        throw new Error(`Refusing to internalize corpus: generated final manifest failed validation:\n${preValidation.errors.join("\n")}`);
      }
      // Write MANIFEST.json in stageDir
      const stageManifestPath = path.join(stageDir, "MANIFEST.json");
      const serializedManifest = serializeCorpusManifest(finalManifest);
      fs.writeFileSync(stageManifestPath, serializedManifest, "utf-8");

      // Atomic commit: rename corpusDir -> backupDir, rename stageDir -> corpusDir
      const hadCorpus = fs.existsSync(corpusDir);
      if (hadCorpus) {
        renameFn(corpusDir, backupDir);
      }
      try {
        renameFn(stageDir, corpusDir);
      } catch (commitErr) {
        // Roll back if rename stageDir -> corpusDir fails
        if (hadCorpus && fs.existsSync(backupDir)) {
          try {
            renameFn(backupDir, corpusDir);
          } catch {
            // preserve original commitErr
          }
        }
        throw commitErr;
      }

      // Clean up backupDir on successful commit
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch (txErr) {
      // Clean up stageDir on failure
      if (fs.existsSync(stageDir)) {
        fs.rmSync(stageDir, { recursive: true, force: true });
      }
      throw txErr;
    }
  } else {
    // Preview mode: report-only without mutating disk
    for (const plan of materializationPlans) {
      applyMaterializationPlan(plan, { preview: true });
    }
  }

  return {
    manifest: finalManifest,
    admitted,
    deduplicated,
    dedupGroups,
    materializationPlans,
    totalSupportFiles,
    totalDanglingReferences,
    danglingDiagnostics,
  };
}
// Preserve direct CLI execution while preventing execution on import
if (import.meta.main || process.argv[1]?.endsWith("internalize-corpus.ts")) {
  const isPreview = process.argv.includes("--preview");
  const res = internalizeCorpus({ preview: isPreview });
  const manifestPath = path.resolve("src/corpus/MANIFEST.json");

  console.log(`Corpus internalization complete!
Total considered: ${res.manifest.summary.total_considered}
Admitted: ${res.manifest.summary.admitted}
Deduplicated: ${res.manifest.summary.deduplicated}
Quarantined: ${res.manifest.summary.quarantined}
Excluded: ${res.manifest.summary.excluded}
Tier A Collision Groups: ${res.dedupGroups.length}
Manifest written to ${manifestPath}`);
}
