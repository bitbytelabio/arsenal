/**
 * arsenal case handler
 * Implements T036 & User Story 2
 * Review case scope and Evidence graph integrity
 */

import { EXIT_CODES, createJsonEnvelope, emitJson } from "../../bin/arsenal.ts";
import type { CommandContext } from "./router.ts";
import { reviewCase, renderMarkdown } from "../../plugin/tools/case-review.ts";

export async function handleCase(ctx: CommandContext): Promise<number> {
  const subCommand = ctx.subCommand ?? "review";

  if (subCommand === "help") {
    if (ctx.isJson) {
      emitJson(
        createJsonEnvelope("arsenal case", EXIT_CODES.SUCCESS, "check", {
          commands: ["review"],
        })
      );
    } else {
      console.log(`Usage: arsenal case review [options] [path]

Commands:
  review    Review case scope and Evidence graph integrity

Options:
  --case-root <path>      Path to case workspace root directory
  --strict                Treat warnings as a failed review
  --verify-hashes         Verify SHA-256 content_hash values against artifact_path
  --format <fmt>          Output format (markdown, json)
  --json                  Output in structured JSON envelope
`);
    }
    return EXIT_CODES.SUCCESS;
  }

  if (subCommand === "review") {
    const caseRootArg =
      (typeof ctx.values["case-root"] === "string" && ctx.values["case-root"]) ||
      ctx.positionals[0] ||
      ctx.repoRoot;

    const strict = Boolean(ctx.values.strict || ctx.rawArgs.includes("--strict"));
    const verifyHashes = Boolean(
      ctx.values["verify-hashes"] || ctx.rawArgs.includes("--verify-hashes")
    );
    const format =
      (typeof ctx.values.format === "string" ? ctx.values.format : undefined) ||
      (ctx.isJson ? "json" : "markdown");

    const report = reviewCase(caseRootArg, { strict, verify_hashes: verifyHashes });
    const exitCode = report.status === "FAIL" ? EXIT_CODES.CHECK_FAILURE : EXIT_CODES.SUCCESS;

    if (ctx.isJson || format === "json") {
      const errorMessages = report.issues
        .filter((i) => i.level === "error")
        .map((i) => `[${i.code}] ${i.path}: ${i.message}`);
      const warningMessages = report.issues
        .filter((i) => i.level === "warning")
        .map((i) => `[${i.code}] ${i.path}: ${i.message}`);

      emitJson(
        createJsonEnvelope(
          ctx.rawArgs.join(" "),
          exitCode,
          "check",
          report,
          warningMessages,
          errorMessages
        )
      );
    } else {
      process.stdout.write(renderMarkdown(report));
    }

    return exitCode;
  }

  const errorMsg = `Unrecognized case subcommand: '${subCommand}'. Available: review`;
  if (ctx.isJson) {
    emitJson(
      createJsonEnvelope(
        ctx.rawArgs.join(" "),
        EXIT_CODES.CLI_USAGE_ERROR,
        "check",
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
