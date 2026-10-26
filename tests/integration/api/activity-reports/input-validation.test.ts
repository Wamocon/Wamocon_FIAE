/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockCatalogScope,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';

// What a trainer or a trainee sends to the routes of the activity reports is
// checked before anything is read or written: a body that is no JSON, a field
// of the wrong type, a text over the limit (4000 characters for comments, 1000
// for the reason of a change), a grade outside 1 to 6 and a criterion that is
// no uuid or does not exist are all a 400. Before, most of them ended in a 500
// from the database (or a TypeError), and an essay went into a text column.

const ME = '11111111-1111-4111-8111-111111111111';
const TRAINER = '33333333-3333-4333-8333-333333333333';
const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const E1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CRIT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const UNKNOWN_CRIT = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ORG = 'org-1';

const me = traineeSession(ME, { organizationId: ORG });
const trainer = fakeSession({ id: TRAINER, organizationId: ORG });

const traineeProfile = {
  id: ME,
  role: 'TRAINEE',
  organizationId: ORG,
  isPlatformOwner: false,
  startOfTrainingDate: new Date(2026, 7, 1),
  ausbildungDurationYears: 3,
};

const report = {
  id: R1,
  traineeId: ME,
  organizationId: ORG,
  ausbildungsjahr: 1,
  weekNumber: 10,
  year: 2027,
  status: 'SUBMITTED',
  skillSelfRatings: null,
};

const tables = () => ({
  activityReports: [report],
  profiles: [traineeProfile],
  activityReportUseCaseEntries: [{ id: E1, reportId: R1, trainerGrade: null }],
  weeklyEvaluations: [],
  weeklySoftskillRatings: [],
  mesSoftskillCriteria: [{ id: CRIT }],
});

async function load(
  route: string,
  session: ReturnType<typeof fakeSession>,
  rows: Record<string, any> = tables()
) {
  jest.resetModules();
  mockSession(session);
  mockCatalogScope();
  const mock = createTableDb(rows);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import(`@/app/api/${route}/route`);
  return { mod, mock };
}

/** A request whose body is the given value, or not JSON at all. */
const request = (
  method: string,
  url: string,
  body: unknown,
  broken = false
) => {
  const req = makeRequest(method, `http://localhost${url}`, {
    token: 'tok',
    body,
  });
  if (broken) {
    req.json = async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    };
    req.text = async () => '{"broken';
  }
  return req;
};
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

const nothingTouched = (mock: ReturnType<typeof createTableDb>) => {
  expect(mock.db.select).not.toHaveBeenCalled();
  expect(mock.db.insert).not.toHaveBeenCalled();
  expect(mock.db.update).not.toHaveBeenCalled();
  expect(mock.db.delete).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const long = (n: number) => 'x'.repeat(n);

// ---------------------------------------------------------------------------
describe('PATCH /api/activity-reports/[id]/entries', () => {
  const url = `/api/activity-reports/${R1}/entries`;
  const patch = (body: unknown, broken = false) =>
    request('PATCH', url, body, broken);
  const grade = (extra: Record<string, unknown> = {}) => ({
    entryId: E1,
    grade: 2,
    comment: 'gut',
    ...extra,
  });

  it('answers 400 for a body that is no JSON and reads nothing', async () => {
    const { mod, mock } = await load('activity-reports/[id]/entries', trainer);
    const res = await mod.PATCH(patch(undefined, true), withId(R1));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    // the session layer is mocked, so no query at all is made by the route
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it.each([null, 'x', 7, [1]])(
    'answers 400 for the JSON body %p',
    async body => {
      const { mod, mock } = await load(
        'activity-reports/[id]/entries',
        trainer
      );
      const res = await mod.PATCH(patch(body), withId(R1));
      expect(res.status).toBe(400);
      expect(mock.db.update).not.toHaveBeenCalled();
    }
  );

  it.each([null, 5, 'x', [1]])(
    'answers 400 for an entry of the list that is %p',
    async element => {
      const { mod, mock } = await load(
        'activity-reports/[id]/entries',
        trainer
      );
      const res = await mod.PATCH(
        patch({ entryGrades: [element] }),
        withId(R1)
      );
      expect(res.status).toBe(400);
      expect(mock.db.update).not.toHaveBeenCalled();
    }
  );

  it('answers 400 for a list longer than 200 entries', async () => {
    const { mod, mock } = await load('activity-reports/[id]/entries', trainer);
    const res = await mod.PATCH(
      patch({ entryGrades: Array.from({ length: 201 }, () => grade()) }),
      withId(R1)
    );
    expect(res.status).toBe(400);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('accepts a comment of 4000 characters and refuses 4001', async () => {
    const ok = await load('activity-reports/[id]/entries', trainer);
    const accepted = await ok.mod.PATCH(
      patch({ entryGrades: [grade({ comment: long(4000) })] }),
      withId(R1)
    );
    expect(accepted.status).toBe(200);

    const bad = await load('activity-reports/[id]/entries', trainer);
    const refused = await bad.mod.PATCH(
      patch({ entryGrades: [grade({ comment: long(4001) })] }),
      withId(R1)
    );
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/comment .* 4000/);
    expect(bad.mock.db.update).not.toHaveBeenCalled();
  });

  it('answers 400 for a comment that is no text', async () => {
    const { mod, mock } = await load('activity-reports/[id]/entries', trainer);
    const res = await mod.PATCH(
      patch({ entryGrades: [grade({ comment: { a: 1 } })] }),
      withId(R1)
    );
    expect(res.status).toBe(400);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('accepts a reason of 1000 characters and refuses 1001', async () => {
    const ok = await load('activity-reports/[id]/entries', trainer);
    expect(
      (
        await ok.mod.PATCH(
          patch({ entryGrades: [grade()], editReason: long(1000) }),
          withId(R1)
        )
      ).status
    ).toBe(200);

    const bad = await load('activity-reports/[id]/entries', trainer);
    const refused = await bad.mod.PATCH(
      patch({ entryGrades: [grade()], editReason: long(1001) }),
      withId(R1)
    );
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/editReason .* 1000/);
    expect(bad.mock.db.update).not.toHaveBeenCalled();
  });

  it('answers 400 for a reason that is no text', async () => {
    const { mod } = await load('activity-reports/[id]/entries', trainer);
    const res = await mod.PATCH(
      patch({ entryGrades: [grade()], editReason: 12 }),
      withId(R1)
    );
    expect(res.status).toBe(400);
  });

  it('keeps answering 400 for a grade outside 1 to 6', async () => {
    const { mod } = await load('activity-reports/[id]/entries', trainer);
    const res = await mod.PATCH(
      patch({ entryGrades: [grade({ grade: 9 })] }),
      withId(R1)
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/weekly-evaluations', () => {
  const post = (body: unknown, broken = false) =>
    request('POST', '/api/weekly-evaluations', body, broken);
  const base = (extra: Record<string, unknown> = {}) => ({
    activityReportId: R1,
    trainerRating: 2,
    softskillRatings: [{ criterionId: CRIT, trainerRating: 2 }],
    ...extra,
  });

  it('accepts a valid request as before', async () => {
    const { mod, mock } = await load('weekly-evaluations', trainer);
    const res = await mod.POST(post(base()));
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'weekly_evaluations')).toHaveLength(1);
    expect(mock.writes('insert', 'weekly_softskill_ratings')).toHaveLength(1);
  });

  it('answers 400 for a body that is no JSON, before any query', async () => {
    const { mod, mock } = await load('weekly-evaluations', trainer);
    const res = await mod.POST(post(undefined, true));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    nothingTouched(mock);
  });

  it.each([null, 'x', 7, [1]])(
    'answers 400 for the JSON body %p',
    async body => {
      const { mod, mock } = await load('weekly-evaluations', trainer);
      expect((await mod.POST(post(body))).status).toBe(400);
      nothingTouched(mock);
    }
  );

  describe('comments and the reason of a change', () => {
    it.each([
      ['trainerComment', 4000],
      ['releaseComment', 4000],
      ['editReason', 1000],
    ])(
      'accepts %s of %i characters and refuses one more',
      async (field, max) => {
        const ok = await load('weekly-evaluations', trainer);
        expect(
          (await ok.mod.POST(post(base({ [field]: long(max) })))).status
        ).toBe(200);

        const bad = await load('weekly-evaluations', trainer);
        const refused = await bad.mod.POST(
          post(base({ [field]: long(max + 1) }))
        );
        expect(refused.status).toBe(400);
        expect((await refused.json()).error).toContain(field);
        nothingTouched(bad.mock);
      }
    );

    it.each(['trainerComment', 'releaseComment'])(
      'refuses %s of a softskill rating over 4000 characters',
      async field => {
        const { mod, mock } = await load('weekly-evaluations', trainer);
        const res = await mod.POST(
          post(
            base({
              softskillRatings: [
                { criterionId: CRIT, trainerRating: 2, [field]: long(4001) },
              ],
            })
          )
        );
        expect(res.status).toBe(400);
        nothingTouched(mock);
      }
    );

    it('refuses a comment that is no text', async () => {
      const { mod, mock } = await load('weekly-evaluations', trainer);
      expect(
        (await mod.POST(post(base({ trainerComment: ['x'] })))).status
      ).toBe(400);
      nothingTouched(mock);
    });
  });

  describe('softskill ratings', () => {
    it.each(['nope', '1; drop table x', 42, {}, ['x']])(
      'answers 400 for the criterionId %p and writes nothing',
      async criterionId => {
        const { mod, mock } = await load('weekly-evaluations', trainer);
        const res = await mod.POST(
          post(base({ softskillRatings: [{ criterionId, trainerRating: 2 }] }))
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Invalid criterionId' });
        nothingTouched(mock);
      }
    );

    it('answers 400 for a criterion that does not exist and creates no evaluation', async () => {
      const { mod, mock } = await load('weekly-evaluations', trainer);
      const res = await mod.POST(
        post(
          base({
            softskillRatings: [{ criterionId: UNKNOWN_CRIT, trainerRating: 2 }],
          })
        )
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Unknown criterionId' });
      expect(mock.writes('insert', 'weekly_evaluations')).toEqual([]);
      expect(mock.writes('insert', 'weekly_softskill_ratings')).toEqual([]);
    });

    it('looks the criteria up in one query', async () => {
      const { mod, mock } = await load('weekly-evaluations', trainer);
      await mod.POST(
        post(
          base({
            softskillRatings: [
              { criterionId: CRIT, trainerRating: 2 },
              { criterionId: CRIT, trainerRating: 3 },
            ],
          })
        )
      );
      const lookups = mock.calls.filter(
        c => c.op === 'select' && c.table === 'mes_softskill_criteria'
      );
      expect(lookups).toHaveLength(1);
    });

    it.each([null, 'x', 5, [1]])(
      'answers 400 for a rating entry that is %p',
      async element => {
        const { mod, mock } = await load('weekly-evaluations', trainer);
        const res = await mod.POST(post(base({ softskillRatings: [element] })));
        expect(res.status).toBe(400);
        nothingTouched(mock);
      }
    );

    it('still skips an entry without a criterionId', async () => {
      const { mod } = await load('weekly-evaluations', trainer);
      const res = await mod.POST(
        post(base({ softskillRatings: [{ trainerRating: 2 }] }))
      );
      expect(res.status).toBe(200);
    });

    it('answers 400 for more than 100 ratings', async () => {
      const { mod, mock } = await load('weekly-evaluations', trainer);
      const res = await mod.POST(
        post(
          base({
            softskillRatings: Array.from({ length: 101 }, () => ({
              criterionId: CRIT,
              trainerRating: 2,
            })),
          })
        )
      );
      expect(res.status).toBe(400);
      nothingTouched(mock);
    });
  });

  describe('grades', () => {
    it.each([
      ['trainerRating', 7],
      ['trainerRating', 'x'],
      ['trainerRating', 0.5],
      ['releaseRating', 8],
    ])('answers 400 for %s = %p', async (field, value) => {
      const { mod, mock } = await load('weekly-evaluations', trainer);
      const res = await mod.POST(post(base({ [field]: value })));
      expect(res.status).toBe(400);
      nothingTouched(mock);
    });

    it.each([
      ['trainerRating', 'x'],
      ['trainerRating', 7],
      ['releaseRating', 9],
    ])('answers 400 for the softskill rating %s = %p', async (field, value) => {
      const { mod, mock } = await load('weekly-evaluations', trainer);
      const res = await mod.POST(
        post(
          base({
            softskillRatings: [{ criterionId: CRIT, [field]: value }],
          })
        )
      );
      expect(res.status).toBe(400);
      nothingTouched(mock);
    });

    it.each([1, 6, '1', '6', undefined, null])(
      'accepts the grade %p',
      async value => {
        const { mod } = await load('weekly-evaluations', trainer);
        const res = await mod.POST(
          post(
            base({
              trainerRating: value,
              softskillRatings: [{ criterionId: CRIT, trainerRating: value }],
            })
          )
        );
        expect(res.status).toBe(200);
      }
    );
  });
});

// ---------------------------------------------------------------------------
describe('PATCH /api/activity-reports/[id]/skill-ratings', () => {
  const url = `/api/activity-reports/${R1}/skill-ratings`;
  const patch = (body: unknown, broken = false) =>
    request('PATCH', url, body, broken);

  it('answers 400 for a body that is no JSON, before any query', async () => {
    const { mod, mock } = await load('activity-reports/[id]/skill-ratings', me);
    const res = await mod.PATCH(patch(undefined, true), withId(R1));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    nothingTouched(mock);
  });

  it.each([null, 'x', 7, [1]])(
    'answers 400 for the JSON body %p',
    async body => {
      const { mod, mock } = await load(
        'activity-reports/[id]/skill-ratings',
        me
      );
      expect((await mod.PATCH(patch(body), withId(R1))).status).toBe(400);
      nothingTouched(mock);
    }
  );

  it.each([[['1', '2']], 'x', 5])(
    'answers 400 for skillSelfRatings that is %p',
    async value => {
      const { mod, mock } = await load(
        'activity-reports/[id]/skill-ratings',
        me
      );
      const res = await mod.PATCH(
        patch({ skillSelfRatings: value }),
        withId(R1)
      );
      expect(res.status).toBe(400);
      nothingTouched(mock);
    }
  );

  it('still stores valid self ratings', async () => {
    const { mod, mock } = await load('activity-reports/[id]/skill-ratings', me);
    const res = await mod.PATCH(
      patch({ skillSelfRatings: { FACHKOMPETENZ: '2' } }),
      withId(R1)
    );
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'activity_reports')).toHaveLength(1);
  });

  it('keeps answering 400 for a grade outside 1 to 6', async () => {
    const { mod } = await load('activity-reports/[id]/skill-ratings', me);
    const res = await mod.PATCH(
      patch({ skillSelfRatings: { FACHKOMPETENZ: '9' } }),
      withId(R1)
    );
    expect(res.status).toBe(400);
  });
});
