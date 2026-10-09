/**
 * src/core/corpus-normalize.ts
 *
 * Per-skill and corpus-level normalization pipeline per specs/002-refactor-skill-corpus:
 * - Parses Markdown documents via skill-frontmatter.ts (YAML semantics, joining folded scalars)
 * - Derives canonical skill identifiers via skill-naming.ts (no vendor tokens, max 64 chars, no mid-word truncation)
 * - Normalizes categories to the closed declared per-domain set in presets/<domain>/routing.json
 * - Enforces description fidelity: 40-300 characters, sentence boundary trimming, no filler padding
 * - Detects and resolves Tier A collisions via skill-dedup.ts (body bytes desc, source priority desc, source_path asc)
 * - Relocates provenance out of shipped frontmatter into MANIFEST.json
 * - Preserves operator local tier (presets/skills/ and arsenal-local manifest entries)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256String } from "./hash.ts";
import {
  type SkillFrontmatter,
  parseSkillDocument,
  splitFrontmatter,
  serializeSkillDocument,
  boundDescription,
  normalizeDescription,
  validateCanonicalSkillFrontmatter,
} from "./skill-frontmatter.ts";
import {
  type SkillDomain,
  deriveSkillId,
  deriveSkillSlug,
  parseSkillId,
  isValidSkillDomain,
  FORBIDDEN_VENDOR_SEGMENTS,
} from "./skill-naming.ts";
import {
  type DedupCandidateInput,
  type DedupGroup,
  detectTierACollisionGroups,
  resolveTierAWinner,
} from "./skill-dedup.ts";
import {
  type ManifestEntry,
  type ManifestEntryStatus,
  type CorpusManifest,
  type CorpusManifestSummary,
  LOCAL_SOURCE_ID,
  computeManifestSummary,
  mergeCorpusManifest,
  serializeCorpusManifest,
  compareManifestEntries,
} from "./skill-manifest.ts";
import { loadUpstreamSources } from "./upstream-sources.ts";
/**
 * Declared category sets per domain from presets/<domain>/routing.json.
 */
export const DECLARED_DOMAIN_CATEGORIES: Readonly<Record<SkillDomain, readonly string[]>> = Object.freeze({
  re: Object.freeze([
    "binary-analysis",
    "decompilation",
    "exploitation",
    "forensics",
    "firmware",
    "cryptography",
  ]),
  mobile: Object.freeze([
    "apk-analysis",
    "ios-analysis",
    "instrumentation",
    "repackaging",
  ]),
  webapp: Object.freeze([
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
  ]),
  red: Object.freeze([
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
  ]),
});

/**
 * Reads declared categories for a domain from presets/<domain>/routing.json,
 * falling back to declared constants if the file cannot be read.
 */
export function getDeclaredDomainCategories(domain: SkillDomain, repoRoot = "."): readonly string[] {
  const routingPath = path.resolve(repoRoot, `presets/${domain}/routing.json`);
  if (fs.existsSync(routingPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(routingPath, "utf-8")) as { categories?: unknown };
      if (Array.isArray(data.categories) && data.categories.every((c) => typeof c === "string")) {
        return Object.freeze([...data.categories]);
      }
    } catch {
      // Fall through to hardcoded declared set
    }
  }
  return DECLARED_DOMAIN_CATEGORIES[domain] ?? Object.freeze([]);
}

/**
 * Normalizes an upstream skill category to the domain's declared closed set
 * via deterministic mapping rules over upstream category and slug tokens (T015).
 * Throws on unmapped residual or invalid domain.
 */
export function normalizeSkillCategory(
  domain: SkillDomain,
  upstreamCategory: string = "",
  slug: string = ""
): string {
  if (!isValidSkillDomain(domain)) {
    throw new Error(`Invalid skill domain '${domain}'. Must be re, webapp, mobile, or red.`);
  }

  const c = (upstreamCategory || "").toLowerCase().trim();
  const s = (slug || "").toLowerCase().trim();

  switch (domain) {
    case "re": {
      if (
        c.includes("crypto") ||
        s.includes("crypto") ||
        s.includes("certificate") ||
        s.includes("tls") ||
        s.includes("aes") ||
        s.includes("rsa") ||
        s.includes("hashcat") ||
        s.includes("hsm") ||
        s.includes("signatures")
      ) {
        return "cryptography";
      }
      if (
        c.includes("forensic") ||
        s.includes("forensic") ||
        s.includes("memory") ||
        s.includes("event-log") ||
        s.includes("hindsight") ||
        s.includes("artifact") ||
        s.includes("kape")
      ) {
        return "forensics";
      }
      if (
        c.includes("firmware") ||
        s.includes("firmware") ||
        s.includes("hardware") ||
        s.includes("chipsec") ||
        s.includes("uefi") ||
        s.includes("iot")
      ) {
        return "firmware";
      }
      if (
        c.includes("exploit") ||
        c.includes("pwn") ||
        c.includes("fuzz") ||
        s.includes("exploit") ||
        s.includes("pwn") ||
        s.includes("fuzz") ||
        s.includes("patch-diff") ||
        s.includes("overflow") ||
        s.includes("rop") ||
        s.includes("heap")
      ) {
        return "exploitation";
      }
      if (
        c.includes("decompil") ||
        c.includes("ida") ||
        c.includes("ghidra") ||
        c.includes("radare") ||
        c.includes("binary-ninja") ||
        s.includes("ida") ||
        s.includes("ghidra") ||
        s.includes("radare") ||
        s.includes("binary-ninja") ||
        s.includes("decompile")
      ) {
        return "decompilation";
      }
      return "binary-analysis";
    }

    case "mobile": {
      if (
        c.includes("ios") ||
        s.includes("ios") ||
        s.includes("ipa") ||
        s.includes("macho") ||
        s.includes("keychain")
      ) {
        return "ios-analysis";
      }
      if (
        s.includes("frida") ||
        s.includes("objection") ||
        s.includes("hook") ||
        s.includes("pinning") ||
        s.includes("pinnin") ||
        s.includes("instrumentation")
      ) {
        return "instrumentation";
      }
      if (s.includes("repack") || s.includes("smali")) {
        return "repackaging";
      }
      return "apk-analysis";
    }

    case "webapp": {
      if (
        s.includes("sqli") ||
        s.includes("sql-injection") ||
        s.includes("xss") ||
        s.includes("csrf") ||
        s.includes("ssrf") ||
        s.includes("ssti") ||
        s.includes("xxe") ||
        s.includes("deserializ") ||
        s.includes("command-injection") ||
        s.includes("ldap-injection") ||
        s.includes("template-injection") ||
        s.includes("injection")
      ) {
        return "injection";
      }
      if (
        s.includes("path-traversal") ||
        s.includes("directory-traversal") ||
        s.includes("lfi") ||
        s.includes("rfi") ||
        s.includes("file-inclusion") ||
        s.includes("traversal")
      ) {
        return "traversal";
      }
      if (
        s.includes("idor") ||
        s.includes("bola") ||
        s.includes("oauth") ||
        s.includes("saml") ||
        s.includes("jwt") ||
        s.includes("auth") ||
        s.includes("login") ||
        s.includes("session") ||
        s.includes("rbac") ||
        s.includes("access-control") ||
        s.includes("privilege") ||
        s.includes("identity") ||
        c === "auth" ||
        c === "identity-access-management" ||
        c === "zero-trust-architecture"
      ) {
        return "authz";
      }
      if (
        s.includes("api") ||
        s.includes("rest") ||
        s.includes("graphql") ||
        s.includes("websocket") ||
        s.includes("grpc") ||
        s.includes("swagger") ||
        s.includes("openapi") ||
        c === "api" ||
        c === "api-security"
      ) {
        return "api";
      }
      if (
        s.includes("client-side") ||
        s.includes("dom") ||
        s.includes("cors") ||
        s.includes("csp") ||
        s.includes("javascript") ||
        s.includes("js-reverse") ||
        s.includes("browser") ||
        s.includes("frontend") ||
        s.includes("clickjack") ||
        s.includes("thick-client") ||
        c === "js-reverse" ||
        c === "browser-extension-reverse" ||
        c === "browser-automation" ||
        c === "thick-client"
      ) {
        return "client-side";
      }

      if (
        c.includes("threat-intel") ||
        c.includes("threat-hunt") ||
        c.includes("threat-detect") ||
        s.includes("threat-intel") ||
        s.includes("threat-hunt") ||
        s.includes("ioc") ||
        s.includes("att&ck")
      ) {
        return "threat-intelligence";
      }
      if (
        c.includes("soc-operation") ||
        c.includes("security-operation") ||
        c.includes("incident-response") ||
        c.includes("ransomware") ||
        c.includes("phishing") ||
        c.includes("deception") ||
        s.includes("incident-response") ||
        s.includes("soc") ||
        s.includes("ransomware") ||
        s.includes("phishing")
      ) {
        return "security-operations";
      }
      if (
        c.includes("container") ||
        c.includes("docker") ||
        c.includes("k8s") ||
        c.includes("kubernetes") ||
        s.includes("container") ||
        s.includes("docker") ||
        s.includes("k8s") ||
        s.includes("kubernetes")
      ) {
        return "container-security";
      }
      if (
        c.includes("endpoint") ||
        c.includes("linux-hardening") ||
        c.includes("macos-security") ||
        c.includes("malware") ||
        s.includes("endpoint") ||
        s.includes("linux-harden") ||
        s.includes("edr")
      ) {
        return "endpoint-security";
      }
      if (
        c.includes("recon") ||
        c.includes("scan_mode") ||
        s.includes("recon") ||
        s.includes("osint") ||
        s.includes("subdomain") ||
        s.includes("fingerprint") ||
        s.includes("discovery") ||
        s.includes("src-hunter")
      ) {
        return "reconnaissance";
      }
      if (
        c.includes("ai-security") ||
        c.includes("llm") ||
        s.includes("ai-") ||
        s.includes("llm-") ||
        s.includes("prompt-injection") ||
        s.includes("machine-learning")
      ) {
        return "ai-security";
      }
      if (
        c.includes("compliance") ||
        c.includes("governance") ||
        c.includes("privacy") ||
        c.includes("data-protection") ||
        s.includes("compliance") ||
        s.includes("gdpr") ||
        s.includes("hipaa") ||
        s.includes("audit")
      ) {
        return "compliance";
      }
      if (
        c.includes("ot-ics") ||
        c.includes("scada") ||
        s.includes("ot-") ||
        s.includes("ics-") ||
        s.includes("scada") ||
        s.includes("plc")
      ) {
        return "ot-ics";
      }
      if (
        c.includes("devsecops") ||
        c.includes("supply-chain") ||
        s.includes("devsecops") ||
        s.includes("pipeline") ||
        s.includes("ci-cd") ||
        s.includes("sbom")
      ) {
        return "devsecops";
      }
      if (
        c.includes("vulnerability-management") ||
        s.includes("vuln-management") ||
        s.includes("patch-management")
      ) {
        return "vulnerability-management";
      }
      return "application-security";
    }

    case "red": {
      if (
        s.includes("active-directory") ||
        s.includes("kerberoast") ||
        s.includes("as-rep") ||
        s.includes("dcsync") ||
        s.includes("bloodhound") ||
        s.includes("ntlm") ||
        s.includes("adcs") ||
        s.includes("gpo") ||
        s.includes("ldap") ||
        s.includes("domain-controller") ||
        s.includes("shadow-copy") ||
        c === "active-directory" ||
        c === "windows-ad" ||
        c === "identity-access-management"
      ) {
        return "active-directory";
      }
      if (
        s.includes("privesc") ||
        s.includes("privilege-escalation") ||
        s.includes("suid") ||
        s.includes("sudo") ||
        s.includes("uac") ||
        s.includes("token") ||
        s.includes("kernel-exploit") ||
        s.includes("pass-the-hash") ||
        s.includes("cve") ||
        c === "privesc"
      ) {
        return "privesc";
      }
      if (
        s.includes("amsi") ||
        s.includes("edr") ||
        s.includes("etw") ||
        s.includes("unhook") ||
        s.includes("evasion") ||
        s.includes("obfuscation") ||
        s.includes("defense-evasion") ||
        s.includes("bypass") ||
        s.includes("sandbox-evasion") ||
        s.includes("anti-forensic") ||
        s.includes("covert") ||
        c === "evasion" ||
        c === "edr-bypass-re"
      ) {
        return "evasion";
      }
      if (
        s.includes("cloud") ||
        s.includes("aws") ||
        s.includes("azure") ||
        s.includes("gcp") ||
        s.includes("iam") ||
        s.includes("s3") ||
        s.includes("bucket") ||
        s.includes("serverless") ||
        s.includes("lambda") ||
        s.includes("container") ||
        s.includes("k8s") ||
        s.includes("kubernetes") ||
        s.includes("docker") ||
        c === "cloud-security" ||
        c === "cloud" ||
        c === "cloud-k8s"
      ) {
        return "cloud-security";
      }
      if (
        s.includes("wireless") ||
        s.includes("wifi") ||
        s.includes("wpa") ||
        s.includes("sdr") ||
        s.includes("bluetooth") ||
        s.includes("rfid") ||
        c === "wireless" ||
        c === "wireless-security" ||
        c === "radio-sdr"
      ) {
        return "wireless";
      }
      if (
        s.includes("recon") ||
        s.includes("osint") ||
        s.includes("shodan") ||
        s.includes("whois") ||
        s.includes("footprint") ||
        s.includes("enumerate") ||
        c === "recon" ||
        c === "reconnaissance"
      ) {
        return "reconnaissance";
      }
      if (
        s.includes("c2") ||
        s.includes("command-and-control") ||
        s.includes("beacon") ||
        s.includes("cobalt") ||
        s.includes("mythic") ||
        s.includes("sliver") ||
        s.includes("implant") ||
        s.includes("post-exploitation") ||
        c === "post-exploitation" ||
        c === "attack-chain"
      ) {
        return "c2-operations";
      }
      if (
        s.includes("phish") ||
        s.includes("social-engineering") ||
        s.includes("pretext") ||
        c === "social-engineering"
      ) {
        return "social-engineering";
      }
      if (
        s.includes("threat-intel") ||
        s.includes("threat-hunt") ||
        s.includes("adversary-emulation") ||
        s.includes("mitre") ||
        c === "threat-intelligence" ||
        c === "threat-hunting"
      ) {
        return "threat-intelligence";
      }
      if (
        s.includes("persist") ||
        s.includes("startup") ||
        s.includes("registry-run") ||
        s.includes("scheduled-task") ||
        s.includes("backdoor") ||
        s.includes("wmi")
      ) {
        return "persistence";
      }
      if (
        s.includes("credential") ||
        s.includes("dump-lsass") ||
        s.includes("mimikatz") ||
        s.includes("sam") ||
        s.includes("ntds") ||
        s.includes("keylogger") ||
        s.includes("vault")
      ) {
        return "credential-access";
      }
      return "network";
    }
  }
}

/**
 * Normalizes description according to contracts/skill-standard.md §2.2 and T020:
 * - Single line after parsing
 * - 40–300 characters
 * - Trimmed at sentence boundary, word boundary + '…' only if no sentence boundary exists before 300
 * - Under 40 characters MUST be a reported check failure, never padded with filler
 */
export function normalizeSkillDescription(
  rawDesc: string,
  _context?: { slug?: string; domain?: string }
): { description: string; valid: boolean; error?: string } {
  const normalized = normalizeDescription(rawDesc || "");
  let bounded = boundDescription(normalized, 300);

  // If bounded string does not end in sentence terminal punctuation or ellipsis,
  // enforce sentence/word boundary per contracts/skill-standard.md §2.2 & T020:
  if (!/[.!?…。！？]$/.test(bounded)) {
    const sentenceRegex = /[.!?。！？](?:\s+|$)/g;
    let lastSentenceEnd = -1;
    let match: RegExpExecArray | null;
    while ((match = sentenceRegex.exec(bounded)) !== null) {
      lastSentenceEnd = match.index + 1;
    }

    if (lastSentenceEnd >= 40) {
      bounded = bounded.slice(0, lastSentenceEnd).trim();
    } else {
      // Word boundary + explicit ellipsis
      const targetLen = Math.min(bounded.length, 299);
      const truncated = bounded.slice(0, targetLen);
      const lastSpace = truncated.lastIndexOf(" ");
      const wordBoundary = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
      const cleaned = wordBoundary.replace(/[,\s;:.-]+$/, "");
      bounded = `${cleaned}…`;
    }
  }

  if (bounded.length < 40) {
    return {
      description: bounded,
      valid: false,
      error: `Description length (${bounded.length}) is under the required 40 characters. Filler padding is prohibited.`,
    };
  }

  return {
    description: bounded,
    valid: true,
  };
}

export const REVSKILL_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
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
});

export interface NormalizeSkillDocumentParams {
  content: string;
  domain?: SkillDomain;
  techniqueSlug?: string;
  upstreamCategory?: string;
  source: string;
  sourcePath: string;
  sourceRev: string | null;
  license: string;
  sourceSha256?: string;
}

export interface NormalizedSkillResult {
  canonicalId: string;
  domain: SkillDomain;
  category: string;
  description: string;
  frontmatter: SkillFrontmatter;
  body: string;
  serialized: string;
  sha256: string;
  bytes: number;
  manifestEntry: ManifestEntry;
  valid: boolean;
  errors: string[];
}


/**
 * Per-skill normalization pipeline (T013).
 */
export function normalizeSkillDocument(
  params: NormalizeSkillDocumentParams
): NormalizedSkillResult {
  const errors: string[] = [];
  const parsedDoc = parseSkillDocument(params.content);

  let rawFrontmatterData: Record<string, unknown> = {};
  let bodyContent = params.content;

  if (parsedDoc) {
    rawFrontmatterData = (parsedDoc.data as Record<string, unknown>) || {};
    bodyContent = parsedDoc.body;
  } else {
    // If not standard YAML frontmatter, split manual or treat whole content as body
    const split = splitFrontmatter(params.content);
    if (split) {
      bodyContent = split.body;
    }
  }

  // 1. Resolve domain
  let domain: SkillDomain = params.domain ?? (rawFrontmatterData.domain as SkillDomain);
  if (!domain || !isValidSkillDomain(domain)) {
    // Try to infer from existing name in frontmatter or techniqueSlug
    const existingName = typeof rawFrontmatterData.name === "string" ? rawFrontmatterData.name : "";
    const parsedId = parseSkillId(existingName) || (params.techniqueSlug ? parseSkillId(params.techniqueSlug) : null);
    if (parsedId && isValidSkillDomain(parsedId.domain)) {
      domain = parsedId.domain;
    } else {
      domain = "re"; // Default fallback domain
    }
  }

  // 2. Resolve technique slug and derive canonical identifier
  const rawTechniqueSlug =
    params.techniqueSlug ||
    (typeof rawFrontmatterData.name === "string" ? rawFrontmatterData.name : "") ||
    path.basename(path.dirname(params.sourcePath));

  const canonicalId = deriveSkillId(domain, rawTechniqueSlug);

  // 3. Normalize category (T015)
  const upstreamCategory =
    params.upstreamCategory ||
    (typeof rawFrontmatterData.category === "string" ? rawFrontmatterData.category : "") ||
    "";
  const slugForCategory = deriveSkillSlug(rawTechniqueSlug, domain);
  const category = normalizeSkillCategory(domain, upstreamCategory, slugForCategory);

  // 4. Normalize description (T020)
  let rawDesc = typeof rawFrontmatterData.description === "string" ? rawFrontmatterData.description : "";
  if (!rawDesc || /[\u3000-\u9fff\uff00-\uffef]/.test(rawDesc) || params.source === "reverse-skill") {
    const lookupKey = slugForCategory.replace(/^(re|webapp|mobile|red)-/, "");
    const sourceDirKey = path.basename(path.dirname(params.sourcePath)).replace(/^(re|webapp|mobile|red)-/, "");
    const revDesc =
      REVSKILL_DESCRIPTIONS[lookupKey] ||
      REVSKILL_DESCRIPTIONS[sourceDirKey] ||
      REVSKILL_DESCRIPTIONS[rawTechniqueSlug.replace(/^(re|webapp|mobile|red)-/, "")];
    if (revDesc) {
      rawDesc = revDesc;
    }
  }
  if (!rawDesc) {
    const mdDescMatch = bodyContent.match(/^##\s+Description\s*\n+([^\n#]+)/m);
    rawDesc = mdDescMatch?.[1]?.trim() ?? "";
  }
  const descResult = normalizeSkillDescription(rawDesc, { slug: slugForCategory, domain });
  if (!descResult.valid && descResult.error) {
    errors.push(descResult.error);
  }

  // Clean body trailing whitespace and sanitize forbidden vendor tokens (contracts/skill-standard.md §1.2)
  let cleanedBody = bodyContent.trim();
  for (const token of FORBIDDEN_VENDOR_SEGMENTS) {
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9])(${token})(?:[^a-zA-Z0-9]|$)`, "gi");
    cleanedBody = cleanedBody.replace(regex, (match, captured) => {
      let replacement = "arsenal";
      if (captured.toLowerCase() === "strix") replacement = "scanner";
      else if (captured.toLowerCase() === "anthropic") replacement = "ai-provider";
      else if (captured.toLowerCase().includes("claude")) replacement = "red-team";
      else if (captured.toLowerCase().includes("revskill")) replacement = "reverse";
      if (captured.toUpperCase() === captured) replacement = replacement.toUpperCase();
      else if (captured[0].toUpperCase() === captured[0]) replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
      return match.replace(captured, replacement);
    });
  }

  // 5. Construct canonical frontmatter (contracts/skill-standard.md §2.1)
  // Strips upstream provenance (source_path, source_sha256, upstream) out of frontmatter into manifest
  const canonicalFrontmatter: SkillFrontmatter = {
    name: canonicalId,
    description: descResult.description,
    domain,
    category,
    hide: true,
    license: params.license,
    metadata: {
      manifest_entry: `src/corpus/${canonicalId}/SKILL.md`,
    },
  };

  // Validate frontmatter against schema
  const fmValidation = validateCanonicalSkillFrontmatter(canonicalFrontmatter);
  if (!fmValidation.valid) {
    errors.push(...fmValidation.errors);
  }

  // Serialize Markdown document deterministically
  const serialized = serializeSkillDocument(canonicalFrontmatter, cleanedBody);
  const contentBytes = Buffer.byteLength(serialized, "utf-8");
  const contentSha256 = sha256String(serialized);

  // Raw source sha256
  const sourceSha256 = params.sourceSha256 || sha256String(params.content);

  // 6. Construct ManifestEntry (data-model.md §2)
  const manifestEntry: ManifestEntry = {
    path: params.sourcePath,
    source: params.source,
    source_rev: params.sourceRev,
    license: params.license,
    status: "admitted",
    destination_path: `src/corpus/${canonicalId}/SKILL.md`,
    sha256: contentSha256,
    bytes: contentBytes,
    source_path: params.sourcePath,
    source_sha256: sourceSha256,
  };

  return {
    canonicalId,
    domain,
    category,
    description: descResult.description,
    frontmatter: canonicalFrontmatter,
    body: cleanedBody,
    serialized,
    sha256: contentSha256,
    bytes: contentBytes,
    manifestEntry,
    valid: errors.length === 0,
    errors,
  };
}

export interface TierAResolutionResult {
  admitted: NormalizedSkillResult[];
  deduplicated: Array<{
    result: NormalizedSkillResult;
    winner: NormalizedSkillResult;
    rationale: string;
  }>;
  dedupGroups: DedupGroup[];
}

/**
 * Resolves Tier A collision groups among normalized skill candidates.
 * Deterministic winner rule: (body bytes desc, source priority desc, source_path asc, identifier asc).
 */
export function resolveTierACollisions(
  candidates: readonly NormalizedSkillResult[]
): TierAResolutionResult {
  const groupsById = new Map<string, NormalizedSkillResult[]>();

  for (const c of candidates) {
    const list = groupsById.get(c.canonicalId);
    if (list) {
      list.push(c);
    } else {
      groupsById.set(c.canonicalId, [c]);
    }
  }

  const admitted: NormalizedSkillResult[] = [];
  const deduplicated: Array<{
    result: NormalizedSkillResult;
    winner: NormalizedSkillResult;
    rationale: string;
  }> = [];
  const dedupGroups: DedupGroup[] = [];

  // Sort groups deterministically by canonicalId
  const sortedIds = [...groupsById.keys()].sort((a, b) => a.localeCompare(b));

  for (const id of sortedIds) {
    const group = groupsById.get(id)!;
    if (group.length === 1) {
      admitted.push(group[0]!);
      continue;
    }

    // Convert to DedupCandidate model
    const dedupInputs: DedupCandidateInput[] = group.map((item) => ({
      identifier: item.canonicalId,
      domain: item.domain,
      slug: deriveSkillSlug(item.canonicalId, item.domain),
      bytes: item.bytes,
      source: item.manifestEntry.source,
      source_path: item.manifestEntry.source_path || item.manifestEntry.path,
    }));

    const { winner: dedupWinner, rationale } = resolveTierAWinner(dedupInputs.map((i) => ({
      identifier: i.identifier!,
      domain: i.domain!,
      slug: i.slug!,
      bytes: i.bytes!,
      source: i.source,
      source_path: i.source_path!,
    })));

    // Find matching NormalizedSkillResult for the winner
    const winnerResult = group.find(
      (c) =>
        (c.manifestEntry.source_path || c.manifestEntry.path) === dedupWinner.source_path &&
        c.manifestEntry.source === dedupWinner.source
    ) || group[0]!;

    admitted.push(winnerResult);

    // Losers become status: deduplicated
    for (const loserResult of group) {
      if (loserResult === winnerResult) continue;

      const loserEntry: ManifestEntry = {
        path: loserResult.manifestEntry.path,
        source: loserResult.manifestEntry.source,
        source_rev: loserResult.manifestEntry.source_rev,
        license: loserResult.manifestEntry.license,
        status: "deduplicated",
        superseded_by: winnerResult.manifestEntry.destination_path,
        reason: rationale,
        source_path: loserResult.manifestEntry.source_path,
        source_sha256: loserResult.manifestEntry.source_sha256,
      };

      deduplicated.push({
        result: {
          ...loserResult,
          manifestEntry: loserEntry,
        },
        winner: winnerResult,
        rationale,
      });
    }

    dedupGroups.push({
      key: id,
      tier: "A",
      members: group.map((c) => c.canonicalId),
      winner: winnerResult.canonicalId,
      rationale,
      applied: true,
    });
  }

  return {
    admitted,
    deduplicated,
    dedupGroups: dedupGroups.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export interface NormalizeCorpusOptions {
  repoRoot?: string;
  write?: boolean;
  force?: boolean;
}

export interface NormalizeCorpusChange {
  id: string;
  oldId?: string;
  path: string;
  status: ManifestEntryStatus;
  action: "created" | "updated" | "unchanged" | "deduplicated";
}

export interface NormalizeCorpusResult {
  summary: CorpusManifestSummary;
  totalConsidered: number;
  admitted: number;
  deduplicated: number;
  quarantined: number;
  excluded: number;
  manifest: CorpusManifest;
  changes: NormalizeCorpusChange[];
  errors: string[];
}

/**
 * Normalizes all skills in src/corpus/ and reconciles MANIFEST.json (T013, T021).
 * Report-only by default; writes when write=true.
 */
export async function normalizeCorpus(
  options: NormalizeCorpusOptions = {}
): Promise<NormalizeCorpusResult> {
  const repoRoot = options.repoRoot || ".";
  const corpusDir = path.resolve(repoRoot, "src/corpus");
  const manifestPath = path.join(corpusDir, "MANIFEST.json");

  const errors: string[] = [];
  const changes: NormalizeCorpusChange[] = [];

  let previousManifest: CorpusManifest | null = null;
  if (fs.existsSync(manifestPath)) {
    try {
      previousManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as CorpusManifest;
    } catch (err) {
      errors.push(`Failed to parse existing manifest: ${String(err)}`);
    }
  }

  // Scan existing src/corpus directories
  const candidateResults: NormalizedSkillResult[] = [];
  const nonAdmittedEntries: ManifestEntry[] = [];

  if (fs.existsSync(corpusDir)) {
    const entries = fs.readdirSync(corpusDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const skillPath = path.join(corpusDir, ent.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;

      const content = fs.readFileSync(skillPath, "utf-8");

      // Match provenance from existing manifest if available
      const existingEntry = previousManifest?.files.find(
        (f) => f.destination_path === `src/corpus/${ent.name}/SKILL.md`
      );

      const parsedId = parseSkillId(ent.name);
      const domain = parsedId?.domain ?? "re";

      const normalized = normalizeSkillDocument({
        content,
        domain,
        techniqueSlug: ent.name,
        source: existingEntry?.source ?? "xalgorix",
        sourcePath: existingEntry?.path ?? `skills/${ent.name}/SKILL.md`,
        sourceRev: existingEntry?.source_rev ?? "HEAD",
        license: existingEntry?.license ?? "Apache-2.0",
        sourceSha256: existingEntry?.source_sha256,
      });

      if (existingEntry?.support_files) {
        normalized.manifestEntry.support_files = existingEntry.support_files;
      }
      if (!normalized.valid) {
        errors.push(...normalized.errors.map((e) => `[${ent.name}] ${e}`));
      }

      candidateResults.push(normalized);
    }
  }

  // Retain any excluded/quarantined entries from previous manifest
  if (previousManifest) {
    for (const file of previousManifest.files) {
      if (file.status === "quarantined" || file.status === "excluded") {
        nonAdmittedEntries.push({ ...file });
      }
    }
  }

  // Resolve Tier A collisions
  const { admitted, deduplicated, dedupGroups } = resolveTierACollisions(candidateResults);

  // Compile final manifest entries
  const allEntries: ManifestEntry[] = [
    ...admitted.map((a) => a.manifestEntry),
    ...deduplicated.map((d) => d.result.manifestEntry),
    ...nonAdmittedEntries,
  ].sort(compareManifestEntries);

  const upstreamConfigs = loadUpstreamSources(repoRoot);
  const sourcesMap = previousManifest?.sources || {
    "reverse-skill": {
      repo: upstreamConfigs["reverse-skill"]?.repo || "zhaoxuya520/reverse-skill",
      rev: upstreamConfigs["reverse-skill"]?.rev || "cab634bd855fc287f6e420c1f36fd1a6b9245960",
      license: upstreamConfigs["reverse-skill"]?.license || "MIT",
    },
    xalgorix: {
      repo: upstreamConfigs["xalgorix"]?.repo || "xalgorix",
      rev: upstreamConfigs["xalgorix"]?.rev || "911ac7310ba3666c1e5efc0abcb5327d1fc71be4",
      license: upstreamConfigs["xalgorix"]?.license || "Apache-2.0",
    },
    "claude-red": {
      repo: upstreamConfigs["claude-red"]?.repo || "claude-red",
      rev: upstreamConfigs["claude-red"]?.rev || "739512a8588b28ff3b554e669391c22508602878",
      license: upstreamConfigs["claude-red"]?.license || "MIT",
    },
    strix: {
      repo: upstreamConfigs["strix"]?.repo || "strix",
      rev: upstreamConfigs["strix"]?.rev || "f1386cad37964197a483ff43c25161f9d933f050",
      license: upstreamConfigs["strix"]?.license || "Apache-2.0",
    },
    "Anthropic-Cybersecurity-Skills": {
      repo: upstreamConfigs["Anthropic-Cybersecurity-Skills"]?.repo || "Anthropic-Cybersecurity-Skills",
      rev: upstreamConfigs["Anthropic-Cybersecurity-Skills"]?.rev || "54a798831d2266a3ca61ce68a7acb80b81160d57",
      license: upstreamConfigs["Anthropic-Cybersecurity-Skills"]?.license || "Apache-2.0",
    },
  };
  const rawManifest: CorpusManifest = {
    schema_version: 1,
    generator: "arsenal-corpus-normalize-v1.0.0",
    created_at: null,
    summary: computeManifestSummary(allEntries),
    sources: sourcesMap,
    files: allEntries,
    dedup_groups: dedupGroups,
  };

  // Reconcile with local tier (IN-11)
  const finalManifest = mergeCorpusManifest(rawManifest, previousManifest);

  // Record changes
  for (const adm of admitted) {
    changes.push({
      id: adm.canonicalId,
      path: `src/corpus/${adm.canonicalId}/SKILL.md`,
      status: "admitted",
      action: "updated",
    });
  }

  for (const ded of deduplicated) {
    changes.push({
      id: ded.result.canonicalId,
      path: ded.result.manifestEntry.path,
      status: "deduplicated",
      action: "deduplicated",
    });
  }

  // Persist if write requested
  if (options.write) {
    fs.mkdirSync(corpusDir, { recursive: true });

    // Clean cutover: remove obsolete child directories under src/corpus/
    const admittedIds = new Set(admitted.map((a) => a.canonicalId));
    if (fs.existsSync(corpusDir)) {
      const existingChildren = fs
        .readdirSync(corpusDir, { withFileTypes: true })
        .filter((ent) => ent.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const child of existingChildren) {
        if (!admittedIds.has(child.name)) {
          fs.rmSync(path.join(corpusDir, child.name), { recursive: true, force: true });
        }
      }
    }

    // Write admitted skills in sorted order
    const sortedAdmitted = [...admitted].sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
    for (const adm of sortedAdmitted) {
      const targetDir = path.join(corpusDir, adm.canonicalId);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, "SKILL.md"), adm.serialized, "utf-8");
    }

    // Write reconciled MANIFEST.json
    const serializedManifest = serializeCorpusManifest(finalManifest);
    fs.writeFileSync(manifestPath, serializedManifest, "utf-8");
  }

  return {
    summary: finalManifest.summary,
    totalConsidered: finalManifest.summary.total_considered,
    admitted: finalManifest.summary.admitted,
    deduplicated: finalManifest.summary.deduplicated,
    quarantined: finalManifest.summary.quarantined,
    excluded: finalManifest.summary.excluded,
    manifest: finalManifest,
    changes,
    errors,
  };
}
