/**
 * tests/us3-roles.test.ts
 * Independent acceptance test for User Story 3: Domain Work Through Explicit Roles
 */

import { describe, expect, it } from "bun:test";
import { isValidRole, validateRoleSpawn } from "../src/core/roles.ts";
import { clusterEndpoints, isExcludedAsset } from "../src/core/assessment-prep.ts";
import { SkillCatalogManager } from "../plugin/extensions/routing.ts";
import * as fs from "node:fs";
import * as path from "node:path";

describe("User Story 3: Roles, Dispatch, and Guidance Discovery", () => {
  it("enforces exactly 6 canonical roles and validates master spawns", () => {
    expect(isValidRole("master")).toBe(true);
    expect(isValidRole("sec-re")).toBe(true);
    expect(isValidRole("sec-webapp")).toBe(true);
    expect(isValidRole("sec-mobile")).toBe(true);
    expect(isValidRole("sec-red")).toBe(true);
    expect(isValidRole("sec-verifier")).toBe(true);
    expect(isValidRole("random-agent")).toBe(false);

    // Master spawning specialists is allowed
    const spawnRe = validateRoleSpawn("master", "sec-re");
    expect(spawnRe.allowed).toBe(true);

    const spawnVer = validateRoleSpawn("master", "sec-verifier");
    expect(spawnVer.allowed).toBe(true);

    // Specialists spawning children is denied (no recursive delegation)
    const recSpawn = validateRoleSpawn("sec-re", "sec-webapp");
    expect(recSpawn.allowed).toBe(false);
    expect(recSpawn.reason).toContain("declares spawns: []");
  });

  it("filters excluded assets and clusters endpoints <= 10", () => {
    expect(isExcludedAsset("node_modules/express/index.js")).toBe(true);
    expect(isExcludedAsset("dist/bundle.min.js")).toBe(true);
    expect(isExcludedAsset("src/controllers/user.ts")).toBe(false);

    const endpoints: string[] = [];
    for (let i = 1; i <= 25; i++) {
      endpoints.push(`/api/v1/resource/${i}`);
    }
    endpoints.push("/api/v1/auth/login"); // High-risk auth

    const clusters = clusterEndpoints(endpoints, 10);
    expect(clusters.length).toBe(3); // 26 items in groups of 10 -> 3 clusters
    for (const c of clusters) {
      expect(c.endpoints.length).toBeLessThanOrEqual(10);
    }

    const authCluster = clusters.find((c) => c.endpoints.includes("/api/v1/auth/login"));
    expect(authCluster).toBeDefined();
    expect(authCluster!.requiresThreatChecklist).toBe(true);
  });

  it("exercises skill_search, skill_list, and skill_load via SkillCatalogManager", () => {
    const manager = new SkillCatalogManager(process.cwd());

    // Search
    const searchRes = manager.search("reverse engineering triage", "re");
    expect(searchRes.total_matches).toBeGreaterThan(0);
    expect(searchRes.results.length).toBeGreaterThan(0);

    // Anti-force-fitting protocol when 0 matches
    const zeroMatch = manager.search("nonexistent-quantum-crypto-teleportation-methodology-xyz");
    expect(zeroMatch.total_matches).toBe(0);
    expect(zeroMatch.note).toContain("NO_RELEVANT_GUIDANCE");

    // List
    const listRes = manager.list("re", undefined, 0, 5);
    expect(listRes.skills.length).toBeGreaterThan(0);
    expect(listRes.skills.length).toBeLessThanOrEqual(5);

    // Load with integrity check
    const firstSkill = listRes.skills[0]!;
    const loadRes = manager.load(firstSkill.name);
    expect(loadRes.error).toBeUndefined();
    expect(loadRes.content).toBeDefined();
    expect(loadRes.sha256).toBe(firstSkill.sha256);
  });
});
