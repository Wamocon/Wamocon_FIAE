/**
 * @jest-environment node
 */
import path from 'path';

import { cardSourceId } from '@/lib/hai/learningTechniques/cards';
import {
  ingestLearningTechniques,
  createIngestDeps,
  type IngestDeps,
} from '@/lib/hai/learningTechniques/ingest';
import {
  LEARNING_TECHNIQUES_DIR,
  loadLearningTechniqueCards,
} from '@/lib/hai/learningTechniques/loader';
import type { LearningTechniqueCard } from '@/lib/hai/learningTechniques/schema';
import { isPlatformSourceType, scopeProblem } from '@/lib/hai/indexScope';

// The ingest path is tested with fakes: no database, no embedding model, no
// network. The real dependencies are only checked for their wiring.

const mockIndexed = jest.fn();
const mockRemoved = jest.fn();
const mockSources = jest.fn();
jest.mock('@/lib/hai/embeddings', () => ({
  indexContent: (...args: unknown[]) => mockIndexed(...args),
  getIndexedSources: () => mockSources(),
  removeEmbeddings: (...args: unknown[]) => mockRemoved(...args),
}));

const cards = loadLearningTechniqueCards(
  path.join(process.cwd(), LEARNING_TECHNIQUES_DIR)
);

function release(card: LearningTechniqueCard): LearningTechniqueCard {
  return {
    ...card,
    review: {
      ...card.review,
      reviewed: true,
      status: 'Freigegeben',
      reviewedBy: 'Niko',
      reviewedAt: '2026-11-02',
    },
  };
}

function fakeDeps(overrides: Partial<IngestDeps> = {}): IngestDeps {
  return {
    indexContent: jest.fn().mockResolvedValue({
      success: true,
      chunksIndexed: 1,
      chunksSkipped: 0,
      chunksFailed: 0,
    }),
    listIndexedSourceIds: jest.fn().mockResolvedValue([]),
    removeSource: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('dry run', () => {
  it('plans every card, needs no dependency and writes nothing', async () => {
    const summary = await ingestLearningTechniques(cards, null, {
      dryRun: true,
    });
    expect(summary.dryRun).toBe(true);
    expect(summary.total).toBe(cards.length);
    expect(summary.plan).toHaveLength(cards.length);
    expect(summary.plan.every(p => p.chunks === 1 && p.characters > 100)).toBe(
      true
    );
    expect(summary.plan.map(p => p.sourceId)).toEqual(
      cards.map(c => cardSourceId(c.id))
    );
  });

  it('counts no embedding call while no card is released', async () => {
    const summary = await ingestLearningTechniques(cards, null, {
      dryRun: true,
    });
    expect(summary.released).toBe(0);
    expect(summary.embeddingCalls).toBe(0);
    expect(summary.plan.every(p => !p.released)).toBe(true);
  });

  it('counts one embedding call per released card', async () => {
    const summary = await ingestLearningTechniques(
      [release(cards[0]), release(cards[1]), ...cards.slice(2)],
      null,
      { dryRun: true }
    );
    expect(summary.released).toBe(2);
    expect(summary.embeddingCalls).toBe(2);
  });
});

describe('apply', () => {
  it('writes nothing for cards that are not released', async () => {
    const deps = fakeDeps();
    const summary = await ingestLearningTechniques(cards, deps, {
      dryRun: false,
    });
    expect(deps.indexContent).not.toHaveBeenCalled();
    expect(summary.indexed).toBe(0);
  });

  it('writes a released card with the platform scope', async () => {
    const deps = fakeDeps();
    const card = release(cards[0]);
    const summary = await ingestLearningTechniques(
      [card, ...cards.slice(1)],
      deps,
      {
        dryRun: false,
      }
    );
    expect(deps.indexContent).toHaveBeenCalledTimes(1);
    const call = (deps.indexContent as jest.Mock).mock.calls[0][0];
    expect(call).toMatchObject({
      sourceType: 'learning_technique',
      sourceId: cardSourceId(card.id),
      trainingCatalogId: null,
      visibility: 'all',
      organizationId: null,
    });
    expect(call.title).toBe(`Lerntechnik: ${card.title}`);
    expect(call.content).toContain('Quelle: Dunlosky');
    // no scope field is hidden in the metadata
    expect(call.metadata).toEqual({
      cardId: card.id,
      rank: card.rank,
      effectiveness: card.effectiveness,
      contentKind: 'learning_technique',
    });
    expect(summary.indexed).toBe(1);
    // the scope the writer accepts for this source type
    expect(
      scopeProblem(
        {
          trainingCatalogId: call.trainingCatalogId,
          visibility: call.visibility,
          organizationId: call.organizationId,
        },
        call.sourceType
      )
    ).toBeNull();
  });

  it('reports a failed card and goes on with the next one', async () => {
    const indexContent = jest
      .fn()
      .mockResolvedValueOnce({
        success: false,
        chunksIndexed: 0,
        chunksSkipped: 0,
        chunksFailed: 1,
        error: 'boom',
      })
      .mockResolvedValue({
        success: true,
        chunksIndexed: 0,
        chunksSkipped: 1,
        chunksFailed: 0,
      });
    const deps = fakeDeps({ indexContent });
    const summary = await ingestLearningTechniques(
      [release(cards[0]), release(cards[1]), ...cards.slice(2)],
      deps,
      { dryRun: false }
    );
    expect(indexContent).toHaveBeenCalledTimes(2);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toEqual([`${cards[0].id}: boom`]);
  });

  it('removes sources of cards that are withdrawn or deleted', async () => {
    const stale = cardSourceId('geloeschte-karte');
    const withdrawn = cardSourceId(cards[1].id);
    const deps = fakeDeps({
      listIndexedSourceIds: jest
        .fn()
        .mockResolvedValue([cardSourceId(cards[0].id), withdrawn, stale]),
    });
    const summary = await ingestLearningTechniques(
      [release(cards[0]), ...cards.slice(1)],
      deps,
      { dryRun: false }
    );
    expect(deps.removeSource).toHaveBeenCalledTimes(2);
    expect(deps.removeSource).toHaveBeenCalledWith(withdrawn);
    expect(deps.removeSource).toHaveBeenCalledWith(stale);
    expect(summary.removed).toBe(2);
  });

  it('removes everything when no card is released any more', async () => {
    const deps = fakeDeps({
      listIndexedSourceIds: jest
        .fn()
        .mockResolvedValue([cardSourceId(cards[0].id)]),
    });
    const summary = await ingestLearningTechniques(cards, deps, {
      dryRun: false,
    });
    expect(summary.removed).toBe(1);
  });

  it('reports a source that could not be removed', async () => {
    const deps = fakeDeps({
      listIndexedSourceIds: jest.fn().mockResolvedValue(['x-1']),
      removeSource: jest.fn().mockResolvedValue(false),
    });
    const summary = await ingestLearningTechniques(cards, deps, {
      dryRun: false,
    });
    expect(summary.removed).toBe(0);
    expect(summary.errors).toEqual(['could not remove source x-1']);
  });

  it('needs dependencies', async () => {
    await expect(
      ingestLearningTechniques(cards, null, { dryRun: false })
    ).rejects.toThrow(/needs deps/);
  });
});

describe('platform scope of the writer', () => {
  it('knows the learning technique source type as platform content', () => {
    expect(isPlatformSourceType('learning_technique')).toBe(true);
    expect(isPlatformSourceType('enabler')).toBe(false);
    expect(isPlatformSourceType(undefined)).toBe(false);
  });

  const platform = {
    trainingCatalogId: null,
    visibility: 'all' as const,
    organizationId: null,
  };

  it('accepts the platform scope only for the platform source type', () => {
    expect(scopeProblem(platform, 'learning_technique')).toBeNull();
    // every other source type still needs an occupation
    expect(scopeProblem(platform, 'enabler')).toMatch(/trainingCatalogId/);
    expect(scopeProblem(platform)).toMatch(/trainingCatalogId/);
  });

  it('refuses a platform chunk with an occupation, owner or trainer visibility', () => {
    const catalog = '00000000-0000-4000-8000-000000000001';
    expect(
      scopeProblem(
        { ...platform, trainingCatalogId: catalog },
        'learning_technique'
      )
    ).toMatch(/no occupation/);
    expect(
      scopeProblem({ ...platform, visibility: 'trainer' }, 'learning_technique')
    ).toMatch(/visibility all/);
    expect(
      scopeProblem(
        { ...platform, organizationId: catalog },
        'learning_technique'
      )
    ).toMatch(/no organization/);
    expect(scopeProblem(undefined, 'learning_technique')).toMatch(/missing/);
  });
});

describe('default dependencies', () => {
  beforeEach(() => jest.clearAllMocks());

  it('wire the index writer, the source list and the removal', async () => {
    mockIndexed.mockResolvedValue({ success: true });
    mockSources.mockResolvedValue([
      { sourceType: 'learning_technique', sourceId: 'a' },
      { sourceType: 'enabler', sourceId: 'b' },
    ]);
    mockRemoved.mockResolvedValue(true);
    const deps = await createIngestDeps();
    await deps.indexContent({} as never);
    expect(mockIndexed).toHaveBeenCalledTimes(1);
    // only the learning technique sources, never another source type
    expect(await deps.listIndexedSourceIds()).toEqual(['a']);
    await deps.removeSource('a');
    expect(mockRemoved).toHaveBeenCalledWith('learning_technique', 'a');
  });
});
