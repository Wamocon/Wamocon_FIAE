/**
 * @jest-environment node
 */

// Speed of the pipeline (docs/hai-geschwindigkeit.md): the live data of the
// person is fetched next to the retrieval and not after it, the stages are
// reported (data only), and the time of the stages is measured. The rules of
// access are not touched here, their tests are ragPipeline.retrieval.test.ts
// and the golden set.

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
  limitToContextBudget,
  processMessage,
  processMessageStream,
  RETRIEVED_CONTEXT_MAX_CHARS,
  type PipelineContext,
  type PipelineStage,
} from '@/lib/hai/ragPipeline';

const FIAE = '00000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000001';
const QUESTION = 'Was ist Normalisierung?';

const access = {
  catalogIds: [FIAE],
  audience: 'trainee',
  organizationId: null,
  userId: USER,
};

function context(extra: Partial<PipelineContext> = {}): PipelineContext {
  return { userId: USER, userRole: 'TRAINEE', ...extra };
}

/** A promise the test settles by hand. */
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveAccess.mockResolvedValue(access);
  mockSearchWithContext.mockResolvedValue({
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
    query: QUESTION,
    totalResults: 1,
  });
  mockFetchPageIndex.mockResolvedValue({
    pdfContext: '',
    documentsScanned: 0,
    relevantPages: 0,
    citations: [],
  });
  mockFetchDataContext.mockResolvedValue({ summary: 'DATEN-ZUSAMMENFASSUNG' });
  mockChat.mockImplementation(
    async (
      _system: string,
      _history: unknown,
      _message: string,
      onChunk?: (text: string) => void
    ) => {
      onChunk?.('Antwort');
      return { text: 'Antwort', citations: [] };
    }
  );
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('live data next to the retrieval', () => {
  it('stream: the live data is fetched while the search is still running', async () => {
    const search = gate<unknown>();
    mockSearchWithContext.mockReturnValue(search.promise);

    const done = processMessageStream(QUESTION, context(), () => undefined);
    await tick();
    await tick();

    // the search has not answered, the data fetch already started
    expect(mockSearchWithContext).toHaveBeenCalledTimes(1);
    expect(mockFetchDataContext).toHaveBeenCalledTimes(1);
    expect(mockChat).not.toHaveBeenCalled();

    search.resolve({ results: [], query: QUESTION, totalResults: 0 });
    await done;
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('blocking: the live data is fetched while the search is still running', async () => {
    const search = gate<unknown>();
    mockSearchWithContext.mockReturnValue(search.promise);

    const done = processMessage(QUESTION, context());
    await tick();
    await tick();

    expect(mockSearchWithContext).toHaveBeenCalledTimes(1);
    expect(mockFetchDataContext).toHaveBeenCalledTimes(1);
    expect(mockChat).not.toHaveBeenCalled();

    search.resolve({ results: [], query: QUESTION, totalResults: 0 });
    await done;
  });

  it('the prompt holds both: the retrieved context and the live data', async () => {
    await processMessageStream(QUESTION, context(), () => undefined);
    const systemPrompt = mockChat.mock.calls[0][0] as string;
    expect(systemPrompt).toContain('Normalisierung entfernt Redundanz');
    expect(systemPrompt).toContain('DATEN-ZUSAMMENFASSUNG');
  });

  it('a failing live data fetch does not stop the answer', async () => {
    mockFetchDataContext.mockRejectedValue(new Error('db down'));
    const result = await processMessageStream(
      QUESTION,
      context(),
      () => undefined
    );
    expect(result.response).toBe('Antwort');
    const systemPrompt = mockChat.mock.calls[0][0] as string;
    expect(systemPrompt).not.toContain('DATEN-ZUSAMMENFASSUNG');
  });

  it('a failing search does not stop the live data', async () => {
    mockSearchWithContext.mockRejectedValue(new Error('vector down'));
    await processMessageStream(QUESTION, context(), () => undefined);
    const systemPrompt = mockChat.mock.calls[0][0] as string;
    expect(systemPrompt).toContain('DATEN-ZUSAMMENFASSUNG');
  });

  it('without a role there is no data fetch', async () => {
    await processMessageStream(
      QUESTION,
      context({ userRole: undefined }),
      () => undefined
    );
    expect(mockFetchDataContext).not.toHaveBeenCalled();
  });
});

describe('stages and timings', () => {
  it('reports search, then answer, before the first chunk of the model', async () => {
    const events: string[] = [];
    mockChat.mockImplementation(
      async (
        _system: string,
        _history: unknown,
        _message: string,
        onChunk?: (text: string) => void
      ) => {
        events.push('model');
        onChunk?.('Antwort');
        return { text: 'Antwort', citations: [] };
      }
    );
    await processMessageStream(
      QUESTION,
      context(),
      () => events.push('chunk'),
      (stage: PipelineStage) => events.push(`stage:${stage}`)
    );
    expect(events).toEqual(['stage:search', 'stage:answer', 'model', 'chunk']);
  });

  it('a day question has no search stage (it skips the search)', async () => {
    const stages: string[] = [];
    await processMessageStream(
      'Was steht heute an?',
      context(),
      () => undefined,
      stage => stages.push(stage)
    );
    expect(mockSearchWithContext).not.toHaveBeenCalled();
    expect(stages).toEqual(['answer']);
  });

  it('a refusal before the model reports no stage', async () => {
    const stages: string[] = [];
    mockResolveAccess.mockResolvedValue(null);
    await processMessageStream(
      QUESTION,
      context(),
      () => undefined,
      stage => stages.push(stage)
    );
    expect(stages).toEqual([]);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('measures the stages in context.timings (numbers only)', async () => {
    const timings: Record<string, number> = {};
    await processMessageStream(QUESTION, context({ timings }), () => undefined);
    expect(Object.keys(timings).sort()).toEqual([
      'data',
      'retrieval',
      'search',
    ]);
    for (const value of Object.values(timings)) {
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('works without a stage callback', async () => {
    const result = await processMessageStream(
      QUESTION,
      context(),
      () => undefined
    );
    expect(result.response).toBe('Antwort');
  });
});

describe('budget of the retrieved context', () => {
  const chunk = (id: string, length: number) => ({
    id,
    content: 'x'.repeat(length),
  });

  it('keeps all chunks of the usual size (five chunks of 1,500 characters)', () => {
    const chunks = [1, 2, 3, 4, 5].map(i => chunk(`c${i}`, 1500));
    expect(limitToContextBudget(chunks)).toEqual(chunks);
  });

  it('cuts the least relevant chunks when five long chunks exceed the budget', () => {
    const chunks = [1, 2, 3, 4, 5].map(i => chunk(`c${i}`, 3000));
    const kept = limitToContextBudget(chunks);
    // 3 x 3000 = 9000 fits, the fourth would be 12000
    expect(kept.map(c => c.id)).toEqual(['c1', 'c2', 'c3']);
    const total = kept.reduce((sum, c) => sum + c.content.length, 0);
    expect(total).toBeLessThanOrEqual(RETRIEVED_CONTEXT_MAX_CHARS);
  });

  it('the two most relevant chunks always stay, however long', () => {
    const chunks = [chunk('c1', 7000), chunk('c2', 7000), chunk('c3', 100)];
    expect(limitToContextBudget(chunks).map(c => c.id)).toEqual(['c1', 'c2']);
  });

  it('keeps the order and handles an empty list', () => {
    expect(limitToContextBudget([])).toEqual([]);
    const chunks = [chunk('b', 10), chunk('a', 10)];
    expect(limitToContextBudget(chunks).map(c => c.id)).toEqual(['b', 'a']);
  });

  it('a chunk that is cut from the prompt is not cited either', async () => {
    const results = [1, 2, 3, 4, 5].map(i => ({
      id: `chunk-${i}`,
      sourceType: 'enabler',
      sourceId: `enabler-${i}`,
      chunkIndex: 0,
      content: 'y'.repeat(3000),
      similarity: 0.95 - i * 0.01,
      metadata: { title: `Enabler ${i}` },
    }));
    mockSearchWithContext.mockResolvedValue({
      results,
      query: QUESTION,
      totalResults: results.length,
    });
    const result = await processMessageStream(
      QUESTION,
      context(),
      () => undefined
    );
    const systemPrompt = mockChat.mock.calls[0][0] as string;
    expect(systemPrompt).toContain('Enabler 3');
    expect(systemPrompt).not.toContain('Enabler 4');
    expect(result.citations.map(c => c.sourceId)).toEqual([
      'enabler-1',
      'enabler-2',
      'enabler-3',
    ]);
  });
});
