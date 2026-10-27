/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ORG, T1, loadScoped, scopeReq } from '../../../helpers/trainerScope';

// What a trainer sends to PUT and PATCH /api/trainer/evaluations/[id] is
// checked before anything is written, like weekly-evaluations (PR 123 and 129,
// src/lib/input-limits.ts, src/lib/uuid.ts, src/lib/evaluation-input.ts): a body
// that is no JSON object, a grade outside 1 to 6, a criterion that is no uuid or
// does not exist, and texts over the limit (4000 characters for comments, 1000
// for the reason of a change or of a rejection) are a 400. Before, most of them
// ended in a 500 from the database or a TypeError, and an essay went into a
// text column. The order stays: session and scope first, then the body.

const API = 'http://localhost/api/trainer';
const EVAL_ID = 'aaaaaaa2-0000-4000-8000-000000000002';
const CRIT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const UNKNOWN_CRIT = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const trainee = {
  id: T1,
  role: 'TRAINEE',
  organizationId: ORG,
  fullName: 'Azubi Eins',
  email: 'a1@example.com',
};

const evaluation = (status = 'SUBMITTED') => ({
  id: EVAL_ID,
  traineeId: T1,
  status,
  trainerRating: '2',
  releaseRating: '3',
  weekNumber: 1,
  year: 2027,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

type Run = {
  method: 'PUT' | 'PATCH';
  body?: unknown;
  broken?: boolean;
  status?: string;
  evaluations?: unknown[];
};

async function run({
  method,
  body,
  broken = false,
  status = 'SUBMITTED',
  evaluations,
}: Run) {
  const { mod, mock } = await loadScoped('trainer/evaluations/[id]/route', {
    tables: {
      profiles: [trainee],
      weeklyEvaluations: evaluations ?? [evaluation(status)],
      weeklySoftskillRatings: [],
      mesSoftskillCriteria: [{ id: CRIT }],
    },
  });
  const req = scopeReq(`${API}/evaluations/${EVAL_ID}`, { method, body });
  req.json = async () => {
    if (broken) throw new SyntaxError('Unexpected token');
    return body;
  };
  const res = await mod[method](req, {
    params: Promise.resolve({ id: EVAL_ID }),
  });
  return { res, mock };
}

const long = (n: number) => 'a'.repeat(n);
const writesOf = (mock: any) =>
  mock.calls.filter((c: any) => c.op !== 'select').map((c: any) => c.op);
const nothingWritten = (mock: any) => expect(writesOf(mock)).toEqual([]);

describe('PUT /evaluations/[id]: trainer assessment', () => {
  const put = (extra: Record<string, unknown> = {}, over: Partial<Run> = {}) =>
    run({
      method: 'PUT',
      body: {
        trainerRating: '2',
        trainerComment: 'gut',
        softskillRatings: [{ criterionId: CRIT, trainerRating: '2' }],
        ...extra,
      },
      ...over,
    });

  it('accepts a valid request as before', async () => {
    const { res, mock } = await put();
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'weekly_evaluations')).toHaveLength(1);
    expect(mock.writes('insert', 'weekly_softskill_ratings')).toHaveLength(1);
  });

  it('accepts grades as numbers or strings', async () => {
    const { res } = await put({
      trainerRating: 3,
      softskillRatings: [{ criterionId: CRIT, trainerRating: 6 }],
    });
    expect(res.status).toBe(200);
  });

  it('answers 400 for a body that is no JSON, before any write', async () => {
    const { res, mock } = await put({}, { broken: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    nothingWritten(mock);
  });

  it.each([null, 'x', 7, [1]])('answers 400 for the JSON body %p', async b => {
    const { res, mock } = await run({ method: 'PUT', body: b });
    expect(res.status).toBe(400);
    nothingWritten(mock);
  });

  it('keeps the order: an unknown evaluation is a 404 before the body is read', async () => {
    const { res } = await run({
      method: 'PUT',
      broken: true,
      evaluations: [],
    });
    expect(res.status).toBe(404);
  });

  describe('comments and the reason of a change', () => {
    it.each([
      ['trainerComment', 4000],
      ['releaseComment', 4000],
      ['editReason', 1000],
    ])(
      'accepts %s of %i characters and refuses one more',
      async (field, max) => {
        const ok = await put({ [field]: long(max) });
        expect(ok.res.status).toBe(200);

        const bad = await put({ [field]: long(max + 1) });
        expect(bad.res.status).toBe(400);
        expect((await bad.res.json()).error).toContain(field);
        nothingWritten(bad.mock);
      }
    );

    it.each(['trainerComment', 'releaseComment'])(
      'refuses %s of a softskill rating over 4000 characters',
      async field => {
        const { res, mock } = await put({
          softskillRatings: [
            { criterionId: CRIT, trainerRating: '2', [field]: long(4001) },
          ],
        });
        expect(res.status).toBe(400);
        nothingWritten(mock);
      }
    );

    it.each([['x'], 5, { a: 1 }])(
      'refuses a comment that is no text (%p)',
      async value => {
        const { res, mock } = await put({ trainerComment: value });
        expect(res.status).toBe(400);
        nothingWritten(mock);
      }
    );
  });

  describe('grades', () => {
    it.each([
      ['trainerRating', 7],
      ['trainerRating', 'x'],
      ['trainerRating', 0.5],
      ['trainerRating', [1]],
      ['trainerRating', { a: 1 }],
      ['releaseRating', 8],
      ['releaseRating', [2]],
    ])('answers 400 for %s = %p', async (field, value) => {
      const { res, mock } = await put({ [field]: value });
      expect(res.status).toBe(400);
      nothingWritten(mock);
    });

    it.each([
      ['trainerRating', 'x'],
      ['trainerRating', 7],
      ['trainerRating', null],
      ['releaseRating', 9],
    ])('answers 400 for the softskill rating %s = %p', async (field, value) => {
      const { res, mock } = await put({
        softskillRatings: [
          { criterionId: CRIT, trainerRating: '2', [field]: value },
        ],
      });
      expect(res.status).toBe(400);
      nothingWritten(mock);
    });

    it('still asks for the overall rating', async () => {
      const { res, mock } = await run({ method: 'PUT', body: {} });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Trainer rating is required' });
      nothingWritten(mock);
    });

    it('asks for a grade in every softskill rating it saves', async () => {
      const { res, mock } = await put({
        softskillRatings: [{ criterionId: CRIT, trainerComment: 'nur Text' }],
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid trainerRating' });
      nothingWritten(mock);
    });
  });

  describe('softskill ratings', () => {
    it.each(['nope', '1; drop table x', 42, {}, ['x']])(
      'answers 400 for the criterionId %p and writes nothing',
      async criterionId => {
        const { res, mock } = await put({
          softskillRatings: [{ criterionId, trainerRating: '2' }],
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Invalid criterionId' });
        nothingWritten(mock);
      }
    );

    it('answers 400 for a criterion that does not exist and writes nothing, not even the evaluation', async () => {
      const { res, mock } = await put({
        softskillRatings: [{ criterionId: UNKNOWN_CRIT, trainerRating: '2' }],
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Unknown criterionId' });
      nothingWritten(mock);
    });

    it('accepts a criterion id in upper case, uuids are case insensitive', async () => {
      const { res } = await put({
        softskillRatings: [
          { criterionId: CRIT.toUpperCase(), trainerRating: '2' },
        ],
      });
      expect(res.status).toBe(200);
    });

    it('looks the criteria up in one query', async () => {
      const { mock } = await put({
        softskillRatings: [
          { criterionId: CRIT, trainerRating: '2' },
          { criterionId: CRIT, trainerRating: '3' },
        ],
      });
      const lookups = mock.calls.filter(
        (c: any) => c.op === 'select' && c.table === 'mes_softskill_criteria'
      );
      expect(lookups).toHaveLength(1);
    });

    it.each([null, 'x', 5, [1]])(
      'answers 400 for a rating entry that is %p',
      async element => {
        const { res, mock } = await put({ softskillRatings: [element] });
        expect(res.status).toBe(400);
        nothingWritten(mock);
      }
    );

    it('answers 400 for more than 100 ratings', async () => {
      const { res, mock } = await put({
        softskillRatings: Array.from({ length: 101 }, () => ({
          criterionId: CRIT,
          trainerRating: '2',
        })),
      });
      expect(res.status).toBe(400);
      nothingWritten(mock);
    });

    it('ignores softskillRatings that is no list, as before', async () => {
      const { res } = await put({ softskillRatings: 'x' });
      expect(res.status).toBe(200);
    });
  });
});

describe('PUT /evaluations/[id]: release grade edit', () => {
  const edit = (extra: Record<string, unknown> = {}) =>
    run({
      method: 'PUT',
      status: 'APPROVED',
      body: {
        isReleaseEdit: true,
        releaseRating: '1',
        editReason: 'Korrektur',
        ...extra,
      },
    });

  it('accepts a valid release edit as before', async () => {
    const { res, mock } = await edit();
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'grade_edit_history')).toHaveLength(1);
  });

  it('writes no audit row when a numeric grade equals the stored one', async () => {
    // the stored release rating is '3', the request says 3
    const { res, mock } = await edit({ releaseRating: 3 });
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'grade_edit_history')).toEqual([]);
    expect(mock.writes('update', 'weekly_evaluations')[0]).toMatchObject({
      releaseRating: '3',
    });
  });

  it('accepts a release rating of null to clear it, as before', async () => {
    const { res } = await edit({ releaseRating: null });
    expect(res.status).toBe(200);
  });

  it.each([
    ['releaseRating', 0],
    ['releaseRating', ''],
    ['releaseRating', 'x'],
    ['trainerRating', null],
    ['trainerRating', ''],
    ['trainerRating', 0],
    ['trainerRating', 9],
  ])('answers 400 for %s = %p and writes nothing', async (field, value) => {
    const { res, mock } = await edit({ [field]: value });
    expect(res.status).toBe(400);
    nothingWritten(mock);
  });

  it.each([
    ['trainerRating', null],
    ['trainerRating', 'x'],
    ['releaseRating', ''],
    ['releaseRating', 12],
  ])('answers 400 for the softskill rating %s = %p', async (field, value) => {
    const { res, mock } = await edit({
      softskillRatings: [{ criterionId: CRIT, [field]: value }],
    });
    expect(res.status).toBe(400);
    nothingWritten(mock);
  });

  it('accepts a softskill release rating of null, a comment alone and no grade at all', async () => {
    const { res } = await edit({
      softskillRatings: [
        { criterionId: CRIT, releaseRating: null },
        { criterionId: CRIT, releaseComment: 'Text' },
      ],
    });
    expect(res.status).toBe(200);
  });

  it('answers 400 for an unknown criterion and writes nothing', async () => {
    const { res, mock } = await edit({
      softskillRatings: [{ criterionId: UNKNOWN_CRIT, releaseRating: '2' }],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unknown criterionId' });
    nothingWritten(mock);
  });

  it('refuses comments over the limit', async () => {
    const { res, mock } = await edit({ releaseComment: long(4001) });
    expect(res.status).toBe(400);
    nothingWritten(mock);
  });
});

describe('PATCH /evaluations/[id]: approve and reject', () => {
  const patch = (body: unknown, over: Partial<Run> = {}) =>
    run({ method: 'PATCH', body, ...over });

  it('accepts approve and reject as before', async () => {
    expect((await patch({ action: 'approve' })).res.status).toBe(200);
    expect(
      (await patch({ action: 'reject', rejectionReason: 'bitte nachbessern' }))
        .res.status
    ).toBe(200);
    expect(
      (await patch({ action: 'reject', rejectionReason: null })).res.status
    ).toBe(200);
  });

  it('answers 400 for a body that is no JSON, before any write', async () => {
    const { res, mock } = await patch(undefined, { broken: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    nothingWritten(mock);
  });

  it.each([null, 'x', 7, [1]])('answers 400 for the JSON body %p', async b => {
    const { res, mock } = await patch(b);
    expect(res.status).toBe(400);
    nothingWritten(mock);
  });

  it('accepts a rejection reason of 1000 characters and refuses one more', async () => {
    const ok = await patch({ action: 'reject', rejectionReason: long(1000) });
    expect(ok.res.status).toBe(200);

    const bad = await patch({ action: 'reject', rejectionReason: long(1001) });
    expect(bad.res.status).toBe(400);
    expect((await bad.res.json()).error).toContain('rejectionReason');
    nothingWritten(bad.mock);
  });

  it.each([['x'], 5, { a: 1 }])(
    'refuses a rejection reason that is no text (%p)',
    async value => {
      const { res, mock } = await patch({
        action: 'reject',
        rejectionReason: value,
      });
      expect(res.status).toBe(400);
      nothingWritten(mock);
    }
  );

  it.each([undefined, 'delete', 5, ['approve'], { a: 1 }])(
    'still answers 400 for the action %p',
    async action => {
      const { res, mock } = await patch({ action });
      expect(res.status).toBe(400);
      nothingWritten(mock);
    }
  );

  it('keeps the order: an unknown evaluation is a 404 before the body is read', async () => {
    const { res } = await patch(undefined, { broken: true, evaluations: [] });
    expect(res.status).toBe(404);
  });
});
