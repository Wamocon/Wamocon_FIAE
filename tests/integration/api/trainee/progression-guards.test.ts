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
import {
  progressionWorld,
  type WorldOptions,
} from '../../../helpers/progressionWorld';

// The order of work on the server: a trainee reads the whole course, but every
// write route and every route that delivers quiz questions answers a locked
// enabler with 403 and code ENABLER_LOCKED (the reason and the enabler to
// finish first, no content). The chain LOW, MEDIUM, HIGH of the lesson quizzes
// is enforced as well (QUIZ_LOCKED). Title and material stay readable.

type Handler = (req: any, ctx: { params: Promise<any> }) => Promise<Response>;

async function load(
  routePath: string,
  method: 'GET' | 'POST',
  tables: Record<string, any>
) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    getUserOrgId: async () => 'org1',
  }));
  mockTraineeSession('t1');
  mockCatalogScope();
  const mod = await import(routePath);
  return { mock, handler: mod[method] as Handler };
}

const req = (body?: unknown) =>
  ({ url: 'http://localhost/api/x', json: async () => body }) as any;
const ctx = (params: Record<string, string>) => ({
  params: Promise.resolve(params),
});

const ENABLER_SUBMIT = '@/app/api/trainee/enablers/[enablerId]/submit/route';
const QUIZ_SUBMIT = '@/app/api/trainee/quizzes/[quizId]/submit/route';
const USE_CASE_SUBMIT = '@/app/api/trainee/use-cases/[useCaseId]/submit/route';
const LEGACY_QUIZ = '@/app/api/trainee/enablers/[enablerId]/quiz/route';
const LEGACY_QUIZ_SUBMIT =
  '@/app/api/trainee/enablers/[enablerId]/quiz/submit/route';
const DIFFICULTY =
  '@/app/api/trainee/enablers/[enablerId]/quizzes/[difficulty]/route';
const QUIZ_LIST = '@/app/api/trainee/enablers/[enablerId]/quizzes/route';
const ENABLER_DETAIL = '@/app/api/trainee/enablers/[enablerId]/route';

// the mock answers a read of the questions with the question of every quiz of
// the world, so an attempt answers all of them
const solved = [
  { questionId: 'qq1', selectedOptionId: 'oo1' },
  { questionId: 'qq2', selectedOptionId: 'oo2' },
  { questionId: 'qq3', selectedOptionId: 'oo3' },
];

// A locked enabler reads no question and no option for the trainee. The one
// read of the questions table that remains is the order of work asking which
// quizzes have a gradable question (ids only, see loadGradableQuizIds).
const expectNoQuestionsDelivered = (mock: ReturnType<typeof createTableDb>) => {
  const reads = (table: string) =>
    mock.calls.filter(c => c.op === 'select' && c.table === table).length;
  expect(reads('options')).toBe(0);
  expect(reads('questions')).toBeLessThanOrEqual(1);
};

const inserted = (mock: ReturnType<typeof createTableDb>, table: string) =>
  mock.writes('insert', table);

const submitScenario = async (world: WorldOptions) => {
  const { handler, mock } = await load(
    ENABLER_SUBMIT,
    'POST',
    progressionWorld(world)
  );
  const res = await handler(
    req({ solutionText: 'text' }),
    ctx({ enablerId: world.target ?? 'e2' })
  );
  return { res, mock, body: await res.json() };
};

describe('enabler submission (scenario)', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

  it('is locked while the enabler before it is not completed: 403 ENABLER_LOCKED, nothing stored', async () => {
    const { res, mock, body } = await submitScenario({ target: 'e2' });
    expect(res.status).toBe(403);
    expect(body).toEqual({
      error: 'Enabler locked',
      code: 'ENABLER_LOCKED',
      reason: 'SEQUENCE',
      lockedBy: { id: 'e1', title: 'Enabler Eins' },
    });
    expect(inserted(mock, 'enablerSubmissions')).toEqual([]);
    expect(inserted(mock, 'notifications')).toEqual([]);
  });

  it('stays locked after a quiz that was attempted but not passed', async () => {
    const { res } = await submitScenario({ target: 'e2', scores: { q1: 30 } });
    expect(res.status).toBe(403);
  });

  it('opens when the enabler before it is passed (50 percent)', async () => {
    const { res, mock } = await submitScenario({
      target: 'e2',
      scores: { q1: 50 },
    });
    expect(res.status).toBe(200);
    expect(inserted(mock, 'enablerSubmissions')).toHaveLength(1);
  });

  it('does not wait for a quiz without a gradable question (free text without an expected answer)', async () => {
    // q1 cannot be graded: no attempt, no pass is needed, e2 is open
    const { res, mock } = await submitScenario({
      target: 'e2',
      ungradable: ['q1'],
    });
    expect(res.status).toBe(200);
    expect(inserted(mock, 'enablerSubmissions')).toHaveLength(1);
  });

  it('still waits for a gradable quiz of the enabler before it', async () => {
    // e1 has the gradable q1 (not passed): locked, although q2 and q3 of e2 are free text
    const { res, body } = await submitScenario({
      target: 'e2',
      ungradable: ['q2', 'q3'],
    });
    expect(res.status).toBe(403);
    expect(body.code).toBe('ENABLER_LOCKED');
  });

  it('is open for the first enabler of the course', async () => {
    const { res } = await submitScenario({ target: 'e1' });
    expect(res.status).toBe(200);
  });

  it('skips an inactive enabler: the next one is the first', async () => {
    const { res } = await submitScenario({ target: 'e2', inactive: ['e1'] });
    expect(res.status).toBe(200);
  });

  it('is not locked for a trainee the order does not apply to (joined before the cut-off date)', async () => {
    const { res } = await submitScenario({ target: 'e2', enforced: false });
    expect(res.status).toBe(200);
  });

  it('opens out of turn with an exception of the trainer', async () => {
    const { res } = await submitScenario({
      target: 'e2',
      overrides: [{ enablerId: 'e2', isActive: true }],
    });
    expect(res.status).toBe(200);
  });

  it('is locked by an exception of the trainer, also for the first enabler', async () => {
    const { res, body } = await submitScenario({
      target: 'e1',
      overrides: [{ enablerId: 'e1', isActive: false }],
    });
    expect(res.status).toBe(403);
    expect(body).toMatchObject({
      code: 'ENABLER_LOCKED',
      reason: 'MANUAL',
      lockedBy: null,
    });
  });

  it('ignores an exception when the order does not apply (old rows lock nobody)', async () => {
    const { res } = await submitScenario({
      target: 'e1',
      enforced: false,
      overrides: [{ enablerId: 'e1', isActive: false }],
    });
    expect(res.status).toBe(200);
  });
});

describe('lesson quiz submission', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

  const submit = async (
    quizId: 'q1' | 'q2' | 'q3',
    world: WorldOptions = {}
  ) => {
    const { handler, mock } = await load(
      QUIZ_SUBMIT,
      'POST',
      progressionWorld({ targetQuiz: quizId, ...world })
    );
    const res = await handler(req({ answers: solved }), ctx({ quizId }));
    return { res, mock, body: await res.json() };
  };

  it('takes no attempt at a locked enabler: 403 ENABLER_LOCKED, no solution, nothing stored', async () => {
    const { res, mock, body } = await submit('q2', { target: 'e2' });
    expect(res.status).toBe(403);
    expect(body.code).toBe('ENABLER_LOCKED');
    expect(findSolutionKeys(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('oo1');
    expect(inserted(mock, 'quizSubmissions')).toEqual([]);
    expect(inserted(mock, 'quizSubmissionAnswers')).toEqual([]);
  });

  it('takes the attempt once the enabler before it is passed', async () => {
    // the mock answers every read of the table alike: the first read (the
    // progression) sees the pass of quiz 1, the later ones see no attempt at
    // quiz 2 (the table of the world holds all quizzes)
    const world = progressionWorld({ target: 'e2', targetQuiz: 'q2' });
    const { handler, mock } = await load(QUIZ_SUBMIT, 'POST', {
      ...world,
      quizSubmissions: {
        sequence: [[{ quizId: 'q1', traineeId: 't1', score: 90 }], []],
      },
    });
    const res = await handler(req({ answers: solved }), ctx({ quizId: 'q2' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.locked).toBe(false);
    expect(inserted(mock, 'quizSubmissions')).toHaveLength(1);
  });

  it('the first enabler takes attempts and a failed quiz is repeated', async () => {
    const { res, mock } = await submit('q1', {
      target: 'e1',
      scores: { q1: 20 },
    });
    expect(res.status).toBe(200);
    expect(inserted(mock, 'quizSubmissions')[0]).toMatchObject({
      attemptNumber: 2,
    });
  });

  it('enforces the chain: MEDIUM takes no attempt before LOW was attempted (QUIZ_LOCKED)', async () => {
    const { res, mock, body } = await submit('q3', {
      target: 'e2',
      scores: { q1: 90 },
    });
    expect(res.status).toBe(403);
    expect(body).toEqual({
      error: 'Quiz locked',
      code: 'QUIZ_LOCKED',
      after: 'LOW',
    });
    expect(inserted(mock, 'quizSubmissions')).toEqual([]);
  });

  it('opens MEDIUM after an attempt at LOW, passed or not', async () => {
    const { res } = await submit('q3', {
      target: 'e2',
      scores: { q1: 90, q2: 10 },
    });
    expect(res.status).toBe(200);
  });

  it('enforces the chain also where the order of enablers does not apply', async () => {
    const { res, body } = await submit('q3', {
      target: 'e2',
      enforced: false,
    });
    expect(res.status).toBe(403);
    expect(body.code).toBe('QUIZ_LOCKED');
  });
});

describe('use case submission', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

  const submit = async (enablerId: string | null, world: WorldOptions = {}) => {
    const { handler, mock } = await load(USE_CASE_SUBMIT, 'POST', {
      ...progressionWorld(world),
      useCases: [
        { id: 'u1', courseId: 'c1', isActive: true, title: 'UC', enablerId },
      ],
      useCaseSubmissions: [],
      useCaseSubmissionLinks: [],
    });
    const res = await handler(
      req({ submissionText: 'x' }),
      ctx({ useCaseId: 'u1' })
    );
    return { res, mock, body: await res.json() };
  };

  it('belongs to its enabler: locked while that enabler is locked', async () => {
    const { res, mock, body } = await submit('e2', { target: 'e2' });
    expect(res.status).toBe(403);
    expect(body.code).toBe('ENABLER_LOCKED');
    expect(inserted(mock, 'useCaseSubmissions')).toEqual([]);
  });

  it('is open when its enabler is open', async () => {
    const { res } = await submit('e2', { target: 'e2', scores: { q1: 80 } });
    expect(res.status).toBe(200);
  });

  it('is not part of the order without an enabler', async () => {
    const { res } = await submit(null, { target: 'e2' });
    expect(res.status).toBe(200);
  });
});

describe('legacy single quiz of an enabler', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

  it('does not deliver the questions of a locked enabler', async () => {
    const { handler, mock } = await load(LEGACY_QUIZ, 'GET', {
      ...progressionWorld({ target: 'e2' }),
      enablerQuizzes: [{ enablerId: 'e2', quizId: 'q2' }],
    });
    const res = await handler(req(), ctx({ enablerId: 'e2' }));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe('ENABLER_LOCKED');
    expect(body.quiz).toBeUndefined();
    expectNoQuestionsDelivered(mock);
  });

  it('takes no submission for a locked enabler', async () => {
    const { handler, mock } = await load(LEGACY_QUIZ_SUBMIT, 'POST', {
      ...progressionWorld({ target: 'e2' }),
      enablerQuizzes: [{ enablerId: 'e2', quizId: 'q2' }],
    });
    const res = await handler(
      req({ answers: solved }),
      ctx({ enablerId: 'e2' })
    );
    expect(res.status).toBe(403);
    expect(inserted(mock, 'quizSubmissions')).toEqual([]);
  });
});

describe('questions of a lesson quiz per difficulty', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

  const get = async (
    enablerId: string,
    difficulty: string,
    world: WorldOptions
  ) => {
    const { handler, mock } = await load(
      DIFFICULTY,
      'GET',
      progressionWorld(world)
    );
    const res = await handler(req(), ctx({ enablerId, difficulty }));
    return { res, mock, body: await res.json() };
  };

  it('delivers no question of a locked enabler and does not even read them', async () => {
    const { res, mock, body } = await get('e2', 'LOW', {
      target: 'e2',
      targetQuiz: 'q2',
    });
    expect(res.status).toBe(403);
    expect(body.code).toBe('ENABLER_LOCKED');
    expect(body.quiz).toBeUndefined();
    expectNoQuestionsDelivered(mock);
  });

  it('delivers the questions of an open enabler, without a solution', async () => {
    const { res, body } = await get('e2', 'LOW', {
      target: 'e2',
      targetQuiz: 'q2',
      scores: { q1: 70 },
    });
    expect(res.status).toBe(200);
    expect(body.quiz.questions).toHaveLength(3);
    expect(findSolutionKeys(body)).toEqual([]);
  });

  it('delivers no question of a quiz whose predecessor in the chain was not attempted', async () => {
    const { res, body } = await get('e2', 'MEDIUM', {
      target: 'e2',
      targetQuiz: 'q3',
      scores: { q1: 70 },
    });
    expect(res.status).toBe(403);
    expect(body.code).toBe('QUIZ_LOCKED');
    expect(body.quiz).toBeUndefined();
  });
});

describe('reading stays free: title, material and the list of the quizzes', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

  it('the detail of a locked enabler answers with its material and says that it is locked', async () => {
    const { handler } = await load(
      ENABLER_DETAIL,
      'GET',
      progressionWorld({ target: 'e2' })
    );
    const res = await handler(req(), ctx({ enablerId: 'e2' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.enabler).toMatchObject({
      title: 'Enabler Zwei',
      descriptionText: 'Material text',
    });
    expect(body.progression).toEqual({
      state: 'locked',
      locked: true,
      reason: 'SEQUENCE',
      lockedBy: { id: 'e1', title: 'Enabler Eins' },
    });
  });

  it('the detail of the first enabler is open', async () => {
    const { handler } = await load(
      ENABLER_DETAIL,
      'GET',
      progressionWorld({ target: 'e1' })
    );
    const body = await (await handler(req(), ctx({ enablerId: 'e1' }))).json();
    expect(body.progression).toMatchObject({ state: 'open', locked: false });
  });

  it('the detail of a passed enabler says completed', async () => {
    const { handler } = await load(
      ENABLER_DETAIL,
      'GET',
      progressionWorld({ target: 'e1', scores: { q1: 100 } })
    );
    const body = await (await handler(req(), ctx({ enablerId: 'e1' }))).json();
    expect(body.progression.state).toBe('completed');
  });

  it('lists the quizzes of a locked enabler as locked (titles only) with what to finish first', async () => {
    const { handler } = await load(
      QUIZ_LIST,
      'GET',
      progressionWorld({ target: 'e2', targetQuiz: 'q2' })
    );
    const res = await handler(req(), ctx({ enablerId: 'e2' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.enablerLocked).toBe(true);
    expect(body.lockedBy).toEqual({ id: 'e1', title: 'Enabler Eins' });
    expect(body.quizzes.length).toBeGreaterThan(0);
    expect(body.quizzes.every((q: any) => q.unlocked === false)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('Q?');
  });

  it('lists the chain of an open enabler: LOW open, MEDIUM after an attempt, passed flag', async () => {
    const world = progressionWorld({
      target: 'e2',
      targetQuiz: 'q2',
      scores: { q1: 90, q2: 20 },
    });
    const { handler } = await load(QUIZ_LIST, 'GET', {
      ...world,
      // the links of this enabler only (the mock does not filter)
      enablerQuizLinks: world.enablerQuizLinks.filter(
        l => l.enablerId === 'e2'
      ),
    });
    const body = await (await handler(req(), ctx({ enablerId: 'e2' }))).json();
    const byDifficulty = Object.fromEntries(
      body.quizzes.map((q: any) => [q.difficulty, q])
    );
    expect(byDifficulty.LOW).toMatchObject({
      unlocked: true,
      completed: true,
      passed: false,
    });
    expect(byDifficulty.MEDIUM).toMatchObject({
      unlocked: true,
      completed: false,
    });
    expect(body.enablerLocked).toBe(false);
  });

  it('a quiz with an attempt that passed is flagged passed', async () => {
    const world = progressionWorld({
      target: 'e2',
      targetQuiz: 'q2',
      scores: { q1: 90, q2: 50 },
    });
    const { handler } = await load(QUIZ_LIST, 'GET', {
      ...world,
      enablerQuizLinks: world.enablerQuizLinks.filter(
        l => l.enablerId === 'e2'
      ),
    });
    const body = await (await handler(req(), ctx({ enablerId: 'e2' }))).json();
    expect(body.quizzes.find((q: any) => q.difficulty === 'LOW').passed).toBe(
      true
    );
  });
});
