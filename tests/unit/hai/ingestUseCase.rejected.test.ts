/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// A document row with a storage url that the server must not fetch (an old
// row) is skipped and counted, the batch goes on with the next document.

const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';
const USE_CASE = '33333333-3333-4333-8333-333333333333';
const DOC_BAD = '44444444-4444-4444-8444-444444444441';
const DOC_GOOD = '44444444-4444-4444-8444-444444444442';

const REJECTED = {
  success: false,
  pages: [],
  totalPages: 0,
  totalCharacters: 0,
  rejected: true,
  error: 'Storage url rejected: The storage url does not belong to the own project.',
};

async function load(single = false) {
  jest.resetModules();
  const rowOf = (id: string, storageUrl: string) => ({
    id,
    title: 'Lösung',
    storageUrl,
    documentType: 'TRAINER_SOLUTION',
    useCaseId: USE_CASE,
    organizationId: ORG,
    visibility: 'TRAINER_ONLY',
  });
  const docRows: Record<string, ReturnType<typeof rowOf>> = {
    [DOC_BAD]: rowOf(DOC_BAD, 'http://169.254.169.254/latest/meta-data/'),
    [DOC_GOOD]: rowOf(DOC_GOOD, 'https://abc.supabase.co/x.pdf'),
  };
  const batch = [DOC_BAD, DOC_GOOD].map(id => ({
    useCaseId: USE_CASE,
    useCaseTitle: 'Use Case A',
    documentId: id,
    documentTitle: 'Lösung',
    storageUrl: docRows[id].storageUrl,
    documentType: 'TRAINER_SOLUTION',
  }));

  // select() calls: the batch query first, then document + use case per document
  const queue: unknown[][] = [
    ...(single ? [] : [batch]),
    [docRows[DOC_BAD]],
    [{ title: 'Use Case A', trainingCatalogId: KFBM }],
    [docRows[DOC_GOOD]],
    [{ title: 'Use Case A', trainingCatalogId: KFBM }],
  ];
  const select = jest.fn(() => {
    const rows = queue.shift() ?? [];
    const result: any = Promise.resolve(rows);
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }),
      limit: async () => rows,
      then: result.then.bind(result),
    };
    return chain;
  });
  const execute = jest.fn(async () => []);
  const generateEmbedding = jest.fn(async (_text: string) => ({
    embedding: [0.1, 0.2],
  }));
  const extract = jest.fn(async (url: string) =>
    url.startsWith('http://169.')
      ? REJECTED
      : {
          success: true,
          totalPages: 1,
          pages: [{ page: 1, text: 'Musterlösung der Aufgabe, Seite eins.' }],
        }
  );
  jest.doMock('@/db/haiDb', () => ({
    __esModule: true,
    default: {
      select,
      execute,
      update: () => ({ set: () => ({ where: async () => [] }) }),
    },
  }));
  jest.doMock('@/lib/hai/providers', () => ({
    __esModule: true,
    getEmbeddingProvider: () => ({
      isInitialized: () => true,
      generateEmbedding,
    }),
  }));
  jest.doMock('@/lib/hai/pdfExtractor', () => ({
    __esModule: true,
    extractTextByPage: extract,
  }));
  const mod = await import('@/lib/hai/ingestUseCase');
  return { ...mod, generateEmbedding, extract };
}

describe('a refused storage url in the ingestion of solutions', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('skips the document with a clear message and indexes nothing', async () => {
    const { ingestUseCaseDocument, generateEmbedding } = await load(true);
    const result = await ingestUseCaseDocument(USE_CASE, DOC_BAD, true);
    expect(result).toMatchObject({
      success: false,
      skipped: true,
      pagesProcessed: 0,
      chunksIndexed: 0,
    });
    expect(result.error).toMatch(/^Storage url rejected: /);
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  it('counts the document as skipped in the batch and goes on with the next', async () => {
    const { ingestAllUseCases, extract } = await load();
    const result = await ingestAllUseCases(true);
    expect(result).toMatchObject({
      totalUseCases: 2,
      successfulUseCases: 1,
      skippedUseCases: 1,
      failedUseCases: 0,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Use Case A: Storage url rejected: /);
    expect(extract).toHaveBeenCalledTimes(2);
  });
});
