/**
 * @jest-environment node
 */

// An empty answer in the provider chain (docs/hai-golden-set.md, 5e): asked again
// once at the same provider, then the next provider, then a ChatUnavailableError
// that is told like a busy model. A provider that hands back an empty text
// (Gemini, Claude, OpenRouter and Ollama do not check it) is a failure too, the
// way the provider of Sokrates already reported it. Stand in providers only.

import {
  EMPTY_ANSWER_RETRIES,
  runChatChain,
  type ChatChain,
} from '@/lib/hai/providers';
import {
  ChatProviderError,
  ChatUnavailableError,
  isEmptyAnswerError,
  isModelBusyError,
} from '@/lib/hai/providers/errors';
import type { ChatProvider } from '@/lib/hai/providers/types';

type Step = string | Error;

/** A provider that works through a list of steps: a text, '' (empty) or an error. */
function scripted(name: string, steps: Step[]) {
  let index = 0;
  const calls = { count: 0 };
  const next = (onChunk?: (text: string) => void) => {
    calls.count += 1;
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    if (step instanceof Error) throw step;
    if (step) onChunk?.(step);
    return { text: step, citations: [] };
  };
  const provider: ChatProvider = {
    name,
    isInitialized: () => true,
    generateResponse: async () => next(),
    generateResponseStream: async (_s, _m, _u, onChunk) => next(onChunk),
  };
  return { provider, calls };
}

const chain = (primary: ChatProvider, fallback: ChatProvider | null = null) =>
  ({
    primary,
    fallback,
    fallbackState: fallback ? 'sokrates' : 'disabled',
  }) as ChatChain;

const run = (c: ChatChain, stream: boolean, chunks: string[] = []) =>
  runChatChain(
    c,
    'system',
    [],
    'Frage',
    stream ? text => chunks.push(text) : undefined
  );

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('isEmptyAnswerError', () => {
  it('knows the kind empty and nothing else', () => {
    expect(isEmptyAnswerError(new ChatProviderError('empty', 'x'))).toBe(true);
    expect(isEmptyAnswerError(new ChatProviderError('timeout', 'x'))).toBe(
      false
    );
    expect(isEmptyAnswerError(new Error('empty'))).toBe(false);
    expect(isEmptyAnswerError(null)).toBe(false);
    // an empty answer is not "busy" by itself: the chain decides after the retry
    expect(isModelBusyError(new ChatProviderError('empty', 'x'))).toBe(false);
  });

  it('asks again exactly once', () => {
    expect(EMPTY_ANSWER_RETRIES).toBe(1);
  });
});

describe.each([
  ['blocking', false],
  ['streaming', true],
])('runChatChain, empty answers (%s)', (_name, stream) => {
  it('an empty text is asked again once and the second answer is used', async () => {
    const p = scripted('gemini', ['', 'Die Antwort.']);
    const chunks: string[] = [];
    const result = await run(chain(p.provider), stream, chunks);
    expect(result.text).toBe('Die Antwort.');
    expect(p.calls.count).toBe(2);
    if (stream) expect(chunks).toEqual(['Die Antwort.']);
  });

  it('blanks only are empty', async () => {
    const p = scripted('claude', [' \n ', 'Die Antwort.']);
    const result = await run(chain(p.provider), stream);
    expect(result.text).toBe('Die Antwort.');
    expect(p.calls.count).toBe(2);
  });

  it('empty twice, no fallback: a busy ChatUnavailableError (the person gets "busy", not a blank bubble)', async () => {
    const p = scripted('gemini', ['']);
    const error = await run(chain(p.provider), stream).catch(e => e);
    expect(error).toBeInstanceOf(ChatUnavailableError);
    expect((error as ChatUnavailableError).modelBusy).toBe(true);
    expect((error as ChatUnavailableError).reason).toBe('no_fallback');
    expect(p.calls.count).toBe(2);
  });

  it('a provider that throws the kind empty (Sokrates) is handled the same way', async () => {
    const p = scripted('openai-compatible', [
      new ChatProviderError('empty', 'x'),
      'Die Antwort.',
    ]);
    const result = await run(chain(p.provider), stream);
    expect(result.text).toBe('Die Antwort.');
    expect(p.calls.count).toBe(2);
  });

  it('empty twice at the primary: the fallback answers (two asks at the primary, one at the fallback)', async () => {
    const primary = scripted('gemini', ['']);
    const fallback = scripted('openai-compatible', ['Vom Fallback.']);
    const result = await run(
      chain(primary.provider, fallback.provider),
      stream
    );
    expect(result.text).toBe('Vom Fallback.');
    expect(primary.calls.count).toBe(2);
    expect(fallback.calls.count).toBe(1);
  });

  it('empty at the primary and at the fallback: busy, reason fallback_failed', async () => {
    const primary = scripted('gemini', ['']);
    const fallback = scripted('openai-compatible', ['']);
    const error = await run(
      chain(primary.provider, fallback.provider),
      stream
    ).catch(e => e);
    expect((error as ChatUnavailableError).reason).toBe('fallback_failed');
    expect((error as ChatUnavailableError).modelBusy).toBe(true);
    expect(primary.calls.count).toBe(2);
    expect(fallback.calls.count).toBe(2);
  });

  it('another failure is not asked again at the same provider and is not busy', async () => {
    const p = scripted('gemini', [new ChatProviderError('http', 'x', 401)]);
    const error = await run(chain(p.provider), stream).catch(e => e);
    expect((error as ChatUnavailableError).modelBusy).toBe(false);
    expect(p.calls.count).toBe(1);
  });

  it('the last failure decides: a refused key after an empty answer is not busy', async () => {
    const primary = scripted('gemini', ['']);
    const fallback = scripted('openai-compatible', [
      new ChatProviderError('http', 'x', 401),
    ]);
    const error = await run(
      chain(primary.provider, fallback.provider),
      stream
    ).catch(e => e);
    expect((error as ChatUnavailableError).modelBusy).toBe(false);
  });
});

describe('runChatChain, text already sent', () => {
  it('a stream that broke off after text is not asked again (a second answer would be glued on)', async () => {
    let calls = 0;
    const broken: ChatProvider = {
      name: 'gemini',
      isInitialized: () => true,
      generateResponse: async () => {
        throw new Error('not used');
      },
      generateResponseStream: async (_s, _m, _u, onChunk) => {
        calls += 1;
        onChunk('halb');
        throw new ChatProviderError('empty', 'x');
      },
    };
    const error = await run(chain(broken), true).catch(e => e);
    expect((error as ChatUnavailableError).reason).toBe('interrupted');
    expect(calls).toBe(1);
  });
});
