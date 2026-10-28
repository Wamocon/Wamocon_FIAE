/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { OpenAICompatibleChatProvider } from '../../../../src/lib/hai/providers/openai-compatible';
import { ChatProviderError } from '../../../../src/lib/hai/providers/errors';
import {
  answers,
  completion,
  reply,
  startFakeSokrates,
  type FakeSokrates,
} from '../../../helpers/fakeSokrates';

describe('OpenAICompatibleChatProvider', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should be initialized when baseUrl and apiKey are provided', () => {
    const provider = new OpenAICompatibleChatProvider(
      'https://sokrates.test-qualitaetsmanagement.com/api',
      'sk-test-key'
    );
    expect(provider.isInitialized()).toBe(true);
    expect(provider.name).toBe('openai-compatible');
  });

  it('should not be initialized when apiKey is missing', () => {
    const provider = new OpenAICompatibleChatProvider(
      'https://sokrates.test-qualitaetsmanagement.com/api',
      undefined
    );
    expect(provider.isInitialized()).toBe(false);
  });

  it('should call the configured OpenAI-compatible endpoint', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [
            { message: { content: 'Test response' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
    });
    global.fetch = mockFetch as any;

    const provider = new OpenAICompatibleChatProvider(
      'https://sokrates.test-qualitaetsmanagement.com/api',
      'sk-test-key',
      'gpt-4o-mini'
    );

    const response = await provider.generateResponse(
      'You are a helpful assistant.',
      [],
      'Hello'
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://sokrates.test-qualitaetsmanagement.com/api/chat/completions'
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer sk-test-key',
      'Content-Type': 'application/json',
    });

    const body = JSON.parse(options.body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');

    expect(response.text).toBe('Test response');
    expect(response.provider).toBe('openai-compatible');
    expect(response.tokenCount).toBe(15);
  });

  it('should trim trailing slash from baseUrl', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
        }),
    });
    global.fetch = mockFetch as any;

    const provider = new OpenAICompatibleChatProvider(
      'https://sokrates.test-qualitaetsmanagement.com/api/',
      'sk-test-key'
    );
    await provider.generateResponse('system', [], 'user');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://sokrates.test-qualitaetsmanagement.com/api/chat/completions'
    );
  });

  it('should throw when not initialized', async () => {
    const provider = new OpenAICompatibleChatProvider(
      'https://sokrates.test-qualitaetsmanagement.com/api',
      undefined
    );
    await expect(
      provider.generateResponse('system', [], 'user')
    ).rejects.toThrow('OPENAI_COMPATIBLE_API_KEY');
  });

  it('should throw on API error', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      text: async () => 'Unauthorized',
    });
    global.fetch = mockFetch as any;

    const provider = new OpenAICompatibleChatProvider(
      'https://sokrates.test-qualitaetsmanagement.com/api',
      'sk-test-key'
    );

    await expect(
      provider.generateResponse('system', [], 'user')
    ).rejects.toThrow('OpenAI-compatible API error');
  });

  it('should stream response correctly', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const mockReader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(chunks[0]),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(chunks[1]),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(chunks[2]),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      releaseLock: jest.fn(),
    };

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });
    global.fetch = mockFetch as any;

    const provider = new OpenAICompatibleChatProvider(
      'https://sokrates.test-qualitaetsmanagement.com/api',
      'sk-test-key'
    );

    const receivedChunks: string[] = [];
    const response = await provider.generateResponseStream(
      'system',
      [],
      'user',
      chunk => receivedChunks.push(chunk)
    );

    expect(receivedChunks).toEqual(['Hello', ' world']);
    expect(response.text).toBe('Hello world');
    expect(response.provider).toBe('openai-compatible');
  });
});

describe('OpenAICompatibleChatProvider: reasoning off, empty answers, time limits', () => {
  const MARKER = 'CONTENT-MARKER-5d1e';
  let fake: FakeSokrates;
  let logged: string[];

  beforeEach(async () => {
    logged = [];
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

  function provider(timeouts = {}) {
    return new OpenAICompatibleChatProvider(
      fake.url,
      'test-key-NOT-A-SECRET',
      'sokrates-fast',
      timeouts
    );
  }

  function sse(parts: string[], stall = false) {
    return (_seen: unknown, res: import('node:http').ServerResponse) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const part of parts) {
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`
        );
      }
      if (!stall) res.end('data: [DONE]\n\n');
    };
  }

  it('sends reasoning_effort none in the blocking call', async () => {
    await provider().generateResponse('system', [], 'user');
    expect(fake.requests[0].body?.reasoning_effort).toBe('none');
    expect(fake.requests[0].body?.model).toBe('sokrates-fast');
    expect(fake.requests[0].body?.stream).toBe(false);
  });

  it('sends reasoning_effort none in the streaming call', async () => {
    fake.setHandler(sse(['a']));
    await provider().generateResponseStream('system', [], 'user', () => {});
    expect(fake.requests[0].body?.reasoning_effort).toBe('none');
    expect(fake.requests[0].body?.stream).toBe(true);
  });

  it('treats an empty answer as an error (kind empty), never reads the reasoning', async () => {
    fake.setHandler((_s, res) =>
      reply(
        res,
        200,
        JSON.stringify({
          choices: [
            {
              message: {
                content: '  ',
                reasoning: MARKER,
                reasoning_content: MARKER,
              },
              finish_reason: 'length',
            },
          ],
        })
      )
    );
    const error = await provider()
      .generateResponse('system', [], 'user')
      .catch(e => e);
    expect(error).toBeInstanceOf(ChatProviderError);
    expect((error as ChatProviderError).kind).toBe('empty');
    expect((error as Error).message).not.toContain(MARKER);
    expect(logged.join('\n')).not.toContain(MARKER);
  });

  it('treats a stream without any content as an error (kind empty)', async () => {
    fake.setHandler(sse([]));
    const chunks: string[] = [];
    const error = await provider()
      .generateResponseStream('system', [], 'user', c => chunks.push(c))
      .catch(e => e);
    expect((error as ChatProviderError).kind).toBe('empty');
    expect(chunks).toEqual([]);
  });

  it('keeps the HTTP status and drops the body from the error and the log', async () => {
    fake.setHandler((_s, res) =>
      reply(
        res,
        400,
        JSON.stringify({
          error: {
            message: `${MARKER} echo`,
            type: 'invalid_request_error',
          },
        })
      )
    );
    const error = await provider()
      .generateResponse('system', [], MARKER)
      .catch(e => e);
    expect((error as ChatProviderError).kind).toBe('http');
    expect((error as ChatProviderError).status).toBe(400);
    expect((error as Error).message).not.toContain(MARKER);
    const log = logged.join('\n');
    expect(log).not.toContain(MARKER);
    expect(log).toContain('400');
    expect(log).toContain('invalid_request_error');
  });

  it('does not log a body that is not JSON (kind invalid)', async () => {
    fake.setHandler((_s, res) => reply(res, 200, `not json ${MARKER}`));
    const error = await provider()
      .generateResponse('system', [], 'user')
      .catch(e => e);
    expect((error as ChatProviderError).kind).toBe('invalid');
    expect((error as Error).message).not.toContain(MARKER);
    expect(logged.join('\n')).not.toContain(MARKER);
  });

  it('stops a blocking call that does not answer within its limit (kind timeout)', async () => {
    fake.setHandler(() => undefined);
    const error = await provider({ requestTimeoutMs: 150 })
      .generateResponse('system', [], 'user')
      .catch(e => e);
    expect((error as ChatProviderError).kind).toBe('timeout');
  });

  it('stops a stream that sends no first byte within its limit', async () => {
    fake.setHandler(() => undefined);
    const error = await provider({ firstByteTimeoutMs: 150 })
      .generateResponseStream('system', [], 'user', () => {})
      .catch(e => e);
    expect((error as ChatProviderError).kind).toBe('timeout');
  });

  it('stops a stream that stalls between two chunks, the text so far was delivered', async () => {
    fake.setHandler(sse(['first '], true));
    const chunks: string[] = [];
    const error = await provider({ idleTimeoutMs: 150 })
      .generateResponseStream('system', [], 'user', c => chunks.push(c))
      .catch(e => e);
    expect((error as ChatProviderError).kind).toBe('timeout');
    expect(chunks).toEqual(['first ']);
  });

  it('does not cut a long stream: the limit counts the pause between chunks, not the whole answer', async () => {
    fake.setHandler(async (_s, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (let i = 0; i < 6; i++) {
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: `p${i} ` } }] })}\n\n`
        );
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      res.end('data: [DONE]\n\n');
    });
    const chunks: string[] = [];
    const result = await provider({
      firstByteTimeoutMs: 300,
      idleTimeoutMs: 300,
    }).generateResponseStream('system', [], 'user', c => chunks.push(c));
    expect(chunks).toHaveLength(6);
    expect(result.text).toBe('p0 p1 p2 p3 p4 p5 ');
  });

  it('reports a refused connection as kind network, without the content', async () => {
    const dead = new OpenAICompatibleChatProvider(
      'http://127.0.0.1:1/api',
      'test-key-NOT-A-SECRET'
    );
    const error = await dead
      .generateResponse('system', [], MARKER)
      .catch(e => e);
    expect((error as ChatProviderError).kind).toBe('network');
    expect(logged.join('\n')).not.toContain(MARKER);
  });

  it('counts the tokens of the answer', async () => {
    fake.setHandler((_s, res) => reply(res, 200, completion('with usage')));
    const response = await provider().generateResponse('system', [], 'user');
    expect(response.tokenCount).toBe(160);
  });

  it('does not follow a redirect: the body is never re-sent to another host', async () => {
    const other = await startFakeSokrates(answers(() => 'must not be asked'));
    try {
      fake.setHandler((_s, res) =>
        reply(res, 307, '', { location: `${other.url}/chat/completions` })
      );
      const error = await provider()
        .generateResponse('system', [], MARKER)
        .catch(e => e);
      expect((error as ChatProviderError).kind).toBe('network');
      expect(other.requests).toHaveLength(0);
      fake.setHandler(sse(['x']));
      const streamError = await provider()
        .generateResponseStream('system', [], MARKER, () => {})
        .then(() => null)
        .catch(e => e);
      expect(streamError).toBeNull();
      fake.setHandler((_s, res) =>
        reply(res, 308, '', { location: `${other.url}/chat/completions` })
      );
      const streamRedirect = await provider()
        .generateResponseStream('system', [], MARKER, () => {})
        .catch(e => e);
      expect((streamRedirect as ChatProviderError).kind).toBe('network');
      expect(other.requests).toHaveLength(0);
    } finally {
      await other.close();
    }
  });

  it('reads a last event that comes without a line break', async () => {
    fake.setHandler((_s, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'tail' } }] })}`
      );
    });
    const chunks: string[] = [];
    const result = await provider().generateResponseStream(
      'system',
      [],
      'user',
      c => chunks.push(c)
    );
    expect(chunks).toEqual(['tail']);
    expect(result.text).toBe('tail');
  });

  it('an error of the caller is not swallowed and ends the read', async () => {
    fake.setHandler(sse(['a', 'b']));
    const error = await provider()
      .generateResponseStream('system', [], 'user', () => {
        throw new Error('client left');
      })
      .catch(e => e);
    expect((error as Error).message).toBe('client left');
  });
});
