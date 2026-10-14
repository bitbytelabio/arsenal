// @bun
// plugin/extensions/bounding.ts
import * as path2 from "path";

// src/core/bounding.ts
import * as fs from "fs";
import * as path from "path";

// src/core/hash.ts
import * as crypto from "crypto";
function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex").toLowerCase();
}
function sha256String(text) {
  return crypto.createHash("sha256").update(text, "utf-8").digest("hex").toLowerCase();
}

// src/core/bounding.ts
var BOUNDING_LIMITS = {
  MAX_LOGICAL_LINES: 500,
  MAX_RAW_BYTES: 51200,
  MAX_DELIVERED_BYTES: 4096,
  HEAD_LINES: 20,
  TAIL_LINES: 20
};
function utf8ByteLength(codePoint) {
  if (codePoint < 128)
    return 1;
  if (codePoint < 2048)
    return 2;
  if (codePoint < 65536)
    return 3;
  return 4;
}
function truncateHeadToByteBudget(str, maxBytes) {
  if (maxBytes <= 0)
    return "";
  let usedBytes = 0;
  let index = 0;
  while (index < str.length) {
    const codePoint = str.codePointAt(index);
    const bytes = utf8ByteLength(codePoint);
    if (usedBytes + bytes > maxBytes)
      break;
    usedBytes += bytes;
    index += codePoint > 65535 ? 2 : 1;
  }
  return index === str.length ? str : str.slice(0, index);
}
function truncateTailToByteBudget(str, maxBytes) {
  if (maxBytes <= 0)
    return "";
  let usedBytes = 0;
  let index = str.length;
  while (index > 0) {
    const low = str.charCodeAt(index - 1);
    let codePoint = low;
    let step = 1;
    if (low >= 56320 && low <= 57343 && index >= 2) {
      const high = str.charCodeAt(index - 2);
      if (high >= 55296 && high <= 56319) {
        codePoint = (high - 55296) * 1024 + (low - 56320) + 65536;
        step = 2;
      }
    }
    const bytes = utf8ByteLength(codePoint);
    if (usedBytes + bytes > maxBytes)
      break;
    usedBytes += bytes;
    index -= step;
  }
  return index === 0 ? str : str.slice(index);
}
function boundAndStore(rawInput, evidenceDir, ext = "txt") {
  const bytes = typeof rawInput === "string" ? new TextEncoder().encode(rawInput) : rawInput;
  const rawText = typeof rawInput === "string" ? rawInput : new TextDecoder().decode(bytes);
  const lines = rawText.split(`
`);
  const byteLength = bytes.byteLength;
  const lineCount = lines.length;
  if (lineCount <= BOUNDING_LIMITS.MAX_LOGICAL_LINES && byteLength <= BOUNDING_LIMITS.MAX_RAW_BYTES) {
    return {
      bounded: false,
      content: rawText,
      originalBytes: byteLength,
      originalLines: lineCount
    };
  }
  const hash = sha256Bytes(bytes);
  const rawDir = path.join(evidenceDir, "raw");
  fs.mkdirSync(rawDir, { recursive: true, mode: 448 });
  const artifactRelPath = path.join("evidence", "raw", `${hash}.${ext}`);
  const artifactFullPath = path.join(evidenceDir, "raw", `${hash}.${ext}`);
  fs.writeFileSync(artifactFullPath, bytes, { mode: 384 });
  try {
    fs.chmodSync(artifactFullPath, 384);
  } catch {}
  const headLines = lines.slice(0, BOUNDING_LIMITS.HEAD_LINES);
  const tailLines = lines.slice(-BOUNDING_LIMITS.TAIL_LINES);
  const spilledLineCount = Math.max(0, lineCount - BOUNDING_LIMITS.HEAD_LINES - BOUNDING_LIMITS.TAIL_LINES);
  const marker = `
[OUTPUT BOUNDED: ${spilledLineCount} lines spilled to ${artifactRelPath} (SHA-256: ${hash})]
`;
  let headText = headLines.join(`
`);
  let tailText = tailLines.join(`
`);
  let combined = `${headText}${marker}${tailText}`;
  const encoder = new TextEncoder;
  if (encoder.encode(combined).byteLength > BOUNDING_LIMITS.MAX_DELIVERED_BYTES) {
    const markerBytes = encoder.encode(marker).byteLength;
    const availableForContent = Math.max(0, BOUNDING_LIMITS.MAX_DELIVERED_BYTES - markerBytes);
    const half = Math.floor(availableForContent / 2);
    headText = truncateHeadToByteBudget(headText, half);
    const headBytes = encoder.encode(headText).byteLength;
    tailText = truncateTailToByteBudget(tailText, availableForContent - headBytes);
    combined = `${headText}${marker}${tailText}`;
  }
  return {
    bounded: true,
    content: combined,
    artifactPath: artifactRelPath,
    artifactHash: hash,
    originalBytes: byteLength,
    originalLines: lineCount
  };
}

// plugin/extensions/bounding.ts
function boundingExtension(pi) {
  pi.on("tool_result", async (event) => {
    if (!event.content || event.content.length === 0)
      return;
    const evidenceDir = path2.resolve(process.cwd(), "evidence");
    let transformed = false;
    const newContent = event.content.map((block) => {
      if (block.type === "text" && typeof block.text === "string") {
        const boundRes = boundAndStore(block.text, evidenceDir);
        if (boundRes.bounded) {
          transformed = true;
          return {
            ...block,
            text: boundRes.content
          };
        }
      }
      return block;
    });
    if (transformed) {
      return { content: newContent };
    }
  });
}
export {
  boundingExtension as default
};
