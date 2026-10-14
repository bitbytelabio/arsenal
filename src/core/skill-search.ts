/**
 * src/core/skill-search.ts
 *
 * Deterministic skill search for runtime discovery (contracts/guidance-distribution.md §1).
 *
 * Ranking — MiniSearch BM25 over name/category/description with field boosts
 * (name 3.5, category 2.0, description 1.0).
 *
 * Recall — query tokens resolve to corpus terms in evidence order:
 *   1. exact dictionary term
 *   2. dictionary terms starting with the token (>= 3 chars)
 *   3. long common-prefix overlap, stem-like ("deserialise" -> "deserialization")
 *   4. bounded Levenshtein fallback (>= 5 chars, distance 1 / 2)
 *
 * Gate — conversational filler is stripped through a bounded stop-word list,
 * and a query only produces results when at least two thirds of the remaining
 * tokens resolve. Fully unrecognized or mostly-nonsense queries therefore
 * return an empty outcome so callers can emit NO_RELEVANT_GUIDANCE instead of
 * force-fitting unrelated playbooks.
 */

import MiniSearch from "minisearch";

export interface SearchDocument {
  name: string;
  domain: string;
  category: string;
  description: string;
  sha256: string;
}

export interface SearchHit<T extends SearchDocument> {
  document: T;
  score: number;
}

export interface SearchOutcome<T extends SearchDocument> {
  hits: SearchHit<T>[];
  totalMatches: number;
  unknownTokens: string[];
}

export interface SearchOptions<T extends SearchDocument> {
  filter?: (document: T) => boolean;
}

/** BM25 field boosts: name > category > description. */
export const SEARCH_FIELD_BOOST: Record<"name" | "category" | "description", number> = {
  name: 3.5,
  category: 2.0,
  description: 1.0,
};

/** Bounded English function-word list stripped before query resolution. */
export const QUERY_STOPWORDS: Record<string, true> = {
  about: true, after: true, all: true, also: true, an: true, and: true, any: true, are: true,
  as: true, at: true, be: true, because: true, before: true, being: true, between: true, both: true,
  but: true, by: true, can: true, could: true, did: true, do: true, does: true, during: true,
  for: true, from: true, had: true, has: true, have: true, how: true, if: true, in: true,
  into: true, is: true, it: true, its: true, may: true, me: true, might: true, must: true,
  my: true, no: true, not: true, of: true, on: true, or: true, our: true, over: true,
  should: true, so: true, some: true, such: true, than: true, that: true, the: true, their: true,
  them: true, then: true, there: true, these: true, they: true, this: true, those: true, to: true,
  under: true, up: true, us: true, was: true, we: true, were: true, what: true, when: true,
  where: true, which: true, who: true, why: true, will: true, with: true, would: true, you: true,
  your: true,
};

const MIN_PREFIX_LENGTH = 3;
const MIN_OVERLAP_LENGTH = 5;
const OVERLAP_RATIO = 0.7;
const MIN_FUZZY_LENGTH = 5;
const FUZZY_DISTANCE_TWO_LENGTH = 8;
const MAX_PREFIX_TERMS = 48;
const MAX_FUZZY_TERMS = 8;

// Coverage gate: resolvedTokens / queryTokens >= 2/3.
const MIN_RESOLVED_NUMERATOR = 2;
const MIN_RESOLVED_DENOMINATOR = 3;

/** Unicode-aware tokenization: lowercase, split on non letter/number boundaries, drop 1-char tokens. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0]!;
    if (token.length >= 2) tokens.push(token);
  }
  return tokens;
}

/** Bounded Levenshtein distance; returns maxDistance + 1 when the bound is exceeded. */
export function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let prev: number[] = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  let curr: number[] = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    const aCode = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = aCode === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[b.length]!;
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function lowerBound(sorted: string[], target: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * BM25 index over a frozen snapshot of the skill catalog.
 * Build once per catalog load; queries are read-only.
 */
export class SkillSearchIndex<T extends SearchDocument> {
  private readonly documentsByName = new Map<string, T>();
  private readonly vocabulary = new Set<string>();
  private readonly dictionary: string[];
  private readonly index: MiniSearch<T>;

  constructor(documents: readonly T[]) {
    for (const document of documents) {
      this.documentsByName.set(document.name, document);
      for (const field of [document.name, document.category, document.description]) {
        for (const token of tokenize(field)) this.vocabulary.add(token);
      }
    }
    this.dictionary = [...this.vocabulary].sort();

    this.index = new MiniSearch<T>({
      idField: "name",
      fields: ["name", "category", "description"],
      storeFields: ["name", "domain", "category", "description", "sha256"],
      tokenize: (text) => tokenize(text),
      searchOptions: { boost: SEARCH_FIELD_BOOST },
    });
    this.index.addAll([...documents]);
  }

  /**
   * Resolves a query token to dictionary terms.
   * Returns null when the token exists nowhere in the corpus dictionary.
   */
  private resolveToken(token: string): string[] | null {
    if (this.vocabulary.has(token)) return [token];

    const candidates = new Set<string>();

    if (token.length >= MIN_PREFIX_LENGTH) {
      const start = lowerBound(this.dictionary, token);
      let added = 0;
      for (let i = start; i < this.dictionary.length && added < MAX_PREFIX_TERMS; i++) {
        const term = this.dictionary[i]!;
        if (!term.startsWith(token)) break;
        candidates.add(term);
        added++;
      }
    }

    // Stem-like overlap: one side is a long common prefix of the other
    // (e.g. "deserialise" -> "deserialization").
    if (token.length >= MIN_OVERLAP_LENGTH) {
      const overlapFloor = Math.max(MIN_OVERLAP_LENGTH, Math.floor(OVERLAP_RATIO * token.length));
      const firstCodePoint = token.codePointAt(0)!;
      const start = lowerBound(this.dictionary, String.fromCodePoint(firstCodePoint));
      const end = lowerBound(this.dictionary, String.fromCodePoint(firstCodePoint + 1));
      for (let i = start; i < end && i < this.dictionary.length; i++) {
        const term = this.dictionary[i]!;
        if (term.length < MIN_OVERLAP_LENGTH || candidates.has(term)) continue;
        if (commonPrefixLength(term, token) >= overlapFloor) candidates.add(term);
      }
    }

    if (candidates.size === 0 && token.length >= MIN_FUZZY_LENGTH) {
      const maxDistance = token.length >= FUZZY_DISTANCE_TWO_LENGTH ? 2 : 1;
      const fuzzy: Array<{ term: string; distance: number }> = [];
      for (const term of this.dictionary) {
        if (term.length < 4 || Math.abs(term.length - token.length) > maxDistance) continue;
        const distance = boundedLevenshtein(term, token, maxDistance);
        if (distance <= maxDistance) fuzzy.push({ term, distance });
      }
      fuzzy.sort((a, b) => a.distance - b.distance || a.term.localeCompare(b.term));
      for (const { term } of fuzzy.slice(0, MAX_FUZZY_TERMS)) candidates.add(term);
    }

    return candidates.size > 0 ? [...candidates] : null;
  }

  /**
   * Ranks documents against the query. Nonsense queries — no token resolves,
   * or fewer than two thirds of the meaningful tokens resolve — return zero
   * hits with the unrecognized tokens reported.
   */
  public search(query: string, options: SearchOptions<T> = {}): SearchOutcome<T> {
    const tokens = tokenize(query).filter((token) => !Object.hasOwn(QUERY_STOPWORDS, token));
    if (tokens.length === 0) {
      return { hits: [], totalMatches: 0, unknownTokens: [] };
    }

    const expanded = new Set<string>();
    const unknownTokens: string[] = [];
    let resolvedTokens = 0;
    for (const token of tokens) {
      const resolved = this.resolveToken(token);
      if (!resolved) {
        unknownTokens.push(token);
        continue;
      }
      resolvedTokens++;
      for (const term of resolved) expanded.add(term);
    }

    if (resolvedTokens * MIN_RESOLVED_DENOMINATOR < tokens.length * MIN_RESOLVED_NUMERATOR) {
      return { hits: [], totalMatches: 0, unknownTokens };
    }

    const filter = options.filter;
    const results = this.index.search([...expanded].join(" "), {
      filter: (result) => {
        const document = this.documentsByName.get(String(result.id));
        return document !== undefined && (filter === undefined || filter(document));
      },
    });

    const hits: SearchHit<T>[] = [];
    for (const result of results) {
      const document = this.documentsByName.get(String(result.id));
      if (document) hits.push({ document, score: result.score });
    }
    hits.sort((a, b) => b.score - a.score || a.document.name.localeCompare(b.document.name));

    return { hits, totalMatches: hits.length, unknownTokens };
  }
}
