/**
 * @jest-environment node
 */
import { PgDialect } from 'drizzle-orm/pg-core';

// Scope of the index search (package H1): the access filter is part of the SQL
// WHERE clause (before LIMIT) and consists of catalog, audience, organization
// and owner of personal rows. These tests render the SQL the search sends and
// check the filter; the real SQL paths run in the smoke test against a local
// database (see the pull request).

const mockExecute = jest.fn();
const mockGenerateEmbedding = jest.fn();
const mockIsInitialized = jest.fn();

jest.mock('@/db/haiDb', () => ({
  __esModule: true,
  default: { execute: (...args: unknown[]) => mockExecute(...args) },
}));
jest.mock('@/lib/hai/providers', () => ({
  getEmbeddingProvider: () => ({
    isInitialized: () => mockIsInitialized(),
    generateEmbedding: (text: string) => mockGenerateEmbedding(text),
  }),
}));

import {
  buildScopeCondition,
  findRelatedContent,
  isUuid,
  searchSimilar,
  searchWithContext,
  type SearchOptions,
} from '@/lib/hai/vectorSearch';
import type { HaiTrainingScope } from '@/lib/hai/trainingScope';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'b0000000-0000-4000-8000-00000000000b';
const USER = '10000000-0000-4000-8000-000000000001';
const VECTOR = '[0.1,0.2]';

const dialect = new PgDialect();
function rendered(call = 0) {
  const arg = mockExecute.mock.calls[call][0];
  const query = dialect.sqlToQuery(arg);
  return { text: query.sql.replace(/\s+/g, ' '), params: query.params };
}

function trainee(extra: Partial<SearchOptions> = {}): SearchOptions {
  return {
    catalogIds: [FIAE],
    audience: 'trainee',
    organizationId: ORG,
    userId: USER,
    ...extra,
  };
}

function row(id: string, similarity: number, metadata = {}) {
  return {
    id,
    source_type: 'enabler',
    source_id: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001',
    chunk_index: 0,
    content: `content ${id}`,
    metadata,
    similarity,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExecute.mockResolvedValue([]);
  mockIsInitialized.mockReturnValue(true);
  mockGenerateEmbedding.mockResolvedValue({ embedding: [0.1, 0.2] });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('isUuid', () => {
  it('accepts UUIDs and rejects everything else', () => {
    expect(isUuid(FIAE)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(`${FIAE}'; drop table x; --`)).toBe(false);
  });
});

describe('buildScopeCondition', () => {
  const render = (scope: Parameters<typeof buildScopeCondition>[0]) => {
    const condition = buildScopeCondition(scope);
    if (!condition) return null;
    const query = dialect.sqlToQuery(condition);
    return { text: query.sql.replace(/\s+/g, ' '), params: query.params };
  };

  it('binds every catalog id as a parameter', () => {
    const out = render(trainee({ catalogIds: [FIAE, KFBM, FIAE] }));
    expect(out!.text).toContain('training_catalog_id IN ($1::uuid, $2::uuid)');
    expect(out!.params.slice(0, 2)).toEqual([FIAE, KFBM]);
  });

  it('limits trainees to visibility all, trainer level sees both', () => {
    expect(render(trainee())!.text).toContain("visibility = 'all'");
    expect(render(trainee({ audience: 'trainer' }))!.text).not.toContain(
      'visibility'
    );
  });

  // The model solutions of the private bucket (metadata.trainerSolution) are
  // returned only to a trainer whose access carries the permission
  // (HAI_TRAINER_SOLUTIONS on). Every other access excludes them in the SQL.
  describe('chunks of trainer solutions (private bucket)', () => {
    const EXCLUDED = "COALESCE(metadata->>'trainerSolution', '') <> 'true'";

    it('excludes them for a trainee, with or without the permission', () => {
      expect(render(trainee())!.text).toContain(EXCLUDED);
      expect(
        render(trainee({ includeTrainerSolutions: true }))!.text
      ).toContain(EXCLUDED);
    });

    it('excludes them for a trainer without the permission (the default)', () => {
      expect(render(trainee({ audience: 'trainer' }))!.text).toContain(
        EXCLUDED
      );
      expect(
        render(
          trainee({ audience: 'trainer', includeTrainerSolutions: false })
        )!.text
      ).toContain(EXCLUDED);
    });

    it('lets them through only for a trainer with the permission', () => {
      const out = render(
        trainee({ audience: 'trainer', includeTrainerSolutions: true })
      );
      expect(out!.text).not.toContain('trainerSolution');
      // the catalog and organization limits stay
      expect(out!.text).toContain('training_catalog_id IN');
      expect(out!.text).toContain('organization_id');
    });

    it('does not trust an odd audience or a value that is not true', () => {
      for (const scope of [
        trainee({
          audience: 'TRAINER' as unknown as 'trainer',
          includeTrainerSolutions: true,
        }),
        trainee({
          audience: 'trainer',
          includeTrainerSolutions: 'true' as unknown as boolean,
        }),
        trainee({
          audience: 'trainer',
          includeTrainerSolutions: 1 as unknown as boolean,
        }),
      ]) {
        expect(render(scope)!.text).toContain(EXCLUDED);
      }
    });

    it('adds no parameter (the numbering of the filter stays)', () => {
      const closed = render(trainee({ audience: 'trainer' }))!;
      const open = render(
        trainee({ audience: 'trainer', includeTrainerSolutions: true })
      )!;
      expect(closed.params).toEqual(open.params);
    });
  });

  it('treats anything but the exact value trainer as a trainee', () => {
    const odd = { ...trainee(), audience: 'TRAINER' as unknown as 'trainer' };
    expect(render(odd)!.text).toContain("visibility = 'all'");
  });

  it('allows the own organization and platform content only', () => {
    const out = render(trainee());
    expect(out!.text).toContain(
      '(organization_id IS NULL OR organization_id = $2::uuid)'
    );
    expect(out!.params).toContain(ORG);
  });

  it('allows platform content only when the organization is unknown', () => {
    const out = render(trainee({ organizationId: null }));
    expect(out!.text).toContain('organization_id IS NULL');
    expect(out!.text).not.toContain('organization_id =');
    // a malformed organization id is not cast, it narrows to platform content
    const odd = render(trainee({ organizationId: 'x; drop' }));
    expect(odd!.text).not.toContain('organization_id =');
  });

  it('matches personal rows only for their owner', () => {
    const out = render(trainee());
    expect(out!.text).toContain(
      "((source_type NOT LIKE 'trainee\\_%' AND metadata->>'userId' IS NULL) OR metadata->>'userId' = $3)"
    );
    expect(out!.params).toContain(USER);
  });

  it('hides a trainee_* row without an owner from everyone', () => {
    // a personal row is recognised by its source type, not only by the owner key
    const out = render(trainee());
    expect(out!.text).toContain("source_type NOT LIKE 'trainee\\_%'");
  });

  it('matches no personal row without a user id', () => {
    const out = render(trainee({ userId: undefined }));
    expect(out!.text).toContain(
      "(source_type NOT LIKE 'trainee\\_%' AND metadata->>'userId' IS NULL)"
    );
    expect(out!.text).not.toContain("metadata->>'userId' =");
  });

  it('is null without a usable catalog (fail closed)', () => {
    expect(buildScopeCondition(trainee({ catalogIds: [] }))).toBeNull();
    expect(buildScopeCondition(trainee({ catalogIds: ['nope'] }))).toBeNull();
    expect(
      buildScopeCondition({
        audience: 'trainee',
      } as unknown as SearchOptions)
    ).toBeNull();
  });
});

describe('searchSimilar', () => {
  it('puts the scope into the WHERE clause, before the LIMIT', async () => {
    await searchSimilar('frage', trainee({ topK: 4 }), VECTOR);
    const { text, params } = rendered();
    expect(text).toMatch(
      /WHERE \(training_catalog_id IN \(\$\d+::uuid\) OR \(source_type = 'learning_technique' AND training_catalog_id IS NULL AND organization_id IS NULL\)\) AND visibility = 'all' AND .*AND embedding IS NOT NULL ORDER BY .* LIMIT \$\d+\s*$/
    );
    expect(params).toContain(FIAE);
    expect(params[params.length - 1]).toBe(4);
  });

  it('returns nothing and calls neither database nor model without scope', async () => {
    const result = await searchSimilar('frage', trainee({ catalogIds: [] }));
    expect(result).toEqual([]);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it('passes the catalog of a KfBM trainee, not the FIAE one', async () => {
    await searchSimilar('frage', trainee({ catalogIds: [KFBM] }), VECTOR);
    const { params } = rendered();
    expect(params).toContain(KFBM);
    expect(params).not.toContain(FIAE);
  });

  it('does not filter visibility for trainer level', async () => {
    await searchSimilar('frage', trainee({ audience: 'trainer' }), VECTOR);
    expect(rendered().text).not.toContain('visibility');
  });

  it('compares source ids as bound text parameters', async () => {
    await searchSimilar(
      'frage',
      trainee({ sourceType: 'enabler', sourceIds: ['abc', 'def'] }),
      VECTOR
    );
    const { text, params } = rendered();
    expect(text).toContain('source_type = $');
    expect(text).toMatch(/source_id::text IN \(\$\d+, \$\d+\)/);
    expect(params).toEqual(expect.arrayContaining(['abc', 'def']));
  });

  it('filters by course through the metadata of the chunk', async () => {
    await searchSimilar('frage', trainee({ courseId: 'course-1' }), VECTOR);
    const { text, params } = rendered();
    expect(text).toContain("metadata->>'courseId' = $");
    expect(params).toContain('course-1');
  });

  it('maps rows and applies the minimum similarity', async () => {
    mockExecute.mockResolvedValue([row('a', 0.9), row('b', 0.2)]);
    const result = await searchSimilar('frage', trainee(), VECTOR);
    expect(result.map(r => r.id)).toEqual(['a']);
    expect(result[0]).toMatchObject({
      sourceType: 'enabler',
      similarity: 0.9,
      content: 'content a',
    });
  });

  it('computes the query embedding when none is given', async () => {
    await searchSimilar('frage', trainee());
    expect(mockGenerateEmbedding).toHaveBeenCalledWith('frage');
    expect(rendered().params).toContain(JSON.stringify([0.1, 0.2]));
  });

  it('returns nothing when the embedding provider is not initialized', async () => {
    mockIsInitialized.mockReturnValue(false);
    expect(await searchSimilar('frage', trainee())).toEqual([]);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns nothing and logs when the database fails', async () => {
    mockExecute.mockRejectedValue(new Error('boom'));
    expect(await searchSimilar('frage', trainee(), VECTOR)).toEqual([]);
  });

  describe('training scope post filter', () => {
    const scope: HaiTrainingScope = {
      applies: true,
      durationYears: 3,
      planLabel: '3 Jahre',
      currentAusbildungsjahr: 1,
      currentPhase: 1,
      allowedAusbildungsjahre: [1],
      allowedComponentPhases: [1, 3],
      phaseMonthRange: { startMonth: 1, endMonth: 18 },
    };

    it('fetches three times the candidates and cuts to topK afterwards', async () => {
      const rows = [
        row('y2-a', 0.95, { year: [2] }),
        row('y2-b', 0.94, { year: [2] }),
        row('y1-a', 0.9, { year: [1] }),
        row('y1-b', 0.85, { year: [1] }),
        row('none', 0.8),
      ];
      mockExecute.mockResolvedValue(rows);
      const result = await searchSimilar(
        'frage',
        trainee({ topK: 2, trainingScope: scope }),
        VECTOR
      );
      const { params } = rendered();
      expect(params[params.length - 1]).toBe(6);
      expect(result.map(r => r.id)).toEqual(['y1-a', 'y1-b']);
    });

    it('keeps the limit when no training scope applies', async () => {
      await searchSimilar('frage', trainee({ topK: 2 }), VECTOR);
      const { params } = rendered();
      expect(params[params.length - 1]).toBe(2);
    });
  });
});

describe('searchWithContext', () => {
  const context = {
    currentEnablerId: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001',
    currentCourseId: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0002',
  };

  it('returns nothing without scope, before any model call', async () => {
    const result = await searchWithContext(
      'frage',
      context,
      trainee({ catalogIds: [] })
    );
    expect(result).toEqual({ results: [], query: 'frage', totalResults: 0 });
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('computes the query embedding once for all steps', async () => {
    await searchWithContext('frage', context, trainee());
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it('applies the scope in every step', async () => {
    await searchWithContext('frage', context, trainee({ catalogIds: [KFBM] }));
    for (let i = 0; i < 3; i++) {
      const { text, params } = rendered(i);
      expect(text).toContain('training_catalog_id IN');
      expect(text).toContain("visibility = 'all'");
      expect(params).toContain(KFBM);
    }
  });

  it('searches the course in step 2 (it used to be a global enabler search)', async () => {
    await searchWithContext('frage', context, trainee());
    const step1 = rendered(0);
    const step2 = rendered(1);
    const step3 = rendered(2);
    expect(step1.params).toContain(context.currentEnablerId);
    expect(step2.text).toContain("metadata->>'courseId' = $");
    expect(step2.params).toContain(context.currentCourseId);
    expect(step2.params).toContain('enabler');
    expect(step3.text).not.toContain("metadata->>'courseId'");
  });

  it('skips step 2 without a current course', async () => {
    await searchWithContext(
      'frage',
      { currentEnablerId: context.currentEnablerId },
      trainee()
    );
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('marks the current context, de-duplicates and sorts by similarity', async () => {
    mockExecute
      .mockResolvedValueOnce([row('current', 0.7)])
      .mockResolvedValueOnce([row('current', 0.7), row('course', 0.9)])
      .mockResolvedValueOnce([row('global', 0.8)]);
    const result = await searchWithContext('frage', context, trainee());
    expect(result.results.map(r => r.id)).toEqual([
      'course',
      'global',
      'current',
    ]);
    expect(
      result.results.find(r => r.id === 'current')!.metadata.isCurrentContext
    ).toBe(true);
    expect(result.totalResults).toBe(3);
  });

  it('returns an empty result when the embedding provider is not initialized', async () => {
    mockIsInitialized.mockReturnValue(false);
    const result = await searchWithContext('frage', context, trainee());
    expect(result.results).toEqual([]);
  });

  it('returns an empty result when embedding fails', async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error('quota'));
    const result = await searchWithContext('frage', context, trainee());
    expect(result).toEqual({ results: [], query: 'frage', totalResults: 0 });
  });
});

describe('findRelatedContent', () => {
  it('returns nothing without scope', async () => {
    expect(
      await findRelatedContent('enabler', FIAE, trainee({ catalogIds: [] }))
    ).toEqual([]);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('scopes the source chunk and the related chunks', async () => {
    mockExecute
      .mockResolvedValueOnce([{ embedding: '[0.1]', content: 'x' }])
      .mockResolvedValueOnce([row('r1', 0.8)]);
    const result = await findRelatedContent(
      'enabler',
      '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001',
      trainee()
    );
    expect(result.map(r => r.id)).toEqual(['r1']);
    expect(rendered(0).text).toContain('training_catalog_id IN');
    expect(rendered(1).text).toContain('training_catalog_id IN');
    expect(rendered(1).text).toContain("visibility = 'all'");
  });

  it('returns nothing when the source chunk is outside the scope', async () => {
    mockExecute.mockResolvedValueOnce([]);
    expect(
      await findRelatedContent(
        'enabler',
        '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001',
        trainee()
      )
    ).toEqual([]);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('returns nothing and logs when the database fails', async () => {
    mockExecute.mockRejectedValue(new Error('boom'));
    expect(
      await findRelatedContent(
        'enabler',
        '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001',
        trainee()
      )
    ).toEqual([]);
  });
});
