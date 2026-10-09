/**
 * arsenal plugin pack module
 * Re-exports plugin pack logic
 */

import type { CommandContext } from "./router.ts";
import { handlePlugin } from "./plugin.ts";

export async function handlePluginPack(ctx: CommandContext): Promise<number> {
  return handlePlugin({ ...ctx, subCommand: "pack" });
}
