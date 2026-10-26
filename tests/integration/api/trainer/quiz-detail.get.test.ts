/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  FIAE,
  KFBM,
  loadScoped,
  scopeReq,
  selectsFrom,
} from '../../../helpers/trainerScope';
import { traineeSession } from '../../../helpers/mockNext';

// GET /api/trainer/quizzes/[quizId]: the trainer sees the options and which one
// is correct, the page of the quiz detail reads it from here. A trainee is
// turned away, a quiz of a foreign occupation is not found.

const ONE = 'trainer/quizzes/[quizId]/route';
const QID = '44444444-4444-4444-8444-444444444444';
const URL_ONE = `http://localhost/api/trainer/quizzes/${QID}`;
const params = { params: Promise.resolve({ quizId: QID }) };

const tables = (trainingCatalogId = FIAE) => ({
  quizzes: [
    {
      id: QID,
      title: 'Global quiz',
      isActive: true,
      quizType: 'GLOBAL',
      trainingCatalogId,
    },
  ],
  questions: [
    { id: 'q-1', quizId: QID, questionText: 'Pick one', orderIndex: 1 },
  ],
  options: [
    { id: 'o-1', questionId: 'q-1', optionText: 'A', isCorrect: false },
    { id: 'o-2', questionId: 'q-1', optionText: 'B', isCorrect: true },
  ],
  quizAssignments: [],
  profiles: [],
});

describe('GET /api/trainer/quizzes/[quizId]', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a trainer sees the options and the index of the correct one', async () => {
    const { mod } = await loadScoped(ONE, { tables: tables() });
    const res = await mod.GET(scopeReq(URL_ONE), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.questions).toEqual([
      {
        id: 'q-1',
        question_text: 'Pick one',
        options: ['A', 'B'],
        correct_index: 1,
      },
    ]);
  });

  it('a trainee is turned away (403) and no question is read', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      session: traineeSession('t1'),
      tables: tables(),
    });
    const res = await mod.GET(scopeReq(URL_ONE), params);
    expect(res.status).toBe(403);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('an anonymous caller is turned away (401)', async () => {
    const { mod } = await loadScoped(ONE, { session: null });
    expect((await mod.GET(scopeReq(URL_ONE), params)).status).toBe(401);
  });

  it('a quiz of a catalog the organization does not use is not found (404)', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      tables: {
        ...tables(KFBM),
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      },
    });
    const res = await mod.GET(scopeReq(URL_ONE), params);
    expect(res.status).toBe(404);
    expect(selectsFrom(mock, 'options')).toHaveLength(0);
  });
});
