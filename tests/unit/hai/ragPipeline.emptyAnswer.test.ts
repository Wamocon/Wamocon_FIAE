/**
 * @jest-environment node
 */

// An empty answer of the model (docs/hai-golden-set.md, 5e). What a person sees in
// the chat and hears in the voice mode when the provider answers with no text:
//  - the REAL provider chain (runChatChain) sits between the pipeline and a stand
//    in provider that answers empty, so the test shows the whole way;
//  - the same provider is asked again once, before any text went out;
//  - if it stays empty, the result has no text and the key hai.error.modelBusy with
//    the code MODEL_BUSY (the message "busy, try again in a minute"), never an
//    empty answer that would end as a silent bubble or a silent voice;
//  - a provider that returns an empty text (Gemini, Claude, OpenRouter and Ollama
//    do not check it themselves) is treated like Sokrates, which throws.
// No model is called.

const mockResolveAccess = jest.fn();
const mockSearchWithContext = jest.fn();
const mockFetchPageIndex = jest.fn();
const mockProvider = jest.fn();

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
jest.mock('@/lib/hai/providers', () => {
  const actual = jest.requireActual('@/lib/hai/providers');
  // the real chain, one stand in provider (and no fallback)
  const chat = (
    systemPrompt: string,
    messages: never[],
    userMessage: string,
    onChunk?: (text: string) => void,
    options?: never
  ) =>
    actual.runChatChain(
      {
        primary: {
          name: 'stand-in',
          isInitialized: () => true,
          generateResponse: (...args: unknown[]) => mockProvider(...args),
          generateResponseStream: (...args: unknown[]) => mockProvider(...args),
        },
        fallback: null,
        fallbackState: 'disabled',
      },
      systemPrompt,
      messages,
      userMessage,
      onChunk,
      options
    );
  return {
    ...actual,
    chatWithFallback: chat,
    chatWithSokratesOnly: chat,
    getChatProvider: () => ({ isInitialized: () => true }),
    getEmbeddingProvider: () => ({ isInitialized: () => false }),
  };
});
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
import { MODEL_BUSY_I18N_KEY } from '@/lib/hai/providers/errors';

const FIAE = '00000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000001';
const QUESTION = 'Wie normalisiere ich eine Datenbank?';

const access = {
  catalogIds: [FIAE],
  audience: 'trainee',
  organizationId: null,
  userId: USER,
};

function context(voice: boolean): PipelineContext {
  return { userId: USER, userRole: 'TRAINEE', ...(voice ? { voice } : {}) };
}

/** What the provider hands back and what the stream sends to the client. */
const empty = async (
  _s: string,
  _m: unknown,
  _u: string,
  // blocking call: the fourth argument is the options object, not a function
  onChunk?: unknown
) => {
  if (typeof onChunk === 'function') onChunk('');
  return { text: '', citations: [] };
};
const text = async (
  _s: string,
  _m: unknown,
  _u: string,
  // blocking call: the fourth argument is the options object, not a function
  onChunk?: unknown
) => {
  if (typeof onChunk === 'function')
    onChunk('Normalisierung entfernt Redundanz.');
  return { text: 'Normalisierung entfernt Redundanz.', citations: [] };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveAccess.mockResolvedValue(access);
  mockSearchWithContext.mockResolvedValue({
    results: [],
    query: QUESTION,
    totalResults: 0,
  });
  mockFetchPageIndex.mockResolvedValue({
    pdfContext: '',
    documentsScanned: 0,
    relevantPages: 0,
    citations: [],
  });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe.each([[false], [true]])('an empty answer (voice: %s)', voice => {
  it('stream: asked again once, then the message "busy" and no text at all', async () => {
    mockProvider.mockImplementation(empty);
    const chunks: string[] = [];
    const result = await processMessageStream(QUESTION, context(voice), c =>
      chunks.push(c)
    );
    // asked twice: the first time and once again
    expect(mockProvider).toHaveBeenCalledTimes(2);
    // nothing for the bubble or the voice: no text, no placeholder
    expect(chunks.join('').trim()).toBe('');
    expect(result.response).toBe('');
    expect(result.errorKey).toBe(MODEL_BUSY_I18N_KEY);
    expect(result.errorCode).toBe('MODEL_BUSY');
    expect(result.retryAfterSec).toBe(30);
  });

  it('blocking: the same', async () => {
    mockProvider.mockImplementation(empty);
    const result = await processMessage(QUESTION, context(voice));
    expect(mockProvider).toHaveBeenCalledTimes(2);
    expect(result.response).toBe('');
    expect(result.errorKey).toBe('hai.error.modelBusy');
    expect(result.errorCode).toBe('MODEL_BUSY');
  });

  it('stream: an answer that comes at the second try is the answer (the person sees no failure)', async () => {
    mockProvider.mockImplementationOnce(empty).mockImplementation(text);
    const chunks: string[] = [];
    const result = await processMessageStream(QUESTION, context(voice), c =>
      chunks.push(c)
    );
    expect(mockProvider).toHaveBeenCalledTimes(2);
    expect(result.response).toBe('Normalisierung entfernt Redundanz.');
    expect(result.errorKey).toBeUndefined();
    expect(chunks.join('')).toContain('Normalisierung');
  });

  it('blocking: an answer that comes at the second try is the answer', async () => {
    mockProvider.mockImplementationOnce(empty).mockImplementation(text);
    const result = await processMessage(QUESTION, context(voice));
    expect(mockProvider).toHaveBeenCalledTimes(2);
    expect(result.response).toBe('Normalisierung entfernt Redundanz.');
    expect(result.errorKey).toBeUndefined();
  });

  it('a text of blanks only is empty too', async () => {
    mockProvider.mockResolvedValue({ text: ' \n ', citations: [] });
    const result = await processMessage(QUESTION, context(voice));
    expect(result.response).toBe('');
    expect(result.errorKey).toBe(MODEL_BUSY_I18N_KEY);
  });
});
