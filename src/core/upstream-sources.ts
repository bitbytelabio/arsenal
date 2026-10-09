/**
 * src/core/upstream-sources.ts
 *
 * Central configuration and dynamic resolution of upstream source repositories.
 * Avoids hardcoding revisions in individual ingestion steps and supports
 * lockfile overrides (upstream/arsenal-upstreams.json) and live git detection.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface UpstreamSource {
  id: string;
  repo: string;
  url: string;
  revision: string;
  license: string;
  sourceRoot: string;
}

export const UPSTREAM_SOURCES: readonly UpstreamSource[] = Object.freeze([
  {
    id: "reverse-skill",
    repo: "zhaoxuya520/reverse-skill",
    url: "https://github.com/zhaoxuya520/reverse-skill.git",
    revision: "cab634bd855fc287f6e420c1f36fd1a6b9245960",
    license: "MIT",
    sourceRoot: "skills",
  },
  {
    id: "xalgorix",
    repo: "xalgorix",
    url: "https://github.com/xalgorix/xalgorix.git",
    revision: "911ac7310ba3666c1e5efc0abcb5327d1fc71be4",
    license: "Apache-2.0",
    sourceRoot: "internal/tools/skills/data",
  },
  {
    id: "claude-red",
    repo: "claude-red",
    url: "https://github.com/SnailSploit/claude-red.git",
    revision: "739512a8588b28ff3b554e669391c22508602878",
    license: "MIT",
    sourceRoot: "Skills",
  },
  {
    id: "strix",
    repo: "strix",
    url: "https://github.com/usestrix/strix.git",
    revision: "f1386cad37964197a483ff43c25161f9d933f050",
    license: "Apache-2.0",
    sourceRoot: "skills",
  },
  {
    id: "Anthropic-Cybersecurity-Skills",
    repo: "Anthropic-Cybersecurity-Skills",
    url: "https://github.com/mukul975/Anthropic-Cybersecurity-Skills.git",
    revision: "54a798831d2266a3ca61ce68a7acb80b81160d57",
    license: "Apache-2.0",
    sourceRoot: "skills",
  },
]);

export interface UpstreamSourceConfig {
  repo: string;
  rev: string;
  license: string;
  upstreamDir: string;
  skillsSubdir: string;
  url?: string;
}

export const DEFAULT_UPSTREAM_SOURCES: Readonly<Record<string, UpstreamSourceConfig>> = Object.freeze({
  "reverse-skill": {
    repo: "zhaoxuya520/reverse-skill",
    rev: "cab634bd855fc287f6e420c1f36fd1a6b9245960",
    license: "MIT",
    upstreamDir: "upstream/reverse-skill",
    skillsSubdir: "skills",
    url: "https://github.com/zhaoxuya520/reverse-skill.git",
  },
  "xalgorix": {
    repo: "xalgorix",
    rev: "911ac7310ba3666c1e5efc0abcb5327d1fc71be4",
    license: "Apache-2.0",
    upstreamDir: "upstream/xalgorix",
    skillsSubdir: "internal/tools/skills/data",
    url: "https://github.com/xalgorix/xalgorix.git",
  },
  "claude-red": {
    repo: "claude-red",
    rev: "739512a8588b28ff3b554e669391c22508602878",
    license: "MIT",
    upstreamDir: "upstream/claude-red",
    skillsSubdir: "Skills",
    url: "https://github.com/SnailSploit/claude-red.git",
  },
  "strix": {
    repo: "strix",
    rev: "f1386cad37964197a483ff43c25161f9d933f050",
    license: "Apache-2.0",
    upstreamDir: "upstream/strix",
    skillsSubdir: "skills",
    url: "https://github.com/usestrix/strix.git",
  },
  "Anthropic-Cybersecurity-Skills": {
    repo: "Anthropic-Cybersecurity-Skills",
    rev: "54a798831d2266a3ca61ce68a7acb80b81160d57",
    license: "Apache-2.0",
    upstreamDir: "upstream/Anthropic-Cybersecurity-Skills",
    skillsSubdir: "skills",
    url: "https://github.com/mukul975/Anthropic-Cybersecurity-Skills.git",
  },
});

/**
 * Loads upstream source configurations, merging defaults with
 * upstream/arsenal-upstreams.json lockfile and local git state.
 */
export function loadUpstreamSources(repoRoot = "."): Record<string, UpstreamSourceConfig> {
  const sources: Record<string, UpstreamSourceConfig> = {};

  for (const [key, def] of Object.entries(DEFAULT_UPSTREAM_SOURCES)) {
    sources[key] = { ...def };
  }

  // Check lockfile paths
  const lockCandidates = [
    path.resolve(repoRoot, "upstream/arsenal-upstreams.json"),
    path.resolve(repoRoot, "arsenal-upstreams.json"),
  ];

  for (const lockPath of lockCandidates) {
    if (fs.existsSync(lockPath)) {
      try {
        const raw = fs.readFileSync(lockPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, Partial<UpstreamSourceConfig>>;
        for (const [key, override] of Object.entries(parsed)) {
          if (sources[key]) {
            sources[key] = {
              ...sources[key],
              ...override,
            };
          } else if (override.repo && override.rev && override.license && override.upstreamDir && override.skillsSubdir) {
            sources[key] = override as UpstreamSourceConfig;
          }
        }
      } catch {
        // Fall back to defaults on parse error
      }
      break;
    }
  }
  return sources;
}
