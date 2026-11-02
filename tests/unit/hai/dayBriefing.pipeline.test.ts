/**
 * @jest-environment node
 */

// Day companion in the pipeline, blocking and streaming: a question about the
// own tasks ("Was steht für mich an?") is answered from the live data of the
// person. It skips the knowledge search, so no source cards of the knowledge
// base hang under the answer, and the model gets the section "Tageslage". The
// data context gets the chosen occupation and the training scope. A knowledge
// question with similar words still runs through the search with its sources.
// Spoken, the day stays the same question with the voice section on top.

const mockResolveAccess = jest.fn();
const mockSearchWithContext = jest.fn();
const mockChat = jest.fn();
const mockData = jest.fn();

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
              title: 'Fachinformatiker Anwendungsentwicklung',
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
  fetchPageIndexContext: jest.fn().mockResolvedValue({
    pdfContext: '',
    documentsScanned: 0,
    relevantPages: 0,
    citations: [],
  }),
}));
jest.mock('@/lib/hai/providers', () => ({
  chatWithFallback: (...args: unknown[]) => mockChat(...args),
  getChatProvider: () => ({ isInitialized: () => true }),
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
}));
jest.mock('@/lib/hai/dataContext', () => ({
  fetchDataContext: (...args: unknown[]) => mockData(...args),
}));
jest.mock('@/lib/hai/actions', () => ({
  detectActionIntent: jest.fn().mockReturnValue(null),
  executeAction: jest.fn(),
}));

import {
  processMessage,
  processMessageStream,
  type PipelineContext,
  type PipelineResult,
} from '@/lib/hai/ragPipeline';

const FIAE = '00000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000001';

const SECTION = '## Tageslage (Tagesbegleiter)';
const VOICE_SECTION = '## Sprachassistent (Tagesbegleiter)';
const KNOWLEDGE_HINT = '## Hinweis zur Wissensdatenbank';

const DAY_DATA = {
  summary: [
    '**Nutzer:** Azubi Eins (Azubi)',
    '**Fortschritt und nächster Schritt:**',
    '- Fachinformatiker Anwendungsentwicklung: 3 von 4 Enablern abgeschlossen (75%)',
  ].join('\n'),
  tokenEstimate: 400,
  dataIntent: 'day_briefing',
};

const SCOPE = {
  currentPhase: 1 as const,
  allowedComponentPhases: [1],
} as unknown as PipelineContext['trainingScope'];

function ctx(extra: Partial<PipelineContext> = {}): PipelineContext {
  return { userId: USER, userRole: 'TRAINEE', ...extra };
}

const paths: Array<
  [string, (message: string, c: PipelineContext) => Promise<PipelineResult>]
> = [
  ['processMessage', (message, c) => processMessage(message, c)],
  [
    'processMessageStream',
    (message, c) => processMessageStream(message, c, () => undefined),
  ],
];

function lastPrompt(): string {
  return String(mockChat.mock.calls.at(-1)?.[0] ?? '');
}

describe.each(paths)('day companion through %s', (_name, run) => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    mockResolveAccess.mockResolvedValue({
      catalogIds: [FIAE],
      audience: 'trainee',
      organizationId: 'org-1',
      userId: USER,
    });
    // a search that would find high-relevance sources for anything
    mockSearchWithContext.mockResolvedValue({
      results: [
        {
          id: 'e1',
          sourceType: 'enabler',
          sourceId: 'e1-source',
          chunkIndex: 0,
          content: 'Enabler 3 Datenbanken',
          similarity: 0.92,
          metadata: { title: 'Enabler 3: Datenbanken' },
        },
      ],
      query: '',
      totalResults: 1,
    });
    mockData.mockResolvedValue(DAY_DATA);
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
  });

  it.each([
    'Was steht für mich an?',
    'Was habe ich diese Woche zu tun?',
    'Was ist offen?',
    'Hallo, was steht an?', // short and with a greeting: not the canned greeting
    'Was ist heute fällig?', // starts with "was ist": not an explanation
  ])(
    'answers "%s" from the data, without the knowledge search and its sources',
    async message => {
      const result = await run(message, ctx());

      expect(mockSearchWithContext).not.toHaveBeenCalled();
      expect(result.citations).toEqual([]);
      expect(result.response).toBe('Antwort');
      expect(result.intent).toBe('question');
      expect(mockChat).toHaveBeenCalledTimes(1);

      const prompt = lastPrompt();
      expect(prompt).toContain('3 von 4 Enablern abgeschlossen');
      expect(prompt).toContain(SECTION);
      expect(prompt).toContain('höchstens drei Punkte');
      expect(prompt).toContain('nie pauschal "keine Daten"');
      expect(prompt).toContain('genau einer Frage');
      // no hint that the knowledge base found nothing, no "nothing found" reason
      expect(prompt).not.toContain(KNOWLEDGE_HINT);
      expect(prompt).not.toContain(VOICE_SECTION);
    }
  );

  it('gives the data context the chosen occupation and the training scope', async () => {
    await run(
      'Was steht für mich an?',
      ctx({ preferredCatalogCode: 'KFBM', trainingScope: SCOPE })
    );
    expect(mockData).toHaveBeenCalledWith(
      USER,
      'TRAINEE',
      'Was steht für mich an?',
      { preferredCatalogCode: 'KFBM', trainingScope: SCOPE }
    );
  });

  it('keeps a knowledge question with similar words in the search, with its sources', async () => {
    mockData.mockResolvedValue(null);
    const result = await run('Was steht in Enabler 3 an?', ctx());

    expect(mockSearchWithContext).toHaveBeenCalledTimes(1);
    expect(result.citations.map(c => c.title)).toEqual([
      'Enabler 3: Datenbanken',
    ]);
    expect(lastPrompt()).not.toContain(SECTION);
  });

  it('keeps the sources of an ordinary knowledge question', async () => {
    mockData.mockResolvedValue(null);
    const result = await run('Was ist ein Primärschlüssel?', ctx());
    expect(mockSearchWithContext).toHaveBeenCalledTimes(1);
    expect(result.citations).toHaveLength(1);
  });

  it('adds no section for a question of another data intent', async () => {
    mockData.mockResolvedValue({
      summary: '**Kursfortschritt:** Datenbanken 3/4',
      tokenEstimate: 300,
      dataIntent: 'progress_query',
    });
    await run('Wie ist mein Fortschritt?', ctx());
    expect(lastPrompt()).not.toContain(SECTION);
  });

  it('leaves a bare greeting a greeting (no model call)', async () => {
    const result = await run('Guten Morgen!', ctx());
    expect(result.intent).toBe('greeting');
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockSearchWithContext).not.toHaveBeenCalled();
  });

  it('does not add the section when the data could not be loaded', async () => {
    mockData.mockResolvedValue(null);
    await run('Was steht für mich an?', ctx());
    const prompt = lastPrompt();
    expect(prompt).not.toContain(SECTION);
    // the existing note about missing live data stays
    expect(prompt).toContain('Es konnten KEINE Live-Daten');
  });

  describe('spoken', () => {
    it('is the same question: shorter answer rules on top, same data, no sources', async () => {
      const result = await run(
        'Was steht für mich an?',
        ctx({ voice: true, preferredCatalogCode: 'FIAE' })
      );
      expect(mockSearchWithContext).not.toHaveBeenCalled();
      expect(result.citations).toEqual([]);
      const prompt = lastPrompt();
      expect(prompt).toContain(VOICE_SECTION);
      expect(prompt).toContain(SECTION);
      expect(prompt).toContain('höchstens drei Punkte');
      expect(prompt).toContain('3 von 4 Enablern abgeschlossen');
      // the voice section keeps its place before the borderline rules
      expect(prompt.indexOf(VOICE_SECTION)).toBeLessThan(
        prompt.lastIndexOf('## Zusatzregeln für Grenzfälle')
      );
    });

    it('keeps the opening question of the day as it is', async () => {
      // src/lib/hai/voice/speech.ts: `${greeting}, was steht heute an?`
      const result = await run(
        'Guten Morgen, was steht heute an?',
        ctx({ voice: true })
      );
      expect(result.intent).toBe('question');
      expect(result.citations).toEqual([]);
      expect(mockSearchWithContext).not.toHaveBeenCalled();
      expect(lastPrompt()).toContain(VOICE_SECTION);
      expect(lastPrompt()).toContain(SECTION);
    });

    it('does not change how a spoken knowledge question is answered', async () => {
      mockData.mockResolvedValue(null);
      const result = await run(
        'Was muss ich tun, um einen Fremdschlüssel zu definieren?',
        ctx({ voice: true })
      );
      expect(mockSearchWithContext).toHaveBeenCalledTimes(1);
      expect(result.citations).toHaveLength(1);
      expect(lastPrompt()).toContain(VOICE_SECTION);
      expect(lastPrompt()).not.toContain(SECTION);
    });
  });
});
