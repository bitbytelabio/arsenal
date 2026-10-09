/**
 * Output Bounding Runtime Extension
 * Implements contracts/runtime.md §2.3 & contracts/evidence-reporting.md §1.1
 * Hooks tool_result post-execution middleware to bound output and spill raw bytes.
 */

import * as path from "node:path";
import { boundAndStore } from "../../src/core/bounding.ts";

export interface ToolResultEvent {
  toolName: string;
  toolCallId: string;
  content: Array<{ type: string; text?: string; data?: unknown }>;
  details?: unknown;
  isError?: boolean;
  input?: Record<string, unknown>;
}

export interface ExtensionContext {
  on: (
    event: "tool_result",
    handler: (event: ToolResultEvent, ctx: unknown) => Promise<{ content?: unknown } | void>
  ) => void;
}

export default function boundingExtension(pi: ExtensionContext): void {
  pi.on("tool_result", async (event: ToolResultEvent) => {
    // If tool produced text content, evaluate bounding
    if (!event.content || event.content.length === 0) return;

    const evidenceDir = path.resolve(process.cwd(), "evidence");
    let transformed = false;

    const newContent = event.content.map((block) => {
      if (block.type === "text" && typeof block.text === "string") {
        const boundRes = boundAndStore(block.text, evidenceDir);
        if (boundRes.bounded) {
          transformed = true;
          return {
            ...block,
            text: boundRes.content,
          };
        }
      }
      return block;
    });

    if (transformed) {
      return { content: newContent };
    }
  });
}
