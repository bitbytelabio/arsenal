/**
 * Document-Preserving YAML Editor
 * Implements non-destructive YAML modification via yaml@2 Document API
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseDocument } from "yaml";
import type { Document } from "yaml";

export interface YamlUpdateResult {
  changed: boolean;
  content: string;
  backupPath?: string;
}

export function updateYamlFile(
  filePath: string,
  mutator: (doc: Document) => boolean | void,
  write: boolean = false
): YamlUpdateResult {
  const resolvedPath = path.resolve(filePath);
  const exists = fs.existsSync(resolvedPath);
  const rawContent = exists ? fs.readFileSync(resolvedPath, "utf-8") : "";

  const doc = parseDocument(rawContent);
  const userResult = mutator(doc);
  const newContent = doc.toString();

  const changed = rawContent !== newContent || userResult === true;

  let backupPath: string | undefined;
  if (changed && write) {
    if (exists) {
      const timestamp = Date.now();
      backupPath = `${resolvedPath}.bak.${timestamp}`;
      fs.copyFileSync(resolvedPath, backupPath);
    }
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, newContent, "utf-8");
  }

  return {
    changed,
    content: newContent,
    backupPath,
  };
}

export function mergeYamlPreservingComments(
  existingContent: string,
  incomingContent: string
): string {
  const targetDoc = parseDocument(existingContent);
  const incomingDoc = parseDocument(incomingContent);

  const incomingObj = incomingDoc.toJS() as unknown;

  function mergeRecursive(
    doc: Document,
    obj: unknown,
    path: string[] = []
  ): void {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const currentPath = [...path, k];
        if (!doc.hasIn(currentPath)) {
          doc.setIn(currentPath, v);
        } else if (v && typeof v === "object" && !Array.isArray(v)) {
          mergeRecursive(doc, v, currentPath);
        }
      }
    }
  }

  if (incomingObj && typeof incomingObj === "object") {
    mergeRecursive(targetDoc, incomingObj);
  }

  return targetDoc.toString();
}
