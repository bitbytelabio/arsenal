import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { handleVerifyOracle } from "../plugin/tools/verify-oracle.ts";

export interface BenchmarkScenario {
  id: string;
  title: string;
  domain: string;
  category: string;
  groundTruth: "vulnerable" | "benign";
  context: Record<string, unknown>;
  expectedFinding?: { cwe?: string; severity?: string };
  oracleCheck: {
    oracle_type: string;
    parameters: Record<string, unknown>;
  };
}

export interface EvaluationReport {
  benchmarkVersion: string;
  evaluatedAt: string;
  totalScenarios: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
}

describe("Arsenal-Bench: Empirical Evaluation Suite (US7)", () => {
  const scenariosPath = path.resolve("tests/fixtures/benchmark/scenarios.json");

  it("evaluates benchmark scenarios with precision and recall >= 0.90", async () => {
    expect(fs.existsSync(scenariosPath)).toBe(true);

    const raw = fs.readFileSync(scenariosPath, "utf-8");
    const scenarios = JSON.parse(raw) as BenchmarkScenario[];

    expect(scenarios.length).toBeGreaterThanOrEqual(10);

    let truePositives = 0;
    let falsePositives = 0;
    let trueNegatives = 0;
    let falseNegatives = 0;

    for (const scenario of scenarios) {
      const oracleRes = await handleVerifyOracle(scenario.oracleCheck);

      const predicted = oracleRes.outcome === "validated" ? "vulnerable" : "benign";

      if (scenario.groundTruth === "vulnerable") {
        if (predicted === "vulnerable") {
          truePositives++;
        } else {
          falseNegatives++;
        }
      } else {
        if (predicted === "benign") {
          trueNegatives++;
        } else {
          falsePositives++;
        }
      }
    }

    const precision = truePositives / (truePositives + falsePositives || 1);
    const recall = truePositives / (truePositives + falseNegatives || 1);
    const f1Score =
      precision + recall > 0 ? (2 * (precision * recall)) / (precision + recall) : 0;

    const report: EvaluationReport = {
      benchmarkVersion: "1.0.0",
      evaluatedAt: new Date().toISOString(),
      totalScenarios: scenarios.length,
      truePositives,
      falsePositives,
      trueNegatives,
      falseNegatives,
      precision,
      recall,
      f1Score,
    };

    expect(report.totalScenarios).toBe(10);
    expect(report.falsePositives).toBe(0);
    expect(report.falseNegatives).toBe(0);
    expect(report.precision).toBe(1.0);
    expect(report.recall).toBe(1.0);
    expect(report.f1Score).toBe(1.0);
  });
});
