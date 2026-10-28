/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  mockCatalogScope,
  mockTraineeSession,
} from '../../../helpers/mockNext';
import { findSolutionKeys } from '../../../helpers/solutionKeys';

// POST and GET /api/trainee/quizzes/[quizId]/submit. The solution of a
// question (correct or not, the correct option, the reasoning) comes back only
// after the trainee has answered that question, and only for it. Scoring and
// the repeatable global quiz stay as they were. A lesson quiz is repeated until
// it is passed (50 percent), a passed one is locked.
// The order of work (locked enabler, chain LOW, MEDIUM, HIGH) is tested in
// progression-guards.test.ts.

const SECRET_1 = 'REASONING-FOR-QUESTION-ONE';
const SECRET_2 = 'REASONING-FOR-QUESTION-TWO';

const lessonQuiz = { id: 'q1', isActive: true, quizType: 'LESSON' };
const globalQuiz = { id: 'q1', isActive: true, quizType: 'GLOBAL' };
const questions = [
  { id: 'q-1', quizId: 'q1', questionText: 'Q1', orderIndex: 1 },
  { id: 'q-2', quizId: 'q1', questionText: 'Q2', orderIndex: 2 },
];
const options = [
  {
    id: 'o-1',
    questionId: 'q-1',
    optionText: 'A',
    isCorrect: true,
    explanation: SECRET_1,
  },
  {
    id: 'o-2',
    questionId: 'q-1',
    optionText: 'B',
    isCorrect: false,
    explanation: null,
  },
  {
    id: 'o-3',
    questionId: 'q-2',
    optionText: 'C',
    isCorrect: true,
    explanation: SECRET_2,
  },
  {
    id: 'o-4',
    questionId: 'q-2',
    optionText: 'D',
    isCorrect: false,
    explanation: null,
  },
];

const lessonTables = () => ({
  quizzes: [lessonQuiz],
  enablerQuizLinks: [{ quizId: 'q1', enablerId: 'e1', difficulty: 'LOW' }],
  enablers: [{ id: 'e1', isActive: true, courseId: 'c1', title: 'E1' }],
  courseMembers: [{ userId: 't1', courseId: 'c1', role: 'TRAINEE' }],
  courses: [{ id: 'c1', createdById: 'tr1' }],
  questions,
  options,
  quizSubmissions: [] as any[],
  quizSubmissionAnswers: [] as any[],
});

async function load(tables: Record<string, any>) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    getUserOrgId: async () => 'org1',
  }));
  mockTraineeSession('t1');
  mockCatalogScope();
  const mod = await import('@/app/api/trainee/quizzes/[quizId]/submit/route');
  return { mock, mod };
}

const ctx = { params: Promise.resolve({ quizId: 'q1' }) };
const post = (body: unknown) =>
  ({
    url: 'http://localhost/api/trainee/quizzes/q1/submit',
    json: async () => body,
  }) as any;
const get = () =>
  ({ url: 'http://localhost/api/trainee/quizzes/q1/submit' }) as any;

const bothAnswers = [
  { questionId: 'q-1', selectedOptionId: 'o-2' }, // wrong
  { questionId: 'q-2', selectedOptionId: 'o-3' }, // right
];

describe('POST /api/trainee/quizzes/[quizId]/submit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('answers each answered question with correct, correct option and reasoning', async () => {
    const { mod, mock } = await load(lessonTables());
    const res = await mod.POST(post({ answers: bothAnswers }), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.score).toBe(50);
    expect(body.locked).toBe(false);
    const byQ = new Map<string, any>(
      body.feedback.map((f: any) => [f.questionId, f])
    );
    expect(byQ.get('q-1')).toMatchObject({
      correct: false,
      correctOptionId: 'o-1',
      explanation: SECRET_1,
      selectedOptionId: 'o-2',
    });
    expect(byQ.get('q-2')).toMatchObject({
      correct: true,
      correctOptionId: 'o-3',
      explanation: SECRET_2,
    });
    expect(mock.writes('insert', 'quizSubmissions')).toHaveLength(1);
  });

  it('a missing answer is a 400 without any solution, nothing is stored', async () => {
    const { mod, mock } = await load(lessonTables());
    const res = await mod.POST(
      post({ answers: [{ questionId: 'q-1', selectedOptionId: 'o-1' }] }),
      ctx
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(findSolutionKeys(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('REASONING');
    expect(mock.writes('insert', 'quizSubmissions')).toEqual([]);
  });

  it('a blank selection counts as missing (no solution for it)', async () => {
    const { mod } = await load(lessonTables());
    const res = await mod.POST(
      post({
        answers: [
          { questionId: 'q-1', selectedOptionId: 'o-1' },
          { questionId: 'q-2', selectedOptionId: '  ' },
        ],
      }),
      ctx
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain('REASONING');
  });

  it('no answers at all is a 400 without any solution', async () => {
    const { mod } = await load(lessonTables());
    const res = await mod.POST(post({ answers: [] }), ctx);
    expect(res.status).toBe(400);
    expect(findSolutionKeys(await res.json())).toEqual([]);
  });

  it('a lesson quiz that was passed before is locked and only repeats the stored answers', async () => {
    const { mod, mock } = await load({
      ...lessonTables(),
      quizSubmissions: [{ id: 's1', quizId: 'q1', traineeId: 't1', score: 80 }],
      // the trainee answered question one only
      quizSubmissionAnswers: [
        { submissionId: 's1', questionId: 'q-1', selectedOptionId: 'o-2' },
      ],
    });
    const res = await mod.POST(post({ answers: bothAnswers }), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.locked).toBe(true);
    expect(mock.writes('insert', 'quizSubmissions')).toEqual([]);
    // only the answered question carries a solution
    expect(body.feedback.map((f: any) => f.questionId)).toEqual(['q-1']);
    expect(JSON.stringify(body)).not.toContain(SECRET_2);
  });

  it('an option of another question is a 400, nothing is stored and nothing is solved', async () => {
    const { mod, mock } = await load(lessonTables());
    const res = await mod.POST(
      post({
        answers: [
          { questionId: 'q-1', selectedOptionId: 'o-3' }, // belongs to q-2
          { questionId: 'q-2', selectedOptionId: 'o-3' },
        ],
      }),
      ctx
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain('REASONING');
    expect(mock.writes('insert', 'quizSubmissions')).toEqual([]);
  });

  it('every option of the quiz as separate entries is a 400 (no score by trying all)', async () => {
    const { mod, mock } = await load(lessonTables());
    const res = await mod.POST(
      post({
        answers: [
          { questionId: 'q-1', selectedOptionId: 'o-1' },
          { questionId: 'q-1', selectedOptionId: 'o-2' },
          { questionId: 'q-2', selectedOptionId: 'o-3' },
          { questionId: 'q-2', selectedOptionId: 'o-4' },
        ],
      }),
      ctx
    );
    expect(res.status).toBe(400);
    expect(mock.writes('insert', 'quizSubmissions')).toEqual([]);
  });

  it('a question that is not in the quiz is a 400', async () => {
    const { mod, mock } = await load(lessonTables());
    const res = await mod.POST(
      post({
        answers: [
          ...bothAnswers,
          { questionId: 'q-foreign', selectedOptionId: 'o-1' },
        ],
      }),
      ctx
    );
    expect(res.status).toBe(400);
    expect(mock.writes('insert', 'quizSubmissions')).toEqual([]);
  });

  it('an option id that does not exist is a 400 as well', async () => {
    const { mod } = await load(lessonTables());
    const res = await mod.POST(
      post({
        answers: [
          { questionId: 'q-1', selectedOptionId: 'nope' },
          { questionId: 'q-2', selectedOptionId: 'o-3' },
        ],
      }),
      ctx
    );
    expect(res.status).toBe(400);
  });

  it('a lesson quiz that was not passed can be repeated, the attempt counts up', async () => {
    const { mod, mock } = await load({
      ...lessonTables(),
      quizSubmissions: [{ id: 's1', quizId: 'q1', traineeId: 't1', score: 30 }],
    });
    const res = await mod.POST(post({ answers: bothAnswers }), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.locked).toBe(false);
    expect(mock.writes('insert', 'quizSubmissions')[0]).toMatchObject({
      attemptNumber: 2,
      score: 50,
    });
  });

  it('a lesson quiz stays locked after a pass, whatever a later attempt scored', async () => {
    const { mod, mock } = await load({
      ...lessonTables(),
      quizSubmissions: [
        { id: 's1', quizId: 'q1', traineeId: 't1', score: 20 },
        { id: 's2', quizId: 'q1', traineeId: 't1', score: 50 },
      ],
      quizSubmissionAnswers: [
        { submissionId: 's2', questionId: 'q-1', selectedOptionId: 'o-1' },
        { submissionId: 's2', questionId: 'q-2', selectedOptionId: 'o-3' },
      ],
    });
    const res = await mod.POST(post({ answers: bothAnswers }), ctx);
    const body = await res.json();
    expect(body.locked).toBe(true);
    // the review shows the attempt that passed
    expect(body.submissionId).toBe('s2');
    expect(body.score).toBe(50);
    expect(mock.writes('insert', 'quizSubmissions')).toEqual([]);
  });

  it('a stored answer without a selection or text does not count as answered', async () => {
    const { mod } = await load({
      ...lessonTables(),
      quizSubmissions: [{ id: 's1', quizId: 'q1', traineeId: 't1', score: 80 }],
      quizSubmissionAnswers: [
        { submissionId: 's1', questionId: 'q-1', selectedOptionId: 'o-2' },
        {
          submissionId: 's1',
          questionId: 'q-2',
          selectedOptionId: null,
          textAnswer: null,
        },
      ],
    });
    const res = await mod.POST(post({ answers: bothAnswers }), ctx);
    const body = await res.json();
    expect(body.feedback.map((f: any) => f.questionId)).toEqual(['q-1']);
    expect(JSON.stringify(body)).not.toContain(SECRET_2);
    const review = await (await mod.GET(get(), ctx)).json();
    expect(review.feedback.map((f: any) => f.questionId)).toEqual(['q-1']);
  });

  it('a global quiz stays repeatable (no lock, attempt number counts up)', async () => {
    const { mod, mock } = await load({
      ...lessonTables(),
      quizzes: [globalQuiz],
      quizAssignments: [{ quizId: 'q1', traineeId: 't1' }],
      quizSubmissions: [{ id: 's0', quizId: 'q1', traineeId: 't1', score: 0 }],
    });
    const res = await mod.POST(post({ answers: bothAnswers }), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.locked).toBe(false);
    expect(mock.writes('insert', 'quizSubmissions')[0]).toMatchObject({
      attemptNumber: 2,
      score: 50,
    });
  });

  it('a global quiz that is not assigned is a 403 without any solution', async () => {
    const { mod, mock } = await load({
      ...lessonTables(),
      quizzes: [globalQuiz],
      quizAssignments: [],
    });
    const res = await mod.POST(post({ answers: bothAnswers }), ctx);
    expect(res.status).toBe(403);
    expect(findSolutionKeys(await res.json())).toEqual([]);
    expect(mock.writes('insert', 'quizSubmissions')).toEqual([]);
  });

  it('a lesson quiz of a course the trainee is not in is a 403 without any solution', async () => {
    const { mod, mock } = await load({
      ...lessonTables(),
      courseMembers: [],
    });
    const res = await mod.POST(post({ answers: bothAnswers }), ctx);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('REASONING');
    expect(mock.writes('insert', 'quizSubmissions')).toEqual([]);
  });

  it('an unknown or inactive quiz is a 404', async () => {
    const { mod } = await load({
      ...lessonTables(),
      quizzes: [{ ...lessonQuiz, isActive: false }],
    });
    const res = await mod.POST(post({ answers: bothAnswers }), ctx);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/trainee/quizzes/[quizId]/submit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('without a submission it is a 404 and carries no solution', async () => {
    const { mod } = await load(lessonTables());
    const res = await mod.GET(get(), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'No submission' });
    expect(findSolutionKeys(body)).toEqual([]);
  });

  it('after a submission it shows the solution of the answered questions only', async () => {
    const { mod } = await load({
      ...lessonTables(),
      quizSubmissions: [{ id: 's1', quizId: 'q1', traineeId: 't1', score: 0 }],
      quizSubmissionAnswers: [
        { submissionId: 's1', questionId: 'q-1', selectedOptionId: 'o-2' },
      ],
    });
    const res = await mod.GET(get(), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.feedback).toEqual([
      expect.objectContaining({
        questionId: 'q-1',
        correct: false,
        correctOptionId: 'o-1',
        explanation: SECRET_1,
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain(SECRET_2);
  });

  it('after a full submission it shows every question', async () => {
    const { mod } = await load({
      ...lessonTables(),
      quizSubmissions: [{ id: 's1', quizId: 'q1', traineeId: 't1', score: 50 }],
      quizSubmissionAnswers: [
        { submissionId: 's1', questionId: 'q-1', selectedOptionId: 'o-2' },
        { submissionId: 's1', questionId: 'q-2', selectedOptionId: 'o-3' },
      ],
    });
    const body = await (await mod.GET(get(), ctx)).json();
    expect(body.score).toBe(50);
    expect(body.feedback).toHaveLength(2);
  });
});
