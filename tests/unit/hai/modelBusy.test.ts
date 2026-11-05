/**
 * @jest-environment node
 */

// A busy or slow model (docs/hai-geschwindigkeit.md, "Ausgelastet"): a time
// limit or a status of overload (429, 502, 503, 504, 524) of the model server
// ends in a ChatUnavailableError that is marked as busy, so the person is told
// the truth (MODEL_BUSY, try again in a minute) and not "not reachable". A wrong
// key or a bad request stays a different failure. An empty answer is asked again once and then told like a busy model. The first
// byte limit is 90 seconds by default and can be set between 15 and 150 seconds.
// No real model is called: Sokrates is a stand-in on localhost.

import { OpenAICompatibleChatProvider } from '@/lib/hai/providers/openai-compatible';
import {
  DEFAULT_FIRST_BYTE_TIMEOUT_MS,
  MAX_FIRST_BYTE_TIMEOUT_MS,
  MIN_FIRST_BYTE_TIMEOUT_MS,
  resolveFirstByteTimeoutMs,
} from '@/lib/hai/providers/openai-compatible';
import {
  ChatProviderError,
  ChatUnavailableError,
  MODEL_BUSY_CODE,
  MODEL_BUSY_I18N_KEY,
  MODEL_BUSY_RETRY_AFTER_SEC,
  isModelBusyError,
  modelBusyPayload,
} from '@/lib/hai/providers/errors';
import { runChatChain, type ChatChain } from '@/lib/hai/providers';
import type { ChatProvider } from '@/lib/hai/providers/types';
import {
  answers,
  reply,
  startFakeSokrates,
  type FakeSokrates,
} from '../../helpers/fakeSokrates';

const MARKER = 'USER-MARKER-9c1d';
const KEY = 'test-key-NOT-A-SECRET';

describe('isModelBusyError', () => {
  it.each([
    ['timeout', new ChatProviderError('timeout', 'x')],
    ['429', new ChatProviderError('http', 'x', 429)],
    ['502', new ChatProviderError('http', 'x', 502)],
    ['503', new ChatProviderError('http', 'x', 503)],
    ['504', new ChatProviderError('http', 'x', 504)],
    ['524', new ChatProviderError('http', 'x', 524)],
    ['an AbortError', Object.assign(new Error('x'), { name: 'AbortError' })],
    ['a TimeoutError', Object.assign(new Error('x'), { name: 'TimeoutError' })],
    ['a status field 503', Object.assign(new Error('x'), { status: 503 })],
  ])('%s is busy', (_name, error) => {
    expect(isModelBusyError(error)).toBe(true);
  });

  it.each([
    ['401 (key refused)', new ChatProviderError('http', 'x', 401)],
    ['403', new ChatProviderError('http', 'x', 403)],
    ['400', new ChatProviderError('http', 'x', 400)],
    ['500', new ChatProviderError('http', 'x', 500)],
    ['an empty answer', new ChatProviderError('empty', 'x')],
    ['a refused connection', new ChatProviderError('network', 'x')],
    ['invalid JSON', new ChatProviderError('invalid', 'x')],
    ['a plain error', new Error('503 in the text only')],
    ['a string', 'timeout'],
    ['null', null],
  ])('%s is not busy', (_name, error) => {
    expect(isModelBusyError(error)).toBe(false);
  });
});

describe('the payload for the client', () => {
  it('has the code and the seconds, nothing else', () => {
    expect(modelBusyPayload()).toEqual({
      code: 'MODEL_BUSY',
      retryAfterSec: 30,
    });
    expect(MODEL_BUSY_CODE).toBe('MODEL_BUSY');
    expect(MODEL_BUSY_RETRY_AFTER_SEC).toBe(30);
    expect(MODEL_BUSY_I18N_KEY).toBe('hai.error.modelBusy');
  });
});

describe('runChatChain with Sokrates as the only provider', () => {
  let fake: FakeSokrates;
  const logged: string[] = [];

  beforeEach(async () => {
    logged.length = 0;
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(
          args
            .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
            .join(' ')
        );
      });
    }
    fake = await startFakeSokrates(answers(() => 'fine'));
  });

  afterEach(async () => {
    await fake.close();
    jest.restoreAllMocks();
  });

  function chain(timeouts = {}): ChatChain {
    return {
      primary: new OpenAICompatibleChatProvider(
        fake.url,
        KEY,
        'sokrates-fast',
        timeouts
      ),
      fallback: null,
      fallbackState: 'primary_is_sokrates',
    };
  }

  async function failureOf(timeouts = {}): Promise<ChatUnavailableError> {
    const error = await runChatChain(
      chain(timeouts),
      'system',
      [],
      MARKER,
      () => undefined
    ).catch(e => e);
    expect(error).toBeInstanceOf(ChatUnavailableError);
    return error as ChatUnavailableError;
  }

  it.each([429, 502, 503, 504, 524])(
    'status %s gives a busy ChatUnavailableError',
    async status => {
      fake.setHandler((_s, res) => reply(res, status, '{"error":"busy"}'));
      const error = await failureOf();
      expect(error.modelBusy).toBe(true);
      // not a text of the model server and not the question in the message
      expect(error.message).not.toContain(MARKER);
    }
  );

  it('a stream that sends no first byte within its limit gives a busy error', async () => {
    fake.setHandler(() => undefined);
    const error = await failureOf({ firstByteTimeoutMs: 150 });
    expect(error.modelBusy).toBe(true);
    expect(error.reason).toBe('no_fallback');
  });

  it.each([401, 403, 400, 500])(
    'status %s is not busy (wrong setup or a failure of the server)',
    async status => {
      fake.setHandler((_s, res) => reply(res, status, '{"error":"x"}'));
      const error = await failureOf();
      expect(error.modelBusy).toBe(false);
    }
  );

  it('an empty answer (asked again once, still empty) is told like a busy model', async () => {
    fake.setHandler((_s, res) =>
      reply(
        res,
        200,
        JSON.stringify({ choices: [{ message: { content: ' ' } }] })
      )
    );
    const error = await failureOf();
    // the server did not answer: the person gets "busy, try again in a minute"
    // and not an empty bubble (docs/hai-golden-set.md, 5e); the chain asks once
    // more before it says so
    expect(error.modelBusy).toBe(true);
    expect(error.reason).toBe('no_fallback');
    expect(fake.requests).toHaveLength(2);
  });

  it('a break-off after the first text is "interrupted" and not busy (the text is already there)', async () => {
    const stalling: ChatProvider = {
      name: 'openai-compatible',
      isInitialized: () => true,
      generateResponse: async () => {
        throw new Error('not used');
      },
      generateResponseStream: async (_s, _m, _u, onChunk) => {
        onChunk('half an answer');
        throw new ChatProviderError('timeout', 'x');
      },
    };
    const error = await runChatChain(
      {
        primary: stalling,
        fallback: null,
        fallbackState: 'primary_is_sokrates',
      },
      'system',
      [],
      MARKER,
      () => undefined
    ).catch(e => e);
    expect((error as ChatUnavailableError).reason).toBe('interrupted');
    expect((error as ChatUnavailableError).modelBusy).toBe(false);
  });

  it('the last failure decides: busy primary, then a refused key at Sokrates is not busy', async () => {
    const busyPrimary: ChatProvider = {
      name: 'gemini',
      isInitialized: () => true,
      generateResponse: async () => {
        throw new ChatProviderError('http', 'x', 503);
      },
      generateResponseStream: async () => {
        throw new ChatProviderError('http', 'x', 503);
      },
    };
    fake.setHandler((_s, res) => reply(res, 401, '{"error":"key"}'));
    const error = await runChatChain(
      {
        primary: busyPrimary,
        fallback: chain().primary,
        fallbackState: 'sokrates',
      },
      'system',
      [],
      MARKER,
      () => undefined
    ).catch(e => e);
    expect((error as ChatUnavailableError).reason).toBe('fallback_failed');
    expect((error as ChatUnavailableError).modelBusy).toBe(false);
  });

  it('a busy answer never goes to another provider: there is none, one request only', async () => {
    fake.setHandler((_s, res) => reply(res, 503, '{"error":"busy"}'));
    await failureOf();
    expect(fake.requests).toHaveLength(1);
  });
});

describe('the first byte limit', () => {
  it('is 90 seconds by default, between 15 and 150 seconds', () => {
    expect(DEFAULT_FIRST_BYTE_TIMEOUT_MS).toBe(90_000);
    expect(MIN_FIRST_BYTE_TIMEOUT_MS).toBe(15_000);
    expect(MAX_FIRST_BYTE_TIMEOUT_MS).toBe(150_000);
    expect(resolveFirstByteTimeoutMs(undefined)).toBe(90_000);
  });

  it.each([
    ['60000', 60_000],
    [' 120000 ', 120_000],
    ['15000', 15_000],
    ['150000', 150_000],
  ])('reads %p as %p', (raw, expected) => {
    expect(resolveFirstByteTimeoutMs(raw)).toBe(expected);
  });

  it.each([
    '',
    'abc',
    '-5',
    '0',
    '14999',
    '150001',
    '1e5',
    '90.5',
    '90 000',
    '90s',
    '999999999999',
  ])('falls back to the default for the invalid value %p', raw => {
    expect(resolveFirstByteTimeoutMs(raw)).toBe(90_000);
  });

  it('a provider takes the value of HAI_CHAT_FIRST_BYTE_TIMEOUT_MS, else the default', () => {
    const before = process.env.HAI_CHAT_FIRST_BYTE_TIMEOUT_MS;
    try {
      const limitOf = () =>
        (new OpenAICompatibleChatProvider('http://127.0.0.1:1/api', KEY) as any)
          .timeouts.firstByteTimeoutMs;
      delete process.env.HAI_CHAT_FIRST_BYTE_TIMEOUT_MS;
      expect(limitOf()).toBe(90_000);
      process.env.HAI_CHAT_FIRST_BYTE_TIMEOUT_MS = '45000';
      expect(limitOf()).toBe(45_000);
      process.env.HAI_CHAT_FIRST_BYTE_TIMEOUT_MS = 'nonsense';
      expect(limitOf()).toBe(90_000);
    } finally {
      if (before === undefined)
        delete process.env.HAI_CHAT_FIRST_BYTE_TIMEOUT_MS;
      else process.env.HAI_CHAT_FIRST_BYTE_TIMEOUT_MS = before;
    }
  });
});
