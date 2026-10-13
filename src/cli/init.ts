/**
 * arsenal init handler
 * Implements T018 & User Story 1
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import type { CommandContext } from "./router.ts";
import { safeWriteFile, safeMkdir } from "../core/fs-safe.ts";
import { sha256String } from "../core/hash.ts";
import { detectDrift } from "../core/drift.ts";
import { VERSION } from "../core/version.ts";

export async function handleInit(ctx: CommandContext): Promise<number> {
  const isCheck = Boolean(ctx.values.check);
  const isWrite = Boolean(ctx.values.write);
  const isForce = Boolean(ctx.values.force);
  const targetDir =
    ctx.subCommand && ctx.subCommand !== "check"
      ? path.resolve(ctx.subCommand)
      : ctx.positionals[0]
        ? path.resolve(ctx.positionals[0])
        : ctx.repoRoot;
  const preset = (ctx.values.preset as string | undefined)?.toLowerCase();
  const engagementName = (ctx.values.name as string | undefined) ?? path.basename(targetDir);

  const ompDir = path.join(targetDir, ".omp");
  const evidenceDir = path.join(targetDir, "evidence");
  const manifestPath = path.join(ompDir, "manifest.json");

  // Check mode: inspect existing scaffolding against manifest
  if (isCheck) {
    if (!fs.existsSync(manifestPath)) {
      const errorMsg = `No manifest found at '${manifestPath}'. Engagement not initialized.`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CHECK_FAILURE,
            "check",
            { clean: false },
            [],
            [errorMsg]
          )
        );
      } else {
        console.error(`Error: ${errorMsg}`);
      }
      return EXIT_CODES.CHECK_FAILURE;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
        files: Array<{ path: string; sha256: string }>;
      };
      const drift = detectDrift(targetDir, manifest.files);

      if (!drift.clean) {
        const errorList: string[] = [];
        if (drift.missingFiles.length > 0) {
          errorList.push(`Missing files: ${drift.missingFiles.join(", ")}`);
        }
        if (drift.modifiedFiles.length > 0) {
          errorList.push(`Modified files: ${drift.modifiedFiles.join(", ")}`);
        }

        if (ctx.isJson) {
          emitJson(
            createJsonEnvelope(
              ctx.rawArgs.join(" "),
              EXIT_CODES.CHECK_FAILURE,
              "check",
              { clean: false, drift },
              [],
              errorList
            )
          );
        } else {
          console.error(`[check failed] Engagement context drift detected:`);
          for (const err of errorList) {
            console.error(` - ${err}`);
          }
        }
        return EXIT_CODES.CHECK_FAILURE;
      }

      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.SUCCESS,
            "check",
            { clean: true, targetDir }
          )
        );
      } else {
        console.log(`[check passed] Scaffolding at '${targetDir}' is clean and unmodified.`);
      }
      return EXIT_CODES.SUCCESS;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.CHECK_FAILURE,
            "check",
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error reading manifest: ${msg}`);
      }
      return EXIT_CODES.CHECK_FAILURE;
    }
  }

  // Scaffolding mode: requires --preset
  if (!preset || !["re", "webapp", "mobile", "red"].includes(preset)) {
    const errorMsg = "Missing or invalid required flag: --preset <re|webapp|mobile|red>";
    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.CLI_USAGE_ERROR,
          ctx.mode,
          {},
          [],
          [errorMsg]
        )
      );
    } else {
      console.error(`Error: ${errorMsg}`);
    }
    return EXIT_CODES.CLI_USAGE_ERROR;
  }

  const engagementId = `ENG-2026-${engagementName.toUpperCase().replace(/[^A-Z0-9-]/g, "-")}`;
  const now = new Date().toISOString();

  // Template contents
  const charterContent = `# Security Engagement Charter: ${engagementName}
Engagement ID: ${engagementId}
Domain: ${preset}
Created: ${now}

## Rules of Engagement
1. All actions must remain within authorized scope defined in .omp/scope.json.
2. Direct observations require cryptographic evidence capture.
3. Exploitation actions strictly require granted authorization.
`;
  const charterSha256 = sha256String(charterContent);

  const engagementContent = JSON.stringify(
    {
      schema_version: 1,
      engagement_id: engagementId,
      name: engagementName,
      domain: preset,
      created_at: now,
      auth: {
        status: "incomplete",
        basis: null,
        reference: null,
        ready_for_act: false,
      },
      status: "prepared",
    },
    null,
    2
  );

  const scopeContent = JSON.stringify(
    {
      schema_version: 1,
      engagement_id: engagementId,
      name: engagementName,
      created_at: now,
      domain: preset,
      auth: {
        status: "incomplete",
        basis: null,
        reference: null,
        ready_for_act: false,
      },
      in_scope: [],
      out_of_scope: [],
      disallowed_actions: ["dos", "unauthorized_data_destruction"],
      window: {
        start: now,
        end: new Date(Date.now() + 86400000 * 7).toISOString(),
        timezone: "UTC",
      },
      environment_id: "env-local-1",
      charter_path: ".omp/charter.md",
      charter_sha256: charterSha256,
      budget_usd: null,
    },
    null,
    2
  );

  const environmentContent = JSON.stringify(
    {
      schema_version: 1,
      id: "env-local-1",
      kind: "local",
      name: "Default Local Environment",
      address: "127.0.0.1",
      access_method: "direct",
      working_root: targetDir,
      proxy_url: null,
      ca_path: null,
      browser_trust_path: null,
      tool_index_path: null,
      path_overrides: null,
      observed_at: now,
    },
    null,
    2
  );

  const evidenceGitignoreContent = `# Ignore raw evidence artifacts & SQLite coordination databases
raw/
*.txt
*.bin
*.sqlite
*.sqlite-wal
*.sqlite-shm
`;

  const plannedFiles: Array<{ relPath: string; content: string }> = [
    { relPath: ".omp/engagement.json", content: engagementContent },
    { relPath: ".omp/scope.json", content: scopeContent },
    { relPath: ".omp/environment.json", content: environmentContent },
    { relPath: ".omp/charter.md", content: charterContent },
    { relPath: "evidence/.gitignore", content: evidenceGitignoreContent },
  ];

  // Build manifest
  const manifestFiles = plannedFiles.map((f) => ({
    path: f.relPath,
    sha256: sha256String(f.content),
    bytes: Buffer.byteLength(f.content, "utf-8"),
  }));

  const manifestContent = JSON.stringify(
    {
      schema_version: 1,
      generator: `arsenal-init-v${VERSION}`,
      created_at: now,
      preset,
      engagement_id: engagementId,
      files: manifestFiles,
    },
    null,
    2
  );

  plannedFiles.push({ relPath: ".omp/manifest.json", content: manifestContent });

  // Execute or preview writes
  const fileResults: Array<{ path: string; action: string }> = [];
  let refused = false;

  for (const item of plannedFiles) {
    const fullPath = path.join(targetDir, item.relPath);
    const res = safeWriteFile(fullPath, item.content, {
      write: isWrite,
      force: isForce,
    });
    if (res.action === "refused") {
      refused = true;
    }
    fileResults.push({ path: item.relPath, action: res.action });
  }

  if (refused) {
    const errorMsg = "Files exist with conflicting content. Specify --force to overwrite with backup.";
    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.MUTATION_REFUSED,
          ctx.mode,
          { files: fileResults },
          [],
          [errorMsg]
        )
      );
    } else {
      console.error(`Error: ${errorMsg}`);
    }
    return EXIT_CODES.MUTATION_REFUSED;
  }

  if (isWrite) {
    safeMkdir(path.join(evidenceDir, "raw"), 0o700);
  }

  if (ctx.isJson) {
    emitJson(
      createJsonEnvelope(ctx.rawArgs.join(" "), EXIT_CODES.SUCCESS, ctx.mode, {
        engagement_id: engagementId,
        preset,
        targetDir,
        files: fileResults,
      })
    );
  } else {
    console.log(
      `[arsenal init] Scaffolding for '${engagementName}' (${preset}) [mode: ${ctx.mode}]:`
    );
    for (const f of fileResults) {
      console.log(` - ${f.path}: ${f.action}`);
    }
    if (!isWrite) {
      console.log("\nNote: Dry-run preview mode. Add --write to persist files to disk.");
    }
  }

  return EXIT_CODES.SUCCESS;
}
