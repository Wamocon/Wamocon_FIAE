/**
 * @jest-environment node
 */
import { PgDialect } from 'drizzle-orm/pg-core';

// Retrieval of the learning technique cards (HAI package B): the cards are
// platform knowledge for every trainee and trainer, and they open nothing else.
// The tests render the SQL the search sends; the real SQL runs against a local
// throwaway database in the smoke test of the pull request.

const mockExecute = jest.fn();
const mockGenerateEmbedding = jest.fn();

jest.mock('@/db/haiDb', () => ({
  __esModule: true,
  default: { execute: (...args: unknown[]) => mockExecute(...args) },
}));
jest.mock('@/lib/hai/providers', () => ({
  getEmbeddingProvider: () => ({
    isInitialized: () => true,
    generateEmbedding: (text: string) => mockGenerateEmbedding(text),
  }),
}));

import {
  LEARNING_TECHNIQUE_SLOTS,
  buildScopeCondition,
  searchSimilar,
  searchWithContext,
  type SearchScope,
} from '@/lib/hai/vectorSearch';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'b0000000-0000-4000-8000-00000000000b';
const USER = '10000000-0000-4000-8000-000000000001';

const dialect = new PgDialect();
const render = (statement: unknown) => {
  const query = dialect.sqlToQuery(statement as never);
  return { text: query.sql.replace(/\s+/g, ' '), params: query.params };
};

const traineeFiae: SearchScope = {
  catalogIds: [FIAE],
  audience: 'trainee',
  organizationId: ORG,
  userId: USER,
};
const traineeKfbm: SearchScope = { ...traineeFiae, catalogIds: [KFBM] };
const trainerFiae: SearchScope = { ...traineeFiae, audience: 'trainer' };

const PLATFORM_RULE =
  "(source_type = 'learning_technique' AND training_catalog_id IS NULL AND organization_id IS NULL)";

function row(id: string, sourceType: string, similarity: number) {
  return {
    id,
    source_type: sourceType,
    source_id: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001',
    chunk_index: 0,
    content: `content ${id}`,
    metadata: {},
    similarity,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExecute.mockResolvedValue([]);
  mockGenerateEmbedding.mockResolvedValue({ embedding: [0.1, 0.2] });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('the scope condition', () => {
  it.each([
    ['a FIAE trainee', traineeFiae, FIAE],
    ['a KfBM trainee', traineeKfbm, KFBM],
    ['a FIAE trainer', trainerFiae, FIAE],
  ])(
    'lets %s read the cards through one explicit platform rule',
    (_n, scope, catalog) => {
      const { text, params } = render(buildScopeCondition(scope)!);
      expect(text).toContain(`OR ${PLATFORM_RULE})`);
      // the occupation rule is still there and holds the caller's catalog only
      expect(text).toMatch(/^\(training_catalog_id IN \(\$1::uuid\) OR /);
      expect(params[0]).toBe(catalog);
      expect(params.filter(p => p === FIAE || p === KFBM)).toEqual([catalog]);
    }
  );

  it('opens the cards to a trainer and a trainee by the same rule', () => {
    const trainee = render(buildScopeCondition(traineeFiae)!);
    const trainer = render(buildScopeCondition(trainerFiae)!);
    expect(trainee.text).toContain(PLATFORM_RULE);
    expect(trainer.text).toContain(PLATFORM_RULE);
  });

  it('keeps the audience, organization and owner rules next to it', () => {
    const { text } = render(buildScopeCondition(traineeFiae)!);
    // a trainee sees visibility all only, the cards included
    expect(text).toContain("AND visibility = 'all' AND");
    expect(render(buildScopeCondition(trainerFiae)!).text).not.toContain(
      'visibility'
    );
    expect(text).toContain('(organization_id IS NULL OR organization_id = $');
    expect(text).toContain("metadata->>'userId' IS NULL");
  });

  it('opens no content of another occupation: the rule names the source type only', () => {
    const { text, params } = render(buildScopeCondition(traineeFiae)!);
    // the only source type that bypasses the catalog list is learning_technique
    expect(text.match(/source_type = '[a-z_]+'/g)).toEqual([
      "source_type = 'learning_technique'",
    ]);
    expect(params).not.toContain('learning_technique');
    // and only for rows that have NO occupation: a row of the other occupation
    // never satisfies "training_catalog_id IS NULL"
    expect(text).toContain('training_catalog_id IS NULL');
    expect(text).not.toMatch(/training_catalog_id IS NOT NULL/);
  });

  it('gives a caller without a catalog scope nothing, not even the cards', async () => {
    expect(buildScopeCondition({ ...traineeFiae, catalogIds: [] })).toBeNull();
    expect(
      buildScopeCondition({ ...traineeFiae, catalogIds: ['not-a-uuid'] })
    ).toBeNull();
    expect(
      await searchSimilar('Wie lerne ich?', {
        ...traineeFiae,
        catalogIds: [],
        sourceType: 'learning_technique',
      })
    ).toEqual([]);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });
});

describe('searchWithContext for a question about learning', () => {
  const options = { ...traineeFiae, topK: 5, minSimilarity: 0.4 };

  it('reserves places for the cards with ONE embedding call', async () => {
    mockExecute
      .mockResolvedValueOnce([
        row('card-1', 'learning_technique', 0.6),
        row('card-2', 'learning_technique', 0.55),
      ])
      .mockResolvedValue([
        row('e-1', 'enabler', 0.9),
        row('e-2', 'enabler', 0.8),
      ]);

    const result = await searchWithContext(
      'Wie kann ich mir Begriffe besser merken?',
      { includeLearningTechniques: true },
      options
    );

    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    // cards first even though the other hits are more similar
    expect(result.results.map(r => r.id)).toEqual([
      'card-1',
      'card-2',
      'e-1',
      'e-2',
    ]);
    const first = render(mockExecute.mock.calls[0][0]);
    expect(first.text).toContain('AND source_type = $');
    expect(first.params).toContain('learning_technique');
    // the other searches share the remaining places
    const second = render(mockExecute.mock.calls[1][0]);
    expect(second.text).toContain('LIMIT $');
    expect(second.params.at(-1)).toBe(options.topK - 2);
  });

  it('never reserves more places than the constant allows', async () => {
    await searchWithContext(
      'Lernplan?',
      { includeLearningTechniques: true },
      options
    );
    const first = render(mockExecute.mock.calls[0][0]);
    expect(first.params.at(-1)).toBe(LEARNING_TECHNIQUE_SLOTS);
  });

  it('does not look for cards on any other question', async () => {
    mockExecute.mockResolvedValue([row('e-1', 'enabler', 0.9)]);
    await searchWithContext('Was ist Normalisierung?', {}, options);
    const calls = mockExecute.mock.calls.map(([s]) => render(s));
    expect(
      calls.every(
        c =>
          !c.params.includes('learning_technique') ||
          c.text.includes('OR (source_type')
      )
    ).toBe(true);
    // no query is restricted to the card source type
    expect(calls.some(c => c.text.includes('AND source_type = $'))).toBe(false);
  });

  it('keeps a plain result when no card is found', async () => {
    mockExecute.mockImplementation(async (statement: unknown) => {
      const { text } = render(statement);
      return text.includes('AND source_type = $')
        ? []
        : [row('e-1', 'enabler', 0.9)];
    });
    const result = await searchWithContext(
      'Lerntipps?',
      { includeLearningTechniques: true },
      options
    );
    expect(result.results.map(r => r.id)).toEqual(['e-1']);
    expect(result.totalResults).toBe(1);
  });
});
