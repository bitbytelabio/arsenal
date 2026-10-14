/**
 * Financial Budget & Spend Governor Extension
 * Implements contracts/runtime.md §2.1, §2.2, §2.4 & T067, T068, T069
 */

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCostRate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface TurnEndEvent {
  turnIndex: number;
  message?: {
    role?: string;
    content?: Array<{ type: string; text?: string; data?: unknown }> | string;
    usage?: TokenUsage;
  };
}

/**
 * Token usage estimation fallback when the provider omits usage reporting
 * (e.g. offline models, non-conforming OpenAI proxies).
 */
export function estimateTokenUsageFromContent(content: unknown): TokenUsage | null {
  if (!content) return null;
  let textLength = 0;
  if (typeof content === "string") {
    textLength = content.length;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
        textLength += block.text.length;
      }
    }
  }
  if (textLength <= 0) return null;
  const estimatedTokens = Math.ceil(textLength / 4);
  return {
    input: 0,
    output: estimatedTokens,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

export interface SpawnEvent {
  agent: string;
  invocationKind?: string;
  modelRole?: string;
  patterns?: string[];
}

export interface SpawnResult {
  model?: string | string[];
  block?: boolean;
  reason?: string;
  note?: string;
}

export interface ExtensionContext {
  agent: {
    kind: "main" | "sub";
    name: string;
    id: string;
  };
  model?: {
    cost?: ModelCostRate;
  };
  ui: {
    notify: (message: string, level: "info" | "warn" | "error") => void;
  };
  abort: () => void;
}

export class BudgetTracker {
  public budgetUsd: number | null = null;
  public totalSpendUsd: number = 0;
  public totalUsage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  public warnedBands: Record<number, true> = {};

  constructor(budgetUsd?: number | null) {
    if (budgetUsd && budgetUsd > 0) {
      this.budgetUsd = budgetUsd;
    }
  }

  public recordTurnSpend(usage: TokenUsage, costRate?: ModelCostRate): {
    spendIncrement: number;
    newTotal: number;
    warning?: { threshold: number; level: "NOTICE" | "URGENT" | "CRITICAL"; message: string };
  } {
    // 4-bucket cost calculation
    const rate = costRate ?? {
      input: 3.0, // Default fallback $3 / 1M tokens
      output: 15.0,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    };

    const costInput = (usage.input * rate.input) / 1000000;
    const costOutput = (usage.output * rate.output) / 1000000;
    const costCacheRead = (usage.cacheRead * rate.cacheRead) / 1000000;
    const costCacheWrite = (usage.cacheWrite * rate.cacheWrite) / 1000000;

    const increment = costInput + costOutput + costCacheRead + costCacheWrite;
    this.totalSpendUsd += increment;

    this.totalUsage.input += usage.input;
    this.totalUsage.output += usage.output;
    this.totalUsage.cacheRead += usage.cacheRead;
    this.totalUsage.cacheWrite += usage.cacheWrite;

    let warning: { threshold: number; level: "NOTICE" | "URGENT" | "CRITICAL"; message: string } | undefined;

    if (this.budgetUsd && this.budgetUsd > 0) {
      const percentage = (this.totalSpendUsd / this.budgetUsd) * 100;

      if (percentage >= 95 && !this.warnedBands[95]) {
        this.warnedBands[95] = true;
        warning = {
          threshold: 95,
          level: "CRITICAL",
          message: `CRITICAL BUDGET NOTICE: Spent $${this.totalSpendUsd.toFixed(4)} of $${this.budgetUsd.toFixed(2)} allowance (>=95%). Cease non-essential tasks immediately.`,
        };
      } else if (percentage >= 85 && !this.warnedBands[85]) {
        this.warnedBands[85] = true;
        warning = {
          threshold: 85,
          level: "URGENT",
          message: `URGENT BUDGET NOTICE: Spent $${this.totalSpendUsd.toFixed(4)} of $${this.budgetUsd.toFixed(2)} allowance (>=85%).`,
        };
      } else if (percentage >= 70 && !this.warnedBands[70]) {
        this.warnedBands[70] = true;
        warning = {
          threshold: 70,
          level: "NOTICE",
          message: `BUDGET NOTICE: Spent $${this.totalSpendUsd.toFixed(4)} of $${this.budgetUsd.toFixed(2)} allowance (>=70%).`,
        };
      }
    }

    return {
      spendIncrement: increment,
      newTotal: this.totalSpendUsd,
      warning,
    };
  }

  public shouldBlockExploratorySpawn(agentName: string): SpawnResult {
    if (!this.budgetUsd || this.budgetUsd <= 0) {
      return {};
    }

    const percentage = (this.totalSpendUsd / this.budgetUsd) * 100;
    if (percentage >= 90) {
      // Permit arsenal-verifier and master
      if (agentName === "arsenal-verifier" || agentName === "master") {
        return {
          note: `Budget reserve active (${percentage.toFixed(1)}% spend). Prioritizing verifier task.`,
        };
      }

      // Block exploratory specialists
      return {
        block: true,
        reason: `Subagent budget reserve active (>=90% spend). Exploratory spawns declined; arsenal-verifier and master reporting prioritized.`,
      };
    }

    return {};
  }
}

// Global process-wide budget tracker instance
export const globalBudgetTracker = new BudgetTracker();

export default function budgetExtension(pi: {
  on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) => void;
}): void {
  // 1. Accumulate spend on turn_end
  pi.on("turn_end", async (rawEvent: unknown, rawCtx: unknown) => {
    const event = rawEvent as TurnEndEvent;
    const ctx = rawCtx as ExtensionContext;

    // Check verifier turn limit (8 turns strictly enforced: turnIndex >= 7)
    if (ctx.agent?.kind === "sub" && ctx.agent.name === "arsenal-verifier") {
      if (event.turnIndex >= 7) {
        ctx.ui.notify(
          "arsenal-verifier reached maximum 8-turn budget. Terminating child session.",
          "warn"
        );
        ctx.abort();
        return;
      }
    }

    const usage = event.message?.usage ?? estimateTokenUsageFromContent(event.message?.content);
    if (usage) {
      const res = globalBudgetTracker.recordTurnSpend(usage, ctx.model?.cost);
      if (res.warning) {
        ctx.ui.notify(res.warning.message, res.warning.level === "CRITICAL" ? "error" : "warn");
      }
    }
  });

  // 2. Intercept subagent spawns on before_subagent_spawn
  pi.on("before_subagent_spawn", async (rawEvent: unknown) => {
    const event = rawEvent as SpawnEvent;
    return globalBudgetTracker.shouldBlockExploratorySpawn(event.agent);
  });
}
