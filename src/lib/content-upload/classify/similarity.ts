// Similarity of documents with a different hash but almost the same text
// (docs/ki-upload-konzept.md 6.2, "Dubletten"): word shingles on a normalized text
// and the Jaccard measure. Pure and deterministic: no clock, no random numbers, no
// hash seed that changes between runs.
//
// Method: the text is normalized (Unicode NFKC, no invisible characters, lower
// case, only letters and digits), cut into words, and every window of five words
// is one shingle, hashed to 32 bits (FNV-1a). A document is the sorted set of its
// shingle hashes. The Jaccard measure of two sets is the share of the shingles
// that they have in common. To avoid comparing every pair, each document gets a
// bottom-k sketch (its 128 smallest hashes, the front of the sorted array), an
// inverted index finds the pairs that share sketch values, and only those pairs
// are compared exactly. Widespread hashes (boilerplate such as a letterhead,
// present in more than 64 documents) are left out of the index. Work is linear in
// the length of the texts plus the number of candidate pairs, and bounded by the
// limits of the options: text length per document, shingles per document, number
// of documents, number of pairs.
//
// The threshold of 0.9 is justified in the note "Stand U4" in the concept: with
// the real files, copies of one document with small edits lie far above it and
// documents of the same template with other content far below.

import { sanitizeExcerptText } from '../text-clean';

export const DEFAULT_SIMILARITY = Object.freeze({
  /** Words of one text that are read (after the normalization). */
  maxTokens: 120_000,
  /** Candidate pairs that are counted before the exact comparison. */
  maxCandidates: 2_000_000,
  /** Words per shingle. */
  shingleSize: 5,
  /** Hashes in the sketch of a document. */
  sketchSize: 128,
  /** Jaccard value from which two documents count as similar. */
  threshold: 0.9,
  /** Documents that are compared; the first ones by id when there are more. */
  maxDocuments: 3000,
  /** Characters of one text that are read. */
  maxChars: 400_000,
  /** Shingles kept per document (the smallest hashes). */
  maxShingles: 20_000,
  /** A sketch value in more documents than this is boilerplate. */
  maxPostings: 64,
  /** Pairs that are compared exactly. */
  maxPairs: 200_000,
});

export type SimilarityOptions = Partial<{
  [K in keyof typeof DEFAULT_SIMILARITY]: number;
}>;

export interface Fingerprint {
  /** The shingle hashes, unique and ascending. */
  hashes: Uint32Array;
  /** Words in the (cut) text. */
  tokens: number;
  /** The text or the number of shingles was cut by a limit. */
  truncated: boolean;
}

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * The words of a text, normalized with the cleaning of the excerpt (NFKC, every
 * invisible and format character removed, so none can split a word), lower case,
 * letters and digits only.
 */
export function normalizeForSimilarity(
  text: string,
  maxChars: number = Number.POSITIVE_INFINITY
): string[] {
  if (typeof text !== 'string') return [];
  const cut = text.length > maxChars ? text.slice(0, maxChars) : text;
  return sanitizeExcerptText(cut).toLowerCase().match(WORD) ?? [];
}

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function hashWord(word: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < word.length; i += 1) {
    h = Math.imul(h ^ word.charCodeAt(i), FNV_PRIME) >>> 0;
  }
  return h;
}

/** One shingle: the word hashes of a window, mixed in order. */
function shingleHash(words: Uint32Array, start: number, size: number): number {
  let h = FNV_OFFSET;
  for (let i = start; i < start + size; i += 1) {
    h = Math.imul(h ^ words[i], FNV_PRIME) >>> 0;
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/**
 * The fingerprint of a text, or null when the text has no words. A text shorter
 * than one shingle is one shingle as a whole.
 */
export function fingerprintOf(
  text: string,
  options: SimilarityOptions = {}
): Fingerprint | null {
  const o = { ...DEFAULT_SIMILARITY, ...options };
  const raw = typeof text === 'string' ? text : '';
  let truncated = raw.length > o.maxChars;
  let words = normalizeForSimilarity(raw, o.maxChars);
  if (words.length === 0) return null;
  // the cleaning can make a text longer (U+FDFA becomes 18 characters), so the
  // number of words is bounded as well
  if (words.length > o.maxTokens) {
    words = words.slice(0, o.maxTokens);
    truncated = true;
  }
  const wordHashes = new Uint32Array(words.length);
  for (let i = 0; i < words.length; i += 1) wordHashes[i] = hashWord(words[i]);
  const size = Math.max(1, Math.min(o.shingleSize, words.length));
  const count = words.length - size + 1;
  const all = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) all[i] = shingleHash(wordHashes, i, size);
  all.sort();
  // unique, ascending
  let unique = 0;
  for (let i = 0; i < all.length; i += 1) {
    if (i === 0 || all[i] !== all[i - 1]) all[unique++] = all[i];
  }
  let kept = unique;
  if (kept > o.maxShingles) {
    kept = o.maxShingles;
    truncated = true;
  }
  return { hashes: all.slice(0, kept), tokens: words.length, truncated };
}

/** Jaccard measure of two fingerprints, 0 to 1. */
export function jaccardOf(a: Fingerprint, b: Fingerprint): number {
  const x = a.hashes;
  const y = b.hashes;
  let i = 0;
  let j = 0;
  let common = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      common += 1;
      i += 1;
      j += 1;
    } else if (x[i] < y[j]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  const union = x.length + y.length - common;
  return union === 0 ? 0 : common / union;
}

export interface SimilarDocument {
  id: string;
  text: string;
  /** A fingerprint that the caller already built from the text (then text is not read). */
  print?: Fingerprint | null;
}

export interface SimilarPair {
  a: string;
  b: string;
  jaccard: number;
}

export interface SimilarGroup {
  /** sim:<smallest id of the group> */
  id: string;
  members: string[];
  maxJaccard: number;
}

export interface SimilarResult {
  pairs: SimilarPair[];
  groups: SimilarGroup[];
  /** A limit cut the work (documents, pairs or text). */
  truncated: boolean;
  /** Documents that were compared. */
  processed: number;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Joins pairs to groups: a chain of pairs is one group. Sorted by id. */
export function groupSimilarPairs(
  pairs: ReadonlyArray<SimilarPair>
): SimilarGroup[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while ((parent.get(root) ?? root) !== root)
      root = parent.get(root) as string;
    parent.set(id, root);
    return root;
  };
  for (const pair of pairs) {
    const ra = find(pair.a);
    const rb = find(pair.b);
    if (ra !== rb) {
      // the smaller id becomes the root, so the result does not depend on the order
      if (byId(ra, rb) < 0) parent.set(rb, ra);
      else parent.set(ra, rb);
    }
  }
  const members = new Map<string, Set<string>>();
  const best = new Map<string, number>();
  for (const pair of pairs) {
    const root = find(pair.a);
    const set = members.get(root) ?? new Set<string>();
    set.add(pair.a);
    set.add(pair.b);
    members.set(root, set);
    best.set(root, Math.max(best.get(root) ?? 0, pair.jaccard));
  }
  return [...members.entries()]
    .map(([root, set]) => {
      const list = [...set].sort(byId);
      return {
        id: `sim:${list[0]}`,
        members: list,
        maxJaccard: best.get(root) ?? 0,
      };
    })
    .sort((g, h) => byId(g.id, h.id));
}

/**
 * Finds the pairs of documents with a Jaccard value at or above the threshold
 * and joins them to groups (a chain of pairs is one group). The order of the
 * input does not matter, the answer is sorted by id.
 */
export function findSimilarDocuments(
  documents: ReadonlyArray<SimilarDocument>,
  options: SimilarityOptions = {}
): SimilarResult {
  const o = { ...DEFAULT_SIMILARITY, ...options };
  // sorted first, then a repeated id keeps the first by text: the answer does
  // not depend on the order of the input
  const valid = (Array.isArray(documents) ? documents : []).filter(
    doc => doc && typeof doc.id === 'string'
  );
  valid.sort(
    (x, y) =>
      byId(x.id, y.id) || byId(String(x.text ?? ''), String(y.text ?? ''))
  );
  const seen = new Set<string>();
  const candidates: SimilarDocument[] = [];
  for (const doc of valid) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    candidates.push(doc);
  }
  let truncated = candidates.length > o.maxDocuments;
  const used = candidates.slice(0, o.maxDocuments);

  const ids: string[] = [];
  const prints: Fingerprint[] = [];
  for (const doc of used) {
    const print =
      doc.print !== undefined ? doc.print : fingerprintOf(doc.text, o);
    if (!print) continue;
    if (print.truncated) truncated = true;
    ids.push(doc.id);
    prints.push(print);
  }
  const n = prints.length;

  // inverted index of the sketches
  const postings = new Map<number, number[]>();
  for (let d = 0; d < n; d += 1) {
    const sketch = prints[d].hashes.subarray(0, o.sketchSize);
    for (let k = 0; k < sketch.length; k += 1) {
      const list = postings.get(sketch[k]);
      if (list) list.push(d);
      else postings.set(sketch[k], [d]);
    }
  }
  const shared = new Map<number, number>();
  const count = (a: number, b: number) => {
    const key = a * n + b;
    const known = shared.get(key);
    if (known !== undefined) shared.set(key, known + 1);
    else if (shared.size < o.maxCandidates) shared.set(key, 1);
    else truncated = true;
  };
  for (const list of postings.values()) {
    if (list.length < 2) continue;
    if (list.length > o.maxPostings) {
      // a value in this many documents is boilerplate or a cluster of copies:
      // only neighbours are linked, which is linear and keeps a cluster of
      // identical documents together as a chain
      for (let x = 0; x + 1 < list.length; x += 1) count(list[x], list[x + 1]);
      continue;
    }
    for (let x = 0; x < list.length; x += 1) {
      for (let y = x + 1; y < list.length; y += 1) count(list[x], list[y]);
    }
  }

  const pairs: SimilarPair[] = [];
  const keys = [...shared.keys()].sort((p, q) => p - q);
  let compared = 0;
  for (const key of keys) {
    const i = Math.floor(key / n);
    const j = key % n;
    const sketchLength = Math.min(
      prints[i].hashes.length,
      prints[j].hashes.length,
      o.sketchSize
    );
    // a pair at the threshold shares at least about this share of its sketches
    const needed = Math.max(1, Math.ceil(o.threshold * 0.5 * sketchLength));
    if ((shared.get(key) ?? 0) < needed) continue;
    if (compared >= o.maxPairs) {
      truncated = true;
      break;
    }
    compared += 1;
    const jaccard = jaccardOf(prints[i], prints[j]);
    if (jaccard >= o.threshold) pairs.push({ a: ids[i], b: ids[j], jaccard });
  }
  pairs.sort((p, q) => byId(p.a, q.a) || byId(p.b, q.b));

  const groups = groupSimilarPairs(pairs);

  return { pairs, groups, truncated, processed: used.length };
}
