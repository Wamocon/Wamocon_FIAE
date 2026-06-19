/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { OpenAICompatibleChatProvider } from '../../../../src/lib/hai/providers/openai-compatible';

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
          choices: [{ message: { content: '' } }],
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
