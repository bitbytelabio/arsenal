/**
 * tools/generate-routers.ts
 * Generates the four Tier-1 domain routers from presets/<domain>/routing.json.
 *
 * contracts/routing-table.md §2: every router body MUST be derived from the
 * routing table; hardcoded router prose is prohibited. §4 fixes the body shape
 * (frontmatter from the table, fixed per-domain guidance, fixed retrieval-tool
 * lines, one line per declared category in priority order).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  DOMAINS,
  loadRoutingTable,
  renderRouterBody,
  type SkillDomain,
} from "../src/core/skill-routing.ts";

export function generateRouters(outSkillsDir: string, repoRoot = "."): SkillDomain[] {
  const written: SkillDomain[] = [];
  for (const domain of DOMAINS) {
    const table = loadRoutingTable(domain, repoRoot);
    if (!table) {
      throw new Error(
        `Missing routing table 'presets/${domain}/routing.json'; cannot generate arsenal-${domain}-router.`
      );
    }
    const dir = path.join(outSkillsDir, `arsenal-${domain}-router`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), renderRouterBody(table), "utf-8");
    written.push(domain);
  }
  return written;
}
