/**
 * @jest-environment node
 */

// Package CF1: the fallback of the HAI chat is the own AI Sokrates and nothing
// else. If the primary provider fails, only the OpenAI compatible provider is
// tried, and only if OPENAI_COMPATIBLE_API_KEY is set. Without it there is no
// fallback and the caller gets a typed error, never a silent switch to Gemini,
// Claude, OpenRouter or Ollama. No real model is called: the foreign providers
// are stand-ins that record every use, Sokrates is a stand-in on localhost or a
// mocked fetch.

const mockGemini = {
  generate: jest.fn(),
  stream: jest.fn(),
  ready: true,
};
const mockForeign = jest.fn();

jest.mock('@/lib/hai/providers/gemini', () => ({
  GeminiChatProvider: class {
    readonly name = 'gemini';
    isInitialized() {
      return mockGemini.ready;
    }
    generateResponse(...args: unknown[]) {
      return mockGemini.generate(...args);
    }
    generateResponseStream(...args: unknown[]) {
      return mockGemini.stream(...args);
    }
  },
  GeminiEmbeddingProvider: class {
    readonly name = 'gemini-embedding';
    readonly dimensions = 3072;
    isInitialized() {
      return true;
    }
  },
}));
jest.mock('@/lib/hai/providers/claude', () => ({
  ClaudeChatProvider: class {
    readonly name = 'claude';
    constructor() {
      mockForeign('claude:construct');
    }
    isInitialized() {
      return true;
    }
    generateResponse() {
      mockForeign('claude:generate');
      return Promise.resolve({ text: 'x', citations: [], provider: 'claude' });
    }
    generateResponseStream() {
      mockForeign('claude:stream');
      return Promise.resolve({ text: 'x', citations: [], provider: 'claude' });
    }
  },
}));
jest.mock('@/lib/hai/providers/openrouter', () => ({
  OpenRouterChatProvider: class {
    readonly name = 'openrouter';
    constructor() {
      mockForeign('openrouter:construct');
    }
    isInitialized() {
      return true;
    }
    generateResponse() {
      mockForeign('openrouter:generate');
      return Promise.resolve({
        text: 'x',
        citations: [],
        provider: 'openrouter',
      });
    }
    generateResponseStream() {
      mockForeign('openrouter:stream');
      return Promise.resolve({
        text: 'x',
        citations: [],
        provider: 'openrouter',
      });
    }
  },
}));

import {
  chatWithFallback,
  getChatProvider,
  getProviderStatus,
  resetProviders,
  resolveChatChain,
  runChatChain,
} from '@/lib/hai/providers';
import {
  ChatUnavailableError,
  isChatUnavailableError,
} from '@/lib/hai/providers/errors';
import {
  loadProviderConfig,
  type ChatProvider,
  type ChatResponse,
} from '@/lib/hai/providers/types';
import {
  answers,
  completion,
  reply,
  startFakeSokrates,
  type FakeSokrates,
} from '../../../helpers/fakeSokrates';

const SYSTEM_MARKER = 'SYSTEM-MARKER-3f9a';
const USER_MARKER = 'USER-MARKER-71c2';
const ANSWER_MARKER = 'ANSWER-MARKER-be04';
const KEY = 'test-key-NOT-A-SECRET';

const ENV_KEYS = [
  'HAI_CHAT_PROVIDER',
  'HAI_CHAT_FALLBACK',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_COMPATIBLE_API_KEY',
  'OPENAI_COMPATIBLE_BASE_URL',
  'OPENAI_COMPATIBLE_MODEL',
  'CONTENT_UPLOAD_KI_ALLOWED_HOSTS',
  'OLLAMA_BASE_URL',
];

const LOCAL_POLICY = { requireHttps: false, allowedHosts: ['127.0.0.1'] };

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function setEnv(values: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

/** The environment of Vercel as described by the owner (28.10.2026), Sokrates set. */
const VERCEL_LIKE = {
  HAI_CHAT_PROVIDER: 'gemini',
  GEMINI_API_KEY: 'g-key',
  OPENROUTER_API_KEY: 'o-key',
  ANTHROPIC_API_KEY: 'a-key',
};

function fakePrimary(
  behavior: {
    initialized?: boolean;
    text?: string;
    chunks?: string[];
    failBeforeOutput?: Error;
    failAfterChunks?: Error;
  } = {}
): ChatProvider & { calls: number } {
  const provider = {
    name: 'gemini',
    calls: 0,
    isInitialized: () => behavior.initialized ?? true,
    generateResponse: async (): Promise<ChatResponse> => {
      provider.calls += 1;
      if (behavior.failBeforeOutput) throw behavior.failBeforeOutput;
      return {
        text: behavior.text ?? 'primary answer',
        citations: [],
        provider: 'gemini',
      };
    },
    generateResponseStream: async (
      _s: string,
      _m: unknown,
      _u: string,
      onChunk: (t: string) => void
    ): Promise<ChatResponse> => {
      provider.calls += 1;
      if (behavior.failBeforeOutput) throw behavior.failBeforeOutput;
      for (const chunk of behavior.chunks ?? ['primary ', 'answer']) {
        onChunk(chunk);
      }
      if (behavior.failAfterChunks) throw behavior.failAfterChunks;
      return {
        text: (behavior.chunks ?? ['primary ', 'answer']).join(''),
        citations: [],
        provider: 'gemini',
      };
    },
  };
  return provider as ChatProvider & { calls: number };
}

function sseHandler(parts: string[], stallAfter = false) {
  return (_seen: unknown, res: import('node:http').ServerResponse) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const part of parts) {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`
      );
    }
    if (!stallAfter) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  };
}

const consoleCalls: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  mockGemini.ready = true;
  consoleCalls.length = 0;
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleCalls.push(
        args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
      );
    });
  }
  resetProviders();
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
  resetProviders();
});

describe('HAI_CHAT_FALLBACK', () => {
  it.each([
    [undefined, 'sokrates'],
    ['', 'sokrates'],
    ['sokrates', 'sokrates'],
    ['SOKRATES', 'sokrates'],
    ['none', 'none'],
    [' None ', 'none'],
    // "any" (all providers as before) does not exist: it is dropped to the default
    ['any', 'sokrates'],
    ['all', 'sokrates'],
    ['gemini', 'sokrates'],
    ['openrouter', 'sokrates'],
    ['claude', 'sokrates'],
    ['false', 'sokrates'],
  ])('reads %p as %p', (raw, expected) => {
    setEnv({ HAI_CHAT_FALLBACK: raw });
    expect(loadProviderConfig().chatFallback).toBe(expected);
  });

  it('does not echo an unknown value into the log', () => {
    setEnv({ HAI_CHAT_FALLBACK: 'SECRET-LOOKING-VALUE' });
    loadProviderConfig();
    expect(consoleCalls.join('\n')).not.toContain('SECRET-LOOKING-VALUE');
  });
});

describe('resolveChatChain: which providers can ever be used', () => {
  it('Sokrates is the only fallback, whatever other keys are set', () => {
    setEnv({
      ...VERCEL_LIKE,
      OPENAI_COMPATIBLE_API_KEY: KEY,
      OPENAI_COMPATIBLE_MODEL: 'sokrates-fast',
    });
    const chain = resolveChatChain(loadProviderConfig(), fakePrimary());
    expect(chain.fallbackState).toBe('sokrates');
    expect(chain.fallback?.name).toBe('openai-compatible');
    expect(chain.primary?.name).toBe('gemini');
    // no foreign provider was even constructed
    expect(mockForeign).not.toHaveBeenCalled();
  });

  it('without OPENAI_COMPATIBLE_API_KEY there is no fallback, other keys do not count', () => {
    setEnv(VERCEL_LIKE);
    const chain = resolveChatChain(loadProviderConfig(), fakePrimary());
    expect(chain.fallback).toBeNull();
    expect(chain.fallbackState).toBe('no_key');
    expect(mockForeign).not.toHaveBeenCalled();
  });

  it('a blank key or a key that cannot be a bearer token is no key', () => {
    for (const bad of ['   ', 'abc def', 'abc\ndef']) {
      setEnv({ ...VERCEL_LIKE, OPENAI_COMPATIBLE_API_KEY: bad });
      const chain = resolveChatChain(loadProviderConfig(), fakePrimary());
      expect(chain.fallback).toBeNull();
      expect(chain.fallbackState).toBe('no_key');
    }
  });

  it('HAI_CHAT_FALLBACK=none switches the fallback off even with a key', () => {
    setEnv({
      ...VERCEL_LIKE,
      OPENAI_COMPATIBLE_API_KEY: KEY,
      HAI_CHAT_FALLBACK: 'none',
    });
    const chain = resolveChatChain(loadProviderConfig(), fakePrimary());
    expect(chain.fallback).toBeNull();
    expect(chain.fallbackState).toBe('disabled');
  });

  it('HAI_CHAT_FALLBACK=any is dropped to sokrates, it never opens the other providers', () => {
    setEnv({
      ...VERCEL_LIKE,
      OPENAI_COMPATIBLE_API_KEY: KEY,
      HAI_CHAT_FALLBACK: 'any',
    });
    const chain = resolveChatChain(loadProviderConfig(), fakePrimary());
    expect(chain.fallback?.name).toBe('openai-compatible');
    expect(chain.fallbackState).toBe('sokrates');
    expect(mockForeign).not.toHaveBeenCalled();
  });

  it('a primary that already is Sokrates gets no second Sokrates', () => {
    setEnv({
      HAI_CHAT_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_API_KEY: KEY,
    });
    const chain = resolveChatChain(loadProviderConfig(), fakePrimary());
    expect(chain.fallback).toBeNull();
    expect(chain.fallbackState).toBe('primary_is_sokrates');
  });

  it('an uninitialized primary is left out of the chain', () => {
    setEnv({ ...VERCEL_LIKE, OPENAI_COMPATIBLE_API_KEY: KEY });
    const chain = resolveChatChain(
      loadProviderConfig(),
      fakePrimary({ initialized: false })
    );
    expect(chain.primary).toBeNull();
    expect(chain.fallback?.name).toBe('openai-compatible');
  });

  it.each([
    ['a foreign host', 'https://api.openai.com/v1'],
    ['plain http', 'http://sokrates.test-qualitaetsmanagement.com/api'],
    ['a port', 'https://sokrates.test-qualitaetsmanagement.com:8443/api'],
    [
      'credentials in the address',
      'https://user:pw@sokrates.test-qualitaetsmanagement.com/api',
    ],
    ['an address that is no URL', 'not a url'],
    ['localhost', 'https://localhost/api'],
    [
      'a look-alike host',
      'https://sokrates.test-qualitaetsmanagement.com.evil.example/api',
    ],
  ])('refuses %s as the target of the fallback', (_name, baseUrl) => {
    setEnv({
      ...VERCEL_LIKE,
      OPENAI_COMPATIBLE_API_KEY: KEY,
      OPENAI_COMPATIBLE_BASE_URL: baseUrl,
    });
    const chain = resolveChatChain(loadProviderConfig(), fakePrimary());
    expect(chain.fallback).toBeNull();
    expect(chain.fallbackState).toBe('target_rejected');
  });

  it('accepts the default address of Sokrates and a base URL with a trailing slash', () => {
    setEnv({ ...VERCEL_LIKE, OPENAI_COMPATIBLE_API_KEY: KEY });
    expect(
      resolveChatChain(loadProviderConfig(), fakePrimary()).fallbackState
    ).toBe('sokrates');
    setEnv({
      ...VERCEL_LIKE,
      OPENAI_COMPATIBLE_API_KEY: KEY,
      OPENAI_COMPATIBLE_BASE_URL:
        'https://sokrates.test-qualitaetsmanagement.com/api/',
    });
    expect(
      resolveChatChain(loadProviderConfig(), fakePrimary()).fallbackState
    ).toBe('sokrates');
  });

  it('the positive list of the upload stage also bounds the chat fallback', () => {
    setEnv({
      ...VERCEL_LIKE,
      OPENAI_COMPATIBLE_API_KEY: KEY,
      OPENAI_COMPATIBLE_BASE_URL: 'https://other.example.org/api',
      CONTENT_UPLOAD_KI_ALLOWED_HOSTS: 'other.example.org',
    });
    expect(
      resolveChatChain(loadProviderConfig(), fakePrimary()).fallbackState
    ).toBe('sokrates');
    // an invalid list fails closed
    setEnv({
      ...VERCEL_LIKE,
      OPENAI_COMPATIBLE_API_KEY: KEY,
      CONTENT_UPLOAD_KI_ALLOWED_HOSTS: 'localhost',
    });
    expect(
      resolveChatChain(loadProviderConfig(), fakePrimary()).fallbackState
    ).toBe('target_rejected');
  });
});

describe('runChatChain against a stand-in for Sokrates on localhost', () => {
  let fake: FakeSokrates;

  beforeEach(async () => {
    fake = await startFakeSokrates(answers(() => ANSWER_MARKER));
    setEnv({
      ...VERCEL_LIKE,
      OPENAI_COMPATIBLE_API_KEY: KEY,
      OPENAI_COMPATIBLE_BASE_URL: fake.url,
      OPENAI_COMPATIBLE_MODEL: 'sokrates-fast',
    });
  });

  afterEach(async () => {
    await fake.close();
  });

  function chainWith(primary: ChatProvider) {
    return resolveChatChain(loadProviderConfig(), primary, LOCAL_POLICY);
  }

  it('the primary answers: Sokrates is not called', async () => {
    const primary = fakePrimary();
    const result = await runChatChain(
      chainWith(primary),
      SYSTEM_MARKER,
      [],
      USER_MARKER
    );
    expect(result.provider).toBe('gemini');
    expect(primary.calls).toBe(1);
    expect(fake.requests).toHaveLength(0);
  });

  it('the primary fails: Sokrates answers, with reasoning off and the configured model', async () => {
    const primary = fakePrimary({ failBeforeOutput: new Error('boom') });
    const result = await runChatChain(
      chainWith(primary),
      SYSTEM_MARKER,
      [{ role: 'user', content: 'earlier' }],
      USER_MARKER,
      undefined,
      { maxOutputTokens: 500 }
    );
    expect(result.provider).toBe('openai-compatible');
    expect(result.text).toBe(ANSWER_MARKER);
    expect(fake.requests).toHaveLength(1);
    const seen = fake.requests[0];
    expect(seen.url).toBe('/api/chat/completions');
    expect(seen.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(seen.body?.model).toBe('sokrates-fast');
    expect(seen.body?.reasoning_effort).toBe('none');
    expect(seen.body?.stream).toBe(false);
    expect(seen.body?.max_tokens).toBe(500);
    expect(mockForeign).not.toHaveBeenCalled();
  });

  it('the primary fails and Sokrates fails too: a typed error, no third provider', async () => {
    fake.setHandler((_seen, res) => reply(res, 503, 'unavailable'));
    const primary = fakePrimary({ failBeforeOutput: new Error('boom') });
    const error = await runChatChain(
      chainWith(primary),
      SYSTEM_MARKER,
      [],
      USER_MARKER
    ).catch(e => e);
    expect(isChatUnavailableError(error)).toBe(true);
    expect((error as ChatUnavailableError).reason).toBe('fallback_failed');
    expect(fake.requests).toHaveLength(1);
    expect(mockForeign).not.toHaveBeenCalled();
  });

  it('an empty answer of Sokrates (thinking model) is a failure, not a blank message', async () => {
    fake.setHandler((_seen, res) =>
      reply(
        res,
        200,
        JSON.stringify({
          choices: [
            {
              message: { content: '', reasoning: 'hidden thoughts' },
              finish_reason: 'length',
            },
          ],
        })
      )
    );
    const primary = fakePrimary({ failBeforeOutput: new Error('boom') });
    const error = await runChatChain(
      chainWith(primary),
      SYSTEM_MARKER,
      [],
      USER_MARKER
    ).catch(e => e);
    expect(isChatUnavailableError(error)).toBe(true);
    expect((error as ChatUnavailableError).reason).toBe('fallback_failed');
  });

  it('streaming: the primary fails before any output, Sokrates streams the answer', async () => {
    fake.setHandler(sseHandler(['Hallo ', 'Welt']));
    const primary = fakePrimary({ failBeforeOutput: new Error('boom') });
    const chunks: string[] = [];
    const result = await runChatChain(
      chainWith(primary),
      SYSTEM_MARKER,
      [],
      USER_MARKER,
      chunk => chunks.push(chunk)
    );
    expect(chunks).toEqual(['Hallo ', 'Welt']);
    expect(result.text).toBe('Hallo Welt');
    expect(result.provider).toBe('openai-compatible');
    expect(fake.requests[0].body?.stream).toBe(true);
    expect(fake.requests[0].body?.reasoning_effort).toBe('none');
  });

  it('streaming: a primary that broke off after output does not get a second answer glued on', async () => {
    fake.setHandler(sseHandler(['should not be used']));
    const primary = fakePrimary({
      chunks: ['part one '],
      failAfterChunks: new Error('stream cut'),
    });
    const chunks: string[] = [];
    const error = await runChatChain(
      chainWith(primary),
      SYSTEM_MARKER,
      [],
      USER_MARKER,
      chunk => chunks.push(chunk)
    ).catch(e => e);
    expect(chunks).toEqual(['part one ']);
    expect(isChatUnavailableError(error)).toBe(true);
    expect((error as ChatUnavailableError).reason).toBe('interrupted');
    expect(fake.requests).toHaveLength(0);
  });

  it('streaming: an empty stream of Sokrates is a failure', async () => {
    fake.setHandler(sseHandler([]));
    const primary = fakePrimary({ failBeforeOutput: new Error('boom') });
    const chunks: string[] = [];
    const error = await runChatChain(
      chainWith(primary),
      SYSTEM_MARKER,
      [],
      USER_MARKER,
      chunk => chunks.push(chunk)
    ).catch(e => e);
    expect(isChatUnavailableError(error)).toBe(true);
    expect((error as ChatUnavailableError).reason).toBe('fallback_failed');
    expect(fake.requests).toHaveLength(1);
    expect(chunks).toEqual([]);
  });

  it('never logs the content of the conversation or of the answer', async () => {
    fake.setHandler((_seen, res) =>
      reply(
        res,
        500,
        JSON.stringify({
          error: {
            message: `${USER_MARKER} ${ANSWER_MARKER}`,
            type: 'server_error',
          },
        })
      )
    );
    const primary = fakePrimary({
      failBeforeOutput: new Error(`${USER_MARKER} ${SYSTEM_MARKER}`),
    });
    await runChatChain(
      chainWith(primary),
      SYSTEM_MARKER,
      [],
      USER_MARKER
    ).catch(() => undefined);
    const log = consoleCalls.join('\n');
    expect(log.length).toBeGreaterThan(0);
    for (const marker of [SYSTEM_MARKER, USER_MARKER, ANSWER_MARKER, KEY]) {
      expect(log).not.toContain(marker);
    }
  });
});

describe('no fallback: a clear error instead of a foreign provider', () => {
  it.each([
    ['no key', { ...VERCEL_LIKE }],
    [
      'switched off',
      {
        ...VERCEL_LIKE,
        OPENAI_COMPATIBLE_API_KEY: KEY,
        HAI_CHAT_FALLBACK: 'none',
      },
    ],
    [
      'a target outside the list',
      {
        ...VERCEL_LIKE,
        OPENAI_COMPATIBLE_API_KEY: KEY,
        OPENAI_COMPATIBLE_BASE_URL: 'https://api.openai.com/v1',
      },
    ],
  ])(
    '%s: the primary fails, the caller gets ChatUnavailableError',
    async (_n, env) => {
      setEnv(env);
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;
      mockGemini.generate.mockRejectedValue(new Error('quota'));

      const error = await chatWithFallback(
        SYSTEM_MARKER,
        [],
        USER_MARKER
      ).catch(e => e);

      expect(isChatUnavailableError(error)).toBe(true);
      expect((error as ChatUnavailableError).reason).toBe('no_fallback');
      expect((error as ChatUnavailableError).fallback).not.toBe('sokrates');
      expect(mockGemini.generate).toHaveBeenCalledTimes(1);
      // nothing reached another provider, nothing was fetched at all
      expect(mockForeign).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  it('the same for the streaming call', async () => {
    setEnv(VERCEL_LIKE);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    mockGemini.stream.mockRejectedValue(new Error('quota'));
    const chunks: string[] = [];

    const error = await chatWithFallback(SYSTEM_MARKER, [], USER_MARKER, c =>
      chunks.push(c)
    ).catch(e => e);

    expect(isChatUnavailableError(error)).toBe(true);
    expect(chunks).toEqual([]);
    expect(mockForeign).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the error message carries no content and no key', async () => {
    setEnv({ ...VERCEL_LIKE, OPENAI_COMPATIBLE_API_KEY: KEY });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => `${ANSWER_MARKER} ${USER_MARKER}`,
    }) as unknown as typeof fetch;
    mockGemini.generate.mockRejectedValue(
      new Error(`${USER_MARKER} ${SYSTEM_MARKER}`)
    );
    const error = await chatWithFallback(SYSTEM_MARKER, [], USER_MARKER).catch(
      e => e
    );
    expect(isChatUnavailableError(error)).toBe(true);
    const text = `${(error as Error).message} ${consoleCalls.join('\n')}`;
    for (const marker of [SYSTEM_MARKER, USER_MARKER, ANSWER_MARKER, KEY]) {
      expect(text).not.toContain(marker);
    }
  });
});

describe('chatWithFallback through the environment (mocked fetch, default policy)', () => {
  it('uses Sokrates at its default address when the primary fails', async () => {
    setEnv({
      ...VERCEL_LIKE,
      OPENAI_COMPATIBLE_API_KEY: KEY,
      OPENAI_COMPATIBLE_MODEL: 'sokrates-fast',
    });
    mockGemini.generate.mockRejectedValue(new Error('quota'));
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => completion('fallback answer'),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await chatWithFallback('system', [], 'user');

    expect(result.text).toBe('fallback answer');
    expect(result.provider).toBe('openai-compatible');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://sokrates.test-qualitaetsmanagement.com/api/chat/completions'
    );
    const body = JSON.parse(String(init.body));
    expect(body.reasoning_effort).toBe('none');
    expect(body.model).toBe('sokrates-fast');
    expect(mockForeign).not.toHaveBeenCalled();
  });

  it('the primary answers: nothing is fetched', async () => {
    setEnv({ ...VERCEL_LIKE, OPENAI_COMPATIBLE_API_KEY: KEY });
    mockGemini.generate.mockResolvedValue({
      text: 'primary',
      citations: [],
      provider: 'gemini',
    });
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const result = await chatWithFallback('system', [], 'user');
    expect(result.provider).toBe('gemini');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('getChatProvider and getProviderStatus', () => {
  it('returns the primary when it is ready', () => {
    setEnv({ ...VERCEL_LIKE, OPENAI_COMPATIBLE_API_KEY: KEY });
    expect(getChatProvider().name).toBe('gemini');
  });

  it('returns Sokrates when the primary is not ready but Sokrates is set', () => {
    mockGemini.ready = false;
    setEnv({ ...VERCEL_LIKE, OPENAI_COMPATIBLE_API_KEY: KEY });
    expect(getChatProvider().name).toBe('openai-compatible');
  });

  it('does not hand out a foreign provider when the primary is not ready', () => {
    mockGemini.ready = false;
    setEnv(VERCEL_LIKE);
    expect(() => getChatProvider()).toThrow(ChatUnavailableError);
    expect(mockForeign).not.toHaveBeenCalled();
  });

  it('throws the typed error when nothing can answer', () => {
    setEnv({ HAI_CHAT_PROVIDER: 'openai-compatible' });
    let thrown: unknown;
    try {
      getChatProvider();
    } catch (error) {
      thrown = error;
    }
    expect(isChatUnavailableError(thrown)).toBe(true);
    expect((thrown as ChatUnavailableError).reason).toBe('no_provider');
  });

  it('reports the fallback state to the diagnostics', () => {
    setEnv({ ...VERCEL_LIKE, OPENAI_COMPATIBLE_API_KEY: KEY });
    expect(getProviderStatus().fallback).toEqual({
      provider: 'openai-compatible',
      initialized: true,
    });
    expect(getProviderStatus().fallbackState).toBe('sokrates');

    resetProviders();
    setEnv(VERCEL_LIKE);
    expect(getProviderStatus().fallback).toBeNull();
    expect(getProviderStatus().fallbackState).toBe('no_key');
  });
});
