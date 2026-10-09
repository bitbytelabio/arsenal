/**
 * tests/us6-routing.test.ts
 * Routing accuracy benchmark test verifying >= 48/50 correct matches per SC-006
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

interface BenchmarkTask {
  id: string;
  domain: string;
  task: string;
  expected: string;
}

interface RouteRule {
  id: string;
  leaf: string;
  must: string;
}

interface DomainRouting {
  priority: string[];
  routes: Record<string, RouteRule>;
}

function routeTask(taskText: string, domain: string): string | null {
  const routingFile = path.resolve(`presets/${domain}/routing.json`);
  if (!fs.existsSync(routingFile)) return null;

  const routing = JSON.parse(fs.readFileSync(routingFile, "utf-8")) as DomainRouting;

  // Evaluate in priority order
  for (const routeId of routing.priority) {
    const route = routing.routes[routeId];
    if (!route) continue;

    const regex = new RegExp(route.must, "i");
    if (regex.test(taskText)) {
      return route.leaf;
    }
  }

  return null;
}

describe("User Story 6: Routing Accuracy Benchmark (SC-006)", () => {
  it("evaluates 50 benchmark tasks and achieves >= 48/50 accuracy", () => {
    const benchmarkPath = path.resolve("tests/routing-benchmark.json");
    const tasks = JSON.parse(fs.readFileSync(benchmarkPath, "utf-8")) as BenchmarkTask[];

    expect(tasks.length).toBe(50);

    let correctCount = 0;
    const failures: Array<{ id: string; task: string; expected: string; matched: string | null }> = [];

    for (const t of tasks) {
      const matchedLeaf = routeTask(t.task, t.domain);
      if (matchedLeaf === t.expected) {
        correctCount++;
      } else {
        failures.push({
          id: t.id,
          task: t.task,
          expected: t.expected,
          matched: matchedLeaf,
        });
      }
    }

    if (failures.length > 0) {
      console.warn(`Routing failures (${failures.length}/50):`, JSON.stringify(failures, null, 2));
    }

    console.log(`Routing benchmark score: ${correctCount} / 50 (${(correctCount / 50) * 100}%)`);
    expect(correctCount).toBeGreaterThanOrEqual(48); // Requirement: >= 48/50 (96%)
  });
});
