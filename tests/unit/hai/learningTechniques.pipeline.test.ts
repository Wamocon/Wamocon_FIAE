/**
 * @jest-environment node
 */

// Both pipelines (processMessage and processMessageStream) add the learning
// technique section with its limits for a question about learning, ask the
// search for cards, and keep every other prompt as it was. Cards open no
// content of another occupation. Model, embeddings and database are fakes.

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
              code: id.endsWith('1') ? 'FIAE' : 'KFBM',
              title: id.endsWith('1') ? 'Fachinformatik' : 'Kaufleute',
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

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'b0000000-0000-4000-8000-00000000000b';
const USER = '10000000-0000-4000-8000-000000000001';

const SECTION = '## Lerntechniken: Tipps zum Lernen und Merken';
const CARD_TEXT = 'Lerntechnik: Abrufübung (KARTENTEXT)';

type IndexRow = {
  id: string;
  sourceType: string;
  catalogId: string | null;
  content: string;
};

// the contract of the SQL filter: own catalog, or the platform card (no catalog)
const INDEX: IndexRow[] = [
  {
    id: 'e-fiae',
    sourceType: 'enabler',
    catalogId: FIAE,
    content: 'FIAE Enabler Normalisierung',
  },
  {
    id: 'e-kfbm',
    sourceType: 'enabler',
    catalogId: KFBM,
    content: 'KfBM Enabler Buchfuehrung',
  },
  {
    id: 'card-1',
    sourceType: 'learning_technique',
    catalogId: null,
    content: CARD_TEXT,
  },
];

function fakeSearch(
  query: string,
  searchContext: { includeLearningTechniques?: boolean },
  options: { catalogIds: string[] }
) {
  const visible = INDEX.filter(
    row =>
      row.sourceType === 'learning_technique' ||
      (row.catalogId && options.catalogIds.includes(row.catalogId))
  );
  const cards = visible.filter(r => r.sourceType === 'learning_technique');
  const others = visible.filter(r => r.sourceType !== 'learning_technique');
  const chosen = searchContext.includeLearningTechniques
    ? [...cards, ...others]
    : others;
  const results = chosen.map(row => ({
    id: row.id,
    sourceType: row.sourceType,
    sourceId: `${row.id}-source`,
    chunkIndex: 0,
    content: row.content,
    similarity: 0.9,
    metadata: { title: row.id },
  }));
  return Promise.resolve({ results, query, totalResults: results.length });
}

const traineeFiae = {
  catalogIds: [FIAE],
  audience: 'trainee',
  organizationId: ORG,
  userId: USER,
};
const traineeKfbm = { ...traineeFiae, catalogIds: [KFBM] };
const trainerFiae = { ...traineeFiae, audience: 'trainer' };

function context(extra: Partial<PipelineContext> = {}): PipelineContext {
  return { userId: USER, userRole: 'TRAINEE', ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveAccess.mockResolvedValue(traineeFiae);
  mockSearchWithContext.mockImplementation(fakeSearch);
  mockFetchDataContext.mockResolvedValue(null);
  mockFetchPageIndex.mockResolvedValue({
    pdfContext: '',
    documentsScanned: 0,
    relevantPages: 0,
    citations: [],
  });
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

const promptOfLastCall = () => mockChat.mock.calls.at(-1)![0] as string;

describe.each([
  [
    'processMessage',
    (message: string, ctx: PipelineContext) => processMessage(message, ctx),
  ],
  [
    'processMessageStream',
    (message: string, ctx: PipelineContext) =>
      processMessageStream(message, ctx, () => undefined),
  ],
])('%s', (_name, run) => {
  it('adds the section with all limits for a question about learning', async () => {
    await run('Wie kann ich mir Fachbegriffe besser merken?', context());
    const prompt = promptOfLastCall();
    expect(prompt).toContain(SECTION);
    expect(prompt).toContain('KEINE Diagnosen');
    expect(prompt).toContain('KEINE Stimm- oder Emotionsanalyse');
    expect(prompt).toContain('KEINE Lerntypen');
    expect(prompt).toContain('KEINE Heilversprechen');
    expect(prompt).toContain(CARD_TEXT);
  });

  it('asks the search for cards only for a question about learning', async () => {
    await run('Wie lerne ich besser?', context());
    expect(mockSearchWithContext.mock.calls[0][1]).toMatchObject({
      includeLearningTechniques: true,
    });
    mockSearchWithContext.mockClear();
    await run('Was ist Normalisierung?', context());
    expect(mockSearchWithContext.mock.calls[0][1]).not.toHaveProperty(
      'includeLearningTechniques'
    );
  });

  it('leaves every other prompt without the section', async () => {
    await run('Was ist Normalisierung?', context());
    expect(promptOfLastCall()).not.toContain(SECTION);
    expect(promptOfLastCall()).not.toContain(CARD_TEXT);
  });

  it('adds the section when a card was found for a message without a keyword', async () => {
    mockSearchWithContext.mockResolvedValue({
      results: [
        {
          id: 'card-1',
          sourceType: 'learning_technique',
          sourceId: 'x',
          chunkIndex: 0,
          content: CARD_TEXT,
          similarity: 0.8,
          metadata: { title: 'card' },
        },
      ],
      query: 'q',
      totalResults: 1,
    });
    await run('Gib mir bitte eine Idee für morgen', context());
    expect(promptOfLastCall()).toContain(SECTION);
  });

  it('shows the cards to a FIAE trainee, a KfBM trainee and a trainer', async () => {
    for (const access of [traineeFiae, traineeKfbm, trainerFiae]) {
      mockResolveAccess.mockResolvedValue(access);
      await run('Welche Lerntechnik hilft beim Merken?', context());
      expect(promptOfLastCall()).toContain(CARD_TEXT);
    }
  });

  it('lets the cards open nothing of another occupation', async () => {
    await run('Wie lerne ich besser für die Klausur?', context());
    expect(promptOfLastCall()).toContain(CARD_TEXT);
    expect(promptOfLastCall()).not.toContain('KfBM Enabler');
    mockResolveAccess.mockResolvedValue(traineeKfbm);
    await run('Wie lerne ich besser für die Klausur?', context());
    expect(promptOfLastCall()).toContain(CARD_TEXT);
    expect(promptOfLastCall()).not.toContain('FIAE Enabler');
  });

  it('names the example of the occupation of the trainee', async () => {
    await run('Wie lerne ich besser?', context());
    expect(promptOfLastCall()).toContain('Kürzel FIAE');
    mockResolveAccess.mockResolvedValue(traineeKfbm);
    await run('Wie lerne ich besser?', context());
    expect(promptOfLastCall()).toContain('Kürzel KfBM');
  });

  it('gives a user without a scope neither cards nor section (fail closed)', async () => {
    mockResolveAccess.mockResolvedValue(null);
    const result = await run('Wie lerne ich besser?', context());
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockSearchWithContext).not.toHaveBeenCalled();
    expect(result.response).toMatch(/Ausbildungsberuf/);
  });

  it('puts the data of the data context next to the section', async () => {
    mockFetchDataContext.mockResolvedValue({
      summary: 'Letzte Quiz-Note: 55.0%',
      tokenEstimate: 10,
      dataIntent: 'learning_query',
    });
    await run('Wie lerne ich meine Quizfehler?', context());
    const prompt = promptOfLastCall();
    expect(prompt).toContain('## Aktuelle Plattform-Daten');
    expect(prompt).toContain('Letzte Quiz-Note: 55.0%');
    expect(prompt).toContain(SECTION);
    // the section tells the model to use these data only if they are there
    expect(prompt).toContain('NUR, wenn diese Angaben im Abschnitt');
  });
});
