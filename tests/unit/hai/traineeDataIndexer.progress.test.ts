/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../helpers/mockDb';

// The progress document of a trainee for the index (/api/hai/sync) takes its
// figures from the helpers of the platform (progressFigures.ts), not from the
// rows of enabler_completions (the quiz based completion does not write them: the
// text said 0 %), and only from the occupation the chunk belongs to (before, the
// courses of every occupation of the trainee stood in the chunk of one).

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

const figure = (over: Record<string, unknown> = {}) => ({
  courseId: 'c1',
  title: 'Datenbanken',
  year: 1,
  catalogId: KFBM,
  enablerTotal: 4,
  enablerDone: 3,
  useCaseTotal: 0,
  useCaseDone: 0,
  percent: 75,
  enablers: [
    { id: 'e1', title: 'Fertig', completed: true, locked: false },
    { id: 'e2', title: 'Noch offen A', completed: false, locked: false },
    { id: 'e3', title: 'Noch offen B', completed: false, locked: true },
  ],
  ...over,
});

async function run(figures: unknown[] | Error) {
  jest.resetModules();
  const hai = createTableDb({
    profiles: [
      {
        fullName: 'Azubi Eins',
        firstName: 'Azubi',
        role: 'TRAINEE',
        startOfTrainingDate: null,
        ausbildungDurationYears: 3,
        organizationId: null,
      },
    ],
    traineeEnrollments: [
      { traineeId: 't1', trainingCatalogId: FIAE, startDate: '2024-08-01' },
      { traineeId: 't1', trainingCatalogId: KFBM, startDate: '2026-08-01' },
    ],
    ausbildungBlocks: [],
  });
  hai.db.execute = jest.fn(async () => []);
  const loadFigures = jest.fn(async (_id: string, _catalogs: string[]) => {
    if (figures instanceof Error) throw figures;
    return figures;
  });
  const indexContent = jest.fn(async (_item: unknown) => ({
    success: true,
    chunksIndexed: 1,
  }));
  jest.doMock('@/db/haiDb', () => ({ __esModule: true, default: hai.db }));
  jest.doMock('@/db', () => ({
    __esModule: true,
    default: createTableDb({}).db,
  }));
  jest.doMock('@/lib/hai/embeddings', () => ({
    __esModule: true,
    indexContent,
  }));
  jest.doMock('@/lib/hai/progressFigures', () => ({
    __esModule: true,
    loadTraineeCourseFigures: loadFigures,
  }));
  const { indexTraineeData } = await import('@/lib/hai/traineeDataIndexer');
  await indexTraineeData('t1');
  const items = indexContent.mock.calls.map(([item]) => item as any);
  const progress = items.find(i => i.sourceType === 'trainee_progress');
  return { progress, loadFigures, items };
}

describe('progress document of a trainee', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('carries the figures of the platform: counts, the percentage of the course card, the open enablers', async () => {
    const { progress } = await run([figure()]);
    expect(progress).toBeDefined();
    const text: string = progress.content;
    expect(text).toContain('## Datenbanken (Jahr 1)');
    expect(text).toContain('Fortschritt: 3/4 Enabler (75%)');
    expect(text).toContain('Gesamtfortschritt: 3/4 Enabler (75%)');
    // completed enablers are not listed as open, the open ones are
    expect(text).toContain('  - Noch offen A');
    expect(text).toContain('  - Noch offen B');
    expect(text).not.toContain('  - Fertig');
  });

  it('asks for the occupation of the chunk only, never for the other one', async () => {
    const { loadFigures, progress } = await run([figure()]);
    expect(loadFigures).toHaveBeenCalledTimes(1);
    expect(loadFigures).toHaveBeenCalledWith('t1', [KFBM]);
    expect(JSON.stringify(loadFigures.mock.calls)).not.toContain(FIAE);
    expect(progress.trainingCatalogId).toBe(KFBM);
  });

  it('adds the courses up for the overall progress and says when everything is completed', async () => {
    const { progress } = await run([
      figure({ enablerTotal: 2, enablerDone: 2, percent: 100, enablers: [] }),
      figure({
        courseId: 'c2',
        title: 'Netzwerke',
        year: null,
        enablerTotal: 6,
        enablerDone: 1,
        percent: 17,
        enablers: [],
      }),
    ]);
    const text: string = progress.content;
    expect(text).toContain('Gesamtfortschritt: 3/8 Enabler (38%)');
    expect(text).toContain('✓ Alle Enabler abgeschlossen!');
    // a course without a year has no "(Jahr ...)"
    expect(text).toContain('## Netzwerke\n');
    expect(text).not.toContain('Jahr null');
  });

  it('leaves out a course without an active enabler (use cases only)', async () => {
    const { progress } = await run([
      figure(),
      figure({
        courseId: 'c3',
        title: 'Nur Use Cases',
        enablerTotal: 0,
        enablerDone: 0,
      }),
    ]);
    expect(progress.content).not.toContain('Nur Use Cases');
  });

  it('has no progress document without a course (as before), and none after a failed read', async () => {
    const empty = await run([]);
    expect(empty.progress).toBeUndefined();
    const failed = await run(new Error('db down'));
    expect(failed.progress).toBeUndefined();
  });

  it('never reads the rows of enabler_completions', async () => {
    jest.resetModules();
    const src = await import('fs').then(fs =>
      fs.readFileSync('src/lib/hai/traineeDataIndexer.ts', 'utf-8')
    );
    expect(src).not.toMatch(
      /from\(enablerCompletions\)|FROM enabler_completions/i
    );
  });
});
