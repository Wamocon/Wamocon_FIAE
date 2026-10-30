/**
 * @jest-environment node
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

// HAI_EMBEDDING_PROVIDER=openai-compatible selects the embeddings of Sokrates.
// The key goes only to an address that passes the rules of Sokrates (https, a
// host of the positive list). No network: nothing is called here.

const ENV_KEYS = [
  'HAI_EMBEDDING_PROVIDER',
  'HAI_EMBEDDING_DIMENSIONS',
  'HAI_SOKRATES_EMBEDDING_MODEL',
  'OPENAI_COMPATIBLE_BASE_URL',
  'OPENAI_COMPATIBLE_API_KEY',
  'CONTENT_UPLOAD_KI_ALLOWED_HOSTS',
  'GEMINI_API_KEY',
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  jest.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

async function embeddingProvider() {
  const mod = await import('@/lib/hai/providers');
  mod.resetProviders();
  return mod.getEmbeddingProvider();
}

describe('loadProviderConfig for the embeddings', () => {
  it('defaults to Gemini and knows the value openai-compatible', async () => {
    const { loadProviderConfig } = await import('@/lib/hai/providers/types');
    expect(loadProviderConfig().embeddingProvider).toBe('gemini');
    process.env.HAI_EMBEDDING_PROVIDER = 'openai-compatible';
    const config = loadProviderConfig();
    expect(config.embeddingProvider).toBe('openai-compatible');
    expect(config.sokratesEmbedding).toEqual({
      model: 'qwen3-embedding',
      dimensions: 3072,
    });
  });

  it('takes the model and the dimensions from the environment', async () => {
    process.env.HAI_EMBEDDING_PROVIDER = 'openai-compatible';
    process.env.HAI_SOKRATES_EMBEDDING_MODEL = 'other-model';
    process.env.HAI_EMBEDDING_DIMENSIONS = '1024';
    const { loadProviderConfig } = await import('@/lib/hai/providers/types');
    expect(loadProviderConfig().sokratesEmbedding).toEqual({
      model: 'other-model',
      dimensions: 1024,
    });
  });

  it('drops an unknown value to Gemini', async () => {
    process.env.HAI_EMBEDDING_PROVIDER = 'something-else';
    const { loadProviderConfig } = await import('@/lib/hai/providers/types');
    expect(loadProviderConfig().embeddingProvider).toBe('gemini');
  });
});

describe('getEmbeddingProvider with Sokrates', () => {
  it('is ready with the key and the address of Sokrates', async () => {
    process.env.HAI_EMBEDDING_PROVIDER = 'openai-compatible';
    process.env.OPENAI_COMPATIBLE_API_KEY = 'a-key';
    const provider = await embeddingProvider();
    expect(provider.name).toBe('openai-compatible');
    expect(provider.dimensions).toBe(3072);
    expect(provider.isInitialized()).toBe(true);
  });

  it('is not ready without the key', async () => {
    process.env.HAI_EMBEDDING_PROVIDER = 'openai-compatible';
    await expect(embeddingProvider()).rejects.toThrow(
      /OPENAI_COMPATIBLE_API_KEY/
    );
  });

  it('does not send the key to an address that is not on the list', async () => {
    process.env.HAI_EMBEDDING_PROVIDER = 'openai-compatible';
    process.env.OPENAI_COMPATIBLE_API_KEY = 'a-key';
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://evil.example.com/api';
    await expect(embeddingProvider()).rejects.toThrow(/not available/);
  });

  it('does not send the key over http', async () => {
    process.env.HAI_EMBEDDING_PROVIDER = 'openai-compatible';
    process.env.OPENAI_COMPATIBLE_API_KEY = 'a-key';
    process.env.OPENAI_COMPATIBLE_BASE_URL =
      'http://sokrates.test-qualitaetsmanagement.com/api';
    await expect(embeddingProvider()).rejects.toThrow(/not available/);
  });
});
