/**
 * @jest-environment node
 */

// Package CF1: when no chat provider can answer (the primary failed and there is
// no Sokrates fallback), the pipeline reports it with a stable key for the user
// (hai.error.chatUnavailable) instead of a text that looks like an answer. The
// text is not streamed and not saved as an answer of the assistant. Every other
// failure keeps its generic message.

const mockChat = jest.fn();
const mockGetChatProvider = jest.fn();
const mockAccess = jest.fn();

jest.mock('@/lib/hai/providers', () => ({
  chatWithFallback: (...args: unknown[]) => mockChat(...args),
  getChatProvider: () => mockGetChatProvider(),
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
}));
jest.mock('@/lib/hai/retrievalAccess', () => ({
  resolveRetrievalAccess: (userId: string) => mockAccess(userId),
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
  searchWithContext: jest
    .fn()
    .mockResolvedValue({ results: [], query: '', totalResults: 0 }),
}));
jest.mock('@/lib/hai/pageIndexService', () => ({
  fetchPageIndexContext: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/hai/dataContext', () => ({
  fetchDataContext: jest.fn().mockResolvedValue(null),
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
  CHAT_UNAVAILABLE_I18N_KEY,
} from '@/lib/hai/providers/errors';

const USER = '10000000-0000-4000-8000-000000000001';
const QUESTION = 'Was ist Normalisierung?';

function ctx(): PipelineContext {
  return { userId: USER, userRole: 'TRAINEE' };
}

describe('HAI pipeline: no chat provider can answer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetChatProvider.mockReturnValue({ isInitialized: () => true });
    mockAccess.mockResolvedValue({
      catalogIds: ['00000000-0000-4000-8000-000000000001'],
      audience: 'trainee',
      organizationId: 'org-1',
      userId: USER,
    });
  });

  it('the key of the message is the one of the locale files', () => {
    expect(CHAT_UNAVAILABLE_I18N_KEY).toBe('hai.error.chatUnavailable');
  });

  it('blocking path: ChatUnavailableError gives the key, no answer text', async () => {
    mockChat.mockRejectedValue(
      new ChatUnavailableError('no_fallback', 'no_key')
    );
    const result = await processMessage(QUESTION, ctx());
    expect(result.errorKey).toBe(CHAT_UNAVAILABLE_I18N_KEY);
    expect(result.response).toBe('');
    expect(result.error).toBe('chat_unavailable');
  });

  it('streaming path: nothing is streamed, the key is returned', async () => {
    mockChat.mockRejectedValue(
      new ChatUnavailableError('fallback_failed', 'sokrates')
    );
    const chunks: string[] = [];
    const result = await processMessageStream(QUESTION, ctx(), c =>
      chunks.push(c)
    );
    expect(chunks).toEqual([]);
    expect(result.errorKey).toBe(CHAT_UNAVAILABLE_I18N_KEY);
    expect(result.response).toBe('');
  });

  it('streaming path: a break-off after output also gives the key (the client replaces the partial text)', async () => {
    mockChat.mockImplementation(
      async (
        _s: string,
        _m: unknown,
        _u: string,
        onChunk?: (t: string) => void
      ) => {
        onChunk?.('half an answer');
        throw new ChatUnavailableError('interrupted', 'no_key');
      }
    );
    const result = await processMessageStream(QUESTION, ctx(), () => undefined);
    expect(result.errorKey).toBe(CHAT_UNAVAILABLE_I18N_KEY);
  });

  it('the readiness gate: nothing ready gives the key in both paths', async () => {
    mockGetChatProvider.mockImplementation(() => {
      throw new ChatUnavailableError('no_provider', 'no_key');
    });
    const blocking = await processMessage(QUESTION, ctx());
    const chunks: string[] = [];
    const streaming = await processMessageStream(QUESTION, ctx(), c =>
      chunks.push(c)
    );
    for (const result of [blocking, streaming]) {
      expect(result.errorKey).toBe(CHAT_UNAVAILABLE_I18N_KEY);
      expect(result.response).toBe('');
    }
    expect(chunks).toEqual([]);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('any other failure keeps the generic message and has no key', async () => {
    mockChat.mockRejectedValue(new Error('something else'));
    const result = await processMessage(QUESTION, ctx());
    expect(result.errorKey).toBeUndefined();
    expect(result.response).toContain('schiefgelaufen');
  });

  it('a plain failure of the gate keeps the old text and has no key', async () => {
    mockGetChatProvider.mockImplementation(() => {
      throw new Error('x');
    });
    const result = await processMessage(QUESTION, ctx());
    expect(result.errorKey).toBeUndefined();
    expect(result.response).toContain('nicht verfügbar');
  });
});
