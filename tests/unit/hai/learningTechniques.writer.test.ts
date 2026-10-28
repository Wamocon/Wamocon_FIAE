/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';

// Write path of the learning technique cards: indexContent accepts the platform
// scope (NULL occupation, visibility all, NULL organization) for the source type
// learning_technique and for no other source type. The embedding provider and
// the database are fakes: no model is called.

const FIAE = '00000000-0000-4000-8000-000000000001';
const SOURCE = '22222222-2222-4222-8222-222222222222';

const dialect = new PgDialect();
const render = (statement: unknown) =>
  dialect.sqlToQuery(statement as never) as { sql: string; params: unknown[] };

async function load() {
  jest.resetModules();
  const execute = jest.fn(async (..._args: unknown[]) => []);
  const select = jest.fn(() => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: async () => [],
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

const card = {
  sourceType: 'learning_technique' as const,
  sourceId: SOURCE,
  title: 'Lerntechnik: Abrufübung',
  content: 'Lerntechnik: Abrufübung\nWas ist das: Du holst Stoff ab.',
  trainingCatalogId: null,
  visibility: 'all' as const,
  organizationId: null,
};

describe('indexContent for learning technique cards', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('writes the platform scope with a NULL occupation', async () => {
    const { indexContent, execute, generateEmbedding } = await load();
    const result = await indexContent(card);
    expect(result).toMatchObject({ success: true, chunksIndexed: 1 });
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
    const insert = execute.mock.calls
      .map(([s]) => render(s))
      .find(s => /INSERT INTO hai_embeddings/.test(s.sql))!;
    expect(insert.params).toEqual(
      expect.arrayContaining(['learning_technique', 'all', null])
    );
    expect(insert.params).not.toContain(FIAE);
  });

  it('refuses a card with an occupation, before any embedding call', async () => {
    const { indexContent, execute, generateEmbedding } = await load();
    const result = await indexContent({ ...card, trainingCatalogId: FIAE });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no occupation/);
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('still refuses another source type without an occupation', async () => {
    const { indexContent, execute, generateEmbedding } = await load();
    const result = await indexContent({ ...card, sourceType: 'enabler' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/trainingCatalogId/);
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
