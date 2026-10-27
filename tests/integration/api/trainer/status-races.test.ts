/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ORG, T1, loadScoped, scopeReq } from '../../../helpers/trainerScope';

// Two trainers (or a double click) can act on the same record at the same
// time. The route reads the status, decides, and writes. Without the status in
// the where() of the write the second call overwrites the first one, writes
// its audit rows and sends its notification as if it had won. The write has to
// carry the status the decision was made on; if it changed nothing the route
// answers 409 and does nothing else (model: trainer/activity-reports/[id]).

const API = 'http://localhost/api/trainer';
const EVAL_ID = 'aaaaaaa2-0000-4000-8000-000000000002';
const SUB_ID = 'aaaaaaa5-0000-4000-8000-000000000005';
const ENABLER = 'aaaaaaa6-0000-4000-8000-000000000006';
const USE_CASE = 'aaaaaaa7-0000-4000-8000-000000000007';
const CRIT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const FIAE = '00000000-0000-4000-8000-000000000001';

const trainee = {
  id: T1,
  role: 'TRAINEE',
  organizationId: ORG,
  fullName: 'Azubi Eins',
  email: 'a1@example.com',
};

const evaluation = (status: string, extra: Record<string, unknown> = {}) => ({
  id: EVAL_ID,
  traineeId: T1,
  status,
  trainerRating: '2',
  releaseRating: '3',
  weekNumber: 1,
  year: 2027,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

type EvalCall = {
  method: 'PUT' | 'PATCH';
  body: Record<string, unknown>;
  status: string;
  ratings?: unknown[];
};

async function evalRoute(call: EvalCall, lost: boolean) {
  const { mod, mock } = await loadScoped('trainer/evaluations/[id]/route', {
    tables: {
      profiles: [trainee],
      weeklyEvaluations: [evaluation(call.status)],
      weeklySoftskillRatings: call.ratings ?? [],
      mesSoftskillCriteria: [{ id: CRIT }],
    },
    // a write that matches no row returns nothing
    returns: lost ? { weeklyEvaluations: [] } : undefined,
  });
  const res = await mod[call.method](
    scopeReq(`${API}/evaluations/${EVAL_ID}`, {
      method: call.method,
      body: call.body,
    }),
    { params: Promise.resolve({ id: EVAL_ID }) }
  );
  return { res, mock };
}

describe('PUT /evaluations/[id]: trainer assessment', () => {
  const call: EvalCall = {
    method: 'PUT',
    status: 'SUBMITTED',
    body: {
      trainerRating: '1',
      trainerComment: 'gut',
      softskillRatings: [{ criterionId: CRIT, trainerRating: '2' }],
    },
  };

  it('carries the status it read into the where()', async () => {
    const { res, mock } = await evalRoute(call, false);
    expect(res.status).toBe(200);
    const where = mock.filters('update', 'weekly_evaluations');
    expect(where.sql).toContain('"weekly_evaluations"."status" = $');
    expect(where.params).toContain('SUBMITTED');
  });

  it('answers 409 and touches no softskill rating when the evaluation was approved meanwhile', async () => {
    const { res, mock } = await evalRoute(call, true);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Evaluation was changed in the meantime',
    });
    expect(mock.writes('insert', 'weekly_softskill_ratings')).toEqual([]);
    expect(mock.writes('update', 'weekly_softskill_ratings')).toEqual([]);
  });
});

describe('PUT /evaluations/[id]: release grade edit', () => {
  const call: EvalCall = {
    method: 'PUT',
    status: 'APPROVED',
    body: { isReleaseEdit: true, releaseRating: '1', editReason: 'Korrektur' },
  };

  it('carries the status it read into the where()', async () => {
    const { res, mock } = await evalRoute(call, false);
    expect(res.status).toBe(200);
    const where = mock.filters('update', 'weekly_evaluations');
    expect(where.sql).toContain('"weekly_evaluations"."status" = $');
    expect(where.params).toContain('APPROVED');
  });

  it('writes the audit row for a change that took place', async () => {
    const { mock } = await evalRoute(call, false);
    expect(mock.writes('insert', 'grade_edit_history')).toHaveLength(1);
  });

  it('answers 409 and writes no audit row for a change that did not take place', async () => {
    const { res, mock } = await evalRoute(call, true);
    expect(res.status).toBe(409);
    expect(mock.writes('insert', 'grade_edit_history')).toEqual([]);
  });
});

describe('PATCH /evaluations/[id]: approve and reject', () => {
  const approve: EvalCall = {
    method: 'PATCH',
    status: 'SUBMITTED',
    body: { action: 'approve' },
  };

  it('carries the status it read into the where()', async () => {
    const { res, mock } = await evalRoute(approve, false);
    expect(res.status).toBe(200);
    const where = mock.filters('update', 'weekly_evaluations');
    expect(where.sql).toContain('"weekly_evaluations"."status" = $');
    expect(where.params).toContain('SUBMITTED');
    expect(mock.writes('insert', 'notifications')).toHaveLength(1);
  });

  it.each([
    ['approve', { action: 'approve' }],
    ['reject', { action: 'reject', rejectionReason: 'bitte nachbessern' }],
  ])(
    'answers 409 and sends no notification when the %s lost the race',
    async (_name, body) => {
      const { res, mock } = await evalRoute(
        { method: 'PATCH', status: 'SUBMITTED', body },
        true
      );
      expect(res.status).toBe(409);
      expect(mock.writes('insert', 'notifications')).toEqual([]);
    }
  );
});

describe('PATCH /reviews/*: feedback on a submission', () => {
  const cases = [
    {
      name: 'enablers',
      route: 'trainer/reviews/enablers/[submissionId]/route',
      table: 'enabler_submissions',
      tables: {
        enablerSubmissions: [
          { id: SUB_ID, enablerId: ENABLER, traineeId: T1, status: 'PENDING' },
        ],
        enablers: [{ id: ENABLER, trainingCatalogId: FIAE }],
      },
      returnKey: 'enablerSubmissions',
      row: { id: SUB_ID, enablerId: ENABLER, traineeId: T1 },
    },
    {
      name: 'use-cases',
      route: 'trainer/reviews/use-cases/[submissionId]/route',
      table: 'use_case_submissions',
      tables: {
        useCaseSubmissions: [
          { id: SUB_ID, useCaseId: USE_CASE, traineeId: T1, status: 'PENDING' },
        ],
        useCases: [{ id: USE_CASE, trainingCatalogId: FIAE }],
      },
      returnKey: 'useCaseSubmissions',
      row: { id: SUB_ID, useCaseId: USE_CASE, traineeId: T1 },
    },
  ];

  describe.each(cases)('$name', entry => {
    async function patch(body: unknown, lost = false) {
      const { mod, mock } = await loadScoped(entry.route, {
        tables: { profiles: [trainee], ...entry.tables },
        returns: { [entry.returnKey]: lost ? [] : [entry.row] },
      });
      const res = await mod.PATCH(
        scopeReq(`${API}/reviews/${entry.name}/${SUB_ID}`, {
          method: 'PATCH',
          body,
        }),
        { params: Promise.resolve({ submissionId: SUB_ID }) }
      );
      return { res, mock };
    }

    it('carries the status it read into the where()', async () => {
      const { res, mock } = await patch({ status: 'APPROVED' });
      expect(res.status).toBe(200);
      const where = mock.filters('update', entry.table);
      expect(where.sql).toContain(`"${entry.table}"."status" = $`);
      expect(where.params).toContain('PENDING');
    });

    it('answers 409 and sends no notification when another review came first', async () => {
      const { res, mock } = await patch({ status: 'APPROVED' }, true);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: 'Submission was changed in the meantime',
      });
      expect(mock.writes('insert', 'notifications')).toEqual([]);
    });

    it.each(['DONE', '', 5, null, {}])(
      'answers 400 for the status %p and changes nothing',
      async status => {
        const { res, mock } = await patch({ status });
        expect(res.status).toBe(400);
        expect(mock.writes('update', entry.table)).toEqual([]);
      }
    );

    it.each(['PENDING', 'APPROVED', 'REJECTED'])(
      'accepts the status %s',
      async status => {
        const { res } = await patch({ status });
        expect(res.status).toBe(200);
      }
    );
  });
});
