/**
 * arsenal plugin handler
 * Implements T026, T027 & User Story 2
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import { VERSION } from "../core/version.ts";
import type { CommandContext } from "./router.ts";

export async function handlePlugin(ctx: CommandContext): Promise<number> {
  const subCommand = ctx.subCommand ?? "";

  if (subCommand === "link") {
    const isWrite = Boolean(ctx.values.write);
    const isForce = Boolean(ctx.values.force);
    const userPluginsDir = path.join(
      process.env.HOME ?? "~",
      ".omp",
      "plugins",
      "node_modules"
    );
    const linkTarget = path.join(userPluginsDir, "arsenal");
    const sourceDir = path.resolve(ctx.repoRoot, "plugin");

    if (!fs.existsSync(sourceDir)) {
      const msg = `Source plugin directory '${sourceDir}' does not exist. Run 'arsenal build --write' first.`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.ENVIRONMENT_UNAVAILABLE,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.ENVIRONMENT_UNAVAILABLE;
    }

    if (!isWrite) {
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.SUCCESS,
            "preview",
            { plannedLink: linkTarget, source: sourceDir }
          )
        );
      } else {
        console.log(`[plugin link preview] Planned symlink: ${linkTarget} -> ${sourceDir}`);
      }
      return EXIT_CODES.SUCCESS;
    }

    if (fs.existsSync(linkTarget) || fs.lstatSync(linkTarget).isSymbolicLink?.()) {
      if (!isForce) {
        const msg = `Destination '${linkTarget}' already exists. Specify --force to overwrite.`;
        if (ctx.isJson) {
          emitJson(
            createJsonEnvelope(
              ctx.rawArgs.join(" "),
              EXIT_CODES.MUTATION_REFUSED,
              ctx.mode,
              {},
              [],
              [msg]
            )
          );
        } else {
          console.error(`Error: ${msg}`);
        }
        return EXIT_CODES.MUTATION_REFUSED;
      }
      fs.rmSync(linkTarget, { recursive: true, force: true });
    }

    fs.mkdirSync(userPluginsDir, { recursive: true });
    fs.symlinkSync(sourceDir, linkTarget, "dir");

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          "write",
          { linked: true, path: linkTarget, target: sourceDir }
        )
      );
    } else {
      console.log(`[plugin link] Successfully linked: ${linkTarget} -> ${sourceDir}`);
    }
    return EXIT_CODES.SUCCESS;
  }

  if (subCommand === "pack") {
    const isWrite = Boolean(ctx.values.write);
    const outDir = ctx.values.out
      ? path.resolve(ctx.values.out as string)
      : path.join(ctx.repoRoot, "dist");
    const archiveName = `arsenal-${VERSION}.tar.gz`;
    const archivePath = path.join(outDir, archiveName);

    if (!isWrite) {
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.SUCCESS,
            "preview",
            { archivePath }
          )
        );
      } else {
        console.log(`[plugin pack preview] Planned archive: ${archivePath}`);
      }
      return EXIT_CODES.SUCCESS;
    }

    fs.mkdirSync(outDir, { recursive: true });

    // Build tarball using bun / tar
    const pluginDir = path.resolve(ctx.repoRoot, "plugin");
    const proc = Bun.spawnSync([
      "tar",
      "--exclude=.env",
      "--exclude=.git",
      "--exclude=node_modules",
      "-czf",
      archivePath,
      "-C",
      path.dirname(pluginDir),
      path.basename(pluginDir),
    ]);

    if (proc.exitCode !== 0) {
      const msg = `Tar packaging failed: ${proc.stderr.toString()}`;
      if (ctx.isJson) {
        emitJson(
          createJsonEnvelope(
            ctx.rawArgs.join(" "),
            EXIT_CODES.ENVIRONMENT_UNAVAILABLE,
            ctx.mode,
            {},
            [],
            [msg]
          )
        );
      } else {
        console.error(`Error: ${msg}`);
      }
      return EXIT_CODES.ENVIRONMENT_UNAVAILABLE;
    }

    // Generate marketplace catalog entry
    const marketplaceCatalog = {
      name: "arsenal",
      version: VERSION,
      description: "Arsenal Security Engagement Harness Plugin",
      archive: archiveName,
      created_at: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(outDir, "marketplace.json"),
      JSON.stringify(marketplaceCatalog, null, 2),
      "utf-8"
    );

    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          EXIT_CODES.SUCCESS,
          "write",
          { archivePath, catalog: marketplaceCatalog }
        )
      );
    } else {
      console.log(`[plugin pack] Packaged marketplace archive at: ${archivePath}`);
    }
    return EXIT_CODES.SUCCESS;
  }

  return EXIT_CODES.CLI_USAGE_ERROR;
}
