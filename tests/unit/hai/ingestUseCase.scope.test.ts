/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';

// Write path 2: lib/hai/ingestUseCase.ts (solution pages of a use case). Every
// chunk is trainer only, carries the occupation of the use case and the
// organization of the document.

const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';
const USE_CASE = '33333333-3333-4333-8333-333333333333';
const DOC = '44444444-4444-4444-8444-444444444444';

const dialect = new PgDialect();
const render = (statement: unknown) =>
  dialect.sqlToQuery(statement as never) as { sql: string; params: unknown[] };

async function load(options: {
  documentType?: string;
  organizationId?: string | null;
  useCaseCatalog?: string | null;
  stored?: Record<string, unknown> | null;
}) {
  jest.resetModules();
  const {
    documentType = 'TRAINER_SOLUTION',
    organizationId = ORG,
    useCaseCatalog = KFBM,
    stored = null,
  } = options;
  const selects = [
    [
      {
        id: DOC,
        title: 'Lösung',
        storageUrl: 'https://example.invalid/x.pdf',
        documentType,
        useCaseId: USE_CASE,
        organizationId,
        visibility: 'TRAINER_ONLY',
      },
    ],
    [{ title: 'Use Case A', trainingCatalogId: useCaseCatalog }],
  ];
  let selectCall = 0;
  const select = jest.fn(() => {
    const rows = selects[selectCall++] ?? [];
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: async () => rows,
    };
    return chain;
  });
  const execute = jest.fn(async (statement: unknown) =>
    /SELECT training_catalog_id/.test(render(statement).sql)
      ? stored
        ? [stored]
        : []
      : []
  );
  const update = jest.fn(() => ({
    set: () => ({ where: async () => [] }),
  }));
  const generateEmbedding = jest.fn(async (_text: string) => ({
    embedding: [0.1, 0.2],
  }));
  jest.doMock('@/db/haiDb', () => ({
    __esModule: true,
    default: { select, execute, update },
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
    extractTextByPage: async () => ({
      success: true,
      totalPages: 1,
      pages: [{ page: 1, text: 'Musterlösung der Aufgabe, Seite eins.' }],
    }),
  }));
  const { ingestUseCaseDocument } = await import('@/lib/hai/ingestUseCase');
  return { ingestUseCaseDocument, execute, generateEmbedding };
}

function statements(execute: jest.Mock) {
  return execute.mock.calls.map(([s]) => render(s));
}

describe('ingestUseCaseDocument sets the scope itself', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('writes the solution page as trainer only, with catalog and organization', async () => {
    const { ingestUseCaseDocument, execute } = await load({});
    const result = await ingestUseCaseDocument(USE_CASE, DOC, true);
    expect(result).toMatchObject({ success: true, chunksIndexed: 1 });
    const insert = statements(execute).find(s =>
      /INSERT INTO hai_embeddings/.test(s.sql)
    )!;
    expect(insert.sql).toMatch(
      /training_catalog_id, visibility, organization_id/
    );
    expect(insert.params).toEqual(
      expect.arrayContaining([KFBM, 'trainer', ORG])
    );
    expect(insert.params).not.toContain('all');
    expect(insert.sql).toMatch(/training_catalog_id = EXCLUDED/);
    expect(insert.sql).toMatch(/visibility = EXCLUDED/);
    expect(insert.sql).toMatch(/organization_id = EXCLUDED/);
  });

  it('writes a NULL organization for a platform document', async () => {
    const { ingestUseCaseDocument, execute } = await load({
      organizationId: null,
    });
    await ingestUseCaseDocument(USE_CASE, DOC, true);
    const insert = statements(execute).find(s =>
      /INSERT INTO hai_embeddings/.test(s.sql)
    )!;
    expect(insert.params).toEqual(
      expect.arrayContaining([KFBM, 'trainer', null])
    );
  });

  it('refuses a use case without a catalog and embeds nothing', async () => {
    const { ingestUseCaseDocument, execute, generateEmbedding } = await load({
      useCaseCatalog: null,
    });
    const result = await ingestUseCaseDocument(USE_CASE, DOC, true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Index scope incomplete/);
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('still refuses a document that is not a trainer solution', async () => {
    const { ingestUseCaseDocument, execute } = await load({
      documentType: 'THEORY',
    });
    const result = await ingestUseCaseDocument(USE_CASE, DOC, true);
    expect(result.success).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rescopes an unchanged page without a model call', async () => {
    const { ingestUseCaseDocument, execute, generateEmbedding } = await load({
      stored: {
        training_catalog_id: '00000000-0000-4000-8000-000000000001',
        visibility: 'trainer',
        organization_id: ORG,
      },
    });
    // the mock returns the stored row for the hash query: same text
    const result = await ingestUseCaseDocument(USE_CASE, DOC, false);
    expect(result).toMatchObject({ success: true, chunksSkipped: 1 });
    expect(generateEmbedding).not.toHaveBeenCalled();
    const update = statements(execute).find(s =>
      /UPDATE hai_embeddings/.test(s.sql)
    )!;
    expect(update.params).toEqual(
      expect.arrayContaining([KFBM, 'trainer', ORG])
    );
  });
});
