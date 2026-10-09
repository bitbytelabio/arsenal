/**
 * src/core/skill-language.ts
 *
 * Deterministic English-residue detection per research.md R10,
 * contracts/skill-standard.md §2, and Task T008.
 *
 * Scans content and files for:
 * - CJK ranges (\u3000-\u9fff, \uff00-\uffef)
 * - Vietnamese diacritics ([ăâđêôơưĂÂĐÊÔƠƯ\u1ea0-\u1ef9àáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵÀÁẢÃẠÈÉẺẼẸÌÍỈĨỊÒÓỎÕỌÙÚỦŨỤỲÝỶỸỴ])
 * - Vietnamese function-word list (không, được, người, phải, cần, thực)
 *
 * Explicitly DOES NOT use a character whitelist: diagrams containing arrows
 * (→, ⇒), mathematical operators (≥, ≤), and box-drawing symbols are legitimate.
 */

import * as fs from "node:fs";

export type LanguageViolationType =
  | "cjk"
  | "fullwidth"
  | "vietnamese_diacritic"
  | "vietnamese_function_word";

export interface LanguageViolation {
  file: string;
  line: number;
  type: LanguageViolationType;
  match: string;
  lineContent?: string;
}

export type FileLanguageViolations = Record<string, LanguageViolation[]>;

/**
 * CJK Unified Ideographs, Symbols, Kana, Hangul (\u3000-\u9fff).
 */
export const CJK_RANGE_REGEX = /[\u3000-\u9fff]/;

/**
 * Fullwidth and Halfwidth forms (\uff00-\uffef).
 */
export const FULLWIDTH_RANGE_REGEX = /[\uff00-\uffef]/;

/**
 * Combined CJK & Fullwidth detector.
 */
export const CJK_OR_FULLWIDTH_REGEX = /[\u3000-\u9fff\uff00-\uffef]/;

/**
 * Vietnamese diacritics and letters:
 * - Specific base letters: ă, â, đ, ê, ô, ơ, ư (and uppercase)
 * - Latin Extended Additional (\u1ea0-\u1ef9)
 * - Common accented vowels with acute, grave, hook, tilde, dot below
 */
export const VIETNAMESE_DIACRITICS_REGEX =
  /[ăâđêôơưĂÂĐÊÔƠƯ\u1ea0-\u1ef9àáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵÀÁẢÃẠÈÉẺẼẸÌÍỈĨỊÒÓỎÕỌÙÚỦŨỤỲÝỶỸỴ]/;

/**
 * Declared Vietnamese function words per research.md R10.
 */
export const VIETNAMESE_FUNCTION_WORDS: readonly string[] = Object.freeze([
  "không",
  "được",
  "người",
  "phải",
  "cần",
  "thực",
]);

/**
 * Regex matching any declared Vietnamese function word with Unicode word boundary awareness.
 */
export const VIETNAMESE_FUNCTION_WORDS_REGEX =
  /(?:^|[^\p{L}\p{N}_])(không|được|người|phải|cần|thực)(?=[^\p{L}\p{N}_]|$)/iu;

/**
 * Checks whether a single line of text has language residue and returns any violations.
 */
export function detectLanguageViolationsInLine(
  line: string,
  lineNumber: number,
  filePath = "",
): LanguageViolation[] {
  const violations: LanguageViolation[] = [];

  const cjkMatch = line.match(CJK_RANGE_REGEX);
  if (cjkMatch?.[0]) {
    violations.push({
      file: filePath,
      line: lineNumber,
      type: "cjk",
      match: cjkMatch[0],
      lineContent: line.trim(),
    });
  }

  const fullwidthMatch = line.match(FULLWIDTH_RANGE_REGEX);
  if (fullwidthMatch?.[0]) {
    violations.push({
      file: filePath,
      line: lineNumber,
      type: "fullwidth",
      match: fullwidthMatch[0],
      lineContent: line.trim(),
    });
  }

  const vietDiacriticMatch = line.match(VIETNAMESE_DIACRITICS_REGEX);
  if (vietDiacriticMatch?.[0]) {
    violations.push({
      file: filePath,
      line: lineNumber,
      type: "vietnamese_diacritic",
      match: vietDiacriticMatch[0],
      lineContent: line.trim(),
    });
  }

  const vietWordMatch = line.match(VIETNAMESE_FUNCTION_WORDS_REGEX);
  if (vietWordMatch?.[1]) {
    violations.push({
      file: filePath,
      line: lineNumber,
      type: "vietnamese_function_word",
      match: vietWordMatch[1],
      lineContent: line.trim(),
    });
  }

  return violations;
}

/**
 * Analyzes string content line-by-line and returns all detected language violations.
 */
export function detectLanguageViolationsInText(
  content: string,
  filePath = "",
): LanguageViolation[] {
  const lines = content.split(/\r?\n/);
  const violations: LanguageViolation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineViolations = detectLanguageViolationsInLine(lines[i]!, i + 1, filePath);
    for (const v of lineViolations) {
      violations.push(v);
    }
  }

  return violations;
}

/**
 * Inspects a file on disk and returns all detected language violations.
 */
export function detectLanguageViolationsInFile(filePath: string): LanguageViolation[] {
  const content = fs.readFileSync(filePath, "utf-8");
  return detectLanguageViolationsInText(content, filePath);
}

/**
 * Evaluates multiple files and produces a comprehensive report keyed by file path.
 * Files with zero violations are excluded from the returned record.
 */
export function reportLanguageResidue(filePaths: Iterable<string>): FileLanguageViolations {
  const report: FileLanguageViolations = {};

  for (const filePath of filePaths) {
    const violations = detectLanguageViolationsInFile(filePath);
    if (violations.length > 0) {
      report[filePath] = violations;
    }
  }

  return report;
}

/**
 * Fast boolean check if content contains any non-English residue.
 */
export function hasLanguageResidue(text: string): boolean {
  return (
    CJK_OR_FULLWIDTH_REGEX.test(text) ||
    VIETNAMESE_DIACRITICS_REGEX.test(text) ||
    VIETNAMESE_FUNCTION_WORDS_REGEX.test(text)
  );
}

/**
 * Returns true if text is clean English (no CJK, fullwidth, or Vietnamese residue).
 */
export function isEnglishOnly(text: string): boolean {
  return !hasLanguageResidue(text);
}
