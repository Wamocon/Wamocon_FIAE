/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  mockCatalogScope,
  mockTraineeSession,
} from '../../../helpers/mockNext';

// POST and GET /api/trainee/quizzes/[quizId]/submit: which questions are
// graded. A free text question without an expected answer has no solution to
// compare with. It is taken out of numerator and denominator of the percentage
// (neither right nor wrong), the answer says "graded: false", and a quiz made
// only of such questions has no score (null), is stored and cannot be passed.
// Choice questions are graded as before.

const SECRET = 'EXPECTED-ANSWER-SECRET';

const lessonQuiz = { id: 'q1', isActive: true, quizType: 'LESSON' };
const globalQuiz = { id: 'q1', isActive: true, quizType: 'GLOBAL' };

const choice = (id: string, order: number) => ({
  id,
  quizId: 'q1',
  questionText: `Choice ${id}`,
  questionType: 'MCQ',
  expectedAnswer: null,
  orderIndex: order,
});
const freeText = (
  id: string,
  order: number,
  expectedAnswer: string | null
) => ({
  id,
  quizId: 'q1',
  questionText: `Text ${id}`,
  questionType: 'TEXT',
  expectedAnswer,
  orderIndex: order,
});
const optionsOf = (questionId: string) => [
  {
    id: `${questionId}-right`,
    questionId,
    optionText: 'right',
    isCorrect: true,
    explanation: 'WHY',
  },
  {
    id: `${questionId}-wrong`,
    questionId,
    optionText: 'wrong',
    isCorrect: false,
    explanation: null,
  },
];

const tablesFor = (
  questions: Array<ReturnType<typeof choice | typeof freeText>>,
  extra: Record<string, any> = {}
) => ({
  quizzes: [lessonQuiz],
  enablerQuizLinks: [{ quizId: 'q1', enablerId: 'e1', difficulty: 'LOW' }],
  enablers: [{ id: 'e1', isActive: true, courseId: 'c1', title: 'E1' }],
  courseMembers: [{ userId: 't1', courseId: 'c1', role: 'TRAINEE' }],
  courses: [{ id: 'c1', createdById: 'tr1' }],
  questions,
  options: questions
    .filter(q => q.questionType === 'MCQ')
    .flatMap(q => optionsOf(q.id)),
  quizSubmissions: [] as any[],
  quizSubmissionAnswers: [] as any[],
  ...extra,
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

const right = (id: string) => ({
  questionId: id,
  selectedOptionId: `${id}-right`,
});
const wrong = (id: string) => ({
  questionId: id,
  selectedOptionId: `${id}-wrong`,
});
const typed = (id: string, textAnswer: string) => ({
  questionId: id,
  textAnswer,
});

const byQuestion = (body: any) =>
  new Map<string, any>(body.feedback.map((f: any) => [f.questionId, f]));

describe('a quiz of free text questions without an expected answer', () => {
  beforeEach(() => jest.clearAllMocks());

  const onlyText = () => [freeText('t-1', 1, null), freeText('t-2', 2, '  ')];

  it('cannot be passed with any text: no score, nothing graded', async () => {
    const { mod } = await load(tablesFor(onlyText()));
    const res = await mod.POST(
      post({ answers: [typed('t-1', 'asdf'), typed('t-2', 'qwer')] }),
      ctx
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.score).toBeNull();
    expect(body.autoGraded).toBe(false);
    expect(body.ungradedCount).toBe(2);
    expect(body.feedback).toHaveLength(2);
    expect(
      body.feedback.every((f: any) => f.graded === false && f.correct === false)
    ).toBe(true);
    expect(body.locked).toBe(false);
  });

  it('is stored with the answers, so the trainer can read them', async () => {
    const { mod, mock } = await load(tablesFor(onlyText()));
    await mod.POST(
      post({
        answers: [typed('t-1', 'mein Text'), typed('t-2', 'noch einer')],
      }),
      ctx
    );
    const [saved] = mock.writes('insert', 'quizSubmissions');
    expect(saved).toMatchObject({
      traineeId: 't1',
      quizId: 'q1',
      score: null,
      attemptNumber: 1,
    });
    const answers = mock.writes('insert', 'quizSubmissionAnswers')[0] as any[];
    expect(answers.map(a => [a.questionId, a.textAnswer])).toEqual([
      ['t-1', 'mein Text'],
      ['t-2', 'noch einer'],
    ]);
  });

  it('still needs a typed answer for every question (a blank one is a 400)', async () => {
    const { mod, mock } = await load(tablesFor(onlyText()));
    const res = await mod.POST(
      post({ answers: [typed('t-1', 'x'), typed('t-2', '   ')] }),
      ctx
    );
    expect(res.status).toBe(400);
    expect(mock.writes('insert', 'quizSubmissions')).toEqual([]);
  });

  it('can be handed in again, the attempt counts up and the best score stays null', async () => {
    const { mod, mock } = await load(
      tablesFor(onlyText(), {
        quizSubmissions: [
          { id: 's1', quizId: 'q1', traineeId: 't1', score: null },
        ],
      })
    );
    const res = await mod.POST(
      post({ answers: [typed('t-1', 'a'), typed('t-2', 'b')] }),
      ctx
    );
    expect(res.status).toBe(200);
    expect((await res.json()).locked).toBe(false);
    expect(mock.writes('insert', 'quizSubmissions')[0]).toMatchObject({
      attemptNumber: 2,
      score: null,
    });
  });

  it('a global quiz of this kind is stored without a score as well', async () => {
    const { mod, mock } = await load(
      tablesFor(onlyText(), {
        quizzes: [globalQuiz],
        quizAssignments: [{ quizId: 'q1', traineeId: 't1' }],
      })
    );
    const res = await mod.POST(
      post({ answers: [typed('t-1', 'a'), typed('t-2', 'b')] }),
      ctx
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.score).toBeNull();
    expect(body.feedback.every((f: any) => f.graded === false)).toBe(true);
    expect(mock.writes('insert', 'quizSubmissions')[0]).toMatchObject({
      score: null,
    });
  });

  it('the review of a stored attempt says "not graded" and carries no key', async () => {
    const { mod } = await load(
      tablesFor(onlyText(), {
        quizSubmissions: [
          { id: 's1', quizId: 'q1', traineeId: 't1', score: null },
        ],
        quizSubmissionAnswers: [
          { submissionId: 's1', questionId: 't-1', textAnswer: 'mein Text' },
          { submissionId: 's1', questionId: 't-2', textAnswer: 'zwei' },
        ],
      })
    );
    const body = await (await mod.GET(get(), ctx)).json();
    expect(body.score).toBeNull();
    expect(body.autoGraded).toBe(false);
    expect(body.feedback).toHaveLength(2);
    expect(
      body.feedback.every(
        (f: any) =>
          f.graded === false &&
          f.correct === false &&
          f.correctAnswerText === null &&
          f.correctOptionId === null
      )
    ).toBe(true);
    expect(byQuestion(body).get('t-1').selectedText).toBe('mein Text');
  });
});

describe('a quiz that mixes choice and free text questions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('leaves the ungraded question out of numerator and denominator', async () => {
    const questions = [
      choice('c-1', 1),
      choice('c-2', 2),
      freeText('t-1', 3, null),
      freeText('t-2', 4, null),
    ];
    const { mod, mock } = await load(tablesFor(questions));
    const res = await mod.POST(
      post({
        answers: [
          right('c-1'),
          wrong('c-2'),
          typed('t-1', 'irgendwas'),
          typed('t-2', 'noch mehr'),
        ],
      }),
      ctx
    );
    const body = await res.json();
    // 1 of 2 graded questions, the two free texts do not count at all
    expect(body.score).toBe(50);
    expect(body.autoGraded).toBe(true);
    expect(body.ungradedCount).toBe(2);
    const f = byQuestion(body);
    expect(f.get('c-1')).toMatchObject({ graded: true, correct: true });
    expect(f.get('c-2')).toMatchObject({ graded: true, correct: false });
    expect(f.get('t-1')).toMatchObject({ graded: false, correct: false });
    expect(f.get('t-2')).toMatchObject({ graded: false, correct: false });
    expect(mock.writes('insert', 'quizSubmissions')[0]).toMatchObject({
      score: 50,
    });
  });

  it('a wrong choice answer is not rescued by free text any more', async () => {
    // before: 1 of 2 questions (the typed text counted as right) = 50, passed
    const { mod } = await load(
      tablesFor([choice('c-1', 1), freeText('t-1', 2, null)])
    );
    const body = await (
      await mod.POST(post({ answers: [wrong('c-1'), typed('t-1', 'x')] }), ctx)
    ).json();
    expect(body.score).toBe(0);
    // not passed: the key stays back
    expect(byQuestion(body).get('c-1').correctOptionId).toBeNull();
  });

  it('a right choice answer passes the quiz, the free text does not hold it back', async () => {
    const { mod } = await load(
      tablesFor([choice('c-1', 1), freeText('t-1', 2, null)])
    );
    const body = await (
      await mod.POST(post({ answers: [right('c-1'), typed('t-1', 'x')] }), ctx)
    ).json();
    expect(body.score).toBe(100);
    // passed: the key of the choice question comes, a free text has none
    expect(byQuestion(body).get('c-1')).toMatchObject({
      correctOptionId: 'c-1-right',
      explanation: 'WHY',
    });
    expect(byQuestion(body).get('t-1')).toMatchObject({
      graded: false,
      correctAnswerText: null,
    });
  });

  it('a free text question WITH an expected answer is graded, case-insensitive', async () => {
    const { mod } = await load(
      tablesFor([
        choice('c-1', 1),
        freeText('t-1', 2, SECRET),
        freeText('t-2', 3, null),
      ])
    );
    const body = await (
      await mod.POST(
        post({
          answers: [
            right('c-1'),
            typed('t-1', `  ${SECRET.toLowerCase()} `),
            typed('t-2', 'frei'),
          ],
        }),
        ctx
      )
    ).json();
    // 2 of 2 graded questions
    expect(body.score).toBe(100);
    expect(body.ungradedCount).toBe(1);
    expect(byQuestion(body).get('t-1')).toMatchObject({
      graded: true,
      correct: true,
    });
  });

  it('a wrong text answer against an expected answer counts as wrong', async () => {
    const { mod } = await load(
      tablesFor([choice('c-1', 1), freeText('t-1', 2, SECRET)])
    );
    const body = await (
      await mod.POST(
        post({ answers: [right('c-1'), typed('t-1', 'nope')] }),
        ctx
      )
    ).json();
    expect(body.score).toBe(50);
    expect(byQuestion(body).get('t-1')).toMatchObject({
      graded: true,
      correct: false,
    });
  });

  it('the passing score of 50 percent is counted on the graded questions', async () => {
    const questions = [
      choice('c-1', 1),
      choice('c-2', 2),
      choice('c-3', 3),
      freeText('t-1', 4, null),
    ];
    const attempt = async (answers: unknown[]) => {
      const { mod } = await load(tablesFor(questions));
      return (await mod.POST(post({ answers }), ctx)).json();
    };
    // 1 of 3 graded = 33 percent: not passed, key stays back
    const failed = await attempt([
      right('c-1'),
      wrong('c-2'),
      wrong('c-3'),
      typed('t-1', 'x'),
    ]);
    expect(failed.score).toBe(33);
    expect(byQuestion(failed).get('c-1').correctOptionId).toBeNull();
    // 2 of 3 graded = 67 percent: passed, key comes
    const passed = await attempt([
      right('c-1'),
      right('c-2'),
      wrong('c-3'),
      typed('t-1', 'x'),
    ]);
    expect(passed.score).toBe(67);
    expect(byQuestion(passed).get('c-3').correctOptionId).toBe('c-3-right');
  });

  it('the review of a passed mixed quiz locks the quiz and marks the free text as not graded', async () => {
    const { mod, mock } = await load(
      tablesFor([choice('c-1', 1), freeText('t-1', 2, null)], {
        quizSubmissions: [
          { id: 's1', quizId: 'q1', traineeId: 't1', score: 100 },
        ],
        quizSubmissionAnswers: [
          {
            submissionId: 's1',
            questionId: 'c-1',
            selectedOptionId: 'c-1-right',
          },
          { submissionId: 's1', questionId: 't-1', textAnswer: 'frei' },
        ],
      })
    );
    const res = await mod.POST(
      post({ answers: [right('c-1'), typed('t-1', 'frei')] }),
      ctx
    );
    const body = await res.json();
    expect(body.locked).toBe(true);
    expect(mock.writes('insert', 'quizSubmissions')).toEqual([]);
    expect(byQuestion(body).get('t-1')).toMatchObject({
      graded: false,
      correct: false,
      selectedText: 'frei',
    });
    expect(byQuestion(body).get('c-1')).toMatchObject({
      graded: true,
      correct: true,
    });
    const review = await (await mod.GET(get(), ctx)).json();
    expect(byQuestion(review).get('t-1')).toMatchObject({ graded: false });
  });
});

describe('a quiz of choice questions only (regression, nothing changes)', () => {
  beforeEach(() => jest.clearAllMocks());

  const four = [
    choice('c-1', 1),
    choice('c-2', 2),
    choice('c-3', 3),
    choice('c-4', 4),
  ];

  it.each([
    [[right, right, right, right], 100],
    [[right, right, right, wrong], 75],
    [[right, right, wrong, wrong], 50],
    [[right, wrong, wrong, wrong], 25],
    [[wrong, wrong, wrong, wrong], 0],
  ])('scores %#: %p gives %p percent', async (pickers, expected) => {
    const { mod, mock } = await load(tablesFor(four));
    const answers = four.map((q, i) => (pickers as any[])[i](q.id));
    const body = await (await mod.POST(post({ answers }), ctx)).json();
    expect(body.score).toBe(expected);
    expect(body.autoGraded).toBe(true);
    expect(body.ungradedCount).toBe(0);
    expect(body.feedback.every((f: any) => f.graded === true)).toBe(true);
    expect(mock.writes('insert', 'quizSubmissions')[0]).toMatchObject({
      score: expected,
    });
  });

  it('three questions give 67 percent for two right ones, as before', async () => {
    const { mod } = await load(
      tablesFor([choice('c-1', 1), choice('c-2', 2), choice('c-3', 3)])
    );
    const body = await (
      await mod.POST(
        post({ answers: [right('c-1'), right('c-2'), wrong('c-3')] }),
        ctx
      )
    ).json();
    expect(body.score).toBe(67);
  });

  it('keeps the key back below 50 and gives it at 50', async () => {
    const two = [choice('c-1', 1), choice('c-2', 2)];
    const failed = await (
      await (
        await load(tablesFor(two))
      ).mod.POST(post({ answers: [wrong('c-1'), wrong('c-2')] }), ctx)
    ).json();
    expect(failed.score).toBe(0);
    expect(
      failed.feedback.every(
        (f: any) =>
          f.correctOptionId === null &&
          f.explanation === null &&
          f.correctAnswerText === null
      )
    ).toBe(true);
    expect(JSON.stringify(failed)).not.toContain('c-1-right');
    const passed = await (
      await (
        await load(tablesFor(two))
      ).mod.POST(post({ answers: [right('c-1'), wrong('c-2')] }), ctx)
    ).json();
    expect(passed.score).toBe(50);
    expect(byQuestion(passed).get('c-1').correctOptionId).toBe('c-1-right');
  });
});

describe('the answer never carries an expected answer of a free text question', () => {
  it('not for a graded question before the pass, not for an ungraded one at all', async () => {
    const { mod } = await load(
      tablesFor([
        choice('c-1', 1),
        freeText('t-1', 2, SECRET),
        freeText('t-2', 3, null),
      ])
    );
    const body = await (
      await mod.POST(
        post({
          answers: [wrong('c-1'), typed('t-1', 'nope'), typed('t-2', 'x')],
        }),
        ctx
      )
    ).json();
    // 0 of 2 graded: not passed, the expected answer stays back
    expect(body.score).toBe(0);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});
