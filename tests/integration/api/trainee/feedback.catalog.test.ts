/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  mockCatalogScope,
  mockTraineeSession,
} from '../../../helpers/mockNext';

// WMCNL-2947, WMCNL-2948: the page "Ausbilder-Feedback" of a trainee.
//  - The quiz results read only the old one-quiz link (enabler_quizzes). The
//    quizzes of an enabler hang on enabler_quiz_links (one per difficulty), so
//    a trainee who finished enabler quizzes saw "Keine Ergebnisse".
//  - Submissions and quiz results of both trainings of a trainee were listed
//    together. Every list belongs to the occupation of the request now.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

const request = () =>
  ({
    url: 'http://localhost/api/trainee/feedback',
    method: 'GET',
    nextUrl: new URL('http://localhost/api/trainee/feedback'),
    headers: { get: () => null },
  }) as any;

async function load(
  tables: Record<string, any>,
  scope = {
    allowedCatalogIds: [FIAE, KFBM],
    activeCatalogId: KFBM,
    selected: true,
  }
) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockTraineeSession('t1');
  mockCatalogScope(scope);
  const mod = await import('@/app/api/trainee/feedback/route');
  return { mock, GET: mod.GET };
}

const quizRow = (over: Record<string, unknown>) => ({
  id: 's',
  quizId: 'q',
  score: 50,
  isReviewed: false,
  trainerFeedback: null,
  submittedAt: new Date('2026-10-29T10:00:00Z'),
  quizTitle: 'Quiz',
  quizType: 'ENABLER',
  difficulty: 'LOW',
  enablerId: 'e1',
  enablerTitle: 'Enabler 1',
  attemptNumber: 1,
  ...over,
});

describe('GET /api/trainee/feedback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists every finished enabler quiz with its difficulty and score', async () => {
    const { GET } = await load({
      enablerSubmissions: [],
      useCaseSubmissions: [],
      quizSubmissions: [
        quizRow({ id: 's1', quizId: 'q-low', score: 98, difficulty: 'LOW' }),
        quizRow({
          id: 's2',
          quizId: 'q-mid',
          score: 68,
          difficulty: 'MEDIUM',
        }),
        quizRow({ id: 's3', quizId: 'q-high', score: 40, difficulty: 'HIGH' }),
        // an older attempt of the first quiz is not listed twice
        quizRow({ id: 's0', quizId: 'q-low', score: 20, difficulty: 'LOW' }),
      ],
    });
    const body = await (await GET(request())).json();

    expect(
      body.enablerQuizResults.map((q: any) => [q.difficulty, q.score])
    ).toEqual([
      ['LOW', 98],
      ['MEDIUM', 68],
      ['HIGH', 40],
    ]);
    expect(body.enablerQuizResults[0]).toMatchObject({
      enablerTitle: 'Enabler 1',
      submittedAt: expect.anything(),
    });
  });

  it('keeps a quiz without an enabler out of the enabler list, global quizzes in their own', async () => {
    const { GET } = await load({
      enablerSubmissions: [],
      useCaseSubmissions: [],
      quizSubmissions: [
        quizRow({
          id: 'g1',
          quizId: 'qg',
          quizType: 'GLOBAL',
          enablerId: null,
          difficulty: null,
          enablerTitle: null,
          score: 77,
        }),
      ],
    });
    const body = await (await GET(request())).json();
    expect(body.enablerQuizResults).toEqual([]);
    expect(body.globalQuizResults).toHaveLength(1);
    expect(body.globalQuizResults[0].score).toBe(77);
  });

  it('limits all four lists to the occupation of the request', async () => {
    const { GET, mock } = await load({
      enablerSubmissions: [],
      useCaseSubmissions: [],
      quizSubmissions: [],
    });
    await GET(request());

    for (const table of [
      'enabler_submissions',
      'use_case_submissions',
      'quiz_submissions',
    ]) {
      const f = mock.filters('select', table);
      expect(f.sql).toContain('training_catalog_id');
      expect(f.params).toContain(KFBM);
      expect(f.params).not.toContain(FIAE);
    }
  });
});
