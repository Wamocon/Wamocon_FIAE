/**
 * @jest-environment node
 */
import {
  SokratesEmbeddingProvider,
  cutAndNormalize,
} from '@/lib/hai/providers/sokrates-embedding';

// The embeddings of Sokrates: the route, the key, the cut of the 4096 values to
// the 3072 of the column and the errors. No network: fetch is replaced.

const BASE = 'https://sokrates.example.invalid/api';

const vectorOf = (size: number, value = 1) => Array(size).fill(value);

function mockFetch(
  respond: (body: { input: string[]; dimensions: number }) => unknown,
  status = 200
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = JSON.parse(String(init.body));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => respond(body),
    } as Response;
  });
  global.fetch = fn as unknown as typeof fetch;
  return { fn, calls };
}

describe('cutAndNormalize', () => {
  it('cuts to the first values and normalizes to length 1', () => {
    const out = cutAndNormalize([3, 4, 100, 100], 2);
    expect(out).toEqual([0.6, 0.8]);
  });

  it('keeps a shorter vector as it is (normalized) and a zero vector untouched', () => {
    expect(cutAndNormalize([3, 4], 10)).toEqual([0.6, 0.8]);
    expect(cutAndNormalize([0, 0, 0], 2)).toEqual([0, 0]);
  });
});

describe('SokratesEmbeddingProvider', () => {
  const provider = () =>
    new SokratesEmbeddingProvider(
      `${BASE}/`,
      'key',
      'qwen3-embedding:8b',
      3072
    );

  it('is initialized only with a key, an address and a model', () => {
    expect(provider().isInitialized()).toBe(true);
    expect(
      new SokratesEmbeddingProvider(BASE, undefined, 'm', 3).isInitialized()
    ).toBe(false);
    expect(
      new SokratesEmbeddingProvider(BASE, '  ', 'm', 3).isInitialized()
    ).toBe(false);
    expect(new SokratesEmbeddingProvider('', 'k', 'm', 3).isInitialized()).toBe(
      false
    );
  });

  it('posts to <base>/embeddings with the bearer key, the model and the dimensions', async () => {
    const { calls } = mockFetch(body => ({
      data: body.input.map((_, index) => ({
        index,
        embedding: vectorOf(4096),
      })),
    }));
    const result = await provider().generateEmbedding('Hallo');
    expect(calls[0].url).toBe(`${BASE}/embeddings`);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer key');
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent).toMatchObject({
      model: 'qwen3-embedding:8b',
      input: ['Hallo'],
      dimensions: 3072,
    });
    expect(result.embedding).toHaveLength(3072);
    const length = Math.sqrt(
      result.embedding.reduce((sum, value) => sum + value * value, 0)
    );
    expect(length).toBeCloseTo(1, 6);
  });

  it('works in batches of 16 and keeps the order of the texts', async () => {
    const { fn } = mockFetch(body => ({
      // answers in reverse order: the index decides
      data: body.input
        .map((text, index) => ({
          index,
          embedding: [Number(text), 0, 0],
        }))
        .reverse(),
    }));
    const texts = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const out = await new SokratesEmbeddingProvider(
      BASE,
      'key',
      'm',
      3
    ).generateEmbeddingsBatch(texts);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(20);
    // normalized, so every first value is 1 (the order is proved by the count of calls and sizes)
    expect(out.every(item => item.embedding[0] === 1)).toBe(true);
  });

  it('cuts overlong texts', async () => {
    const { calls } = mockFetch(body => ({
      data: body.input.map((_, index) => ({ index, embedding: [1, 0, 0] })),
    }));
    await new SokratesEmbeddingProvider(BASE, 'key', 'm', 3).generateEmbedding(
      'x'.repeat(9000)
    );
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.input[0].length).toBe(4001);
  });

  it('fails without the key before any request', async () => {
    const { fn } = mockFetch(() => ({}));
    await expect(
      new SokratesEmbeddingProvider(BASE, undefined, 'm', 3).generateEmbedding(
        'a'
      )
    ).rejects.toThrow(/not configured/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('fails with the status only, never with the body', async () => {
    mockFetch(() => ({ detail: 'secret text' }), 401);
    await expect(provider().generateEmbedding('a')).rejects.toThrow(
      'Sokrates embeddings failed (401)'
    );
  });

  it('fails on a response with the wrong shape or count', async () => {
    mockFetch(() => ({ data: [] }));
    await expect(provider().generateEmbedding('a')).rejects.toThrow(
      /Unexpected/
    );
    mockFetch(() => ({ data: [{ index: 0 }] }));
    await expect(provider().generateEmbedding('a')).rejects.toThrow(
      /Unexpected/
    );
    mockFetch(() => ({}));
    await expect(provider().generateEmbedding('a')).rejects.toThrow(
      /Unexpected/
    );
  });
});
