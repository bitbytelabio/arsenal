/**
 * arsenal plugin link module
 * Re-exports plugin link logic
 */

import type { CommandContext } from "./router.ts";
import { handlePlugin } from "./plugin.ts";

export async function handlePluginLink(ctx: CommandContext): Promise<number> {
  return handlePlugin({ ...ctx, subCommand: "link" });
}
