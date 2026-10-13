import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { internalizeCorpus } from "../tools/internalize-corpus.ts";
import { readCorpusManifest, serializeCorpusManifest, type CorpusManifest } from "../src/core/skill-manifest.ts";
import { sha256String } from "../src/core/hash.ts";
import { normalizeSkillDocument } from "../src/core/corpus-normalize.ts";

function createMockRepo(options: {
  malformedManifest?: boolean;
  missingProvenance?: boolean;
  tamperedUpstream?: boolean;
  changedSupportBytes?: boolean;
  missingSupportFileOnDisk?: boolean;
  missingSupportFileInManifest?: boolean;
  upstreamSupportContent?: string;
  canonicalSkillSerialized?: boolean;
} = {}): {
  repoRoot: string;
  initialSkillBytes: Buffer;
  initialSupportBytes: Buffer;
  cleanup: () => void;
} {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-durability-test-"));
  const corpusDir = path.join(repoRoot, "src/corpus");
  fs.mkdirSync(corpusDir, { recursive: true });

  // 1. Create mock upstream for reverse-skill
  const revRoot = path.join(repoRoot, "upstream/reverse-skill/skills/apk-reverse");
  fs.mkdirSync(path.join(revRoot, "references"), { recursive: true });
  const rawSkillContent = `---
name: apk-reverse
description: Original upstream description that is long enough to satisfy forty character minimum boundary.
category: apk-analysis
---

# Upstream APK Reverse Engineering
Upstream documentation with raw content.
See [Reference](references/guide.md).
`;
  fs.writeFileSync(path.join(revRoot, "SKILL.md"), rawSkillContent, "utf-8");
  const upSupport = options.upstreamSupportContent ?? "Upstream reference content\n";
  fs.writeFileSync(path.join(revRoot, "references/guide.md"), upSupport, "utf-8");

  // 2. Create lockfile/config
  fs.mkdirSync(path.join(repoRoot, "upstream"), { recursive: true });
  const revHash = options.tamperedUpstream
    ? "deadbeef1234567890abcdef1234567890abcdef"
    : "cab634bd855fc287f6e420c1f36fd1a6b9245960";
  const upstreamsConfig = {
    "reverse-skill": {
      repo: "zhaoxuya520/reverse-skill",
      rev: revHash,
      license: "MIT",
      upstreamDir: "upstream/reverse-skill",
      skillsSubdir: "skills",
    },
    xalgorix: {
      repo: "xalgorix",
      rev: "911ac7310ba3666c1e5efc0abcb5327d1fc71be4",
      license: "Apache-2.0",
      upstreamDir: "upstream/xalgorix",
      skillsSubdir: "internal/tools/skills/data",
    },
    "claude-red": {
      repo: "claude-red",
      rev: "739512a8588b28ff3b554e669391c22508602878",
      license: "MIT",
      upstreamDir: "upstream/claude-red",
      skillsSubdir: "Skills",
    },
    strix: {
      repo: "strix",
      rev: "f1386cad37964197a483ff43c25161f9d933f050",
      license: "Apache-2.0",
      upstreamDir: "upstream/strix",
      skillsSubdir: "skills",
    },
    "Anthropic-Cybersecurity-Skills": {
      repo: "Anthropic-Cybersecurity-Skills",
      rev: "54a798831d2266a3ca61ce68a7acb80b81160d57",
      license: "Apache-2.0",
      upstreamDir: "upstream/Anthropic-Cybersecurity-Skills",
      skillsSubdir: "skills",
    },
  };
  fs.writeFileSync(path.join(repoRoot, "upstream/arsenal-upstreams.json"), JSON.stringify(upstreamsConfig, null, 2), "utf-8");

  // 3. Create existing curated skill in src/corpus/re-apk-reverse
  const curatedSkillDir = path.join(corpusDir, "re-apk-reverse");
  fs.mkdirSync(path.join(curatedSkillDir, "references"), { recursive: true });
  const curatedSkillContent = `---
name: re-apk-reverse
description: Decompile, analyze, modify smali, repackage, and bypass Android APK defenses.
domain: re
category: binary-analysis
hide: true
license: MIT
metadata:
  manifest_entry: src/corpus/re-apk-reverse/SKILL.md
---

# Curated English APK Reverse
Specialized curated instructions that must never be wiped or overwritten.
See [Reference](skill://re-apk-reverse/references/guide.md).
`;
  const skillTextToWrite = options.canonicalSkillSerialized
    ? normalizeSkillDocument({
        content: `---\nname: re-apk-reverse\ndescription: Decompile, analyze, modify smali, repackage, and bypass Android APK defenses.\ndomain: re\ncategory: binary-analysis\nhide: true\nlicense: MIT\n---\n\n# Upstream APK Reverse Engineering\nUpstream documentation with raw content.\nSee [Reference](references/guide.md).\n`,
        domain: "re",
        techniqueSlug: "apk-reverse",
        upstreamCategory: "apk-reverse",
        source: "reverse-skill",
        sourcePath: "skills/apk-reverse/SKILL.md",
        sourceRev: revHash,
        license: "MIT",
        sourceSha256: sha256String(rawSkillContent),
      }).serialized
    : curatedSkillContent;
  fs.writeFileSync(path.join(curatedSkillDir, "SKILL.md"), skillTextToWrite, "utf-8");
  const curatedSupportContent = options.changedSupportBytes ? "Changed support bytes\n" : "Upstream reference content\n";
  if (!options.missingSupportFileOnDisk) {
    fs.writeFileSync(path.join(curatedSkillDir, "references/guide.md"), curatedSupportContent, "utf-8");
  }

  // Also create a non-enumerated source skill: re-reverse-engineer-anything (source: 'rea')
  const reaDir = path.join(corpusDir, "re-reverse-engineer-anything");
  fs.mkdirSync(reaDir, { recursive: true });
  fs.writeFileSync(path.join(reaDir, "SKILL.md"), "# REA Tool Guide\n", "utf-8");

  // 4. Create MANIFEST.json in src/corpus
  if (options.malformedManifest) {
    fs.writeFileSync(path.join(corpusDir, "MANIFEST.json"), "{ invalid json: true }", "utf-8");
  } else {
    const rawSha = options.missingProvenance ? undefined : sha256String(rawSkillContent);
    const initialManifest: CorpusManifest = {
      schema_version: 1,
      generator: "arsenal-corpus-internalize-v3.0.0",
      created_at: null,
      summary: {
        total_considered: 2,
        admitted: 2,
        quarantined: 0,
        excluded: 0,
        deduplicated: 0,
      },
      sources: {
        "reverse-skill": {
          repo: "zhaoxuya520/reverse-skill",
          rev: "cab634bd855fc287f6e420c1f36fd1a6b9245960",
          license: "MIT",
        },
        rea: {
          repo: "morluto/rea",
          rev: "a56f7bb668ab23fec8d33f7af353ac7ed2fe1895",
          license: "MIT",
        },
      },
      files: [
        {
          path: "skills/apk-reverse/SKILL.md",
          source: "reverse-skill",
          source_rev: "cab634bd855fc287f6e420c1f36fd1a6b9245960",
          license: "MIT",
          status: "admitted",
          destination_path: "src/corpus/re-apk-reverse/SKILL.md",
          sha256: sha256String(curatedSkillContent),
          bytes: Buffer.byteLength(curatedSkillContent, "utf-8"),
          source_path: "skills/apk-reverse/SKILL.md",
          ...(rawSha ? { source_sha256: rawSha } : {}),
          ...(options.missingSupportFileInManifest
            ? {}
            : {
                support_files: [
                  {
                    path: "references/guide.md",
                    source_path: "references/guide.md",
                    sha256: sha256String(curatedSupportContent),
                    bytes: Buffer.byteLength(curatedSupportContent, "utf-8"),
                  },
                ],
              }),
        },
        {
          path: "skills/reverse-engineer-anything/SKILL.md",
          source: "rea",
          source_rev: "a56f7bb668ab23fec8d33f7af353ac7ed2fe1895",
          license: "MIT",
          status: "admitted",
          destination_path: "src/corpus/re-reverse-engineer-anything/SKILL.md",
          sha256: sha256String("# REA Tool Guide\n"),
          bytes: Buffer.byteLength("# REA Tool Guide\n", "utf-8"),
          source_path: "skills/reverse-engineer-anything/SKILL.md",
          source_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      ],
    };
    fs.writeFileSync(path.join(corpusDir, "MANIFEST.json"), serializeCorpusManifest(initialManifest), "utf-8");
  }

  return {
    repoRoot,
    initialSkillBytes: Buffer.from(skillTextToWrite, "utf-8"),
    initialSupportBytes: Buffer.from(curatedSupportContent, "utf-8"),
    cleanup: () => {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    },
  };
}

describe("Corpus Durability and Ingestion Safety", () => {
  it("preserves same-source curated SKILL.md and support files byte-for-byte, materializes missing support files, and reconciles manifest hash", () => {
    // Legacy canonical skill lacks the support file on disk: ingester must materialize it and preserve SKILL.md byte-for-byte
    const { repoRoot, initialSkillBytes, cleanup } = createMockRepo({ missingSupportFileOnDisk: true });
    try {
      const res = internalizeCorpus({ repoRoot, preview: false });
      expect(res.admitted.length).toBeGreaterThan(0);

      // Verify curated SKILL.md was preserved BYTE-FOR-BYTE on disk
      const skillPath = path.join(repoRoot, "src/corpus/re-apk-reverse/SKILL.md");
      const diskSkillBytes = fs.readFileSync(skillPath);
      expect(diskSkillBytes.equals(initialSkillBytes)).toBe(true);

      // Verify newly planned missing support file was materialized into disk
      const supportPath = path.join(repoRoot, "src/corpus/re-apk-reverse/references/guide.md");
      expect(fs.existsSync(supportPath)).toBe(true);
      expect(fs.readFileSync(supportPath, "utf-8")).toBe("Upstream reference content\n");

      // Verify non-enumerated 'rea' directory and manifest entry survived completely byte-for-byte
      const reaPath = path.join(repoRoot, "src/corpus/re-reverse-engineer-anything/SKILL.md");
      expect(fs.existsSync(reaPath)).toBe(true);
      expect(fs.readFileSync(reaPath, "utf-8")).toBe("# REA Tool Guide\n");

      const manifest = readCorpusManifest(path.join(repoRoot, "src/corpus/MANIFEST.json"));
      const apkEntry = manifest.files.find((f) => f.destination_path === "src/corpus/re-apk-reverse/SKILL.md");
      expect(apkEntry).toBeDefined();
      expect(apkEntry?.sha256).toBe(sha256String(initialSkillBytes.toString("utf-8")));
      expect(apkEntry?.bytes).toBe(initialSkillBytes.byteLength);

      const reaEntry = manifest.files.find((f) => f.source === "rea");
      expect(reaEntry).toBeDefined();
      expect(reaEntry?.status).toBe("admitted");
      expect(manifest.sources.rea).toBeDefined();
    } finally {
      cleanup();
    }
  });
  it("reconciles legacy missing support file in manifest by merging newly planned item into manifest", () => {
    // Legacy canonical skill has SKILL.md and references/guide.md on disk, but manifest was missing support_files entry
    const { repoRoot, initialSkillBytes, cleanup } = createMockRepo({ missingSupportFileInManifest: true });
    try {
      const res = internalizeCorpus({ repoRoot, preview: false });
      expect(res.admitted.length).toBeGreaterThan(0);

      // Curated SKILL.md preserved byte-for-byte
      const skillPath = path.join(repoRoot, "src/corpus/re-apk-reverse/SKILL.md");
      expect(fs.readFileSync(skillPath).equals(initialSkillBytes)).toBe(true);

      // Manifest merged the newly planned support file record without failing validateSupportFileIntegrity
      const manifest = readCorpusManifest(path.join(repoRoot, "src/corpus/MANIFEST.json"));
      const apkEntry = manifest.files.find((f) => f.destination_path === "src/corpus/re-apk-reverse/SKILL.md");
      expect(apkEntry).toBeDefined();
      expect(apkEntry?.support_files).toBeDefined();
      expect(apkEntry?.support_files?.length).toBe(1);
      expect(apkEntry?.support_files?.[0]?.path).toBe("references/guide.md");
    } finally {
      cleanup();
    }
  });

  it("refuses internalization when upstream support file changes under a new revision and leaves corpus + manifest unchanged", () => {
    // Upstream references/guide.md mutated under a new revision
    const mutatedSupport = "MUTATED upstream content that differs from canonical\n";
    const { repoRoot, initialSkillBytes, initialSupportBytes, cleanup } = createMockRepo({
      tamperedUpstream: true,
      upstreamSupportContent: mutatedSupport,
      canonicalSkillSerialized: true,
    });
    try {
      const manifestPath = path.join(repoRoot, "src/corpus/MANIFEST.json");
      const initialManifestContent = fs.readFileSync(manifestPath, "utf-8");
      const skillPath = path.join(repoRoot, "src/corpus/re-apk-reverse/SKILL.md");
      const supportPath = path.join(repoRoot, "src/corpus/re-apk-reverse/references/guide.md");

      expect(() => {
        internalizeCorpus({ repoRoot, preview: false });
      }).toThrow(/Refusing to internalize corpus: candidate for 're-apk-reverse' modifies support file/);

      // Assert complete bytes unchanged on disk for SKILL.md, references/guide.md, and MANIFEST.json
      expect(fs.readFileSync(skillPath).equals(initialSkillBytes)).toBe(true);
      expect(fs.readFileSync(supportPath).equals(initialSupportBytes)).toBe(true);
      expect(fs.readFileSync(manifestPath, "utf-8")).toBe(initialManifestContent);
    } finally {
      cleanup();
    }
  });

  it("refuses internalization when existing manifest is malformed rather than doing a fresh reset", () => {
    const { repoRoot, cleanup } = createMockRepo({ malformedManifest: true });
    try {
      expect(() => {
        internalizeCorpus({ repoRoot, preview: false });
      }).toThrow(/Refusing to internalize corpus: existing manifest/);

      // Corrupted manifest must NOT be overwritten
      const manifestRaw = fs.readFileSync(path.join(repoRoot, "src/corpus/MANIFEST.json"), "utf-8");
      expect(manifestRaw).toContain("invalid json: true");
    } finally {
      cleanup();
    }
  });

  it("refuses internalization when legacy entry lacks source_sha256 and upstream rev/raw changes", () => {
    const { repoRoot, cleanup } = createMockRepo({ missingProvenance: true, tamperedUpstream: true });
    try {
      expect(() => {
        internalizeCorpus({ repoRoot, preview: false });
      }).toThrow(/lacks source_sha256 and upstream has changed/);

      // Disk bytes must remain unchanged
      const skillPath = path.join(repoRoot, "src/corpus/re-apk-reverse/SKILL.md");
      expect(fs.readFileSync(skillPath, "utf-8")).toContain("Specialized curated instructions");
    } finally {
      cleanup();
    }
  });

  it("forces second rename failure and verifies full recursive rollback of corpus, manifest, support, and REA", () => {
    const { repoRoot, cleanup } = createMockRepo();
    try {
      const corpusDir = path.join(repoRoot, "src/corpus");

      // Take full recursive snapshot before internalization
      const snapshot = new Map<string, Buffer>();
      function recordDir(dir: string, base: string) {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          const rel = path.relative(base, full);
          if (ent.isDirectory()) {
            recordDir(full, base);
          } else if (ent.isFile()) {
            snapshot.set(rel, fs.readFileSync(full));
          }
        }
      }
      recordDir(corpusDir, corpusDir);

      let renameCallCount = 0;
      expect(() => {
        internalizeCorpus({
          repoRoot,
          preview: false,
          renameSync: (oldPath: fs.PathLike, newPath: fs.PathLike) => {
            renameCallCount++;
            if (renameCallCount === 2) {
              throw new Error("Simulated filesystem failure during stageDir -> corpusDir commit");
            }
            return fs.renameSync(oldPath, newPath);
          },
        });
      }).toThrow(/Simulated filesystem failure during stageDir -> corpusDir commit/);

      // Assert full recursive rollback: every file in snapshot exists and has identical bytes
      expect(fs.existsSync(corpusDir)).toBe(true);
      for (const [relPath, origBytes] of snapshot.entries()) {
        const currentPath = path.join(corpusDir, relPath);
        expect(fs.existsSync(currentPath)).toBe(true);
        expect(fs.readFileSync(currentPath).equals(origBytes)).toBe(true);
      }

      // Assert REA survived completely
      const reaSkill = path.join(corpusDir, "re-reverse-engineer-anything/SKILL.md");
      expect(fs.existsSync(reaSkill)).toBe(true);
      expect(fs.readFileSync(reaSkill, "utf-8")).toBe("# REA Tool Guide\n");
    } finally {
      cleanup();
    }
  });
  it("does not re-materialize duplicate scripts/ copy when curated skill relocated helper to templates/", () => {
    const { repoRoot, cleanup } = createMockRepo();
    try {
      const upSkillFile = path.join(repoRoot, "upstream/reverse-skill/skills/apk-reverse/SKILL.md");
      const upScriptsDir = path.join(repoRoot, "upstream/reverse-skill/skills/apk-reverse/scripts");
      const curSkillFile = path.join(repoRoot, "src/corpus/re-apk-reverse/SKILL.md");
      const curTplDir = path.join(repoRoot, "src/corpus/re-apk-reverse/templates");
      const manifestFile = path.join(repoRoot, "src/corpus/MANIFEST.json");

      fs.mkdirSync(upScriptsDir, { recursive: true });
      fs.writeFileSync(path.join(upScriptsDir, "process.py"), "print('ok')\n", "utf-8");
      const newUpRaw = `${fs.readFileSync(upSkillFile, "utf-8")}\nRun \`python scripts/process.py\`.\n`;
      fs.writeFileSync(upSkillFile, newUpRaw, "utf-8");

      fs.mkdirSync(curTplDir, { recursive: true });
      fs.writeFileSync(path.join(curTplDir, "process.py"), "print('ok')\n", "utf-8");
      const newCurMd = `${fs.readFileSync(curSkillFile, "utf-8")}\nRun \`python templates/process.py\`.\n`;
      fs.writeFileSync(curSkillFile, newCurMd, "utf-8");

      const manifest = readCorpusManifest(manifestFile);
      const apk = manifest.files.find((f) => f.destination_path === "src/corpus/re-apk-reverse/SKILL.md")!;
      apk.source_sha256 = sha256String(newUpRaw);
      apk.sha256 = sha256String(newCurMd);
      apk.bytes = Buffer.byteLength(newCurMd, "utf-8");
      apk.support_files = [
        ...(apk.support_files ?? []),
        {
          path: "templates/process.py",
          source_path: "scripts/process.py",
          sha256: sha256String("print('ok')\n"),
          bytes: Buffer.byteLength("print('ok')\n", "utf-8"),
        },
      ];
      fs.writeFileSync(manifestFile, serializeCorpusManifest(manifest), "utf-8");

      internalizeCorpus({ repoRoot, preview: false });
      expect(fs.existsSync(path.join(repoRoot, "src/corpus/re-apk-reverse/templates/process.py"))).toBe(true);
      expect(fs.existsSync(path.join(repoRoot, "src/corpus/re-apk-reverse/scripts/process.py"))).toBe(false);
      const finalManifest = readCorpusManifest(manifestFile);
      const finalApk = finalManifest.files.find((f) => f.destination_path === "src/corpus/re-apk-reverse/SKILL.md");
      expect(finalApk?.support_files?.map((sf) => sf.path)).toEqual(["references/guide.md", "templates/process.py"]);
    } finally {
      cleanup();
    }
  });
  it("refuses internalization when upstream SKILL.md changes under a new revision and disk is already canonical curated", () => {
    const { repoRoot, initialSkillBytes, initialSupportBytes, cleanup } = createMockRepo({
      tamperedUpstream: true,
    });
    try {
      const upSkillFile = path.join(repoRoot, "upstream/reverse-skill/skills/apk-reverse/SKILL.md");
      fs.writeFileSync(
        upSkillFile,
        `${fs.readFileSync(upSkillFile, "utf-8")}\n## New Upstream Section Under New Revision\n`,
        "utf-8"
      );
      const manifestPath = path.join(repoRoot, "src/corpus/MANIFEST.json");
      const initialManifestContent = fs.readFileSync(manifestPath, "utf-8");
      const skillPath = path.join(repoRoot, "src/corpus/re-apk-reverse/SKILL.md");
      const supportPath = path.join(repoRoot, "src/corpus/re-apk-reverse/references/guide.md");

      expect(() => {
        internalizeCorpus({ repoRoot, preview: false });
      }).toThrow(/Refusing to internalize corpus: candidate for 're-apk-reverse' modifies existing canonical SKILL\.md under changed revision/);

      expect(fs.readFileSync(skillPath).equals(initialSkillBytes)).toBe(true);
      expect(fs.readFileSync(supportPath).equals(initialSupportBytes)).toBe(true);
      expect(fs.readFileSync(manifestPath, "utf-8")).toBe(initialManifestContent);
    } finally {
      cleanup();
    }
  });
});
