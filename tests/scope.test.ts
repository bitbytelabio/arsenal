/**
 * tests/scope.test.ts
 * Behavioral test for scope parser and attribution engine
 */

import { describe, expect, it } from "bun:test";
import { attributeTarget, parseScope, resolveActiveScope } from "../src/core/scope.ts";
import type { ScopeDocument } from "../src/core/scope.ts";
import ledgerExtension from "../plugin/extensions/ledger.ts";
import * as fs from "node:fs";
import * as path from "node:path";
describe("Scope Parser & Attribution Engine", () => {
  const sampleScope: ScopeDocument = {
    schema_version: 1,
    engagement_id: "ENG-2026-TEST",
    name: "Target Testing",
    created_at: "2026-10-08T00:00:00.000Z",
    domain: "webapp",
    auth: {
      status: "granted",
      basis: "Engagement Letter",
      reference: "EL-2026",
      ready_for_act: true,
    },
    in_scope: ["https://api.target.com/*", "*.app.target.com"],
    out_of_scope: ["https://api.target.com/admin/*", "billing.app.target.com"],
    disallowed_actions: ["dos"],
    window: {
      start: "2026-10-08T00:00:00.000Z",
      end: "2026-10-09T00:00:00.000Z",
      timezone: "UTC",
    },
    budget_usd: "50.00",
  };

  it("parses valid scope and checks window ordering", () => {
    const doc = parseScope(JSON.stringify(sampleScope));
    expect(doc.engagement_id).toBe("ENG-2026-TEST");
  });

  it("rejects inverted window (start >= end)", () => {
    const invalidWindow = {
      ...sampleScope,
      window: {
        start: "2026-10-09T00:00:00.000Z",
        end: "2026-10-08T00:00:00.000Z",
        timezone: "UTC",
      },
    };
    expect(() => parseScope(JSON.stringify(invalidWindow))).toThrow(
      "start time must precede end time"
    );
  });

  it("correctly attributes in-scope target", () => {
    const attr = attributeTarget("https://api.target.com/v1/users", sampleScope);
    expect(attr.status).toBe("in_scope");
    expect(attr.matchingSelector).toBe("https://api.target.com/*");
  });

  it("correctly prioritizes out-of-scope exclusion over inclusion", () => {
    const attr = attributeTarget("https://api.target.com/admin/delete", sampleScope);
    expect(attr.status).toBe("out_of_scope");
    expect(attr.matchingSelector).toBe("https://api.target.com/admin/*");
  });

  it("reports unknown when target does not match any selectors", () => {
    const attr = attributeTarget("https://other.com", sampleScope);
    expect(attr.status).toBe("unknown");
  });

  it("reports unknown when in_scope is empty", () => {
    const emptyInScope: ScopeDocument = { ...sampleScope, in_scope: [] };
    const attr = attributeTarget("https://api.target.com/v1/users", emptyInScope);
    expect(attr.status).toBe("unknown");
    expect(attr.reason).toContain("empty inclusion is incomplete scope");
  });

  it("resolves active scope from .omp/scope.json and attributes target (T019)", async () => {
    const testWorkspace = path.resolve("tests/fixtures/scope-test-ws");
    fs.rmSync(testWorkspace, { recursive: true, force: true });
    fs.mkdirSync(path.join(testWorkspace, ".omp"), { recursive: true });

    const scopePath = path.join(testWorkspace, ".omp/scope.json");
    fs.writeFileSync(scopePath, JSON.stringify(sampleScope, null, 2), "utf-8");

    const resolution = resolveActiveScope(testWorkspace);
    expect(resolution.scope).not.toBeNull();
    expect(resolution.scopeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(resolution.scopeSha256).not.toBe("0".repeat(64));

    const inScopeAttr = attributeTarget("https://api.target.com/v1/users", resolution.scope!);
    expect(inScopeAttr.status).toBe("in_scope");

    const outScopeAttr = attributeTarget("https://api.target.com/admin/settings", resolution.scope!);
    expect(outScopeAttr.status).toBe("out_of_scope");

    const unkAttr = attributeTarget("https://unauthorized.internal.net", resolution.scope!);
    expect(unkAttr.status).toBe("unknown");

    fs.rmSync(testWorkspace, { recursive: true, force: true });
  });

  it("returns null scope and sha when no scope file exists (T019)", () => {
    const emptyWorkspace = path.resolve("tests/fixtures/scope-empty-ws");
    fs.rmSync(emptyWorkspace, { recursive: true, force: true });
    fs.mkdirSync(emptyWorkspace, { recursive: true });

    const resolution = resolveActiveScope(emptyWorkspace);
    expect(resolution.scope).toBeNull();
    expect(resolution.scopeSha256).toBeNull();

    fs.rmSync(emptyWorkspace, { recursive: true, force: true });
  });

  it("records authentic scope attribution through ledgerExtension (T020/T021)", async () => {
    const testWs = path.resolve("tests/fixtures/scope-ledger-ws");
    fs.rmSync(testWs, { recursive: true, force: true });
    fs.mkdirSync(path.join(testWs, ".omp"), { recursive: true });

    const scopeContent = JSON.stringify({
      ...sampleScope,
      in_scope: ["api.example.com", "https://api.target.com/*"],
    });
    fs.writeFileSync(path.join(testWs, ".omp/scope.json"), scopeContent, "utf-8");

    // Mock pi event emitter
    let toolResultHandler: ((evt: unknown, ctx: unknown) => Promise<unknown>) | null = null;
    const mockPi = {
      on: (event: string, handler: (evt: unknown, ctx: unknown) => Promise<unknown> | unknown) => {
        if (event === "tool_result") {
          toolResultHandler = handler as (evt: unknown, ctx: unknown) => Promise<unknown>;
        }
      },
    };

    // Change cwd temporarily to testWs for ledgerExtension
    const origCwd = process.cwd();
    process.chdir(testWs);

    try {
      ledgerExtension(mockPi);
      expect(toolResultHandler).not.toBeNull();

      await toolResultHandler!(
        {
          toolName: "evidence_exec",
          toolCallId: "call-123",
          content: [{ type: "text", text: "sample observation" }],
          input: { url: "https://api.example.com/v1/users" },
        },
        { agent: { name: "sec-webapp", id: "agent-1" } }
      );

      const ledgerPath = path.join(testWs, "evidence/ledger.jsonl");
      expect(fs.existsSync(ledgerPath)).toBe(true);
      const lines = fs.readFileSync(ledgerPath, "utf-8").trim().split("\n");
      expect(lines.length).toBe(1);

      const record = JSON.parse(lines[0]!);
      expect(record.data.scope_attribution).toBe("in_scope");
      expect(record.data.scope_revision_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(record.data.scope_revision_sha256).not.toBe("0".repeat(64));
    } finally {
      process.chdir(origCwd);
      fs.rmSync(testWs, { recursive: true, force: true });
    }
  });
});
