#!/usr/bin/env bun
/**
 * tools/extract-baselines.ts
 *
 * Regenerates a domain coverage baseline from a local checkout of the pinned
 * revision (contracts/coverage-baseline.md §2 B-1..B-4; research.md R6.3).
 *
 * Report-only by default; `--write` persists `presets/baselines/<domain>.json`.
 * Fails closed (nonzero, no partial output) when the pinned revision is absent
 * from the checkout, the artifact path is missing, or the artifact shape does not
 * match the expected type. Never emits an empty baseline.
 *
 * Usage:
 *   bun run tools/extract-baselines.ts [--domain <re|webapp|mobile|red|all>] [--write] [--json]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256File, sha256String } from "../src/core/hash.ts";
import { validateSchema } from "../src/schemas/validator.ts";
import {
  COVERAGE_BASELINE_SCHEMA_ID,
  type Capability,
  type CoverageBaseline,
} from "../src/core/coverage-baseline.ts";
import { DOMAINS, type SkillDomain } from "../src/core/skill-routing.ts";

interface CheckoutSpec {
  domain: SkillDomain;
  dir: string;
  revision: string;
  artifactPath: string;
  parser: "wstg" | "attack-stix" | "mastg-tests" | "authored";
  standard: { name: string; url: string; revision: string; version?: string | null };
  license: string;
}

/**
 * Checked-in pins. Revisions are constants so re-extraction is reproducible and
 * independent of the caller's environment (contracts/coverage-baseline.md §2 B-1).
 */
const ATTACK_PIN = "6cda5ad8462c79e14fbb872f4e09059b18e0cfc4";
const ATTACK_VERSION = "19.2";
const MASTG_PIN = "02ffd85fb74383ec2a30b42866d38f89d72c0ead";

export const CHECKOUTS: Record<SkillDomain, CheckoutSpec> = {
  webapp: {
    domain: "webapp",
    dir: "upstream/wstg",
    revision: "41825236dfaebda3f605f47963c5640bafd1355d",
    artifactPath: "checklists/checklist.json",
    parser: "wstg",
    standard: {
      name: "OWASP Web Security Testing Guide",
      url: "https://owasp.org/www-project-web-security-testing-guide/",
      revision: "41825236dfaebda3f605f47963c5640bafd1355d",
      version: "4.2",
    },
    license: "CC-BY-SA-4.0",
  },
  red: {
    domain: "red",
    dir: "upstream/attack-stix-data",
    revision: ATTACK_PIN,
    artifactPath: "enterprise-attack/enterprise-attack.json",
    parser: "attack-stix",
    standard: {
      name: "MITRE ATT&CK Enterprise",
      url: "https://attack.mitre.org/",
      revision: ATTACK_PIN,
      version: ATTACK_VERSION,
    },
    license: "Apache-2.0",
  },
  mobile: {
    domain: "mobile",
    dir: "upstream/mastg",
    revision: MASTG_PIN,
    artifactPath: "tests",
    parser: "mastg-tests",
    standard: {
      name: "OWASP Mobile Application Security Testing Guide",
      url: "https://mas.owasp.org/MASTG/",
      revision: MASTG_PIN,
      version: null,
    },
    license: "CC-BY-SA-4.0",
  },
  re: {
    domain: "re",
    dir: "",
    revision: "",
    artifactPath: "",
    parser: "authored",
    standard: {
      name: "arsenal-re-capability-taxonomy",
      url: "https://github.com/arsenal/arsenal",
      revision: "",
      version: null,
    },
    license: "Apache-2.0",
  },
};

function fail(message: string): never {
  console.error(`extract-baselines: ${message}`);
  process.exit(1);
}

function sha256Tree(dirAbs: string): string {
  const lines: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) lines.push(`${path.relative(dirAbs, full).replace(/\\/g, "/")} ${sha256File(full)}`);
    }
  };
  walk(dirAbs);
  return sha256String(lines.join("\n") + "\n");
}

function gitHead(dir: string): string | null {
  const headFile = path.join(dir, ".git/HEAD");
  if (!fs.existsSync(headFile)) return null;
  const raw = fs.readFileSync(headFile, "utf-8").trim();
  if (raw.startsWith("ref: ")) {
    const refPath = path.join(dir, ".git", raw.slice(5));
    if (fs.existsSync(refPath)) return fs.readFileSync(refPath, "utf-8").trim();
    const packedPath = path.join(dir, ".git/packed-refs");
    if (fs.existsSync(packedPath)) {
      for (const line of fs.readFileSync(packedPath, "utf-8").split("\n")) {
        const [sha, ref] = line.split(" ");
        if (ref === raw.slice(5)) return sha ?? null;
      }
    }
    return null;
  }
  return raw;
}

function parseWstg(artifactAbs: string): Capability[] {
  const parsed = JSON.parse(fs.readFileSync(artifactAbs, "utf-8")) as {
    categories?: Record<string, { id?: string; tests?: Array<{ id?: string; name?: string; reference?: string }> }>;
  };
  if (!parsed.categories || typeof parsed.categories !== "object") {
    fail("WSTG artifact has no 'categories' object");
  }
  const capabilities: Capability[] = [];
  for (const [name, category] of Object.entries(parsed.categories)) {
    for (const test of category.tests ?? []) {
      if (!test.id || !test.name) continue;
      capabilities.push({
        id: test.id,
        title: test.name,
        category: category.id ?? name,
        source_ref: test.reference ?? "",
      });
    }
  }
  return capabilities;
}

function parseAttackStix(artifactAbs: string): Capability[] {
  const parsed = JSON.parse(fs.readFileSync(artifactAbs, "utf-8")) as {
    objects?: Array<Record<string, unknown>>;
  };
  if (!Array.isArray(parsed.objects)) fail("ATT&CK STIX bundle has no 'objects' array");
  const capabilities: Capability[] = [];
  for (const obj of parsed.objects) {
    if (obj.type !== "attack-pattern") continue;
    if (obj.revoked === true || obj["x_mitre_deprecated"] === true) continue;
    const extRefs = (obj.external_references ?? []) as Array<Record<string, string>>;
    const mitre = extRefs.find((r) => r.source_name === "mitre-attack");
    const id = mitre?.external_id;
    if (!id || !/^T\d{4}(\.\d{3})?$/.test(id)) continue;
    const phases = (obj.kill_chain_phases ?? []) as Array<Record<string, string>>;
    capabilities.push({
      id,
      title: String(obj.name ?? id),
      category: phases[0]?.phase_name ?? "unknown",
      source_ref: mitre?.url ?? `https://attack.mitre.org/techniques/${id.replace(".", "/")}`,
    });
  }
  return capabilities;
}

/**
 * MASTG publishes one Markdown file per test under `tests/<platform>/MASVS-<CAT>/`.
 * The identifier is the filename (`MASTG-TEST-<NNNN>`); frontmatter carries the
 * title and platform. No spreadsheet parser is used (contract §2).
 */
function parseMastgTests(artifactAbs: string): Capability[] {
  if (!fs.existsSync(artifactAbs)) fail(`MASTG tests directory missing at '${artifactAbs}'`);
  const capabilities: Capability[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      const id = entry.name.replace(/\.md$/, "");
      if (!/^MASTG-TEST-\d+$/.test(id)) continue;
      const content = fs.readFileSync(full, "utf-8");
      const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
      const fm: Record<string, string> = {};
      if (fmMatch) {
        for (const line of fmMatch[1]!.split("\n")) {
          const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
          if (m) fm[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
        }
      }
      const masvsDir = path.basename(path.dirname(full));
      capabilities.push({
        id,
        title: fm.title ?? id,
        category: /^MASVS-/.test(masvsDir) ? masvsDir : (fm.platform ?? "unknown"),
        source_ref: path.relative(artifactAbs, full).replace(/\\/g, "/"),
      });
    }
  };
  walk(artifactAbs);
  return capabilities;
}

function extract(spec: CheckoutSpec, repoRoot: string): { baseline: CoverageBaseline | null; errors: string[] } {
  if (spec.parser === "authored") {
    return { baseline: null, errors: [`domain '${spec.domain}' has no external standard; the baseline is authored (T029)`] };
  }
  if (!spec.revision) {
    return { baseline: null, errors: [`domain '${spec.domain}' has no pinned revision recorded yet`] };
  }
  const dirAbs = path.resolve(repoRoot, spec.dir);
  if (!fs.existsSync(dirAbs)) {
    return { baseline: null, errors: [`checkout absent: '${spec.dir}' (pinned revision ${spec.revision})`] };
  }
  const head = gitHead(dirAbs);
  if (head !== null && head !== spec.revision) {
    return {
      baseline: null,
      errors: [`checkout '${spec.dir}' is at ${head}, expected pinned revision ${spec.revision}`],
    };
  }
  const artifactAbs = path.resolve(dirAbs, spec.artifactPath);
  if (!fs.existsSync(artifactAbs)) {
    return { baseline: null, errors: [`artifact path missing: '${spec.dir}/${spec.artifactPath}'`] };
  }

  let capabilities: Capability[];
  try {
    capabilities =
      spec.parser === "wstg"
        ? parseWstg(artifactAbs)
        : spec.parser === "attack-stix"
          ? parseAttackStix(artifactAbs)
          : parseMastgTests(artifactAbs);
  } catch (err) {
    return { baseline: null, errors: [`failed to parse artifact: ${String(err)}`] };
  }
  if (capabilities.length === 0) {
    return { baseline: null, errors: ["artifact produced zero capabilities; refusing to emit an empty baseline"] };
  }

  capabilities.sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set<string>();
  for (const cap of capabilities) {
    if (seen.has(cap.id)) return { baseline: null, errors: [`duplicate capability id '${cap.id}'`] };
    seen.add(cap.id);
  }

  const artifactSha = fs.statSync(artifactAbs).isDirectory() ? sha256Tree(artifactAbs) : sha256File(artifactAbs);

  // B-1/B-3: a checked-in baseline is a pin, not a rolling record. Re-extraction
  // must reproduce the recorded revision and the recorded artifact hash, or it is
  // a failure — never a silent re-pin.
  const existingPath = path.resolve(repoRoot, `presets/baselines/${spec.domain}.json`);
  if (fs.existsSync(existingPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(existingPath, "utf-8")) as CoverageBaseline;
      if (existing.standard?.revision !== spec.revision) {
        return {
          baseline: null,
          errors: [
            `checked-in baseline revision ${existing.standard?.revision} does not match the pinned revision ${spec.revision}`,
          ],
        };
      }
      if (existing.extracted_from?.sha256 !== artifactSha) {
        return {
          baseline: null,
          errors: [
            `artifact hash ${artifactSha.slice(0, 12)}… does not match the checked-in baseline ${String(
              existing.extracted_from?.sha256
            ).slice(0, 12)}…`,
          ],
        };
      }
    } catch {
      return { baseline: null, errors: [`checked-in baseline '${existingPath}' is unreadable`] };
    }
  }

  const baseline: CoverageBaseline = {
    schemaVersion: "1.0",
    domain: spec.domain,
    standard: { ...spec.standard },
    extracted_from: {
      path: `${spec.dir}/${spec.artifactPath}`,
      sha256: artifactSha,
    },
    license: spec.license,
    capabilities,
  };
  return { baseline, errors: [] };
}

function main(): void {
  const args = process.argv.slice(2);
  const isWrite = args.includes("--write");
  const isJson = args.includes("--json");
  const domainArg = args.includes("--domain") ? args[args.indexOf("--domain") + 1] : "all";
  const repoRoot = process.cwd();

  const domains: SkillDomain[] =
    domainArg === "all" || !domainArg ? [...DOMAINS] : [domainArg as SkillDomain];
  for (const d of domains) {
    if (!(d in CHECKOUTS)) fail(`unknown domain '${d}'`);
  }

  let failures = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const domain of domains) {
    const spec = CHECKOUTS[domain];
    const { baseline, errors } = extract(spec, repoRoot);
    if (!baseline) {
      failures++;
      results.push({ domain, status: "unavailable", errors });
      continue;
    }
    const schemaResult = validateSchema(COVERAGE_BASELINE_SCHEMA_ID, baseline);
    if (!schemaResult.valid) {
      failures++;
      results.push({ domain, status: "invalid", errors: schemaResult.errors });
      continue;
    }
    const outPath = path.resolve(repoRoot, `presets/baselines/${domain}.json`);
    if (isWrite) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2) + "\n", "utf-8");
    }
    results.push({
      domain,
      status: isWrite ? "written" : "preview",
      capabilities: baseline.capabilities.length,
      revision: baseline.standard.revision,
      extracted_from_sha256: baseline.extracted_from.sha256,
      path: outPath,
    });
  }

  if (isJson) {
    console.log(JSON.stringify({ results, failures }, null, 2));
  } else {
    for (const r of results) {
      if (r.status === "unavailable" || r.status === "invalid") {
        console.error(`[${r.domain}] ${r.status}: ${(r.errors as string[]).join("; ")}`);
      } else {
        console.log(
          `[${r.domain}] ${r.status}: ${r.capabilities} capabilities @ ${r.revision} (${String(r.extracted_from_sha256).slice(0, 12)}…)`
        );
      }
    }
  }
  process.exit(failures > 0 ? 1 : 0);
}

if (import.meta.main) main();
