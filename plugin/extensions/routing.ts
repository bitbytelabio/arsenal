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
import type { SkillAssetLoadResult } from "../../src/core/types.ts";

export interface SkillSearchResultItem {
  name: string;
  domain: string;
  category: string;
  description: string;
  sha256: string;
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

export class SkillCatalogManager {
  private catalogPath: string;
  private skillsDir: string;
  private routingDir: string;

  constructor(baseDir?: string) {
    const root = resolvePluginRoot(baseDir);
    this.catalogPath = path.resolve(root, "catalog/skills.index.jsonl");
    this.skillsDir = path.resolve(root, "skills");
    this.routingDir = path.resolve(root, "catalog/routing");
  }

  private loadRoutingTables(): Record<SkillDomain, RoutingTable | null> {
    const domains: SkillDomain[] = ["re", "webapp", "mobile", "red"];
    const tables = {} as Record<SkillDomain, RoutingTable | null>;
    for (const domain of domains) {
      const file = path.join(this.routingDir, `${domain}.json`);
      if (!fs.existsSync(file)) {
        tables[domain] = null;
        continue;
      }
      try {
        tables[domain] = JSON.parse(fs.readFileSync(file, "utf-8")) as RoutingTable;
      } catch {
        tables[domain] = null;
      }
    }
    return tables;
  }

  /** Read-only deterministic routing lookup (contracts/routing-table.md §5). */
  public route(hint: string, domain?: SkillDomain): RouteResult {
    return routeHint(hint, domain, this.loadRoutingTables());
  }

  public loadCatalog(): CatalogItem[] {
    if (!fs.existsSync(this.catalogPath)) {
      return [];
    }
    const raw = fs.readFileSync(this.catalogPath, "utf-8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as CatalogItem);
  }

  public search(
    query: string,
    domain?: "re" | "webapp" | "mobile" | "red",
    category?: string,
    requestedLimit: number = 10
  ): SkillSearchOutput {
    const limit = Math.min(Math.max(1, requestedLimit), 25);
    const catalog = this.loadCatalog();
    const queryTokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);

    const scored: Array<{ item: CatalogItem; score: number }> = [];

    for (const item of catalog) {
      if (domain && item.domain !== domain) continue;
      if (category && item.category !== category) continue;

      let score = 0;
      const lowerName = item.name.toLowerCase();
      const lowerDesc = item.description.toLowerCase();
      const lowerCat = item.category.toLowerCase();

      for (const token of queryTokens) {
        if (lowerName.includes(token)) score += 3;
        if (lowerDesc.includes(token)) score += 1;
        if (lowerCat.includes(token)) score += 2;
      }

      if (score > 0) {
        scored.push({ item, score });
      }
    }

    // Sort score desc, then name asc
    scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

    const totalMatches = scored.length;
    if (totalMatches === 0) {
      return {
        total_matches: 0,
        returned: 0,
        limit,
        results: [],
        note: "NO_RELEVANT_GUIDANCE: Task requirements do not match existing playbooks. Do NOT force-fit unrelated guidance. Follow Anti-Force-Fitting Protocol: conduct external methodology research and propose a new playbook.",
      };
    }

    const results = scored.slice(0, limit).map((s) => ({
      name: s.item.name,
      domain: s.item.domain,
      category: s.item.category,
      description: s.item.description,
      sha256: s.item.sha256,
    }));

    return {
      total_matches: totalMatches,
      returned: results.length,
      limit,
      results,
    };
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

  public load(name: string): SkillLoadOutput {
    const skillPath = path.join(this.skillsDir, name, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      return { error: "SKILL_NOT_FOUND", name };
    }

    const raw = fs.readFileSync(skillPath, "utf-8");
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
    const skillDir = path.join(this.skillsDir, skillName);
    if (!fs.existsSync(skillDir)) {
      throw new Error(`Skill '${skillName}' not found`);
    }
    const cleanSubpath = assetPath.replace(/^(\.\/|\/)+/, "");
    const targetPath = path.resolve(skillDir, cleanSubpath);
    if (!targetPath.startsWith(skillDir)) {
      throw new Error(`Path traversal denied: '${assetPath}' escapes skill directory`);
    }
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Asset '${cleanSubpath}' not found in skill '${skillName}'`);
    }
    const bounded = safeReadBoundedFile(targetPath);
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

  registerTool(pi, {
    name: "skill_search",
    description: "Search machine-readable skill catalog index for relevant security playbooks.",
    parameters: {
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
    parameters: {
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
    parameters: {
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
    parameters: {
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
    parameters: {
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
