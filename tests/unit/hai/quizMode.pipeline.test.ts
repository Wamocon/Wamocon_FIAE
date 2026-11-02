/**
 * @jest-environment node
 */

// Quiz mode in the RAG pipeline: a request to be quizzed ends the turn before
// retrieval and the model, with a fixed text and the start signal for the quiz
// card. It sits behind the persona gate (a request about another occupation is
// refused first) and ahead of everything else. No model is called.

const mockResolveAccess = jest.fn();
const mockChat = jest.fn();
const mockSearch = jest.fn();
const mockPageIndex = jest.fn();
const mockDataContext = jest.fn();

jest.mock('@/lib/hai/retrievalAccess', () => ({
  resolveRetrievalAccess: (userId: string) => mockResolveAccess(userId),
}));
jest.mock('@/lib/hai/personaAccess', () => {
  const persona = jest.requireActual('@/lib/hai/persona');
  const fixtures = jest.requireActual('./fixtures/kfbmPersona');
  const all = [fixtures.FIAE_CATALOG, fixtures.KFBM_CATALOG];
  return {
    loadHaiPersona: async (
      access: { catalogIds: string[]; audience: string } | null
    ) => {
      if (!access) return persona.NEUTRAL_PERSONA;
      const own = all.filter(c => access.catalogIds.includes(c.id));
      return persona.resolveHaiPersona({
        catalogs: own,
        otherCatalogs: all.filter(c => !access.catalogIds.includes(c.id)),
        role: access.audience === 'trainer' ? 'TRAINER' : 'TRAINEE',
      });
    },
  };
});
jest.mock('@/lib/hai/vectorSearch', () => ({
  searchWithContext: (...args: unknown[]) => mockSearch(...args),
}));
jest.mock('@/lib/hai/pageIndexService', () => ({
  fetchPageIndexContext: (...args: unknown[]) => mockPageIndex(...args),
}));
jest.mock('@/lib/hai/providers', () => ({
  chatWithFallback: (...args: unknown[]) => mockChat(...args),
  getChatProvider: () => ({ isInitialized: () => true }),
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
}));
jest.mock('@/lib/hai/dataContext', () => ({
  fetchDataContext: (...args: unknown[]) => mockDataContext(...args),
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
import { DENIAL_BERUF_TEXT } from '@/lib/hai/denial';
import { FIAE_CATALOG, KFBM_CATALOG } from './fixtures/kfbmPersona';

const USER = '10000000-0000-4000-8000-000000000001';
const ENABLER = '20000000-0000-4000-8000-000000000001';

const access = (catalog: { id: string }, audience = 'trainee') => ({
  catalogIds: [catalog.id],
  audience,
  organizationId: null,
  userId: USER,
});

const context = (
  overrides: Partial<PipelineContext> = {}
): PipelineContext => ({
  userId: USER,
  userRole: 'TRAINEE',
  ...overrides,
});

describe.each([
  [
    'processMessage',
    (message: string, ctx: PipelineContext, chunks: string[]) =>
      processMessage(message, ctx).then(result => {
        chunks.push(result.response);
        return result;
      }),
  ],
  [
    'processMessageStream',
    (message: string, ctx: PipelineContext, chunks: string[]) =>
      processMessageStream(message, ctx, text => chunks.push(text)),
  ],
])('%s and the quiz mode', (_name, run) => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveAccess.mockResolvedValue(access(FIAE_CATALOG));
    mockSearch.mockResolvedValue({ results: [], query: '', totalResults: 0 });
    mockPageIndex.mockResolvedValue({
      pdfContext: '',
      documentsScanned: 0,
      relevantPages: 0,
      citations: [],
    });
    mockDataContext.mockResolvedValue(null);
    mockChat.mockImplementation(
      async (
        _s: string,
        _h: unknown,
        _m: string,
        onChunk?: (text: string) => void
      ) => {
        onChunk?.('Antwort');
        return { text: 'Antwort', citations: [] };
      }
    );
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('answers "Frag mich zu SQL ab" with the start signal and no model call', async () => {
    const chunks: string[] = [];
    const result = await run('Frag mich zu SQL ab', context(), chunks);
    expect(result.intent).toBe('quiz_request');
    expect(result.quizMode).toEqual({ topic: 'SQL', enablerId: null });
    expect(result.response).toContain('„SQL“');
    expect(result.response).toContain('Übung ohne Wertung');
    expect(chunks.join('')).toContain('„SQL“');
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockPageIndex).not.toHaveBeenCalled();
    expect(mockDataContext).not.toHaveBeenCalled();
  });

  it('starts for the open enabler when the chat is open in one', async () => {
    const result = await run(
      'Quiz mich zu diesem Enabler',
      context({ currentEnablerId: ENABLER, enablerTitle: 'SQL Grundlagen' }),
      []
    );
    expect(result.quizMode).toEqual({ topic: null, enablerId: ENABLER });
    expect(result.response).toContain('SQL Grundlagen');
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('starts mixed without an enabler and without a topic', async () => {
    const result = await run('Quiz mich', context(), []);
    expect(result.quizMode).toEqual({ topic: null, enablerId: null });
  });

  it('works for a trainer too (the preview of the quiz)', async () => {
    mockResolveAccess.mockResolvedValue(access(FIAE_CATALOG, 'trainer'));
    const result = await run(
      'Frag mich ab',
      context({ userRole: 'TRAINER' }),
      []
    );
    expect(result.quizMode).toEqual({ topic: null, enablerId: null });
  });

  it('does not touch an ordinary question', async () => {
    const result = await run('Was ist ein Primärschlüssel?', context(), []);
    expect(result.quizMode).toBeUndefined();
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('leaves the persona gate first: a request about another occupation is refused', async () => {
    const result = await run('Frag mich zu KfBM Lernfeld 3 ab', context(), []);
    expect(result.quizMode).toBeUndefined();
    expect(result.response).toBe(DENIAL_BERUF_TEXT);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('gives a KfBM trainee the same start, scoped by the server later', async () => {
    mockResolveAccess.mockResolvedValue(access(KFBM_CATALOG));
    const result = await run('Quiz mich zu Rechnungen', context(), []);
    expect(result.quizMode).toEqual({ topic: 'Rechnungen', enablerId: null });
  });
});
