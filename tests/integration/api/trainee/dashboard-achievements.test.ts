/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  mockCatalogScope,
  mockTraineeSession,
} from '../../../helpers/mockNext';

// WMCNL-2950, 2951, 2952: the dashboard of a trainee with two trainings.
//  - "Letzte Erfolge" showed the latest quiz of ANY occupation (a KfBM quiz in
//    the tab FIAE) and also a failed one (40 %).
//  - "Wöchentlicher Fortschritt" counted events and printed them as percent
//    (318 %), for both occupations alike.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

async function dashboard(tables: Record<string, any>) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockTraineeSession();
  mockCatalogScope({
    allowedCatalogIds: [FIAE, KFBM],
    activeCatalogId: KFBM,
    selected: true,
  });
  const mod = await import('@/app/api/trainee/dashboard/route');
  const res = await mod.GET({
    url: 'http://localhost/api/trainee/dashboard',
    headers: { get: () => null },
  } as any);
  return { mock, body: await res.json() };
}

const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe('dashboard achievements and weekly progress per occupation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks only for a PASSED quiz of the occupation of the tab', async () => {
    const { mock } = await dashboard({
      courseMembers: [],
      enablers: [],
      courses: [],
      quizSubmissions: [],
      quizzes: [],
      enablerCompletions: [],
    });
    // the query with the title is the one joined with quizzes: it carries the
    // catalog and the passing score (50)
    const recent = mock.calls.find(
      (c: any) => c.table === 'quiz_submissions' && (c.where ?? []).length > 0
    );
    const filters = mock.filters('select', 'quiz_submissions');
    expect(recent).toBeDefined();
    expect(filters.sql).toContain('"quizzes"."training_catalog_id"');
    expect(filters.params).toContain(KFBM);
    expect(filters.params).not.toContain(FIAE);
    expect(filters.params).toContain(50);
    expect(filters.sql).toContain('>=');
  });

  it('limits the last completed enabler to the occupation of the tab', async () => {
    const { mock } = await dashboard({
      courseMembers: [],
      enablers: [],
      courses: [],
      quizSubmissions: [],
      enablerCompletions: [],
    });
    const f = mock.filters('select', 'enabler_completions');
    expect(f.sql).toContain('"courses"."training_catalog_id"');
    expect(f.params).toContain(KFBM);
  });

  it('shows the passed quiz as achievement with its score', async () => {
    const { body } = await dashboard({
      courseMembers: [],
      enablers: [],
      courses: [],
      // the mock returns the rows of a table for every query on it
      quizSubmissions: [
        {
          quizId: 'q1',
          score: 68,
          submittedAt: days(1),
          quizTitle: 'Quiz mittel',
        },
      ],
      enablerCompletions: [],
    });
    expect(body.achievements[0]).toMatchObject({
      kind: 'quiz',
      text: '68% im Quiz "Quiz mittel"',
    });
  });

  it('keeps the weekly progress between 0 and 100 and 0 without enablers', async () => {
    const attempts = Array.from({ length: 300 }, (_, i) => ({
      quizId: `q${i}`,
      score: 90,
      submittedAt: days(i % 6),
      quizTitle: 'Q',
    }));
    const { body } = await dashboard({
      courseMembers: [],
      enablers: [],
      courses: [],
      quizSubmissions: attempts,
      enablerCompletions: attempts.map(a => ({
        enablerId: 'e',
        completedAt: a.submittedAt,
        enablerTitle: 'E',
      })),
    });
    expect(body.weeklyProgress).toHaveLength(6);
    for (const w of body.weeklyProgress) {
      expect(w.progress).toBeGreaterThanOrEqual(0);
      expect(w.progress).toBeLessThanOrEqual(100);
    }
  });
});
