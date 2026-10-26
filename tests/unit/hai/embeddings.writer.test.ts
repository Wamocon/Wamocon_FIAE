/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';

// Write path 1: lib/hai/embeddings.ts indexContent. It sets the occupation,
// the visibility and the organization of every chunk itself, refuses a call
// without a complete scope, and keeps the trainer part of a source in its own
// block of chunk indexes.

const KFBM = '00000000-0000-4000-8000-000000000002';
const FIAE = '00000000-0000-4000-8000-000000000001';
const ORG = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';

const dialect = new PgDialect();
const render = (statement: unknown) =>
  dialect.sqlToQuery(statement as never) as { sql: string; params: unknown[] };

type StoredRow = {
  contentHash: string;
  trainingCatalogId: string | null;
  visibility: string;
  organizationId: string | null;
} | null;

async function load(stored: StoredRow = null) {
  jest.resetModules();
  const execute = jest.fn(async (..._args: unknown[]) => []);
  const select = jest.fn(() => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: async () => (stored ? [stored] : []),
    };
    return chain;
  });
  const generateEmbedding = jest.fn(async (_text: string) => ({
    embedding: [0.1, 0.2, 0.3],
  }));
  jest.doMock('@/db/haiDb', () => ({
    __esModule: true,
    default: { execute, select },
  }));
  jest.doMock('@/lib/hai/providers', () => ({
    __esModule: true,
    getEmbeddingProvider: () => ({
      name: 'gemini',
      isInitialized: () => true,
      generateEmbedding,
    }),
  }));
  const mod = await import('@/lib/hai/embeddings');
  return { ...mod, execute, generateEmbedding };
}

const base = {
  sourceType: 'enabler' as const,
  sourceId: SOURCE,
  title: 'Titel',
  content: 'Ein kurzer Text für den Test.',
  trainingCatalogId: KFBM,
  visibility: 'all' as const,
  organizationId: null,
};

function statements(execute: jest.Mock) {
  return execute.mock.calls.map(([statement]) => render(statement));
}

function insertOf(execute: jest.Mock) {
  const insert = statements(execute).find(s =>
    /INSERT INTO hai_embeddings/.test(s.sql)
  );
  if (!insert) throw new Error('no insert');
  return insert;
}

describe('indexContent sets the scope columns itself', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('writes catalog, visibility and organization with the chunk', async () => {
    const { indexContent, execute } = await load();
    const result = await indexContent({
      ...base,
      organizationId: ORG,
      visibility: 'trainer',
    });
    expect(result).toMatchObject({ success: true, chunksIndexed: 1 });
    const insert = insertOf(execute);
    expect(insert.sql).toMatch(
      /training_catalog_id,\s+visibility,\s+organization_id/
    );
    expect(insert.params).toEqual(
      expect.arrayContaining([KFBM, 'trainer', ORG])
    );
    // the upsert updates them as well
    expect(insert.sql).toMatch(/training_catalog_id = EXCLUDED/);
    expect(insert.sql).toMatch(/visibility = EXCLUDED/);
    expect(insert.sql).toMatch(/organization_id = EXCLUDED/);
  });

  it('writes platform content with a NULL organization', async () => {
    const { indexContent, execute } = await load();
    await indexContent(base);
    expect(insertOf(execute).params).toEqual(
      expect.arrayContaining([KFBM, 'all', null])
    );
  });

  it.each([
    ['without a catalog', { trainingCatalogId: null }],
    ['with a visibility that does not exist', { visibility: 'everyone' }],
    ['without an organization', { organizationId: undefined }],
  ])('refuses a call %s and embeds nothing', async (_name, patch) => {
    const { indexContent, execute, generateEmbedding } = await load();
    const result = await indexContent({ ...base, ...patch } as never);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Index scope incomplete/);
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('writes the trainer part at its own chunk index and cleans only its block', async () => {
    const { indexContent, execute } = await load();
    await indexContent({
      ...base,
      sourceType: 'quiz',
      visibility: 'trainer',
      chunkIndexOffset: 10000,
      metadata: { contentPart: 'answers' },
    });
    const insert = insertOf(execute);
    expect(insert.params).toContain(10000);
    // the metadata goes in as a JSON string (an object is not accepted by the
    // postgres client with prepared statements off)
    const metadata = insert.params.find(
      param => typeof param === 'string' && param.startsWith('{')
    );
    expect(JSON.parse(metadata as string)).toMatchObject({
      contentPart: 'answers',
    });
    const cleanup = statements(execute).find(s =>
      /DELETE FROM hai_embeddings/.test(s.sql)
    )!;
    // stale chunks of the answers: above 10000 and below the end of the block
    expect(cleanup.sql).toMatch(/chunk_index > \$3\s+AND chunk_index < \$4/);
    expect(cleanup.params.slice(2)).toEqual([10000, 20000]);
  });

  it('keeps the public part away from the trainer block when it cleans up', async () => {
    const { indexContent, execute } = await load();
    await indexContent({ ...base, sourceType: 'quiz' });
    const cleanup = statements(execute).find(s =>
      /DELETE FROM hai_embeddings/.test(s.sql)
    )!;
    expect(cleanup.params.slice(2)).toEqual([0, 10000]);
  });
});

describe('indexContent: unchanged text with another scope is rescoped without a model call', () => {
  const content = base.content;
  // the hash the writer computes for the single chunk
  async function hashOfChunk() {
    const { createHash } = await import('crypto');
    const { chunkDocument } = await import('@/lib/hai/chunker');
    const [chunk] = chunkDocument(content, 'Titel', {
      maxChunkSize: 500,
      overlap: 50,
      preserveParagraphs: true,
      preserveSentences: true,
    });
    return createHash('sha256').update(chunk.content).digest('hex');
  }

  it('skips a chunk whose text and scope are unchanged', async () => {
    const contentHash = await hashOfChunk();
    const { indexContent, execute, generateEmbedding } = await load({
      contentHash,
      trainingCatalogId: KFBM,
      visibility: 'all',
      organizationId: null,
    });
    const result = await indexContent(base);
    expect(result).toMatchObject({ chunksIndexed: 0, chunksSkipped: 1 });
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(
      statements(execute).some(s =>
        /INSERT INTO|UPDATE hai_embeddings/.test(s.sql)
      )
    ).toBe(false);
  });

  it('updates only the scope columns when the occupation changed', async () => {
    const contentHash = await hashOfChunk();
    const { indexContent, execute, generateEmbedding } = await load({
      contentHash,
      trainingCatalogId: FIAE,
      visibility: 'all',
      organizationId: null,
    });
    const result = await indexContent(base);
    expect(result).toMatchObject({ chunksIndexed: 0, chunksSkipped: 1 });
    expect(generateEmbedding).not.toHaveBeenCalled();
    const update = statements(execute).find(s =>
      /UPDATE hai_embeddings/.test(s.sql)
    )!;
    expect(update.params).toEqual(expect.arrayContaining([KFBM, 'all']));
  });

  it('embeds again when the text changed', async () => {
    const { indexContent, generateEmbedding } = await load({
      contentHash: 'another hash',
      trainingCatalogId: KFBM,
      visibility: 'all',
      organizationId: null,
    });
    await indexContent(base);
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
  });
});

describe('removeChunkPart', () => {
  it('removes one block of chunk indexes of a source', async () => {
    const { removeChunkPart, execute } = await load();
    await removeChunkPart('quiz', SOURCE, 10000);
    const [statement] = statements(execute);
    expect(statement.sql).toMatch(/chunk_index >= \$3/);
    expect(statement.params.slice(2)).toEqual([10000, 20000]);
  });
});
