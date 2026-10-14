/**
 * In-process APK / ZIP inspector engine
 * Implements lightweight, zero-subprocess mobile artifact analysis using fflate.
 * Extracts AndroidManifest.xml strings, components, permissions, architectures, and certificates.
 */

import * as fs from "node:fs";
import { unzipSync } from "fflate";
import { sha256Bytes } from "./hash.ts";

export interface ApkComponents {
  activities: string[];
  services: string[];
  receivers: string[];
  providers: string[];
}

export interface ApkInspectionResult {
  packageName: string;
  permissions: string[];
  components: ApkComponents;
  debuggable: boolean;
  hasCertificates: boolean;
  certificateFiles: string[];
  dexFiles: string[];
  nativeArchitectures: string[];
  totalFiles: number;
  byteLength: number;
  sha256: string;
}

/**
 * Parses string pool from Android Binary XML (AXML) format.
 * Returns array of extracted strings, or null if buffer is not binary XML.
 */
export function parseAxmlStrings(buffer: Uint8Array): string[] | null {
  // AXML starts with RES_XML_TYPE (0x00080003 in little-endian: 0x03, 0x00, 0x08, 0x00)
  if (buffer.length < 8) return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== 0x00080003) {
    return null; // Not compiled binary XML
  }

  // String pool chunk typically starts at offset 8
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const chunkType = view.getUint16(offset, true);
    const headerSize = view.getUint16(offset + 2, true);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkType === 0x0001) {
      // RES_STRING_POOL_TYPE
      const stringCount = view.getUint32(offset + 8, true);
      const flags = view.getUint32(offset + 16, true);
      const isUtf8 = (flags & (1 << 8)) !== 0;
      const stringsStart = offset + view.getUint32(offset + 20, true);

      const stringOffsets: number[] = [];
      for (let i = 0; i < stringCount; i++) {
        stringOffsets.push(view.getUint32(offset + 28 + i * 4, true));
      }

      const results: string[] = [];
      const decoder = new TextDecoder(isUtf8 ? "utf-8" : "utf-16le");

      for (const strOffset of stringOffsets) {
        const absolutePos = stringsStart + strOffset;
        if (absolutePos >= buffer.length) continue;

        if (isUtf8) {
          // In UTF-8 string pool: 1 or 2 bytes character count, 1 or 2 bytes byte length, followed by null-terminated data
          let pos = absolutePos;
          // Skip utf16 char count
          if ((buffer[pos]! & 0x80) !== 0) pos += 2;
          else pos += 1;
          // Skip utf8 byte length
          let byteLen = 0;
          if ((buffer[pos]! & 0x80) !== 0) {
            byteLen = ((buffer[pos]! & 0x7f) << 8) | buffer[pos + 1]!;
            pos += 2;
          } else {
            byteLen = buffer[pos]!;
            pos += 1;
          }
          if (pos + byteLen <= buffer.length) {
            const rawSlice = buffer.subarray(pos, pos + byteLen);
            results.push(decoder.decode(rawSlice));
          }
        } else {
          // In UTF-16 string pool: 2 or 4 bytes character count, followed by null-terminated utf16-le data
          let pos = absolutePos;
          let charCount = view.getUint16(pos, true);
          pos += 2;
          if ((charCount & 0x8000) !== 0) {
            charCount = ((charCount & 0x7fff) << 16) | view.getUint16(pos, true);
            pos += 2;
          }
          const byteLen = charCount * 2;
          if (pos + byteLen <= buffer.length) {
            const rawSlice = buffer.subarray(pos, pos + byteLen);
            results.push(decoder.decode(rawSlice));
          }
        }
      }

      return results;
    }

    if (chunkSize <= 0) break;
    offset += chunkSize;
  }

  return null;
}

/**
 * Extracts manifest metadata (package, permissions, components, debuggable)
 * from either compiled binary XML or plain-text XML buffer.
 */
export function extractManifestMetadata(manifestBytes: Uint8Array): {
  packageName: string;
  permissions: string[];
  components: ApkComponents;
  debuggable: boolean;
} {
  const binaryStrings = parseAxmlStrings(manifestBytes);

  if (binaryStrings) {
    // Compiled binary XML analysis
    const permissions: string[] = [];
    const activities: string[] = [];
    const services: string[] = [];
    const receivers: string[] = [];
    const providers: string[] = [];
    let packageName = "unknown";
    let debuggable = false;

    // Check for package name candidate: standard reverse-DNS identifier
    const packageCandidates: string[] = [];
    for (const str of binaryStrings) {
      if (str.startsWith("android.permission.") || str.includes(".permission.")) {
        if (!permissions.includes(str)) permissions.push(str);
      } else if (str.endsWith("Activity") || str.includes(".ui.") || str.includes("MainActivity")) {
        if (!activities.includes(str)) activities.push(str);
      } else if (str.endsWith("Service")) {
        if (!services.includes(str)) services.push(str);
      } else if (str.endsWith("Receiver")) {
        if (!receivers.includes(str)) receivers.push(str);
      } else if (str.endsWith("Provider")) {
        if (!providers.includes(str)) providers.push(str);
      }

      if (/^[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}$/i.test(str) && !str.startsWith("android.")) {
        packageCandidates.push(str);
      }
    }

    if (packageCandidates.length > 0) {
      packageName = packageCandidates[0]!;
    }

    // Check if debuggable flag string exists in the pool
    debuggable = binaryStrings.includes("debuggable") && binaryStrings.includes("true");

    return {
      packageName,
      permissions: permissions.sort(),
      components: {
        activities: activities.sort(),
        services: services.sort(),
        receivers: receivers.sort(),
        providers: providers.sort(),
      },
      debuggable,
    };
  }

  // Plain-text XML fallback
  const text = new TextDecoder("utf-8").decode(manifestBytes);
  const pkgMatch = text.match(/package\s*=\s*["']([^"']+)["']/i);
  const packageName = pkgMatch ? pkgMatch[1]! : "unknown";

  const permissions: string[] = [];
  const permRegex = /<uses-permission[^>]+android:name\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = permRegex.exec(text)) !== null) {
    if (match[1] && !permissions.includes(match[1])) {
      permissions.push(match[1]);
    }
  }

  const activities: string[] = [];
  const actRegex = /<activity[^>]+android:name\s*=\s*["']([^"']+)["']/gi;
  while ((match = actRegex.exec(text)) !== null) {
    if (match[1] && !activities.includes(match[1])) activities.push(match[1]);
  }

  const services: string[] = [];
  const srvRegex = /<service[^>]+android:name\s*=\s*["']([^"']+)["']/gi;
  while ((match = srvRegex.exec(text)) !== null) {
    if (match[1] && !services.includes(match[1])) services.push(match[1]);
  }

  const receivers: string[] = [];
  const recRegex = /<receiver[^>]+android:name\s*=\s*["']([^"']+)["']/gi;
  while ((match = recRegex.exec(text)) !== null) {
    if (match[1] && !receivers.includes(match[1])) receivers.push(match[1]);
  }

  const providers: string[] = [];
  const prvRegex = /<provider[^>]+android:name\s*=\s*["']([^"']+)["']/gi;
  while ((match = prvRegex.exec(text)) !== null) {
    if (match[1] && !providers.includes(match[1])) providers.push(match[1]);
  }

  const debuggable = /android:debuggable\s*=\s*["']true["']/i.test(text);

  return {
    packageName,
    permissions: permissions.sort(),
    components: {
      activities: activities.sort(),
      services: services.sort(),
      receivers: receivers.sort(),
      providers: providers.sort(),
    },
    debuggable,
  };
}

/**
 * In-process APK inspection using fflate.
 * Inspects manifest, components, permissions, native architectures, and certificate signatures.
 */
export function inspectApkInProcess(apkInput: string | Uint8Array): ApkInspectionResult {
  const bytes = typeof apkInput === "string" ? fs.readFileSync(apkInput) : apkInput;
  const hash = sha256Bytes(bytes);

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse APK archive: ${msg}`);
  }

  const fileNames = Object.keys(unzipped);
  const totalFiles = fileNames.length;

  const manifestBytes = unzipped["AndroidManifest.xml"];
  if (!manifestBytes) {
    throw new Error("Invalid APK: archive does not contain AndroidManifest.xml");
  }

  const metadata = extractManifestMetadata(manifestBytes);

  const certificateFiles = fileNames.filter(
    (name) =>
      name.startsWith("META-INF/") &&
      (name.endsWith(".RSA") || name.endsWith(".DSA") || name.endsWith(".EC"))
  );

  const dexFiles = fileNames.filter((name) => /^classes\d*\.dex$/.test(name)).sort();

  const nativeArchSet = new Set<string>();
  for (const name of fileNames) {
    if (name.startsWith("lib/")) {
      const parts = name.split("/");
      if (parts.length >= 3 && parts[1]) {
        nativeArchSet.add(parts[1]);
      }
    }
  }

  return {
    packageName: metadata.packageName,
    permissions: metadata.permissions,
    components: metadata.components,
    debuggable: metadata.debuggable,
    hasCertificates: certificateFiles.length > 0,
    certificateFiles: certificateFiles.sort(),
    dexFiles,
    nativeArchitectures: Array.from(nativeArchSet).sort(),
    totalFiles,
    byteLength: bytes.byteLength,
    sha256: hash,
  };
}
