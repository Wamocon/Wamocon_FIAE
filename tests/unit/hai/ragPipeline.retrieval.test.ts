/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

// Retrieval of the RAG pipeline (package H1): one shared function
// (retrieveContext) feeds processMessage and processMessageStream, its scope
// comes from the database (resolveRetrievalAccess), and without a scope no
// index content is used. The in-memory index below applies the contract of
// the SQL filter (catalog, visibility) so the tests check what a user gets.

const mockResolveAccess = jest.fn();
const mockSearchWithContext = jest.fn();
const mockFetchPageIndex = jest.fn();
const mockChat = jest.fn();
const mockSokrates = jest.fn();

jest.mock('@/lib/hai/retrievalAccess', () => ({
  resolveRetrievalAccess: (userId: string) => mockResolveAccess(userId),
}));
// The persona is resolved from the access (package H3): FIAE keeps the FIAE
// texts, another occupation without settings gets the generic persona, and
// without an access the persona is neutral. Its own tests: persona*.test.ts.
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
  chatWithSokratesOnly: (...args: unknown[]) => mockSokrates(...args),
  getChatProvider: () => ({ isInitialized: () => true }),
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
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
  retrieveContext,
  type PipelineContext,
} from '@/lib/hai/ragPipeline';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'b0000000-0000-4000-8000-00000000000b';
const USER = '10000000-0000-4000-8000-000000000001';
const QUESTION = 'Was ist Normalisierung?';

type IndexRow = {
  id: string;
  sourceType: string;
  catalogId: string;
  visibility: 'all' | 'trainer';
  content: string;
};

const INDEX: IndexRow[] = [
  {
    id: 'e-fiae',
    sourceType: 'enabler',
    catalogId: FIAE,
    visibility: 'all',
    content: 'FIAE Enabler Normalisierung',
  },
  {
    id: 'c-fiae',
    sourceType: 'course',
    catalogId: FIAE,
    visibility: 'all',
    content: 'FIAE Kurs Datenbanken',
  },
  {
    id: 'u-fiae',
    sourceType: 'use_case',
    catalogId: FIAE,
    visibility: 'all',
    content: 'FIAE Use Case Beschreibung',
  },
  {
    id: 's-fiae',
    sourceType: 'use_case',
    catalogId: FIAE,
    visibility: 'trainer',
    content: 'FIAE LOESUNG Seite 3',
  },
  {
    id: 'q-fiae',
    sourceType: 'quiz',
    catalogId: FIAE,
    visibility: 'trainer',
    content: 'Quiz richtig Antwort B',
  },
  {
    id: 'e-kfbm',
    sourceType: 'enabler',
    catalogId: KFBM,
    visibility: 'all',
    content: 'KfBM Enabler Buchfuehrung',
  },
];

/** Applies the contract of the SQL filter of vectorSearch to the index. */
function fakeSearch(
  _query: string,
  _context: unknown,
  options: { catalogIds: string[]; audience: string }
) {
  const results = INDEX.filter(
    row =>
      options.catalogIds.includes(row.catalogId) &&
      (options.audience === 'trainer' || row.visibility === 'all')
  ).map(row => ({
    id: row.id,
    sourceType: row.sourceType,
    sourceId: `${row.id}-source`,
    chunkIndex: 0,
    content: row.content,
    similarity: 0.9,
    metadata: { title: row.id },
  }));
  return Promise.resolve({
    results,
    query: _query,
    totalResults: results.length,
  });
}

function context(extra: Partial<PipelineContext> = {}): PipelineContext {
  return {
    userId: USER,
    userRole: 'TRAINEE',
    currentEnablerId: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001',
    currentCourseId: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0002',
    ...extra,
  };
}

const traineeFiae = {
  catalogIds: [FIAE],
  audience: 'trainee',
  organizationId: ORG,
  userId: USER,
};
const traineeKfbm = { ...traineeFiae, catalogIds: [KFBM] };
const trainerFiae = { ...traineeFiae, audience: 'trainer' };

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveAccess.mockResolvedValue(traineeFiae);
  mockSearchWithContext.mockImplementation(fakeSearch);
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
  mockSokrates.mockImplementation(
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

const systemPromptOfLastCall = () => mockChat.mock.calls.at(-1)![0] as string;

describe('retrieveContext', () => {
  it('resolves the scope from the user id, not from the context role', async () => {
    await retrieveContext(QUESTION, context({ userRole: 'TRAINER' }));
    expect(mockResolveAccess).toHaveBeenCalledWith(USER);
    // the role the client side context claims is not used for the audience
    const options = mockSearchWithContext.mock.calls[0][2];
    expect(options.audience).toBe('trainee');
  });

  it('passes catalogs, audience, organization and user to the search', async () => {
    await retrieveContext(QUESTION, context());
    const [query, searchContext, options] = mockSearchWithContext.mock.calls[0];
    expect(query).toBe(QUESTION);
    expect(searchContext).toEqual({
      currentEnablerId: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001',
      currentCourseId: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0002',
    });
    expect(options).toMatchObject({
      topK: 5,
      minSimilarity: 0.45,
      catalogIds: [FIAE],
      audience: 'trainee',
      organizationId: ORG,
      userId: USER,
    });
  });

  it('passes the same scope to the PageIndex', async () => {
    await retrieveContext(QUESTION, context());
    const [query, vectorResults, options] = mockFetchPageIndex.mock.calls[0];
    expect(query).toBe(QUESTION);
    expect(vectorResults.length).toBeGreaterThan(0);
    expect(options).toMatchObject({
      catalogIds: [FIAE],
      audience: 'trainee',
      organizationId: ORG,
      currentEnablerId: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001',
    });
  });

  it('hands the training scope to the search (it filters there)', async () => {
    const trainingScope = { applies: true } as never;
    await retrieveContext(QUESTION, context({ trainingScope }));
    expect(mockSearchWithContext.mock.calls[0][2].trainingScope).toBe(
      trainingScope
    );
    expect(mockFetchPageIndex.mock.calls[0][2].trainingScope).toBe(
      trainingScope
    );
  });

  it('uses no index content without a scope (fail closed)', async () => {
    mockResolveAccess.mockResolvedValue(null);
    const result = await retrieveContext(QUESTION, context());
    expect(result).toEqual({ searchResults: [], retrievedContext: '' });
    expect(mockSearchWithContext).not.toHaveBeenCalled();
    expect(mockFetchPageIndex).not.toHaveBeenCalled();
  });

  it('continues with the PageIndex when the vector search fails', async () => {
    mockSearchWithContext.mockRejectedValue(new Error('vector down'));
    const result = await retrieveContext(QUESTION, context());
    expect(result.searchResults).toEqual([]);
    expect(mockFetchPageIndex).toHaveBeenCalled();
  });

  it('turns PageIndex citations into search results and keeps the URL rule', async () => {
    mockFetchPageIndex.mockResolvedValue({
      pdfContext: '--- PDF-Dokumenten-Kontext ---',
      documentsScanned: 2,
      relevantPages: 2,
      citations: [
        {
          documentId: 'doc-public',
          documentTitle: 'Theorie',
          fileName: 'theorie.pdf',
          pageNumber: 2,
          storageUrl: 'https://bucket.example/theorie.pdf',
          relevanceScore: 0.8,
        },
        {
          documentId: 'doc-solution',
          documentTitle: 'Loesung',
          fileName: 'loesung.pdf',
          pageNumber: 1,
          relevanceScore: 0.7,
        },
      ],
    });
    mockResolveAccess.mockResolvedValue(trainerFiae);
    const result = await retrieveContext(QUESTION, context());
    const publicDoc = result.searchResults.find(
      r => r.sourceId === 'doc-public'
    );
    const solutionDoc = result.searchResults.find(
      r => r.sourceId === 'doc-solution'
    );
    expect(publicDoc?.metadata.storageUrl).toBe(
      'https://bucket.example/theorie.pdf'
    );
    expect(solutionDoc?.metadata.storageUrl).toBeUndefined();
    expect(result.retrievedContext).toContain('PDF-Dokumenten-Kontext');
  });

  it('continues without PDF context when the PageIndex fails', async () => {
    mockFetchPageIndex.mockRejectedValue(new Error('pdf down'));
    const result = await retrieveContext(QUESTION, context());
    expect(result.searchResults.length).toBeGreaterThan(0);
  });
});

// Model solutions of the private bucket (trainer solutions, switch
// HAI_TRAINER_SOLUTIONS): the pipeline passes the permission of the access to
// the search, and as a second guard drops every marked chunk the access does
// not allow. Nothing of it comes from the request.
describe('retrieveContext: trainer solutions', () => {
  const SOLUTION_TEXT = 'MUSTERLOESUNG KFBM Schritt 1 Fahrtkosten';
  const markedChunk = (catalogId: string) => ({
    id: 'private-solution',
    sourceType: 'document',
    sourceId: 'solution-doc',
    chunkIndex: 0,
    content: SOLUTION_TEXT,
    similarity: 0.95,
    metadata: {
      title: 'Loesung UC 1',
      documentType: 'TRAINER_SOLUTION',
      trainerSolution: true,
      catalogId,
    },
  });
  const trainerWithPermission = {
    ...trainerFiae,
    includeTrainerSolutions: true,
  };

  /** A search that returns the marked chunk to anyone (a broken filter). */
  function leakySearch(
    query: string,
    _context: unknown,
    options: { catalogIds: string[]; audience: string }
  ) {
    return fakeSearch(query, _context, options).then(found => ({
      ...found,
      results: [...found.results, markedChunk(FIAE)],
    }));
  }

  it('passes the permission of the access to the search, and nothing else', async () => {
    mockResolveAccess.mockResolvedValue(trainerWithPermission);
    await retrieveContext(QUESTION, context());
    expect(mockSearchWithContext.mock.calls[0][2].includeTrainerSolutions).toBe(
      true
    );
    mockSearchWithContext.mockClear();
    mockResolveAccess.mockResolvedValue(trainerFiae);
    await retrieveContext(QUESTION, context());
    expect(
      mockSearchWithContext.mock.calls[0][2].includeTrainerSolutions
    ).toBeUndefined();
  });

  it('gives a trainer with the permission the solution, marked as trainer knowledge', async () => {
    mockResolveAccess.mockResolvedValue(trainerWithPermission);
    mockSearchWithContext.mockImplementation(leakySearch);
    const result = await retrieveContext(QUESTION, context());
    expect(result.usedTrainerSolutions).toBe(true);
    expect(result.retrievedContext).toContain(SOLUTION_TEXT);
    expect(result.retrievedContext).toMatch(/Musterlösung.*nur für Trainer/);
    expect(result.searchResults.some(r => r.sourceId === 'solution-doc')).toBe(
      true
    );
  });

  it.each([
    ['a trainee', traineeFiae],
    ['a trainee who claims the trainer role', traineeFiae],
    ['a trainer without the permission (switch off)', trainerFiae],
    [
      'a trainer with a permission that is not true',
      { ...trainerFiae, includeTrainerSolutions: 'true' },
    ],
    [
      'a trainee with the permission set by mistake',
      { ...traineeFiae, includeTrainerSolutions: true },
    ],
  ])(
    'drops a marked chunk for %s even if the search returns it',
    async (_name, access) => {
      mockResolveAccess.mockResolvedValue(access);
      mockSearchWithContext.mockImplementation(leakySearch);
      const result = await retrieveContext(
        QUESTION,
        context({ userRole: 'TRAINER' })
      );
      expect(result.usedTrainerSolutions).toBeUndefined();
      expect(result.retrievedContext).not.toContain(SOLUTION_TEXT);
      expect(result.retrievedContext).not.toContain('Musterlösung');
      expect(
        result.searchResults.some(r => r.sourceId === 'solution-doc')
      ).toBe(false);
    }
  );

  it('does not flag a turn without a marked chunk', async () => {
    mockResolveAccess.mockResolvedValue(trainerWithPermission);
    const result = await retrieveContext(QUESTION, context());
    expect(result.usedTrainerSolutions).toBeUndefined();
  });

  it('gives no citation with an address for the solution', async () => {
    mockResolveAccess.mockResolvedValue(trainerWithPermission);
    mockSearchWithContext.mockImplementation(
      async (...args: Parameters<typeof leakySearch>) => {
        const found = await leakySearch(...args);
        return {
          ...found,
          results: found.results.map(r =>
            r.id === 'private-solution'
              ? {
                  ...r,
                  metadata: {
                    ...r.metadata,
                    storageUrl: 'private://content-solutions/kfbm/a.pdf',
                    url: 'https://x.supabase.co/storage/v1/object/sign/content-solutions/kfbm/a.pdf?token=abc',
                  },
                }
              : r
          ),
        };
      }
    );
    const result = await processMessage(QUESTION, context());
    const citation = result.citations.find(c => c.sourceId === 'solution-doc');
    expect(citation).toBeDefined();
    expect(citation?.url).toBeUndefined();
    expect(JSON.stringify(result.citations)).not.toMatch(
      /private:\/\/|token=|content-solutions/
    );
  });

  describe('HAI_TRAINER_SOLUTIONS_CHAT=sokrates', () => {
    const saved = process.env.HAI_TRAINER_SOLUTIONS_CHAT;
    afterEach(() => {
      if (saved === undefined) delete process.env.HAI_TRAINER_SOLUTIONS_CHAT;
      else process.env.HAI_TRAINER_SOLUTIONS_CHAT = saved;
    });
    const runs = [
      (ctx: PipelineContext) => processMessage(QUESTION, ctx),
      (ctx: PipelineContext) =>
        processMessageStream(QUESTION, ctx, () => undefined),
    ];

    it('answers a turn with trainer solutions by Sokrates only, never by the normal chain', async () => {
      process.env.HAI_TRAINER_SOLUTIONS_CHAT = 'sokrates';
      mockResolveAccess.mockResolvedValue(trainerWithPermission);
      mockSearchWithContext.mockImplementation(leakySearch);
      for (const run of runs) {
        mockChat.mockClear();
        mockSokrates.mockClear();
        await run(context());
        expect(mockSokrates).toHaveBeenCalledTimes(1);
        expect(mockChat).not.toHaveBeenCalled();
      }
    });

    it('also does it for a turn whose history comes from a session with trainer knowledge', async () => {
      process.env.HAI_TRAINER_SOLUTIONS_CHAT = 'sokrates';
      mockResolveAccess.mockResolvedValue(trainerWithPermission);
      for (const run of runs) {
        mockChat.mockClear();
        mockSokrates.mockClear();
        await run(context({ holdsTrainerKnowledge: true }));
        expect(mockSokrates).toHaveBeenCalledTimes(1);
        expect(mockChat).not.toHaveBeenCalled();
      }
    });

    it('leaves an ordinary turn on the normal chain', async () => {
      process.env.HAI_TRAINER_SOLUTIONS_CHAT = 'sokrates';
      mockResolveAccess.mockResolvedValue(trainerWithPermission);
      for (const run of runs) {
        mockChat.mockClear();
        mockSokrates.mockClear();
        await run(context());
        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(mockSokrates).not.toHaveBeenCalled();
      }
    });

    it('does nothing by default (the normal chain answers a turn with trainer solutions)', async () => {
      delete process.env.HAI_TRAINER_SOLUTIONS_CHAT;
      mockResolveAccess.mockResolvedValue(trainerWithPermission);
      mockSearchWithContext.mockImplementation(leakySearch);
      for (const run of runs) {
        mockChat.mockClear();
        mockSokrates.mockClear();
        await run(context());
        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(mockSokrates).not.toHaveBeenCalled();
      }
    });
  });

  it('marks the result of the turn so that the chat can keep it from other roles', async () => {
    mockResolveAccess.mockResolvedValue(trainerWithPermission);
    mockSearchWithContext.mockImplementation(leakySearch);
    for (const run of [
      () => processMessage(QUESTION, context()),
      () => processMessageStream(QUESTION, context(), () => undefined),
    ]) {
      const result = await run();
      expect(result.usedTrainerSolutions).toBe(true);
    }
    mockResolveAccess.mockResolvedValue(trainerFiae);
    for (const run of [
      () => processMessage(QUESTION, context()),
      () => processMessageStream(QUESTION, context(), () => undefined),
    ]) {
      const result = await run();
      expect(result.usedTrainerSolutions).toBeUndefined();
    }
  });
});

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
])('%s uses the scoped retrieval', (_name, run) => {
  it('FIAE trainee: still gets enabler, course and use case hits, never a solution', async () => {
    const result = await run(QUESTION, context());
    const prompt = systemPromptOfLastCall();
    expect(prompt).toContain('FIAE Enabler Normalisierung');
    expect(prompt).toContain('FIAE Kurs Datenbanken');
    expect(prompt).toContain('FIAE Use Case Beschreibung');
    expect(prompt).not.toContain('LOESUNG');
    expect(prompt).not.toContain('Antwort B');
    expect(prompt).not.toContain('KfBM Enabler');
    expect(result.citations.map(c => c.title).sort()).toEqual([
      'c-fiae',
      'e-fiae',
      'u-fiae',
    ]);
  });

  it('trainer: sees the solutions of the occupation', async () => {
    mockResolveAccess.mockResolvedValue(trainerFiae);
    await run(QUESTION, context({ userRole: 'TRAINER' }));
    const prompt = systemPromptOfLastCall();
    expect(prompt).toContain('FIAE LOESUNG Seite 3');
    expect(prompt).toContain('Antwort B');
    expect(prompt).not.toContain('KfBM Enabler');
  });

  it('KfBM trainee: gets only KfBM content', async () => {
    mockResolveAccess.mockResolvedValue(traineeKfbm);
    await run(QUESTION, context());
    const prompt = systemPromptOfLastCall();
    expect(prompt).toContain('KfBM Enabler Buchfuehrung');
    expect(prompt).not.toContain('FIAE');
  });

  it('user without a scope: neutral refusal, no index content, no model call', async () => {
    mockResolveAccess.mockResolvedValue(null);
    const result = await run(QUESTION, context());
    expect(result.response).toContain('kein Ausbildungsberuf zugeordnet');
    expect(result.intent).toBe('off_topic');
    expect(result.citations).toEqual([]);
    expect(mockSearchWithContext).not.toHaveBeenCalled();
    expect(mockFetchPageIndex).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('calls the PageIndex with the scope as well', async () => {
    await run(QUESTION, context());
    expect(mockFetchPageIndex.mock.calls[0][2]).toMatchObject({
      catalogIds: [FIAE],
      audience: 'trainee',
    });
  });

  it('does not retrieve for a quiz answer', async () => {
    await run('B', context({ quizState: { active: true } }));
    expect(mockSearchWithContext).not.toHaveBeenCalled();
    expect(mockFetchPageIndex).not.toHaveBeenCalled();
  });

  it('does not retrieve for a web search', async () => {
    await run('suche nach aktuellen Datenbank News', context());
    expect(mockSearchWithContext).not.toHaveBeenCalled();
    expect(mockFetchPageIndex).not.toHaveBeenCalled();
  });
});

describe('both pipelines share one retrieval (structure)', () => {
  const source = fs
    .readFileSync(
      path.join(process.cwd(), 'src', 'lib', 'hai', 'ragPipeline.ts'),
      'utf-8'
    )
    .replace(/\r\n/g, '\n');

  it('searches and reads PDFs in exactly one place, inside retrieveContext', () => {
    expect(source.match(/await searchWithContext\(/g)).toHaveLength(1);
    expect(source.match(/await fetchPageIndexContext\(/g)).toHaveLength(1);
    const body = source.slice(
      source.indexOf('export async function retrieveContext'),
      source.indexOf('// MAIN PIPELINE')
    );
    expect(body).toContain('await searchWithContext(');
    expect(body).toContain('await fetchPageIndexContext(');
  });

  it('calls retrieveContext in processMessage and in processMessageStream', () => {
    const streamAt = source.indexOf(
      'export async function processMessageStream'
    );
    const single = source.slice(
      source.indexOf('export async function processMessage('),
      streamAt
    );
    const stream = source.slice(streamAt);
    expect(single).toContain('await retrieveContext(');
    expect(stream).toContain('await retrieveContext(');
  });

  it('has no unscoped search call left in the pipeline module', () => {
    expect(source).not.toMatch(/filterSearchResultsForTrainingScope/);
    expect(source.match(/audience: access\.audience/g)).toHaveLength(2);
  });
});
