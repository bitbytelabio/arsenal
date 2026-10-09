// @bun
// plugin/extensions/budget.ts
class BudgetTracker {
  budgetUsd = null;
  totalSpendUsd = 0;
  totalUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  warnedBands = {};
  constructor(budgetUsd) {
    if (budgetUsd && budgetUsd > 0) {
      this.budgetUsd = budgetUsd;
    }
  }
  recordTurnSpend(usage, costRate) {
    const rate = costRate ?? {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75
    };
    const costInput = usage.input * rate.input / 1e6;
    const costOutput = usage.output * rate.output / 1e6;
    const costCacheRead = usage.cacheRead * rate.cacheRead / 1e6;
    const costCacheWrite = usage.cacheWrite * rate.cacheWrite / 1e6;
    const increment = costInput + costOutput + costCacheRead + costCacheWrite;
    this.totalSpendUsd += increment;
    this.totalUsage.input += usage.input;
    this.totalUsage.output += usage.output;
    this.totalUsage.cacheRead += usage.cacheRead;
    this.totalUsage.cacheWrite += usage.cacheWrite;
    let warning;
    if (this.budgetUsd && this.budgetUsd > 0) {
      const percentage = this.totalSpendUsd / this.budgetUsd * 100;
      if (percentage >= 95 && !this.warnedBands[95]) {
        this.warnedBands[95] = true;
        warning = {
          threshold: 95,
          level: "CRITICAL",
          message: `CRITICAL BUDGET NOTICE: Spent $${this.totalSpendUsd.toFixed(4)} of $${this.budgetUsd.toFixed(2)} allowance (>=95%). Cease non-essential tasks immediately.`
        };
      } else if (percentage >= 85 && !this.warnedBands[85]) {
        this.warnedBands[85] = true;
        warning = {
          threshold: 85,
          level: "URGENT",
          message: `URGENT BUDGET NOTICE: Spent $${this.totalSpendUsd.toFixed(4)} of $${this.budgetUsd.toFixed(2)} allowance (>=85%).`
        };
      } else if (percentage >= 70 && !this.warnedBands[70]) {
        this.warnedBands[70] = true;
        warning = {
          threshold: 70,
          level: "NOTICE",
          message: `BUDGET NOTICE: Spent $${this.totalSpendUsd.toFixed(4)} of $${this.budgetUsd.toFixed(2)} allowance (>=70%).`
        };
      }
    }
    return {
      spendIncrement: increment,
      newTotal: this.totalSpendUsd,
      warning
    };
  }
  shouldBlockExploratorySpawn(agentName) {
    if (!this.budgetUsd || this.budgetUsd <= 0) {
      return {};
    }
    const percentage = this.totalSpendUsd / this.budgetUsd * 100;
    if (percentage >= 90) {
      if (agentName === "sec-verifier" || agentName === "master") {
        return {
          note: `Budget reserve active (${percentage.toFixed(1)}% spend). Prioritizing verifier task.`
        };
      }
      return {
        block: true,
        reason: `Subagent budget reserve active (>=90% spend). Exploratory spawns declined; sec-verifier and master reporting prioritized.`
      };
    }
    return {};
  }
}
var globalBudgetTracker = new BudgetTracker;
function budgetExtension(pi) {
  pi.on("turn_end", async (rawEvent, rawCtx) => {
    const event = rawEvent;
    const ctx = rawCtx;
    if (ctx.agent?.kind === "sub" && ctx.agent.name === "sec-verifier") {
      if (event.turnIndex >= 7) {
        ctx.ui.notify("sec-verifier reached maximum 8-turn budget. Terminating child session.", "warn");
        ctx.abort();
        return;
      }
    }
    const usage = event.message?.usage;
    if (usage) {
      const res = globalBudgetTracker.recordTurnSpend(usage, ctx.model?.cost);
      if (res.warning) {
        ctx.ui.notify(res.warning.message, res.warning.level === "CRITICAL" ? "error" : "warn");
      }
    }
  });
  pi.on("before_subagent_spawn", async (rawEvent) => {
    const event = rawEvent;
    return globalBudgetTracker.shouldBlockExploratorySpawn(event.agent);
  });
}
export {
  BudgetTracker,
  budgetExtension as default,
  globalBudgetTracker
};
