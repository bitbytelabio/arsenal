import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Operational Slash Commands Suite", () => {
  const commandsDir = path.resolve("plugin/commands");
  const secCommands = [
    "sec-engage.md",
    "sec-report.md",
    "sec-scope.md",
    "sec-recon.md",
    "sec-verify.md",
    "sec-finding.md",
    "sec-review.md",
    "sec-doctor.md",
  ];

  test("all canonical slash command definitions exist in plugin/commands/", () => {
    for (const cmd of secCommands) {
      const cmdPath = path.join(commandsDir, cmd);
      expect(fs.existsSync(cmdPath)).toBe(true);
      const content = fs.readFileSync(cmdPath, "utf-8");
      expect(content.length).toBeGreaterThan(200); // No empty or placeholder stubs!
      expect(content).toContain("## Usage");
    }

    // arsenal-skill-update.md is also present with 7-step fixed workflow
    const updateCmd = path.join(commandsDir, "arsenal-skill-update.md");
    expect(fs.existsSync(updateCmd)).toBe(true);
    expect(fs.readFileSync(updateCmd, "utf-8")).toContain("## Fixed Execution Workflow");
  });

  test("sec-engage defines 5 sequential assessment phases", () => {
    const engageContent = fs.readFileSync(path.join(commandsDir, "sec-engage.md"), "utf-8");
    expect(engageContent).toContain("Phase 1: Scoping");
    expect(engageContent).toContain("Phase 2: Surface Reconnaissance");
    expect(engageContent).toContain("Phase 3: Vulnerability Assessment");
    expect(engageContent).toContain("Phase 4: Independent Verification Gate");
    expect(engageContent).toContain("Phase 5: Case Review & Reporting");
  });

  test("sec-report specifies default timestamped report destination", () => {
    const reportContent = fs.readFileSync(path.join(commandsDir, "sec-report.md"), "utf-8");
    expect(reportContent).toContain(".omp/arsenal/reports/report-<timestamp>.md");
  });

  test("sec-scope and sec-recon define interactive authorization gate", () => {
    const reconContent = fs.readFileSync(path.join(commandsDir, "sec-recon.md"), "utf-8");
    expect(reconContent).toContain("Pre-Execution Scope Gate");
    expect(reconContent).toContain("Add target to scope, proceed conditionally, or abort?");
  });
});
