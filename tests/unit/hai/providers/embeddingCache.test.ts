/**
 * @jest-environment node
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  CachedEmbeddingProvider,
  EMBEDDING_CACHE_MAX_ENTRIES,
  EMBEDDING_CACHE_TTL_MS,
} from '@/lib/hai/providers/embeddingCache';
import type {
  EmbeddingProvider,
  EmbeddingResult,
} from '@/lib/hai/providers/types';

// The cache keeps the vector of a question for a short time. It must never
// mix two texts, never keep a failure, never leak the text or a person, and it
// must not touch the indexing (batch).

function inner(
  generate: (text: string) => Promise<EmbeddingResult> = async text => ({
    embedding: [text.length, 1, 2],
  })
) {
  const generateEmbedding = jest.fn(generate);
  const generateEmbeddingsBatch = jest.fn(async (texts: string[]) =>
    texts.map(t => ({ embedding: [t.length] }))
  );
  const provider: EmbeddingProvider = {
    name: 'test-provider',
    dimensions: 3,
    isInitialized: () => true,
    generateEmbedding,
    generateEmbeddingsBatch,
  };
  return { provider, generateEmbedding, generateEmbeddingsBatch };
}

describe('CachedEmbeddingProvider', () => {
  it('passes name, dimensions and the initialized state through', () => {
    const { provider } = inner();
    const cached = new CachedEmbeddingProvider(provider);
    expect(cached.name).toBe('test-provider');
    expect(cached.dimensions).toBe(3);
    expect(cached.isInitialized()).toBe(true);
  });

  it('calls the provider once for the same text', async () => {
    const { provider, generateEmbedding } = inner();
    const cached = new CachedEmbeddingProvider(provider);
    const first = await cached.generateEmbedding('Was ist ein Router?');
    const second = await cached.generateEmbedding('Was ist ein Router?');
    expect(second).toEqual(first);
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
  });

  it('treats other spaces around the same words as the same text', async () => {
    const { provider, generateEmbedding } = inner();
    const cached = new CachedEmbeddingProvider(provider);
    await cached.generateEmbedding('Was ist  ein Router?');
    await cached.generateEmbedding('  Was ist ein   Router? ');
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
  });

  it('never gives the vector of one text for another text', async () => {
    const { provider, generateEmbedding } = inner();
    const cached = new CachedEmbeddingProvider(provider);
    const a = await cached.generateEmbedding('kurz');
    const b = await cached.generateEmbedding('ein etwas längerer Text');
    expect(a.embedding).not.toEqual(b.embedding);
    expect(generateEmbedding).toHaveBeenCalledTimes(2);
  });

  it('keeps a different case apart (the vector depends on it)', async () => {
    const { provider, generateEmbedding } = inner();
    const cached = new CachedEmbeddingProvider(provider);
    await cached.generateEmbedding('SQL');
    await cached.generateEmbedding('sql');
    expect(generateEmbedding).toHaveBeenCalledTimes(2);
  });

  it('two requests at the same moment share one call', async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => {
      release = resolve;
    });
    const { provider, generateEmbedding } = inner(async () => {
      await wait;
      return { embedding: [7] };
    });
    const cached = new CachedEmbeddingProvider(provider);
    const one = cached.generateEmbedding('gleiche Frage');
    const two = cached.generateEmbedding('gleiche Frage');
    release();
    expect(await one).toEqual({ embedding: [7] });
    expect(await two).toEqual({ embedding: [7] });
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failure: the next request asks again', async () => {
    let calls = 0;
    const { provider, generateEmbedding } = inner(async () => {
      calls += 1;
      if (calls === 1) throw new Error('Sokrates embeddings failed (500)');
      return { embedding: [1, 2, 3] };
    });
    const cached = new CachedEmbeddingProvider(provider);
    await expect(cached.generateEmbedding('Frage')).rejects.toThrow(
      'failed (500)'
    );
    expect(cached.size).toBe(0);
    await expect(cached.generateEmbedding('Frage')).resolves.toEqual({
      embedding: [1, 2, 3],
    });
    expect(generateEmbedding).toHaveBeenCalledTimes(2);
  });

  it('does not keep an empty vector', async () => {
    const { provider, generateEmbedding } = inner(async () => ({
      embedding: [],
    }));
    const cached = new CachedEmbeddingProvider(provider);
    await cached.generateEmbedding('Frage');
    await cached.generateEmbedding('Frage');
    expect(cached.size).toBe(0);
    expect(generateEmbedding).toHaveBeenCalledTimes(2);
  });

  it('forgets an entry after the lifetime', async () => {
    let now = 1_000;
    const { provider, generateEmbedding } = inner();
    const cached = new CachedEmbeddingProvider(provider, { now: () => now });
    await cached.generateEmbedding('Frage');
    now += EMBEDDING_CACHE_TTL_MS - 1;
    await cached.generateEmbedding('Frage');
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
    now += 2;
    await cached.generateEmbedding('Frage');
    expect(generateEmbedding).toHaveBeenCalledTimes(2);
  });

  it('holds at most the configured number of entries, oldest first out', async () => {
    const { provider, generateEmbedding } = inner();
    const cached = new CachedEmbeddingProvider(provider, { maxEntries: 2 });
    await cached.generateEmbedding('eins');
    await cached.generateEmbedding('zwei');
    await cached.generateEmbedding('drei');
    expect(cached.size).toBe(2);
    generateEmbedding.mockClear();
    await cached.generateEmbedding('drei');
    await cached.generateEmbedding('zwei');
    expect(generateEmbedding).not.toHaveBeenCalled();
    await cached.generateEmbedding('eins');
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
  });

  it('a read keeps an entry young (least recently used goes first)', async () => {
    const { provider, generateEmbedding } = inner();
    const cached = new CachedEmbeddingProvider(provider, { maxEntries: 2 });
    await cached.generateEmbedding('eins');
    await cached.generateEmbedding('zwei');
    await cached.generateEmbedding('eins'); // read: eins is the youngest now
    await cached.generateEmbedding('drei'); // pushes zwei out
    generateEmbedding.mockClear();
    await cached.generateEmbedding('eins');
    expect(generateEmbedding).not.toHaveBeenCalled();
    await cached.generateEmbedding('zwei');
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
  });

  it('the batch of the indexing goes straight through and is not cached', async () => {
    const { provider, generateEmbedding, generateEmbeddingsBatch } = inner();
    const cached = new CachedEmbeddingProvider(provider);
    await cached.generateEmbeddingsBatch(['a', 'bb']);
    await cached.generateEmbeddingsBatch(['a', 'bb']);
    expect(generateEmbeddingsBatch).toHaveBeenCalledTimes(2);
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(cached.size).toBe(0);
  });

  it('the key holds neither the text nor a person: only a hash is a key', async () => {
    const { provider } = inner();
    const cached = new CachedEmbeddingProvider(provider);
    await cached.generateEmbedding('Frage von Max Mustermann');
    const keys = [
      ...((
        cached as unknown as { entries: Map<string, unknown> }
      ).entries.keys() as Iterable<string>),
    ];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(keys[0]).not.toContain('Mustermann');
  });

  it('has sensible limits', () => {
    expect(EMBEDDING_CACHE_TTL_MS).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(EMBEDDING_CACHE_MAX_ENTRIES).toBeLessThanOrEqual(200);
  });
});
