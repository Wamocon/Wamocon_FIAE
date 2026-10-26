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

jest.mock('@/lib/hai/retrievalAccess', () => ({
  resolveRetrievalAccess: (userId: string) => mockResolveAccess(userId),
}));
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

  it('user without a scope: no index content at all', async () => {
    mockResolveAccess.mockResolvedValue(null);
    const result = await run(QUESTION, context());
    const prompt = systemPromptOfLastCall();
    expect(prompt).not.toContain('FIAE');
    expect(prompt).not.toContain('KfBM');
    expect(result.citations).toEqual([]);
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
    expect(mockResolveAccess).not.toHaveBeenCalled();
    expect(mockSearchWithContext).not.toHaveBeenCalled();
  });

  it('does not retrieve for a web search', async () => {
    await run('suche nach aktuellen Datenbank News', context());
    expect(mockResolveAccess).not.toHaveBeenCalled();
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
