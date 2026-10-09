/**
 * Native APK and AndroidManifest Inspection Tool
 * Zero external dependencies — parses ZIP and AndroidManifest (plain XML and binary AXML)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import type { ApkInspectResult, ExportedComponent } from "../../src/core/types.ts";

export interface ApkInspectInput {
  apk_path: string;
  extract_components?: boolean;
  extract_permissions?: boolean;
}

/**
 * Extracts a file from a ZIP archive in memory without external dependencies.
 */
function extractFromZip(zipPath: string, targetFileName: string): Buffer {
  const buf = fs.readFileSync(zipPath);

  // Search backwards for End of Central Directory Record (EOCD: 0x06054b50)
  let eocdOffset = -1;
  const searchLimit = Math.max(0, buf.length - 65536);
  for (let i = buf.length - 22; i >= searchLimit; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error(`Invalid ZIP/APK archive: EOCD record not found in ${zipPath}`);
  }

  const cdCount = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) break;

    const compression = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);

    const fileName = buf.toString("utf-8", pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;

    if (fileName === targetFileName) {
      if (localHeaderOffset + 30 > buf.length) {
        throw new Error(`Corrupted ZIP entry offset for ${targetFileName}`);
      }
      const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;

      if (dataStart + compressedSize > buf.length) {
        throw new Error(`Unexpected EOF while reading ${targetFileName}`);
      }

      const rawData = buf.subarray(dataStart, dataStart + compressedSize);

      if (compression === 0) {
        return Buffer.from(rawData);
      } else if (compression === 8) {
        return zlib.inflateRawSync(rawData);
      } else {
        throw new Error(`Unsupported compression method (${compression}) in ${zipPath}`);
      }
    }
  }

  throw new Error(`File '${targetFileName}' not found in APK: ${zipPath}`);
}

/**
 * Parses plain text XML AndroidManifest.
 */
function parseTextManifest(xmlText: string): ApkInspectResult {
  const packageMatch = xmlText.match(/package\s*=\s*["']([^"']+)["']/i);
  const packageName = packageMatch ? packageMatch[1]! : "unknown.package";

  const vCodeMatch = xmlText.match(/versionCode\s*=\s*["']([^"']+)["']/i);
  const versionCode = vCodeMatch ? parseInt(vCodeMatch[1]!, 10) : undefined;

  const vNameMatch = xmlText.match(/versionName\s*=\s*["']([^"']+)["']/i);
  const versionName = vNameMatch ? vNameMatch[1] : undefined;

  const minSdkMatch = xmlText.match(/minSdkVersion\s*=\s*["']([^"']+)["']/i);
  const minSdkVersion = minSdkMatch ? parseInt(minSdkMatch[1]!, 10) : undefined;

  const targetSdkMatch = xmlText.match(/targetSdkVersion\s*=\s*["']([^"']+)["']/i);
  const targetSdkVersion = targetSdkMatch ? parseInt(targetSdkMatch[1]!, 10) : undefined;

  // Permissions
  const permissions: string[] = [];
  const permRegex = /<uses-permission[^>]*android:name\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let permMatch: RegExpExecArray | null;
  while ((permMatch = permRegex.exec(xmlText)) !== null) {
    if (permMatch[1] && !permissions.includes(permMatch[1])) {
      permissions.push(permMatch[1]);
    }
  }

  // Application flags
  const debuggableMatch = xmlText.match(/android:debuggable\s*=\s*["']true["']/i);
  const debuggable = Boolean(debuggableMatch);

  const allowBackupMatch = xmlText.match(/android:allowBackup\s*=\s*["']true["']/i);
  const allowBackup = Boolean(allowBackupMatch);

  const dangerousFlags: string[] = [];
  if (debuggable) dangerousFlags.push("debuggable");
  if (allowBackup) dangerousFlags.push("allowBackup");
  if (/android:usesCleartextTraffic\s*=\s*["']true["']/i.test(xmlText)) {
    dangerousFlags.push("usesCleartextTraffic");
  }
  if (/android:testOnly\s*=\s*["']true["']/i.test(xmlText)) {
    dangerousFlags.push("testOnly");
  }

  // Exported components: activities, services, receivers, providers
  const exportedComponents: ExportedComponent[] = [];
  const componentTypes = [
    { tag: "activity", type: "activity" as const },
    { tag: "service", type: "service" as const },
    { tag: "receiver", type: "receiver" as const },
    { tag: "provider", type: "provider" as const },
  ];

  for (const { tag, type } of componentTypes) {
    // Match each component tag block: <activity ...>...</activity> or <activity ... />
    const tagRegex = new RegExp(`<${tag}\\b([\\s\\S]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tag}>)`, "gi");
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(xmlText)) !== null) {
      const attrs = match[1] || "";
      const inner = match[2] || "";

      const nameMatch = attrs.match(/android:name\s*=\s*["']([^"']+)["']/i);
      if (!nameMatch || !nameMatch[1]) continue;
      const name = nameMatch[1];

      const exportedExplicitMatch = attrs.match(/android:exported\s*=\s*["'](true|false)["']/i);
      let exported = false;
      if (exportedExplicitMatch) {
        exported = exportedExplicitMatch[1]!.toLowerCase() === "true";
      } else {
        // Android default: if has intent-filter, exported=true
        exported = /<intent-filter\b/i.test(inner);
      }

      if (exported) {
        const permAttrMatch = attrs.match(/android:permission\s*=\s*["']([^"']+)["']/i);
        const permission = permAttrMatch ? permAttrMatch[1]! : null;
        exportedComponents.push({ type, name, permission });
      }
    }
  }

  return {
    packageName,
    versionCode,
    versionName,
    minSdkVersion,
    targetSdkVersion,
    debuggable,
    allowBackup,
    permissions,
    exportedComponents,
    dangerousFlags,
  };
}

/**
 * Parses binary AXML (Android compiled binary XML) by extracting the string pool and structural tokens.
 */
function parseBinaryManifest(rawBuf: Buffer): ApkInspectResult {
  // Binary AXML chunk header check
  const magic = rawBuf.readUInt32LE(0);
  if (magic !== 0x00080003) {
    // If not magic, attempt text fallback
    return parseTextManifest(rawBuf.toString("utf-8"));
  }

  // String pool is the second chunk
  let stringPoolOffset = 8;
  const poolType = rawBuf.readUInt16LE(stringPoolOffset);
  if (poolType !== 0x0001) {
    throw new Error("Invalid AXML: Expected StringPool chunk at offset 8");
  }

  const stringCount = rawBuf.readUInt32LE(stringPoolOffset + 8);
  const flags = rawBuf.readUInt32LE(stringPoolOffset + 16);
  const stringsStart = stringPoolOffset + rawBuf.readUInt32LE(stringPoolOffset + 20);
  const isUtf8 = (flags & (1 << 8)) !== 0;

  const strings: string[] = [];
  const offsetTableStart = stringPoolOffset + 28;

  for (let i = 0; i < stringCount; i++) {
    const strOffset = stringsStart + rawBuf.readUInt32LE(offsetTableStart + i * 4);
    if (strOffset >= rawBuf.length) continue;

    if (isUtf8) {
      // UTF-8 length prefix: 1 or 2 bytes
      let lenOffset = strOffset;
      let len = rawBuf.readUInt8(lenOffset++);
      if ((len & 0x80) !== 0) {
        len = ((len & 0x7f) << 8) | rawBuf.readUInt8(lenOffset++);
      }
      let byteLen = rawBuf.readUInt8(lenOffset++);
      if ((byteLen & 0x80) !== 0) {
        byteLen = ((byteLen & 0x7f) << 8) | rawBuf.readUInt8(lenOffset++);
      }
      strings.push(rawBuf.toString("utf-8", lenOffset, lenOffset + byteLen));
    } else {
      // UTF-16 length prefix: 2 or 4 bytes
      let lenOffset = strOffset;
      let len = rawBuf.readUInt16LE(lenOffset);
      lenOffset += 2;
      if ((len & 0x8000) !== 0) {
        len = ((len & 0x7fff) << 16) | rawBuf.readUInt16LE(lenOffset);
        lenOffset += 2;
      }
      strings.push(rawBuf.toString("utf16le", lenOffset, lenOffset + len * 2));
    }
  }

  // Extract metadata from string pool tokens
  let packageName = "unknown.package";
  const permissions: string[] = [];
  const exportedComponents: ExportedComponent[] = [];
  const dangerousFlags: string[] = [];
  let debuggable = false;
  let allowBackup = false;

  for (const s of strings) {
    if (s.startsWith("android.permission.")) {
      if (!permissions.includes(s)) permissions.push(s);
    }
    if (s === "debuggable") {
      debuggable = true;
      if (!dangerousFlags.includes("debuggable")) dangerousFlags.push("debuggable");
    }
    if (s === "allowBackup") {
      allowBackup = true;
      if (!dangerousFlags.includes("allowBackup")) dangerousFlags.push("allowBackup");
    }
    if (s === "usesCleartextTraffic") {
      if (!dangerousFlags.includes("usesCleartextTraffic")) dangerousFlags.push("usesCleartextTraffic");
    }
  }

  // Find package name by locating standard package patterns
  const candidatePkg = strings.find(
    (s) => s.includes(".") && !s.startsWith("android.") && !s.includes("/") && !s.endsWith(".xml")
  );
  if (candidatePkg) {
    packageName = candidatePkg;
  }

  return {
    packageName,
    debuggable,
    allowBackup,
    permissions,
    exportedComponents,
    dangerousFlags,
  };
}

/**
 * Inspect an Android APK file and extract package, component, and security metadata.
 */
export async function inspectApk(input: ApkInspectInput): Promise<ApkInspectResult> {
  const resolvedPath = path.resolve(input.apk_path);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`APK file not found: ${resolvedPath}`);
  }

  const manifestBuf = extractFromZip(resolvedPath, "AndroidManifest.xml");
  if (manifestBuf.length >= 4 && manifestBuf.readUInt32LE(0) === 0x00080003) {
    return parseBinaryManifest(manifestBuf);
  }

  return parseTextManifest(manifestBuf.toString("utf-8"));
}
