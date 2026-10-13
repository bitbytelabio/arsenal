/**
 * Structured Output & Envelope Utility
 * Implements contracts/cli.md §1.4
 */

import type { JsonEnvelope } from "../../bin/arsenal.ts";
import { VERSION } from "./version.ts";

export function createEnvelope<T = unknown>(
  command: string,
  exitCode: number,
  mode: "preview" | "write" | "check",
  data: T,
  warnings: string[] = [],
  errors: string[] = []
): JsonEnvelope<T> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    version: VERSION,
    command,
    status: exitCode === 0 ? "success" : "failure",
    exitCode,
    timestamp: new Date().toISOString(),
    mode,
    data,
    warnings,
    errors,
  };
}

export function printOutput<T>(
  envelope: JsonEnvelope<T>,
  isJson: boolean,
  humanFormatter?: (data: T) => void
): void {
  if (isJson) {
    console.log(JSON.stringify(envelope, null, 2));
  } else if (humanFormatter) {
    humanFormatter(envelope.data);
    if (envelope.warnings.length > 0) {
      for (const w of envelope.warnings) {
        console.warn(`[warning] ${w}`);
      }
    }
    if (envelope.errors.length > 0) {
      for (const e of envelope.errors) {
        console.error(`[error] ${e}`);
      }
    }
  } else {
    console.log(JSON.stringify(envelope.data, null, 2));
  }
}

export function logDiagnostic(message: string, isJson: boolean): void {
  if (isJson) {
    console.error(message);
  } else {
    console.log(message);
  }
}
