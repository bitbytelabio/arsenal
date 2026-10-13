import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  extractSkillReferences,
  resolveCitation,
  auditCitations,
  parseSkillUri,
  resolveSkillUri,
  extractDocumentAnchors,
  slugifyHeading,
  classifyNonFileCitation,
} from "../src/core/reference-resolver.ts";
import {
  detectLanguageViolationsInText,
  detectLanguageViolationsInFile,
} from "../src/core/skill-language.ts";
import {
  buildSkillMaterializationPlan,
  applyMaterializationPlan,
} from "../src/core/skill-references.ts";
import { migrateSkillContent } from "../tools/migrate-skill-uris.ts";
import { runCommandContext as handleSkills } from "./helpers/python-cli.ts"
import { EXIT_CODES } from "./helpers/python-cli.ts"

describe("Recursive Reference Audit & Diagnostics", () => {
  it("extracts document anchors and respects code blocks", () => {
    const md = [
      "# Main Heading",
      "Prose paragraph.",
      "## Root Cause Logic",
      "```markdown",
      "### Heading Inside Code Block",
      "```",
      'More text with <a id="custom-anchor"></a> and link.',
    ].join("\n");

    const anchors = extractDocumentAnchors(md);
    expect(anchors.has("main-heading")).toBe(true);
    expect(anchors.has("root-cause-logic")).toBe(true);
    expect(anchors.has("custom-anchor")).toBe(true);
    expect(anchors.has("heading-inside-code-block")).toBe(false);
  });

  it("slugifies headings with formatting and punctuation cleanly", () => {
    expect(slugifyHeading("## Bug Identification -> Root Cause")).toBe("bug-identification-root-cause");
    expect(slugifyHeading("### Step 1: Use `agent.py` & Verify!")).toBe("step-1-use-agentpy-verify");
  });

  it("parses and validates canonical skill:// URIs, rejecting doubled or malformed schemes", () => {
    const validRoot = parseSkillUri("skill://re-apk-reverse");
    expect(validRoot.valid).toBe(true);
    expect(validRoot.skillId).toBe("re-apk-reverse");
    expect(validRoot.subpath).toBe("");

    const validSub = parseSkillUri("skill://re-apk-reverse/references/checklist.md#security-items");
    expect(validSub.valid).toBe(true);
    expect(validSub.skillId).toBe("re-apk-reverse");
    expect(validSub.subpath).toBe("references/checklist.md");
    expect(validSub.anchor).toBe("security-items");

    // Doubled / nested skill://
    const doubled = parseSkillUri("skill://re-apk-reverse/skill://re-ida-reverse/references/foo.md");
    expect(doubled.valid).toBe(false);
    expect(doubled.error).toContain("nested 'skill://'");

    // Invalid skill ID
    const invalidId = parseSkillUri("skill://Invalid_Skill:ID/foo.md");
    expect(invalidId.valid).toBe(false);

    // Empty skill ID
    const emptyId = parseSkillUri("skill:///foo.md");
    expect(emptyId.valid).toBe(false);
  });

  it("distinguishes markdown links from illustrative system paths so root-relative links fail truthfully", () => {
    const content = [
      "Here is a link: [Bug Identification](/exploit/bug-identification.md).",
      "Here is a command: `/usr/bin/python -m http.server`",
      "```bash",
      "cat /etc/passwd",
      "```",
    ].join("\n");

    const citations = extractSkillReferences(content);
    const rootLink = citations.find((c) => c.kind === "markdown-link" && c.target === "/exploit/bug-identification.md");
    expect(rootLink).toBeDefined();
    expect(rootLink?.line).toBe(1);

    const resolution = resolveCitation(rootLink!, {
      skillId: "re-test-skill",
      shippedTree: "/nonexistent-dir",
    });
    expect(resolution.status).toBe("dangling");
    expect(resolution.diagnosticReason).toContain("Broken root-relative link");
  });
  it("ignores regex and command syntax inside code fences from being parsed as markdown links", () => {
    const content = [
      "# Code Block Test",
      "```bash",
      'grep -oP \'["\\x27](/[a-zA-Z0-9_/.-]+)["\\x27]\' file.txt',
      "```",
      "Prose outside: [Valid](references/api-reference.md)",
    ].join("\n");

    const citations = extractSkillReferences(content);
    expect(citations.length).toBe(1);
    expect(citations[0]?.kind).toBe("markdown-link");
    expect(citations[0]?.target).toBe("references/api-reference.md");
  });


  it("resolves document-relative references from nested support files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ref-test-"));
    try {
      const skillDir = path.join(tempDir, "re-test-skill");
      const opsDir = path.join(skillDir, "support", "ops");
      fs.mkdirSync(opsDir, { recursive: true });

      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Test Skill\n", "utf-8");
      fs.writeFileSync(path.join(opsDir, "decision-framework.md"), "# Decision Framework\n## Step 1\n", "utf-8");

      const nestedDoc = path.join(opsDir, "workflow.md");
      fs.writeFileSync(
        nestedDoc,
        "[Framework](decision-framework.md#step-1)\n[Missing](nonexistent.md)\n",
        "utf-8"
      );

      const citations = extractSkillReferences(fs.readFileSync(nestedDoc, "utf-8"));
      expect(citations.length).toBe(2);

      const validCitation = citations.find((c) => c.target === "decision-framework.md");
      expect(validCitation).toBeDefined();
      const validRes = resolveCitation(validCitation!, {
        skillId: "re-test-skill",
        shippedTree: tempDir,
        documentRelPath: "support/ops/workflow.md",
      });
      expect(validRes.status).toBe("resolved-shipped");
      expect(validRes.shippedRelPath).toBe("support/ops/decision-framework.md");

      const missingCitation = citations.find((c) => c.target === "nonexistent.md");
      expect(missingCitation).toBeDefined();
      const missingRes = resolveCitation(missingCitation!, {
        skillId: "re-test-skill",
        shippedTree: tempDir,
        documentRelPath: "support/ops/workflow.md",
      });
      expect(missingRes.status).toBe("dangling");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("validates document anchors and flags missing anchors as dangling", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-test-"));
    try {
      const skillDir = path.join(tempDir, "re-anchor-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        [
          "# Skill Title",
          "## Valid Section",
          "[Valid Link](#valid-section)",
          "[Broken Link](#nonexistent-section)",
        ].join("\n"),
        "utf-8"
      );

      const audit = auditCitations({ treeDir: tempDir });
      expect(audit.playbooks_scanned).toBe(1);
      const danglingAnchors = audit.dangling.filter((d) => d.reason.includes("Anchor"));
      expect(danglingAnchors.length).toBe(1);
      expect(danglingAnchors[0]?.raw).toContain("#nonexistent-section");
      expect(danglingAnchors[0]?.file).toBe("SKILL.md");
      expect(danglingAnchors[0]?.line).toBe(4);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not suppress helper scripts (agent.py, recon.sh, run-supervisor.py) while classifying real tools and lab targets truthfully", () => {
    // Genuine external tools
    expect(classifyNonFileCitation("sqlmap")?.status).toBe("documented-prerequisite");
    expect(classifyNonFileCitation("secretsdump.py")?.status).toBe("documented-prerequisite");

    // Genuine lab workspace targets
    expect(classifyNonFileCitation("calc.exe")?.status).toBe("documented-prerequisite");
    expect(classifyNonFileCitation("target.apk")?.status).toBe("documented-prerequisite");

    // Shipped helper scripts must NOT be classified as non-file citations
    expect(classifyNonFileCitation("agent.py")).toBeNull();
    expect(classifyNonFileCitation("recon.sh")).toBeNull();
    expect(classifyNonFileCitation("run-supervisor.py")).toBeNull();
  });

  it("checks human-facing prose for language residue without rejecting code blocks or script data", () => {
    // Human-facing prose with Chinese
    const proseWithChinese = [
      "# Android Analysis",
      "## 恶意软件分析说明",
      "Analyze the APK safely.",
    ].join("\n");
    const violationsProse = detectLanguageViolationsInText(proseWithChinese, "SKILL.md");
    expect(violationsProse.length).toBeGreaterThan(0);
    expect(violationsProse[0]?.type).toBe("cjk");

    // Fenced code block with Chinese test data / attack strings
    const codeBlockWithChinese = [
      "# Case Review",
      "```python",
      'offline_note = any(marker in notes for marker in ("offline", "离线", "not applicable"))',
      "```",
    ].join("\n");
    const violationsCode = detectLanguageViolationsInText(codeBlockWithChinese, "SKILL.md");
    expect(violationsCode).toEqual([]);

    // Inline code payload in prose
    const inlinePayload = 'Test homoglyph detection using `domain = "gооgle.com"` and verify.';
    const violationsInline = detectLanguageViolationsInText(inlinePayload, "SKILL.md");
    expect(violationsInline).toEqual([]);

    // Python script file (.py) containing test data
    const pyScript = 'offline_note = any(marker in notes for marker in ("offline", "离线"))\n';
    const violationsPy = detectLanguageViolationsInText(pyScript, "templates/review_case.py");
    expect(violationsPy).toEqual([]);
    // Arbitrary prose wrapped in inline code must NOT be exempted
    const disguisedProse = "Description: `这是一段不应该被豁免的中文散文` in document.";
    const violationsDisguised = detectLanguageViolationsInText(disguisedProse, "SKILL.md");
    expect(violationsDisguised.length).toBeGreaterThan(0);
    expect(violationsDisguised[0]?.type).toBe("cjk");
  });

  it("parses AST reference definitions, balanced parens, setext/duplicate headings, and HTML anchors with quoted > without matching data-id", () => {
    const md = [
      "Setext Main",
      "===========",
      "",
      "## Duplicate Heading",
      "### Duplicate Heading",
      "",
      '<div data-id="fake-anchor" title="x > y" id="real-html-anchor"></div>',
      "```html",
      '<div id="code-block-anchor"></div>',
      "```",
      "",
      "See [Guide][g] and [Balanced](references/foo_(old).md#duplicate-heading-1).",
      "~~~bash",
      "[FakeInTildeFence](references/should-ignore.md)",
      "~~~",
      "",
      "[g]: references/missing-def.md",
    ].join("\n");

    const anchors = extractDocumentAnchors(md);
    expect(anchors.has("setext-main")).toBe(true);
    expect(anchors.has("duplicate-heading")).toBe(true);
    expect(anchors.has("duplicate-heading-1")).toBe(true);
    expect(anchors.has("real-html-anchor")).toBe(true);
    expect(anchors.has("fake-anchor")).toBe(false);
    expect(anchors.has("code-block-anchor")).toBe(false);

    const refs = extractSkillReferences(md);
    expect(refs.some((r) => r.target === "references/should-ignore.md")).toBe(false);
    const defRef = refs.find((r) => r.target === "references/missing-def.md");
    expect(defRef).toBeDefined();
    expect(defRef?.raw).toBe("[Guide][g]");
    expect(defRef?.line).toBe(12);

    const balRef = refs.find((r) => r.target === "references/foo_(old).md");
    expect(balRef).toBeDefined();
    expect(balRef?.anchor).toBe("duplicate-heading-1");
  });

  it("extracts canonical skill:// URIs in inline code and code blocks as first-class references", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-uri-inline-"));
    try {
      const skillDir = path.join(tempDir, "re-test");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "Read `skill://re-test/references/missing.md#section`.\n",
        "utf-8"
      );

      const audit = auditCitations({ treeDir: tempDir });
      expect(audit.playbooks_scanned).toBe(1);
      expect(audit.dangling.length).toBe(1);
      expect(audit.dangling[0]?.target).toBe("skill://re-test/references/missing.md#section");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects bare helper arguments in fenced commands with exact column offset and resolves shipped templates", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fenced-helper-"));
    try {
      const skillDir = path.join(tempDir, "re-helper");
      fs.mkdirSync(skillDir, { recursive: true });
      const md = [
        "# Helper Skill",
        "```bash",
        "python agent.py sample.apk",
        "```",
      ].join("\n");
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), md, "utf-8");

      // When missing: dangling at column 8
      const auditMissing = auditCitations({ treeDir: tempDir });
      expect(auditMissing.dangling.length).toBe(1);
      expect(auditMissing.dangling[0]?.target).toBe("agent.py");
      expect(auditMissing.dangling[0]?.line).toBe(3);
      expect(auditMissing.dangling[0]?.column).toBe(8);

      // When shipped in templates/agent.py: resolves cleanly
      fs.mkdirSync(path.join(skillDir, "templates"), { recursive: true });
      fs.writeFileSync(path.join(skillDir, "templates", "agent.py"), "print('ok')\n", "utf-8");
      const auditShipped = auditCitations({ treeDir: tempDir });
      expect(auditShipped.dangling.length).toBe(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects path traversal, dot segments, encoded separators, directories, and symlink escapes in resolveCitation and resolveSkillUri", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uri-containment-"));
    try {
      const skillA = path.join(tempDir, "re-a");
      const skillB = path.join(tempDir, "re-b");
      fs.mkdirSync(path.join(skillA, "references"), { recursive: true });
      fs.mkdirSync(skillB, { recursive: true });
      fs.writeFileSync(path.join(skillA, "SKILL.md"), "# Skill A\n", "utf-8");
      fs.writeFileSync(path.join(skillB, "SKILL.md"), "# Skill B\n", "utf-8");

      // Symlink inside re-a pointing outside to re-b/SKILL.md
      const symlinkPath = path.join(skillA, "references", "escaped.md");
      fs.symlinkSync(path.join(skillB, "SKILL.md"), symlinkPath);

      // 1. Traversal URI: skill://re-a/../re-b/SKILL.md
      const travUri = "skill://re-a/../re-b/SKILL.md";
      expect(parseSkillUri(travUri).valid).toBe(false);
      expect(resolveSkillUri(travUri, tempDir).exists).toBe(false);
      const travCitation = resolveCitation(
        {
          raw: travUri,
          kind: "inline-code",
          target: travUri,
          startIndex: 0,
          endIndex: travUri.length,
          line: 1,
          column: 1,
        },
        { skillId: "re-a", shippedTree: tempDir }
      );
      expect(travCitation.status).toBe("dangling");

      // 2. Encoded traversal
      expect(parseSkillUri("skill://re-a/%2e%2e/re-b/SKILL.md").valid).toBe(false);

      // 3. Directory as asset
      expect(resolveSkillUri("skill://re-a/references", tempDir).exists).toBe(false);

      // 4. Symlink escape
      const symUri = "skill://re-a/references/escaped.md";
      expect(resolveSkillUri(symUri, tempDir).exists).toBe(false);
      const symCitation = resolveCitation(
        {
          raw: symUri,
          kind: "inline-code",
          target: symUri,
          startIndex: 0,
          endIndex: symUri.length,
          line: 1,
          column: 1,
        },
        { skillId: "re-a", shippedTree: tempDir }
      );
      expect(symCitation.status).toBe("dangling");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("materializes cited scripts at their exact relative path and refuses to overwrite curated files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mat-preserve-"));
    try {
      const upstreamDir = path.join(tempDir, "upstream", "reverse-skill", "skills", "re-test");
      const corpusDir = path.join(tempDir, "src", "corpus", "re-test");
      fs.mkdirSync(path.join(upstreamDir, "scripts"), { recursive: true });
      fs.mkdirSync(path.join(corpusDir, "scripts"), { recursive: true });

      fs.writeFileSync(path.join(upstreamDir, "scripts", "foo.py"), "print('upstream')\n", "utf-8");
      fs.writeFileSync(path.join(upstreamDir, "scripts", "curated.py"), "print('upstream')\n", "utf-8");
      fs.writeFileSync(path.join(corpusDir, "scripts", "curated.py"), "print('curated-custom')\n", "utf-8");

      const skillMd = "# Skill\nRun `python scripts/foo.py` and `python scripts/curated.py`.\n";
      fs.writeFileSync(path.join(corpusDir, "SKILL.md"), skillMd, "utf-8");

      const plan = buildSkillMaterializationPlan(skillMd, {
        skillSlug: "re-test",
        source: "reverse-skill",
        sourcePath: "skills/re-test/SKILL.md",
        repoRoot: tempDir,
      });

      expect(plan.items.some((i) => i.destRelPath === "scripts/foo.py")).toBe(true);
      expect(plan.items.some((i) => i.destRelPath === "templates/foo.py")).toBe(false);
      const curatedItem = plan.items.find((i) => i.destRelPath === "scripts/curated.py");
      expect(curatedItem?.content.toString("utf-8")).toBe("print('curated-custom')\n");
      expect(curatedItem?.upstreamContent?.toString("utf-8")).toBe("print('upstream')\n");
      expect(curatedItem?.sourceSha256).toBeDefined();
      expect(curatedItem?.sourceSha256).not.toBe(curatedItem?.record.sha256);
      applyMaterializationPlan(plan, { preview: false });
      expect(fs.existsSync(path.join(corpusDir, "scripts", "foo.py"))).toBe(true);
      expect(fs.readFileSync(path.join(corpusDir, "scripts", "curated.py"), "utf-8")).toBe(
        "print('curated-custom')\n"
      );

      const audit = auditCitations({ treeDir: path.join(tempDir, "src", "corpus") });
      expect(audit.dangling.length).toBe(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("migrates URIs idempotently via AST without corrupting executable command arguments", () => {
    const raw = [
      "# Skill",
      "See [Guide](references/guide.md#intro) and `references/checklist.md`.",
      "Execute `python references/helper.py --input sample.bin`.",
      "```bash",
      "python references/helper.py",
      "```",
    ].join("\n");

    const pass1 = migrateSkillContent("re-test", raw);
    expect(pass1.count).toBe(2);
    expect(pass1.updated).toContain("[Guide](skill://re-test/references/guide.md#intro)");
    expect(pass1.updated).toContain("`skill://re-test/references/checklist.md`");
    expect(pass1.updated).toContain("`python references/helper.py --input sample.bin`");

    const pass2 = migrateSkillContent("re-test", pass1.updated);
    expect(pass2.count).toBe(0);
    expect(pass2.updated).toBe(pass1.updated);
  });

  it("distinguishes Python source code fences from bash command blocks while preserving canonical URIs and Windows backslashes", () => {
    const md = [
      "# Language Context Test",
      "```python",
      "print('Usage: python process.py --input file.bin')",
      "# Reference: skill://re-test/references/spec.md",
      "```",
      "```yaml",
      "group: admission.k8s.gatekeeper.sh",
      "```",
      "```powershell",
      'powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\\bootstrap-reverse.ps1"',
      "```",
      "```bash",
      "python agent.py sample.apk",
      "```",
    ].join("\n");

    const refs = extractSkillReferences(md);
    // Python print('Usage: python process.py ...') inside ```python block is NOT a shell command
    expect(refs.some((r) => r.target === "process.py" || r.target === "file.bin")).toBe(false);
    // K8s DNS group in YAML is NOT a shell script
    expect(refs.some((r) => r.target === "admission.k8s.gatekeeper.sh")).toBe(false);
    // Windows backslash path in PowerShell is preserved, not eaten into scriptsbootstrap-reverse.ps1
    expect(refs.some((r) => r.target === "scripts\\bootstrap-reverse.ps1")).toBe(true);
    // Bash command block extracts bare helper agent.py
    const agentRef = refs.find((r) => r.target === "agent.py");
    expect(agentRef).toBeDefined();
    expect(agentRef?.column).toBe(8);
  });

  it("validates --skill and --domain filters in scripts-audit and rejects nonexistent selections", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-skill-filter-"));
    try {
      const skillDir = path.join(tempDir, "src", "corpus", "re-valid-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Valid Skill\n", "utf-8");

      const validExit = await handleSkills({
        family: "skills",
        subCommand: "scripts-audit",
        positionals: [],
        values: { skill: "re-valid-skill", json: false },
        rawArgs: ["skills", "scripts-audit", "--skill", "re-valid-skill"],
        isJson: false,
        mode: "check",
        repoRoot: tempDir,
        profileDir: tempDir,
      });
      expect(validExit).toBe(EXIT_CODES.SUCCESS);

      const missingSkillExit = await handleSkills({
        family: "skills",
        subCommand: "scripts-audit",
        positionals: [],
        values: { skill: "re-nonexistent", json: false },
        rawArgs: ["skills", "scripts-audit", "--skill", "re-nonexistent"],
        isJson: false,
        mode: "check",
        repoRoot: tempDir,
        profileDir: tempDir,
      });
      expect(missingSkillExit).toBe(EXIT_CODES.CLI_USAGE_ERROR);

      const missingDomainExit = await handleSkills({
        family: "skills",
        subCommand: "scripts-audit",
        positionals: [],
        values: { domain: "nonexistent", json: false },
        rawArgs: ["skills", "scripts-audit", "--domain", "nonexistent"],
        isJson: false,
        mode: "check",
        repoRoot: tempDir,
        profileDir: tempDir,
      });
      expect(missingDomainExit).toBe(EXIT_CODES.CLI_USAGE_ERROR);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("ignores inline prose folder labels and bare skill:// scheme mentions while failing explicit links/argv and deduplicating category_counts.dangling", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prose-shorthand-"));
    try {
      const skillDir = path.join(tempDir, "re-shorthand");
      fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });

      // 1. Prose shorthand only -> 0 dangling
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "Place helpers in `scripts/` or `references/` and use `skill://` canonical URIs.\n",
        "utf-8"
      );
      const cleanAudit = auditCitations({ treeDir: tempDir });
      expect(cleanAudit.dangling_count).toBe(0);
      expect(cleanAudit.category_counts.dangling).toBe(0);

      // 2. Explicit markdown link [broken](skill://), [dir](references/), execution argv `python skill://`, and duplicate dangling on same line
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        [
          "# Broken Cases",
          "See [broken](skill://) and [dir](references/).",
          "Run `python skill://`.",
          "Duplicate on same line: [A](references/missing.md) and [B](references/missing.md).",
        ].join("\n"),
        "utf-8"
      );
      const brokenAudit = auditCitations({ treeDir: tempDir });
      expect(brokenAudit.dangling_count).toBe(4);
      expect(brokenAudit.category_counts.dangling).toBe(brokenAudit.dangling_count);
      expect(brokenAudit.dangling.some((d) => d.raw === "[broken](skill://)")).toBe(true);
      expect(brokenAudit.dangling.some((d) => d.raw === "[dir](references/)")).toBe(true);
      expect(brokenAudit.dangling.some((d) => d.target === "skill://" && d.line === 3)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("enforces ReviewReferenceBoundaries falsifier regressions (template priority, nested relative links, symlinked skill roots, definition report.md, image/title/def migration, nested support script normalization)", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ref-boundaries-"));
    try {
      const upstreamDir = path.join(tempDir, "upstream", "reverse-skill", "skills", "re-bound");
      const corpusRoot = path.join(tempDir, "src", "corpus");
      const skillDir = path.join(corpusRoot, "re-bound");
      const outsideSkillDir = path.join(tempDir, "outside-skill");

      fs.mkdirSync(path.join(upstreamDir, "scripts"), { recursive: true });
      fs.mkdirSync(path.join(upstreamDir, "templates"), { recursive: true });
      fs.mkdirSync(path.join(upstreamDir, "references"), { recursive: true });
      fs.mkdirSync(path.join(skillDir, "support", "ops"), { recursive: true });
      fs.mkdirSync(outsideSkillDir, { recursive: true });

      // Finding 1 & 8 fixtures:
      // Upstream has both scripts/foo.py and templates/foo.py with distinct content
      fs.writeFileSync(path.join(upstreamDir, "scripts", "foo.py"), "print('from-scripts')\n", "utf-8");
      fs.writeFileSync(path.join(upstreamDir, "templates", "foo.py"), "print('from-templates')\n", "utf-8");
      // Upstream has scripts/runner.py cited relatively from references/guide.md as ../scripts/runner.py
      fs.writeFileSync(path.join(upstreamDir, "scripts", "runner.py"), "print('runner')\n", "utf-8");
      fs.writeFileSync(
        path.join(upstreamDir, "references", "guide.md"),
        "# Guide\nRun `python ../scripts/runner.py`.\n",
        "utf-8"
      );

      const skillMd = "# Bound Skill\nSee [Guide](references/guide.md) and run `python templates/foo.py`.\n";
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");

      const plan = buildSkillMaterializationPlan(skillMd, {
        skillSlug: "re-bound",
        source: "reverse-skill",
        sourcePath: "skills/re-bound/SKILL.md",
        repoRoot: tempDir,
      });

      // Finding 1: templates/foo.py must come from upstream templates/foo.py
      const templateItem = plan.items.find((i) => i.destRelPath === "templates/foo.py");
      expect(templateItem).toBeDefined();
      expect(templateItem?.content.toString("utf-8")).toBe("print('from-templates')\n");
      expect(templateItem?.record.source_path).toBe("templates/foo.py");

      // Finding 8: ../scripts/runner.py in references/guide.md normalizes to scripts/runner.py
      const runnerItem = plan.items.find((i) => i.destRelPath === "scripts/runner.py");
      expect(runnerItem).toBeDefined();

      applyMaterializationPlan(plan, { preview: false });

      // Finding 2: support/ops/workflow.md linking to README.md when only root README.md exists -> dangling
      fs.writeFileSync(path.join(skillDir, "README.md"), "# Root Readme\n", "utf-8");
      fs.writeFileSync(
        path.join(skillDir, "support", "ops", "workflow.md"),
        "[Local Readme](README.md)\n",
        "utf-8"
      );

      // Finding 4: [Guide][g] / [g]: report.md when report.md is absent -> dangling (not CASE_ARTIFACTS prerequisite)
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `${skillMd}\nSee [Report][g].\n\n[g]: report.md\n`,
        "utf-8"
      );

      const audit = auditCitations({ treeDir: corpusRoot, skillIds: ["re-bound"] });
      expect(audit.dangling.some((d) => d.file === "support/ops/workflow.md" && d.target === "README.md")).toBe(true);
      expect(audit.dangling.some((d) => d.file === "SKILL.md" && d.target === "report.md")).toBe(true);
      expect(audit.category_counts.dangling).toBe(2);

      // Finding 3: Symlinked skill root outside corpus tree must fail verification
      fs.writeFileSync(path.join(outsideSkillDir, "SKILL.md"), "# Outside Skill\n", "utf-8");
      fs.symlinkSync(outsideSkillDir, path.join(corpusRoot, "re-linked"));
      expect(resolveSkillUri("skill://re-linked/SKILL.md", corpusRoot).exists).toBe(false);
      const linkedRes = resolveCitation(
        {
          raw: "skill://re-linked/SKILL.md",
          kind: "inline-code",
          target: "skill://re-linked/SKILL.md",
          startIndex: 0,
          endIndex: 25,
          line: 1,
          column: 1,
        },
        { skillId: "re-bound", shippedTree: corpusRoot }
      );
      expect(linkedRes.status).toBe("dangling");

      // Findings 5, 6, 7: Migrate images, definition destinations (not labels), and link hrefs (not titles)
      const migInput = [
        "![diagram](references/diagram.svg)",
        '[Guide](references/foo.md "references/foo.md")',
        "",
        "[references/foo.md]: references/foo.md",
      ].join("\n");
      const migRes = migrateSkillContent("re-bound", migInput);
      expect(migRes.count).toBe(3);
      expect(migRes.updated).toContain("![diagram](skill://re-bound/references/diagram.svg)");
      expect(migRes.updated).toContain('[Guide](skill://re-bound/references/foo.md "references/foo.md")');
      expect(migRes.updated).toContain("[references/foo.md]: skill://re-bound/references/foo.md");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("classifies bounded external workspace/kernel/Firmadyne prerequisites while keeping arbitrary missing strict paths dangling", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ref-workspace-prereq-"));
    try {
      const skillDir = path.join(tempDir, "re-prereq");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        [
          "# Prereq Test",
          "Carry forward `evidence/E-triage.md`.",
          "Unzip `assets/index.android.bundle` and `assets/bin/Data/Managed/Metadata/global-metadata.dat`.",
          "See `assets/dispatchblock.png`.",
          "```bash",
          "./scripts/decode_stacktrace.sh vmlinux /lib/modules/build < dmesg.log",
          "./scripts/getArch.sh ./images/1.tar.gz",
          "./scripts/tar2db.py -i 1 -f ./images/1.tar.gz",
          "sudo ./scripts/makeImage.sh 1",
          "./scripts/inferNetwork.sh 1",
          "bash ./scripts/missing_bundled_helper.sh",
          "```",
          "Also missing `assets/missing_template.md`.",
        ].join("\n"),
        "utf-8"
      );

      const audit = auditCitations({ treeDir: tempDir, skillIds: ["re-prereq"] });
      expect(audit.dangling_count).toBe(2);
      expect(audit.category_counts.documented_prerequisite).toBe(9);
      expect(audit.dangling.some((d) => d.target === "./scripts/missing_bundled_helper.sh")).toBe(true);
      expect(audit.dangling.some((d) => d.target === "assets/missing_template.md")).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
