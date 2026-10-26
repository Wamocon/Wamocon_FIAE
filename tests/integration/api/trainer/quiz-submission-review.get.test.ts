/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  FIAE,
  KFBM,
  ORG,
  OTHER_ORG,
  T1,
  loadScoped,
  scopeReq,
  selectsFrom,
  superAdminSession,
} from '../../../helpers/trainerScope';
import { traineeSession } from '../../../helpers/mockNext';

// GET /api/trainer/quiz-submissions/[submissionId]: the review of one quiz
// submission with the answer key (which option is correct, the expected answer
// of a text question). The page of the trainer used to read these tables on the
// server without any session, so the key is now served by this route behind the
// trainer guard, inside the organization and occupation of the caller.

const ONE = 'trainer/quiz-submissions/[submissionId]/route';
const SID = '33333333-3333-4333-8333-333333333333';
const QID = '44444444-4444-4444-8444-444444444444';
const URL_ONE = `http://localhost/api/trainer/quiz-submissions/${SID}`;
const params = { params: Promise.resolve({ submissionId: SID }) };

const submission = {
  id: SID,
  traineeId: T1,
  quizId: QID,
  score: 50,
  isReviewed: false,
};
const traineeRow = (organizationId = ORG) => ({
  id: T1,
  role: 'TRAINEE',
  organizationId,
  fullName: 'Tina Trainee',
  email: 'tina@example.com',
});

const tables = (overrides: Record<string, unknown> = {}) => ({
  quizSubmissions: [submission],
  profiles: [traineeRow()],
  quizzes: [
    {
      id: QID,
      title: 'Lesson quiz',
      quizType: 'LESSON',
      trainingCatalogId: FIAE,
    },
  ],
  enablerQuizLinks: [{ quizId: QID, enablerId: 'e1', difficulty: 'LOW' }],
  enablers: [{ id: 'e1', title: 'Enabler One' }],
  // the mock does not sort, the route asks the database for order_index
  questions: [
    {
      id: 'q-1',
      quizId: QID,
      questionText: 'Pick one',
      questionType: 'MCQ',
      orderIndex: 1,
      expectedAnswer: null,
    },
    {
      id: 'q-2',
      quizId: QID,
      questionText: 'Free text?',
      questionType: 'TEXT',
      orderIndex: 2,
      expectedAnswer: 'forty-two',
    },
  ],
  options: [
    { id: 'o-1', questionId: 'q-1', optionText: 'A', isCorrect: true },
    { id: 'o-2', questionId: 'q-1', optionText: 'B', isCorrect: false },
  ],
  quizSubmissionAnswers: [
    {
      submissionId: SID,
      questionId: 'q-1',
      selectedOptionId: 'o-2',
      textAnswer: null,
    },
    {
      submissionId: SID,
      questionId: 'q-2',
      selectedOptionId: null,
      textAnswer: 'forty-three',
    },
  ],
  ...overrides,
});

describe('GET /api/trainer/quiz-submissions/[submissionId]', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a trainer of the organization sees the key and the answers of the trainee', async () => {
    const { mod } = await loadScoped(ONE, { tables: tables() });
    const res = await mod.GET(scopeReq(URL_ONE), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.submission).toEqual({
      id: SID,
      traineeId: T1,
      quizId: QID,
      score: 50,
      isReviewed: false,
    });
    expect(body.quiz).toEqual({ title: 'Lesson quiz', quizType: 'LESSON' });
    expect(body.trainee).toEqual({
      fullName: 'Tina Trainee',
      email: 'tina@example.com',
    });
    expect(body.lesson).toEqual({
      difficulty: 'LOW',
      enablerTitle: 'Enabler One',
    });
    // with the marker of the correct option
    expect(body.questions.map((q: any) => q.id)).toEqual(['q-1', 'q-2']);
    expect(body.questions[0]).toMatchObject({
      text: 'Pick one',
      questionType: 'MCQ',
      selectedOptionId: 'o-2',
      options: [
        { id: 'o-1', optionText: 'A', isCorrect: true },
        { id: 'o-2', optionText: 'B', isCorrect: false },
      ],
    });
    expect(body.questions[1]).toMatchObject({
      questionType: 'TEXT',
      expectedAnswer: 'forty-two',
      textAnswer: 'forty-three',
    });
  });

  it('the answer does not carry more of the trainee profile than name and email', async () => {
    const { mod } = await loadScoped(ONE, {
      tables: tables({
        profiles: [{ ...traineeRow(), phone: '0123', assignedTrainerId: 'x' }],
      }),
    });
    const body = await (await mod.GET(scopeReq(URL_ONE), params)).json();
    expect(Object.keys(body.trainee).sort()).toEqual(['email', 'fullName']);
  });

  it('a quiz without a lesson link has no lesson context', async () => {
    const { mod } = await loadScoped(ONE, {
      tables: tables({ enablerQuizLinks: [] }),
    });
    const body = await (await mod.GET(scopeReq(URL_ONE), params)).json();
    expect(body.lesson).toBeNull();
  });

  it('a submission of a trainee of another organization is not found (404), no key is read', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      tables: tables({ profiles: [traineeRow(OTHER_ORG)] }),
    });
    const res = await mod.GET(scopeReq(URL_ONE), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Submission not found' });
    expect(selectsFrom(mock, 'options')).toHaveLength(0);
    expect(selectsFrom(mock, 'questions')).toHaveLength(0);
  });

  it('a submission that does not exist answers the same (404)', async () => {
    const { mod } = await loadScoped(ONE, {
      tables: tables({ quizSubmissions: [] }),
    });
    const res = await mod.GET(scopeReq(URL_ONE), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Submission not found' });
  });

  it('a trainee of another occupation than the chosen one is not found (404)', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      tables: tables({
        // the second lookup is the occupation check, it finds nobody
        profiles: { sequence: [[traineeRow()], []] },
        quizzes: [
          { id: QID, title: 'T', quizType: 'LESSON', trainingCatalogId: KFBM },
        ],
      }),
    });
    const res = await mod.GET(scopeReq(URL_ONE, { header: 'KFBM' }), params);
    expect(res.status).toBe(404);
    expect(selectsFrom(mock, 'options')).toHaveLength(0);
  });

  it('a quiz outside the catalogs of the caller is not found (404)', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      tables: tables({
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
        quizzes: [
          { id: QID, title: 'T', quizType: 'LESSON', trainingCatalogId: KFBM },
        ],
      }),
    });
    const res = await mod.GET(scopeReq(URL_ONE), params);
    expect(res.status).toBe(404);
    expect(selectsFrom(mock, 'options')).toHaveLength(0);
  });

  it('the super admin reaches a submission of any organization', async () => {
    const { mod } = await loadScoped(ONE, {
      session: superAdminSession(),
      tables: tables({ profiles: [traineeRow(OTHER_ORG)] }),
    });
    const res = await mod.GET(scopeReq(URL_ONE), params);
    expect(res.status).toBe(200);
  });

  it('an id that is no uuid answers like a missing submission (404), no query is made', async () => {
    const { mod, mock } = await loadScoped(ONE, { tables: tables() });
    const res = await mod.GET(scopeReq(URL_ONE), {
      params: Promise.resolve({ submissionId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Submission not found' });
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('a trainee is turned away (403) without reading anything', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      session: traineeSession('t1'),
      tables: tables(),
    });
    const res = await mod.GET(scopeReq(URL_ONE), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('an anonymous caller is turned away (401)', async () => {
    const { mod } = await loadScoped(ONE, { session: null });
    expect((await mod.GET(scopeReq(URL_ONE), params)).status).toBe(401);
  });

  it('500 without a detail when the database fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { mod, mock } = await loadScoped(ONE, { tables: tables() });
    (mock.db.select as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await mod.GET(scopeReq(URL_ONE), params);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    errorSpy.mockRestore();
  });
});
