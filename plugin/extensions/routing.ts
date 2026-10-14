/**
 * Runtime Guidance Discovery Tools Extension
 * Implements contracts/guidance-distribution.md §1 & T032
 * Registers skill_search, skill_list, skill_load on-demand discovery tools
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256String } from "../../src/core/hash.ts";
import { routeHint, type RoutingTable, type RouteResult, type SkillDomain } from "../../src/core/skill-routing.ts";
import { safeReadBoundedFile } from "../../src/core/fs-safe.ts";
import { SkillSearchIndex } from "../../src/core/skill-search.ts";
import QuickLRU from "quick-lru";
import type { SkillAssetLoadResult } from "../../src/core/types.ts";

export interface SkillSearchResultItem {
  name: string;
  domain: string;
  category: string;
  description: string;
  sha256: string;
  score?: number;
}

export interface SkillSearchOutput {
  total_matches: number;
  returned: number;
  limit: number;
  results: SkillSearchResultItem[];
  note?: string;
}

export interface SkillListOutput {
  total: number;
  offset: number;
  limit: number;
  skills: SkillSearchResultItem[];
}

export interface SkillLoadOutput {
  name?: string;
  content?: string;
  sha256?: string;
  error?: "SKILL_NOT_FOUND" | "INTEGRITY_VERIFICATION_FAILED";
  expected_hash?: string;
  actual_hash?: string;
}

export interface CatalogItem {
  name: string;
  domain: string;
  category: string;
  description: string;
  sha256: string;
  bytes: number;
}

function resolvePluginRoot(baseDir?: string): string {
  if (baseDir) {
    const resolved = path.resolve(baseDir);
    if (fs.existsSync(path.join(resolved, "catalog/skills.index.jsonl"))) {
      return resolved;
    }
    if (fs.existsSync(path.join(resolved, "plugin/catalog/skills.index.jsonl"))) {
      return path.join(resolved, "plugin");
    }
    if (fs.existsSync(path.join(resolved, "plugin"))) {
      return path.join(resolved, "plugin");
    }
    return resolved;
  }

  const metaDir = typeof import.meta !== "undefined" && import.meta.dir ? import.meta.dir : process.cwd();

  const distRoot = path.resolve(metaDir, "../..");
  if (fs.existsSync(path.join(distRoot, "catalog/skills.index.jsonl"))) {
    return distRoot;
  }

  const sourceRoot = path.resolve(metaDir, "..");
  if (fs.existsSync(path.join(sourceRoot, "catalog/skills.index.jsonl"))) {
    return sourceRoot;
  }

  const cwdPlugin = path.resolve(process.cwd(), "plugin");
  if (fs.existsSync(path.join(cwdPlugin, "catalog/skills.index.jsonl"))) {
    return cwdPlugin;
  }
  if (fs.existsSync(path.resolve(process.cwd(), "catalog/skills.index.jsonl"))) {
    return path.resolve(process.cwd());
  }

  return distRoot;
}

interface RoutingCacheEntry {
  mtimeMs: number;
  size: number;
  table: RoutingTable | null;
}

interface CatalogCacheEntry {
  mtimeMs: number;
  size: number;
  items: CatalogItem[];
  index: SkillSearchIndex<CatalogItem> | null;
}

export class SkillCatalogManager {
  private catalogPath: string;
  private skillsDir: string;
  private routingDir: string;
  private catalogCache: CatalogCacheEntry | null = null;
  private readonly routingCache: Record<SkillDomain, RoutingCacheEntry | null>;
  private readonly queryCache = new QuickLRU<string, SkillSearchOutput>({ maxSize: 128 });

  constructor(baseDir?: string) {
    const root = resolvePluginRoot(baseDir);
    this.catalogPath = path.resolve(root, "catalog/skills.index.jsonl");
    this.skillsDir = path.resolve(root, "skills");
    this.routingDir = path.resolve(root, "catalog/routing");
    this.routingCache = { re: null, webapp: null, mobile: null, red: null };
  }

  private loadRoutingTables(): Record<SkillDomain, RoutingTable | null> {
    const domains: SkillDomain[] = ["re", "webapp", "mobile", "red"];
    const tables = {} as Record<SkillDomain, RoutingTable | null>;
    for (const domain of domains) {
      const file = path.join(this.routingDir, `${domain}.json`);

      let mtimeMs = 0;
      let size = -1;
      try {
        const stat = fs.statSync(file);
        mtimeMs = stat.mtimeMs;
        size = stat.size;
      } catch {
        mtimeMs = 0;
        size = -1;
      }

      const cached = this.routingCache[domain];
      if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
        tables[domain] = cached.table;
        continue;
      }

      let table: RoutingTable | null = null;
      if (size >= 0) {
        try {
          table = JSON.parse(fs.readFileSync(file, "utf-8")) as RoutingTable;
        } catch {
          table = null;
        }
      }

      this.routingCache[domain] = { mtimeMs, size, table };
      tables[domain] = table;
    }
    return tables;
  }

  /** Read-only deterministic routing lookup (contracts/routing-table.md §5). */
  public route(hint: string, domain?: SkillDomain): RouteResult {
    return routeHint(hint, domain, this.loadRoutingTables());
  }

  /** Immutable catalog snapshot; treat the returned array as read-only. */
  public loadCatalog(): readonly CatalogItem[] {
    return this.loadCatalogSnapshot().items;
  }

  /**
   * Snapshot cache keyed by mtime + size. The 711 KiB JSONL catalog is parsed
   * once per (path, mtime, size) and reused for search, list, load, and index
   * construction; edits on disk invalidate it deterministically.
   */
  private loadCatalogSnapshot(): CatalogCacheEntry {
    let mtimeMs = 0;
    let size = -1;
    try {
      const stat = fs.statSync(this.catalogPath);
      mtimeMs = stat.mtimeMs;
      size = stat.size;
    } catch {
      mtimeMs = 0;
      size = -1;
    }

    const cached = this.catalogCache;
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
      return cached;
    }

    let items: CatalogItem[] = [];
    if (size >= 0) {
      const raw = fs.readFileSync(this.catalogPath, "utf-8");
      items = raw
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as CatalogItem);
    }

    const snapshot: CatalogCacheEntry = { mtimeMs, size, items, index: null };
    this.catalogCache = snapshot;
    this.queryCache.clear();
    return snapshot;
  }

  /** BM25 index over the current catalog snapshot; built lazily on first search. */
  private getSearchIndex(): SkillSearchIndex<CatalogItem> {
    const snapshot = this.loadCatalogSnapshot();
    if (!snapshot.index) {
      snapshot.index = new SkillSearchIndex(snapshot.items);
    }
    return snapshot.index;
  }

  public search(
    query: string,
    domain?: "re" | "webapp" | "mobile" | "red",
    category?: string,
    requestedLimit: number = 10
  ): SkillSearchOutput {
    const limit = Math.min(Math.max(1, requestedLimit), 25);
    const cacheKey = `${query}\u0000${domain ?? ""}\u0000${category ?? ""}\u0000${limit}`;

    // Revalidate the catalog snapshot before serving a cached outcome; a new
    // snapshot clears the query cache deterministically.
    this.loadCatalogSnapshot();
    const cached = this.queryCache.get(cacheKey);
    if (cached) return cached;

    const outcome = this.getSearchIndex().search(query, {
      filter: (item) => {
        if (domain && item.domain !== domain) return false;
        if (category && item.category !== category) return false;
        return true;
      },
    });

    const unknownNote =
      outcome.unknownTokens.length > 0
        ? ` Unrecognized query terms: ${outcome.unknownTokens.map((token) => `'${token}'`).join(", ")}.`
        : "";

    let output: SkillSearchOutput;
    if (outcome.totalMatches === 0) {
      output = {
        total_matches: 0,
        returned: 0,
        limit,
        results: [],
        note: `NO_RELEVANT_GUIDANCE: Task requirements do not match existing playbooks. Do NOT force-fit unrelated guidance. Follow Anti-Force-Fitting Protocol: conduct external methodology research and propose a new playbook.${unknownNote}`,
      };
    } else {
      const results = outcome.hits.slice(0, limit).map((hit) => ({
        name: hit.document.name,
        domain: hit.document.domain,
        category: hit.document.category,
        description: hit.document.description,
        sha256: hit.document.sha256,
        score: Number(hit.score.toFixed(4)),
      }));
      output = {
        total_matches: outcome.totalMatches,
        returned: results.length,
        limit,
        results,
      };
      if (outcome.unknownTokens.length > 0) {
        output.note = `Unrecognized query terms ignored: ${outcome.unknownTokens.map((token) => `'${token}'`).join(", ")}.`;
      }
    }

    this.queryCache.set(cacheKey, output);
    return output;
  }

  public list(
    domain?: "re" | "webapp" | "mobile" | "red",
    category?: string,
    offset: number = 0,
    requestedLimit: number = 20
  ): SkillListOutput {
    const limit = Math.min(Math.max(1, requestedLimit), 50);
    const catalog = this.loadCatalog();

    const filtered = catalog.filter((item) => {
      if (domain && item.domain !== domain) return false;
      if (category && item.category !== category) return false;
      return true;
    });

    const page = filtered.slice(offset, offset + limit).map((i) => ({
      name: i.name,
      domain: i.domain,
      category: i.category,
      description: i.description,
      sha256: i.sha256,
    }));

    return {
      total: filtered.length,
      offset,
      limit,
      skills: page,
    };
  }

  /**
   * Resolves a skill identifier to its canonical directory. Rejects path
   * segments in the identifier and verifies that the real (symlink-resolved)
   * directory stays inside the skills root.
   */
  private resolveSkillDir(name: string): string | null {
    if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;
    const root = path.resolve(this.skillsDir);
    let realRoot: string;
    let realCandidate: string;
    try {
      realRoot = fs.realpathSync(root);
      realCandidate = fs.realpathSync(path.join(realRoot, name));
    } catch {
      return null;
    }
    const candidateRel = path.relative(realRoot, realCandidate);
    if (!candidateRel || candidateRel.startsWith("..") || path.isAbsolute(candidateRel)) return null;
    return realCandidate;
  }

  public load(name: string): SkillLoadOutput {
    const skillDir = this.resolveSkillDir(name);
    if (!skillDir) {
      return { error: "SKILL_NOT_FOUND", name };
    }

    const skillPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      return { error: "SKILL_NOT_FOUND", name };
    }

    let resolvedSkillFile: string;
    try {
      resolvedSkillFile = fs.realpathSync(skillPath);
    } catch {
      return { error: "SKILL_NOT_FOUND", name };
    }
    const fileRel = path.relative(skillDir, resolvedSkillFile);
    if (!fileRel || fileRel.startsWith("..") || path.isAbsolute(fileRel)) {
      return { error: "SKILL_NOT_FOUND", name };
    }

    const raw = fs.readFileSync(resolvedSkillFile, "utf-8");
    const computedHash = sha256String(raw);

    const catalog = this.loadCatalog();
    const entry = catalog.find((c) => c.name === name);

    if (entry && entry.sha256 !== computedHash) {
      return {
        error: "INTEGRITY_VERIFICATION_FAILED",
        name,
        expected_hash: entry.sha256,
        actual_hash: computedHash,
      };
    }

    return {
      name,
      content: raw,
      sha256: computedHash,
    };
  }

  public loadAsset(skillName: string, assetPath: string): SkillAssetLoadResult {
    const skillDir = this.resolveSkillDir(skillName);
    if (!skillDir) {
      throw new Error(`Skill '${skillName}' not found`);
    }
    const cleanSubpath = assetPath.replace(/^(\.\/|\/)+/, "");
    const targetPath = path.resolve(skillDir, cleanSubpath);
    const skillDirPrefix = skillDir.endsWith(path.sep) ? skillDir : `${skillDir}${path.sep}`;
    if (!targetPath.startsWith(skillDirPrefix)) {
      throw new Error(`Path traversal denied: '${assetPath}' escapes skill directory`);
    }
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Asset '${cleanSubpath}' not found in skill '${skillName}'`);
    }

    let resolvedTarget: string;
    try {
      resolvedTarget = fs.realpathSync(targetPath);
    } catch {
      throw new Error(`Asset '${cleanSubpath}' not found in skill '${skillName}'`);
    }
    const targetRel = path.relative(skillDir, resolvedTarget);
    if (!targetRel || targetRel.startsWith("..") || path.isAbsolute(targetRel)) {
      throw new Error(`Path traversal denied: '${assetPath}' escapes skill directory`);
    }

    const bounded = safeReadBoundedFile(resolvedTarget);
    return {
      skill: skillName,
      assetPath: cleanSubpath,
      resolvedUri: `skill://${skillName}/${cleanSubpath}`,
      content: bounded.content,
      sizeBytes: bounded.sizeBytes,
      truncated: bounded.truncated,
    };
  }
}

// OMP extension entrypoint
export interface ExtensionContext {
  registerTool: (tool: unknown, ...args: unknown[]) => void;
  zod?: unknown;
}

interface HostZodFluent {
  describe: (d: string) => HostZodFluent;
  optional: () => HostZodFluent;
  default: (v: unknown) => HostZodFluent;
  min: (n: number) => HostZodFluent;
  max: (n: number) => HostZodFluent;
  int: () => HostZodFluent;
}

interface HostZodBuilder {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => HostZodFluent;
  enum: (values: string[]) => HostZodFluent;
  number: () => HostZodFluent;
}

function isHostZod(z: unknown): z is HostZodBuilder {
  return typeof z === "object" && z !== null && "object" in z && typeof z.object === "function";
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (
    toolCallIdOrParams: unknown,
    maybeParams?: unknown,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
    ctx?: unknown
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: unknown;
    isError?: boolean;
  }>;
}

function registerTool(
  pi: ExtensionContext,
  tool: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
    handler: (params: unknown) => Promise<unknown>;
  }
): void {
  const executeFn = async (toolCallIdOrParams: unknown, maybeParams?: unknown) => {
    try {
      const params = maybeParams !== undefined ? maybeParams : toolCallIdOrParams;
      const rawResult = await tool.handler(params);
      const textResult =
        typeof rawResult === "string"
          ? rawResult
          : JSON.stringify(rawResult, null, 2);
      return {
        content: [{ type: "text" as const, text: textResult }],
        details: rawResult,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${errMsg}` }],
        details: { error: errMsg },
        isError: true,
      };
    }
  };

  const toolObj: ToolDefinition = {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: executeFn,
  };

  if (typeof pi.registerTool === "function") {
    if (pi.registerTool.length >= 3) {
      pi.registerTool(
        tool.name,
        { description: tool.description, parameters: tool.parameters },
        (args: unknown) => tool.handler(args)
      );
    } else {
      pi.registerTool(toolObj);
    }
  }
}

export default function routingExtension(pi: ExtensionContext): void {
  const manager = new SkillCatalogManager();
  const hostZod = pi && typeof pi === "object" && "zod" in pi && isHostZod(pi.zod) ? pi.zod : null;

  registerTool(pi, {
    name: "skill_search",
    description: "Search machine-readable skill catalog index for relevant security playbooks.",
    parameters: hostZod
      ? (hostZod.object({
          query: hostZod.string().describe("Search keywords or technique description"),
          domain: hostZod.enum(["re", "webapp", "mobile", "red"]).optional().describe("Filter playbooks by security domain"),
          category: hostZod.string().optional().describe("Filter playbooks by category"),
          limit: hostZod.number().int().min(1).max(25).default(10).optional().describe("Maximum matching playbooks to return"),
        }) as Record<string, unknown>)
      : {
          type: "object",
          properties: {
            query: { type: "string" },
            domain: { enum: ["re", "webapp", "mobile", "red"] },
            category: { type: "string" },
            limit: { type: "integer" },
          },
          required: ["query"],
        },
    handler: async (args: unknown) => {
      const { query, domain, category, limit } = (args || {}) as {
        query: string;
        domain?: "re" | "webapp" | "mobile" | "red";
        category?: string;
        limit?: number;
      };
      return manager.search(query, domain, category, limit);
    },
  });

  registerTool(pi, {
    name: "skill_list",
    description: "List available playbooks scoped by domain or category.",
    parameters: hostZod
      ? (hostZod.object({
          domain: hostZod.enum(["re", "webapp", "mobile", "red"]).optional().describe("Filter playbooks by security domain"),
          category: hostZod.string().optional().describe("Filter playbooks by category"),
          offset: hostZod.number().int().min(0).default(0).optional().describe("Pagination offset"),
          limit: hostZod.number().int().min(1).max(100).default(20).optional().describe("Maximum playbooks to return"),
        }) as Record<string, unknown>)
      : {
          type: "object",
          properties: {
            domain: { enum: ["re", "webapp", "mobile", "red"] },
            category: { type: "string" },
            offset: { type: "integer" },
            limit: { type: "integer" },
          },
        },
    handler: async (args: unknown) => {
      const { domain, category, offset, limit } = (args || {}) as {
        domain?: "re" | "webapp" | "mobile" | "red";
        category?: string;
        offset?: number;
        limit?: number;
      };
      return manager.list(domain, category, offset, limit);
    },
  });

  registerTool(pi, {
    name: "skill_load",
    description: "Load complete verified markdown body of an on-demand leaf skill.",
    parameters: hostZod
      ? (hostZod.object({
          name: hostZod.string().describe("Canonical identifier of the skill to load"),
          asset_path: hostZod.string().optional().describe("Optional relative path to support asset inside skill directory"),
        }) as Record<string, unknown>)
      : {
          type: "object",
          properties: {
            name: { type: "string" },
            asset_path: { type: "string", description: "Optional relative path to support asset inside skill directory" },
          },
          required: ["name"],
        },
    handler: async (args: unknown) => {
      const { name, asset_path } = (args || {}) as { name: string; asset_path?: string };
      if (asset_path) {
        return manager.loadAsset(name, asset_path);
      }
      return manager.load(name);
    },
  });

  registerTool(pi, {
    name: "skill_asset_load",
    description:
      "Retrieve an auxiliary support asset (reference, template, or field journal) from a registered canonical skill.",
    parameters: hostZod
      ? (hostZod.object({
          skill_name: hostZod.string().describe("Canonical identifier of the skill"),
          asset_path: hostZod.string().describe("Relative path to the support asset inside the skill directory"),
        }) as Record<string, unknown>)
      : {
          type: "object",
          properties: {
            skill_name: { type: "string", description: "Canonical identifier of the skill." },
            asset_path: { type: "string", description: "Relative path to the support asset inside the skill directory." },
          },
          required: ["skill_name", "asset_path"],
        },
    handler: async (args: unknown) => {
      const { skill_name, asset_path } = (args || {}) as { skill_name: string; asset_path: string };
      return manager.loadAsset(skill_name, asset_path);
    },
  });

  registerTool(pi, {
    name: "skill_route",
    description:
      "Deterministic read-only routing lookup: match a task hint against the domain routing tables and return the owning route, category, and leaf playbook.",
    parameters: hostZod
      ? (hostZod.object({
          hint: hostZod.string().describe("Task description or security testing intent"),
          domain: hostZod.enum(["re", "webapp", "mobile", "red"]).optional().describe("Filter routing by domain"),
        }) as Record<string, unknown>)
      : {
          type: "object",
          properties: {
            hint: { type: "string" },
            domain: { enum: ["re", "webapp", "mobile", "red"] },
          },
          required: ["hint"],
        },
    handler: async (args: unknown) => {
      const { hint, domain } = (args || {}) as { hint: string; domain?: SkillDomain };
      return manager.route(hint, domain);
    },
  });

}
