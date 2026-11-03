/**
 * @jest-environment node
 */

// A busy model server (docs/hai-geschwindigkeit.md, "Ausgelastet"):
//  - a busy chat model gives the key hai.error.modelBusy with the code MODEL_BUSY
//    and the seconds, every other failure keeps hai.error.chatUnavailable;
//  - a search that cannot run (embedding at Sokrates timed out) does not stop the
//    question: it goes on without the knowledge search and the prompt says so
//    ("Wissenssuche gerade nicht verfügbar"), not "no context found";
//  - a short question about the own data waits at most 4 seconds for the search;
//  - the questions of the first screenshot ("Zeig mir, was ich gerade zu tun
//    habe", "Hi, was habe ich heute für Aufgaben?") are day questions and never
//    wait for the search at all.

const mockResolveAccess = jest.fn();
const mockSearchWithContext = jest.fn();
const mockFetchPageIndex = jest.fn();
const mockChat = jest.fn();
const mockFetchDataContext = jest.fn();

jest.mock('@/lib/hai/retrievalAccess', () => ({
  resolveRetrievalAccess: (userId: string) => mockResolveAccess(userId),
}));
jest.mock('@/lib/hai/personaAccess', () => {
  const persona = jest.requireActual('@/lib/hai/persona');
  return {
    loadHaiPersona: async (access: { catalogIds: string[] } | null) =>
      access
        ? persona.resolveHaiPersona({
            catalogs: access.catalogIds.map(id => ({
              id,
              code: 'FIAE',
              title: 'Fachinformatik',
              settings: {},
            })),
          })
        : persona.NEUTRAL_PERSONA,
  };
});
jest.mock('@/lib/hai/vectorSearch', () => ({
  searchWithContext: (...args: unknown[]) => mockSearchWithContext(...args),
}));
jest.mock('@/lib/hai/pageIndexService', () => ({
  fetchPageIndexContext: (...args: unknown[]) => mockFetchPageIndex(...args),
}));
jest.mock('@/lib/hai/providers', () => ({
  chatWithFallback: (...args: unknown[]) => mockChat(...args),
  chatWithSokratesOnly: (...args: unknown[]) => mockChat(...args),
  getChatProvider: () => ({ isInitialized: () => true }),
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
}));
jest.mock('@/lib/hai/dataContext', () => ({
  fetchDataContext: (...args: unknown[]) => mockFetchDataContext(...args),
}));
jest.mock('@/lib/hai/actions', () => ({
  detectActionIntent: jest.fn().mockReturnValue(null),
  executeAction: jest.fn(),
}));

import {
  processMessage,
  processMessageStream,
  type PipelineContext,
} from '@/lib/hai/ragPipeline';
import {
  ChatUnavailableError,
  MODEL_BUSY_I18N_KEY,
  CHAT_UNAVAILABLE_I18N_KEY,
} from '@/lib/hai/providers/errors';
import {
  DATA_QUESTION_SEARCH_DEADLINE_MS,
  SEARCH_UNAVAILABLE_NOTE,
} from '@/lib/hai/searchDeadline';

const FIAE = '00000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000001';
const KNOWLEDGE = 'Was ist Normalisierung?';
const DATA_QUESTION = 'Wie ist mein Fortschritt in SQL?';

const access = {
  catalogIds: [FIAE],
  audience: 'trainee',
  organizationId: null,
  userId: USER,
};

const found = {
  results: [
    {
      id: 'chunk-1',
      sourceType: 'enabler',
      sourceId: 'enabler-1',
      chunkIndex: 0,
      content: 'Normalisierung entfernt Redundanz',
      similarity: 0.9,
      metadata: { title: 'Enabler 1' },
    },
  ],
  query: KNOWLEDGE,
  totalResults: 1,
};

function context(extra: Partial<PipelineContext> = {}): PipelineContext {
  return { userId: USER, userRole: 'TRAINEE', ...extra };
}

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

const answer = async (
  _system: string,
  _history: unknown,
  _message: string,
  onChunk?: (text: string) => void
) => {
  onChunk?.('Antwort');
  return { text: 'Antwort', citations: [] };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveAccess.mockResolvedValue(access);
  mockSearchWithContext.mockResolvedValue(found);
  mockFetchPageIndex.mockResolvedValue({
    pdfContext: '',
    documentsScanned: 0,
    relevantPages: 0,
    citations: [],
  });
  mockFetchDataContext.mockResolvedValue({ summary: 'DATEN-ZUSAMMENFASSUNG' });
  mockChat.mockImplementation(answer);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a busy chat model', () => {
  const busy = () =>
    new ChatUnavailableError('no_fallback', 'primary_is_sokrates', '', true);

  it('stream: the key hai.error.modelBusy, the code MODEL_BUSY and the seconds, no text', async () => {
    mockChat.mockRejectedValue(busy());
    const chunks: string[] = [];
    const result = await processMessageStream(KNOWLEDGE, context(), c =>
      chunks.push(c)
    );
    expect(chunks).toEqual([]);
    expect(result.response).toBe('');
    expect(result.errorKey).toBe(MODEL_BUSY_I18N_KEY);
    expect(result.errorCode).toBe('MODEL_BUSY');
    expect(result.retryAfterSec).toBe(30);
  });

  it('blocking: the same', async () => {
    mockChat.mockRejectedValue(busy());
    const result = await processMessage(KNOWLEDGE, context());
    expect(result.errorKey).toBe('hai.error.modelBusy');
    expect(result.errorCode).toBe('MODEL_BUSY');
    expect(result.retryAfterSec).toBe(30);
    expect(result.response).toBe('');
  });

  it('nothing internal is in the result: no provider, no address, no failure text', async () => {
    mockChat.mockRejectedValue(
      new ChatUnavailableError(
        'no_fallback',
        'primary_is_sokrates',
        'openai-compatible: timeout https://sokrates.example/api key=abc',
        true
      )
    );
    const result = await processMessage(KNOWLEDGE, context());
    const text = JSON.stringify(result);
    expect(text).not.toMatch(
      /openai|sokrates|https?:|key=|timeout|stack|ChatUnavailable/i
    );
    // the result carries only these fields
    expect(Object.keys(result).sort()).toEqual(
      [
        'citations',
        'error',
        'errorCode',
        'errorKey',
        'intent',
        'response',
        'retryAfterSec',
      ].sort()
    );
  });

  it('another failure keeps hai.error.chatUnavailable and has no code', async () => {
    mockChat.mockRejectedValue(
      new ChatUnavailableError('no_fallback', 'no_key')
    );
    const result = await processMessage(KNOWLEDGE, context());
    expect(result.errorKey).toBe(CHAT_UNAVAILABLE_I18N_KEY);
    expect(result.errorCode).toBeUndefined();
    expect(result.retryAfterSec).toBeUndefined();
  });
});

describe('the knowledge search cannot run (embedding timed out)', () => {
  it('stream: the question goes on, the prompt says the search was not available', async () => {
    mockSearchWithContext.mockResolvedValue({
      results: [],
      query: KNOWLEDGE,
      totalResults: 0,
      unavailable: true,
    });
    const result = await processMessageStream(KNOWLEDGE, context(), () => {});
    expect(result.response).toBe('Antwort');
    expect(result.errorKey).toBeUndefined();
    const prompt = mockChat.mock.calls[0][0] as string;
    expect(prompt).toContain('Wissenssuche gerade nicht verfügbar');
    expect(prompt).not.toContain('KEIN spezifischer Kontext');
    // the live data still goes in
    expect(prompt).toContain('DATEN-ZUSAMMENFASSUNG');
  });

  it('blocking: the same', async () => {
    mockSearchWithContext.mockResolvedValue({
      results: [],
      query: KNOWLEDGE,
      totalResults: 0,
      unavailable: true,
    });
    const result = await processMessage(KNOWLEDGE, context());
    expect(result.response).toBe('Antwort');
    expect(mockChat.mock.calls[0][0]).toContain(
      'Wissenssuche gerade nicht verfügbar'
    );
  });

  it('a search that throws counts as not available too', async () => {
    mockSearchWithContext.mockRejectedValue(new Error('TimeoutError'));
    const result = await processMessageStream(KNOWLEDGE, context(), () => {});
    expect(result.response).toBe('Antwort');
    expect(mockChat.mock.calls[0][0]).toContain(SEARCH_UNAVAILABLE_NOTE);
  });

  it('a search that found nothing is still "nothing found", not "not available"', async () => {
    mockSearchWithContext.mockResolvedValue({
      results: [],
      query: KNOWLEDGE,
      totalResults: 0,
    });
    await processMessageStream(KNOWLEDGE, context(), () => {});
    const prompt = mockChat.mock.calls[0][0] as string;
    expect(prompt).toContain('KEIN spezifischer Kontext');
    expect(prompt).not.toContain('Wissenssuche gerade nicht verfügbar');
  });

  it('the note names no provider, no address and no error', () => {
    expect(SEARCH_UNAVAILABLE_NOTE).not.toMatch(
      /sokrates|openai|gemini|https?:|timeout|embedding/i
    );
    expect(SEARCH_UNAVAILABLE_NOTE).not.toMatch(/[–—]/);
  });
});

describe('a short question about the own data waits at most 4 seconds for the search', () => {
  it('goes on without the search after 4 seconds and says so', async () => {
    jest.useFakeTimers();
    const search = gate<unknown>();
    mockSearchWithContext.mockReturnValue(search.promise);

    const done = processMessageStream(DATA_QUESTION, context(), () => {});
    await jest.advanceTimersByTimeAsync(DATA_QUESTION_SEARCH_DEADLINE_MS - 100);
    expect(mockChat).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(200);
    const result = await done;

    expect(result.response).toBe('Antwort');
    const prompt = mockChat.mock.calls[0][0] as string;
    expect(prompt).toContain('Wissenssuche gerade nicht verfügbar');
    expect(prompt).toContain('DATEN-ZUSAMMENFASSUNG');
    // a late result of the abandoned search changes nothing and throws nothing
    search.resolve(found);
    await jest.advanceTimersByTimeAsync(10);
  });

  it('blocking: the same limit', async () => {
    jest.useFakeTimers();
    mockSearchWithContext.mockReturnValue(gate<unknown>().promise);
    const done = processMessage(DATA_QUESTION, context());
    await jest.advanceTimersByTimeAsync(DATA_QUESTION_SEARCH_DEADLINE_MS + 100);
    const result = await done;
    expect(result.response).toBe('Antwort');
    expect(mockChat.mock.calls[0][0]).toContain(SEARCH_UNAVAILABLE_NOTE);
  });

  it('a search that is quick enough is used', async () => {
    const result = await processMessageStream(
      DATA_QUESTION,
      context(),
      () => {}
    );
    expect(result.response).toBe('Antwort');
    const prompt = mockChat.mock.calls[0][0] as string;
    expect(prompt).toContain('Normalisierung entfernt Redundanz');
    expect(prompt).not.toContain('Wissenssuche gerade nicht verfügbar');
  });

  it('a knowledge question has no such limit: it waits for the search', async () => {
    jest.useFakeTimers();
    const search = gate<unknown>();
    mockSearchWithContext.mockReturnValue(search.promise);

    const done = processMessageStream(KNOWLEDGE, context(), () => {});
    await jest.advanceTimersByTimeAsync(30_000);
    expect(mockChat).not.toHaveBeenCalled();

    search.resolve(found);
    await jest.advanceTimersByTimeAsync(10);
    await done;
    expect(mockChat.mock.calls[0][0]).toContain(
      'Normalisierung entfernt Redundanz'
    );
  });

  it('a long question that happens to name a data word keeps the full search', async () => {
    jest.useFakeTimers();
    const search = gate<unknown>();
    mockSearchWithContext.mockReturnValue(search.promise);
    const long = `Erkläre mir bitte ausführlich, wie ich bei einer Datenbank mit Fortschritt und Noten eine saubere Normalisierung bis zur dritten Normalform durchführe und was dabei zu beachten ist, danke. ${'x'.repeat(40)}`;
    const done = processMessageStream(long, context(), () => {});
    await jest.advanceTimersByTimeAsync(10_000);
    expect(mockChat).not.toHaveBeenCalled();
    search.resolve(found);
    await jest.advanceTimersByTimeAsync(10);
    await done;
  });
});

describe('day questions never wait for the search', () => {
  it.each([
    'Zeig mir, was ich gerade zu tun habe.',
    'Hi, was habe ich heute für Aufgaben?',
    'Was habe ich heute zu tun?',
  ])('%s', async question => {
    mockSearchWithContext.mockReturnValue(gate<unknown>().promise);
    const stages: string[] = [];
    const result = await processMessageStream(
      question,
      context(),
      () => {},
      stage => stages.push(stage)
    );
    expect(result.response).toBe('Antwort');
    expect(mockSearchWithContext).not.toHaveBeenCalled();
    expect(stages).toEqual(['answer']);
  });
});
