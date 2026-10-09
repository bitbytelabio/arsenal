/**
 * Five Pinned Source Corpus Adapters & Normalization Engine
 * Implements contracts/guidance-distribution.md §2 & T072
 */

export interface SourcePoolMetadata {
  name: string;
  revision: string;
  license: string;
  sourceDir: string;
}

export const PINNED_SOURCES: Record<string, SourcePoolMetadata> = {
  "reverse-skill": {
    name: "reverse-skill",
    revision: "cab634bd855fc287f6e420c1f36fd1a6b9245960",
    license: "MIT",
    sourceDir: "vendor/reverse-skill/skills",
  },
  xalgorix: {
    name: "xalgorix",
    revision: "911ac7310ba3666c1e5efc0abcb5327d1fc71be4",
    license: "Apache-2.0",
    sourceDir: "upstream/xalgorix/internal/tools/skills/data",
  },
  "claude-red": {
    name: "claude-red",
    revision: "739512a8588b28ff3b554e669391c22508602878",
    license: "MIT",
    sourceDir: "upstream/claude-red/Skills",
  },
  strix: {
    name: "strix",
    revision: "f1386cad37964197a483ff43c25161f9d933f050",
    license: "Apache-2.0",
    sourceDir: "upstream/strix/skills",
  },
  "Anthropic-Cybersecurity-Skills": {
    name: "Anthropic-Cybersecurity-Skills",
    revision: "54a798831d2266a3ca61ce68a7acb80b81160d57",
    license: "Apache-2.0",
    sourceDir: "upstream/Anthropic-Cybersecurity-Skills/skills",
  },
};

export function formatCanonicalSkillName(domain: string, source: string, slug: string): string {
  const normSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  const base = `${domain}-${source}-${normSlug}`;
  if (base.length > 64) {
    return base.substring(0, 64).replace(/-+$/, "");
  }
  return base;
}
