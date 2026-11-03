/**
 * Memory cache for the embedding of a question.
 *
 * The embedding of a question is a call to another server (Sokrates: 5 to 60
 * seconds on a busy day, see docs/hai-geschwindigkeit.md). The same text always
 * gives the same vector, so a repeated text (the user asks again, edits and
 * sends again, a regeneration, the same quiz topic) does not have to wait for it
 * a second time. Two requests for the same text at the same moment share one call.
 *
 * What is stored and for how long:
 *  - key: a SHA-256 of provider, dimensions and the text (trimmed, spaces
 *    folded). The text itself, the user and the session are NOT part of the key
 *    and are not stored: nothing leads from an entry to a person.
 *  - value: the vector. It depends on the text only, it carries no right and no
 *    scope. Who may read which chunk is decided by the search filter after it
 *    (catalogs, audience, organization), never by this cache.
 *  - memory of one server instance only, at most MAX_ENTRIES entries, gone after
 *    TTL_MS and with the instance. Nothing is written to a database or a file.
 *
 * Only single texts (the question) are cached. The batch of the indexing goes
 * straight through.
 *
 * @module lib/hai/providers/embeddingCache
 */

import { createHash } from 'crypto';
import type { EmbeddingProvider, EmbeddingResult } from './types';

/** Lifetime of an entry: long enough for "ask again", short enough to stay fresh. */
export const EMBEDDING_CACHE_TTL_MS = 10 * 60 * 1000;
/** A vector of 3072 numbers is about 25 KB in memory: 100 entries are a few MB. */
export const EMBEDDING_CACHE_MAX_ENTRIES = 100;

interface Entry {
  result: EmbeddingResult;
  expiresAt: number;
}

export interface EmbeddingCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  /** For tests. */
  now?: () => number;
}

/** The text as the cache sees it: the same question typed with other spaces is the same. */
function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export class CachedEmbeddingProvider implements EmbeddingProvider {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<EmbeddingResult>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    private readonly inner: EmbeddingProvider,
    options: EmbeddingCacheOptions = {}
  ) {
    this.ttlMs = options.ttlMs ?? EMBEDDING_CACHE_TTL_MS;
    this.maxEntries = options.maxEntries ?? EMBEDDING_CACHE_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  get name(): string {
    return this.inner.name;
  }

  get dimensions(): number {
    return this.inner.dimensions;
  }

  isInitialized(): boolean {
    return this.inner.isInitialized();
  }

  /** Number of entries held (for tests and diagnostics). */
  get size(): number {
    return this.entries.size;
  }

  private keyOf(text: string): string {
    return createHash('sha256')
      .update(`${this.inner.name}|${this.inner.dimensions}|`)
      .update(normalizeText(text))
      .digest('hex');
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const key = this.keyOf(text);

    const hit = this.entries.get(key);
    if (hit) {
      if (hit.expiresAt > this.now()) {
        // most recently used goes last (Map keeps the order of insertion)
        this.entries.delete(key);
        this.entries.set(key, hit);
        return hit.result;
      }
      this.entries.delete(key);
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const call = this.inner
      .generateEmbedding(text)
      .then(result => {
        this.store(key, result);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, call);
    return call;
  }

  generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return this.inner.generateEmbeddingsBatch(texts);
  }

  private store(key: string, result: EmbeddingResult): void {
    // an empty vector is no result worth keeping
    if (!Array.isArray(result.embedding) || result.embedding.length === 0) {
      return;
    }
    this.entries.set(key, {
      result,
      expiresAt: this.now() + this.ttlMs,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
