/**
 * @jest-environment node
 */

// Agent layer: the requests for content (course, document, "diese Datei") and the
// commands without a target are answered by the platform in both pipelines, with a
// mock model that is never called: a recognized request never goes to the model
// without an answer of the platform.

const mockChat = jest.fn();
const mockDocsOf = jest.fn();
const mockDocsByName = jest.fn();

jest.mock('@/lib/hai/actions', () => ({
  detectActionIntent: jest.fn().mockReturnValue(null),
  executeAction: jest.fn(),
}));
jest.mock('@/lib/hai/providers', () => ({
  chatWithFallback: (...args: unknown[]) => mockChat(...args),
  getChatProvider: () => ({ isInitialized: () => true }),
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
}));
const mockAccess = jest.fn();
jest.mock('@/lib/hai/retrievalAccess', () => ({
  resolveRetrievalAccess: (userId: string) => mockAccess(userId),
}));
jest.mock('@/lib/hai/personaAccess', () => {
  const persona = jest.requireActual('@/lib/hai/persona');
  const fiae = {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'FIAE',
    title: 'Fachinformatiker Anwendungsentwicklung',
    settings: {},
  };
  return {
    loadHaiPersona: async () =>
      persona.resolveHaiPersona({ catalogs: [fiae], otherCatalogs: [] }),
  };
});
jest.mock('@/lib/hai/vectorSearch', () => ({
  searchWithContext: jest.fn().mockResolvedValue({ results: [] }),
}));
jest.mock('@/lib/hai/pageIndexService', () => ({
  fetchPageIndexContext: jest
    .fn()
    .mockResolvedValue({ pdfContext: '', citations: [] }),
}));
jest.mock('@/lib/hai/dataContext', () => ({
  fetchDataContext: jest.fn().mockResolvedValue(null),
}));

const COURSE = '40000000-0000-4000-8000-000000000001';
const E1 = '20000000-0000-4000-8000-000000000001';
const D1 = '50000000-0000-4000-8000-000000000001';
const candidate = (id: string, title: string) => ({
  id,
  title,
  code: null,
  courseId: '40000000-0000-4000-8000-000000000001',
  courseTitle: 'Netzwerke',
});
jest.mock('@/lib/hai/navigation/data', () => ({
  loadTraineeEnablers: async () => [
    candidate('20000000-0000-4000-8000-000000000001', 'Datensicherung'),
  ],
  loadTraineeUseCases: async () => [],
  loadEnablerLock: async () => ({
    locked: false,
    lockedByTitle: null,
    hasActiveQuiz: true,
  }),
  loadNextStepEntries: async () => [],
}));
jest.mock('@/lib/hai/navigation/contentData', () => ({
  loadCourses: async () => [
    candidate('40000000-0000-4000-8000-000000000001', 'Netzwerke'),
  ],
  loadTrainerEnablers: async () => [],
  loadTrainerUseCases: async () => [],
  findDocumentsOf: (...args: unknown[]) => mockDocsOf(...args),
  findDocumentsByName: (...args: unknown[]) => mockDocsByName(...args),
  enablerHasScenarioPdf: async () => false,
}));

import {
  processMessage,
  processMessageStream,
  type PipelineContext,
  type PipelineResult,
} from '@/lib/hai/ragPipeline';

const USER = '10000000-0000-4000-8000-000000000001';
const FIAE = '00000000-0000-4000-8000-000000000001';

const ctx = (overrides: Partial<PipelineContext> = {}): PipelineContext => ({
  userId: USER,
  userRole: 'TRAINEE',
  ...overrides,
});

const doc = {
  id: D1,
  title: 'Szenario K14-i',
  fileName: 'Szenario_14i.pdf',
  documentType: 'EXERCISE',
  parentType: 'enabler' as const,
  parentId: E1,
  parentTitle: 'Datensicherung',
  courseId: COURSE,
};

const paths: Array<
  [string, (message: string, c: PipelineContext) => Promise<PipelineResult>]
> = [
  ['processMessage', (message, c) => processMessage(message, c)],
  [
    'processMessageStream',
    (message, c) => processMessageStream(message, c, () => undefined),
  ],
];

describe.each(paths)('HAI content navigation through %s', (_name, run) => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockChat.mockResolvedValue({ text: 'Antwort des Modells', citations: [] });
    mockAccess.mockResolvedValue({
      catalogIds: [FIAE],
      audience: 'trainee' as const,
      organizationId: 'org-1',
      userId: USER,
    });
    mockDocsOf.mockResolvedValue([doc]);
    mockDocsByName.mockResolvedValue([doc]);
  });

  it('opens a course by its title, no model call', async () => {
    const result = await run('Öffne den Kurs Netzwerke', ctx());
    expect(mockChat).not.toHaveBeenCalled();
    expect(result.navigationOffer).toMatchObject({
      path: `/trainee/modules/${COURSE}`,
      auto: true,
    });
    expect(result.response).toBe('Ich öffne den Kurs Netzwerke.');
  });

  it('opens a document by its file name in the reader, typed and spoken', async () => {
    for (const voice of [false, true]) {
      const result = await run(
        'Öffne das Dokument Szenario_14i',
        ctx(voice ? { voice: true } : {})
      );
      expect(result.navigationOffer).toMatchObject({
        path: `/trainee/enablers/${E1}?document=${D1}`,
        auto: true,
      });
      expect(result.response).toBe('Ich öffne das Dokument Szenario K14-i.');
    }
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('offers a card for a question for the way to a scenario', async () => {
    const result = await run(
      'Wo finde ich das Szenario zu Enabler Datensicherung?',
      ctx()
    );
    expect(result.navigationOffer?.path).toBe(
      `/trainee/enablers/${E1}?document=${D1}`
    );
    expect(result.navigationOffer?.auto).toBeUndefined();
    expect(result.response).toContain('Mit Öffnen gelangst du direkt dorthin.');
  });

  it('uses the enabler of the page for "diese Datei"', async () => {
    const result = await run(
      'Öffne diese Datei',
      ctx({
        page: {
          path: `/trainee/enablers/${E1}`,
          kind: 'enabler',
          title: 'Datensicherung',
          visibleLabels: [],
          entities: [{ type: 'enabler', id: E1, title: 'Datensicherung' }],
        },
      })
    );
    expect(result.navigationOffer?.path).toBe(
      `/trainee/enablers/${E1}?document=${D1}`
    );
    expect(mockDocsOf).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'TRAINEE', userId: USER }),
      expect.objectContaining({ type: 'enabler', id: E1 })
    );
  });

  it('uses the record of the last turns for "das PDF dazu"', async () => {
    const result = await run(
      'und das PDF dazu',
      ctx({
        previousMessages: [
          {
            role: 'user',
            parts: [{ text: 'Öffne den Enabler Datensicherung' }],
          },
          { role: 'model', parts: [{ text: 'Ich öffne den Enabler.' }] },
        ],
      })
    );
    expect(result.navigationOffer?.path).toBe(
      `/trainee/enablers/${E1}?document=${D1}`
    );
  });

  it('answers a command without a target with the nearest pages as cards, never with the model', async () => {
    const result = await run('Öffne die Kantine', ctx());
    expect(mockChat).not.toHaveBeenCalled();
    expect(result.intent).toBe('navigation');
    expect(result.navigationOffer).toBeUndefined();
    expect(result.navigationChoices?.length).toBeGreaterThan(0);
    expect(result.navigationChoices?.length).toBeLessThanOrEqual(3);
    expect(result.response).not.toMatch(/Berechtigung|kann ich nicht/);
    expect(result.navigationOutcome).toBe('not_found');
  });

  it('gives a trainee a neutral answer for a file name that is not in the allowed documents', async () => {
    mockDocsByName.mockResolvedValue([]);
    const result = await run(
      'Öffne das Dokument UC_1b_Loesung_Intern.pdf',
      ctx()
    );
    expect(mockChat).not.toHaveBeenCalled();
    expect(result.navigationOffer).toBeUndefined();
    expect(result.response).toContain('keine passende Datei');
    expect(result.response).not.toMatch(/Schutz|Trainer|Berechtigung/);
  });

  it('gives a trainer the page of the use case with the document', async () => {
    mockAccess.mockResolvedValue({
      catalogIds: [FIAE],
      audience: 'trainer' as const,
      organizationId: 'org-1',
      userId: USER,
    });
    mockDocsByName.mockResolvedValue([
      { ...doc, parentType: 'use_case', parentId: E1 },
    ]);
    const result = await run(
      'Öffne das Dokument Szenario_14i',
      ctx({ userRole: 'TRAINER' })
    );
    expect(result.navigationOffer?.path).toBe(
      `/trainer/use-cases/${E1}?document=${D1}`
    );
  });
});
