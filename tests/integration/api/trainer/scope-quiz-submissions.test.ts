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
  selectParams,
  selectsFrom,
  superAdminSession,
  trainerSession,
} from '../../../helpers/trainerScope';
import { traineeSession } from '../../../helpers/mockNext';

// /api/trainer/quiz-submissions (list) and /api/trainer/quiz-submissions/[id]
// (review). A trainer only reaches the submissions of trainees of the own
// organization (the super admin of every organization) and, once an occupation
// is chosen, of that occupation. A foreign submission answers like a missing
// one (404) and is never changed.

const LIST = 'trainer/quiz-submissions/route';
const ONE = 'trainer/quiz-submissions/[submissionId]/route';
const URL_LIST = 'http://localhost/api/trainer/quiz-submissions';
const URL_ONE = 'http://localhost/api/trainer/quiz-submissions/bbbbbbb2-0000-4000-8000-000000000002';
const params = { params: Promise.resolve({ submissionId: 'bbbbbbb2-0000-4000-8000-000000000002' }) };

const submission = (overrides: Record<string, unknown> = {}) => ({
  id: 'bbbbbbb2-0000-4000-8000-000000000002',
  traineeId: T1,
  quizId: 'bbbbbbb1-0000-4000-8000-000000000001',
  score: 80,
  isReviewed: false,
  ...overrides,
});
const traineeRow = (organizationId = ORG) => ({
  id: T1,
  role: 'TRAINEE',
  organizationId,
});

describe('GET /api/trainer/quiz-submissions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('limits the list to trainees of the own organization', async () => {
    const { mod, mock } = await loadScoped(LIST, {
      tables: { quizSubmissions: [submission()] },
    });
    const res = await mod.GET(scopeReq(URL_LIST));
    expect(res.status).toBe(200);
    expect((await res.json()).submissions).toHaveLength(1);
    const filter = mock.filters('select', 'quiz_submissions');
    expect(filter.sql).toContain('"quiz_submissions"."trainee_id" in (select');
    expect(filter.sql).toContain('"profiles"."organization_id" = $');
    expect(filter.params).toContain(ORG);
    expect(filter.params).toContain('TRAINEE');
    expect(filter.params).not.toContain(OTHER_ORG);
  });

  it('does not add the trainees of courses of the caller (no cross-organization union)', async () => {
    const { mod, mock } = await loadScoped(LIST, {
      tables: { quizSubmissions: [submission()] },
    });
    await mod.GET(scopeReq(URL_LIST));
    expect(selectsFrom(mock, 'courses')).toHaveLength(0);
    expect(selectsFrom(mock, 'course_members')).toHaveLength(0);
  });

  it('a trainer of the platform organization still only sees the own organization', async () => {
    const { mod, mock } = await loadScoped(LIST, {
      session: trainerSession({ isPlatformOwner: true }),
      tables: { quizSubmissions: [submission()] },
    });
    await mod.GET(scopeReq(URL_LIST));
    expect(selectParams(mock, 'quiz_submissions')).toContain(ORG);
  });

  it('the super admin sees every organization', async () => {
    const { mod, mock } = await loadScoped(LIST, {
      session: superAdminSession(),
      tables: { quizSubmissions: [submission()] },
    });
    const res = await mod.GET(scopeReq(URL_LIST));
    expect(res.status).toBe(200);
    expect(mock.filters('select', 'quiz_submissions').sql).not.toContain(
      'organization_id'
    );
  });

  it('FIAE regression: without a header nothing about occupations is asked', async () => {
    const { mod, mock } = await loadScoped(LIST, {
      tables: { quizSubmissions: [submission()] },
    });
    await mod.GET(scopeReq(URL_LIST));
    expect(selectsFrom(mock, 'trainee_enrollments')).toHaveLength(0);
    expect(mock.filters('select', 'quiz_submissions').sql).not.toContain(
      'trainee_enrollments'
    );
  });

  it('with an occupation (x-catalog) only its trainees', async () => {
    const { mod, mock } = await loadScoped(LIST, {
      tables: { quizSubmissions: [submission()] },
    });
    const res = await mod.GET(scopeReq(URL_LIST, { header: 'KFBM' }));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'quiz_submissions');
    expect(filter.sql).toContain('exists (select 1 from "trainee_enrollments"');
    expect(filter.params).toContain(KFBM);
  });

  it('refuses an occupation the organization has not enabled (403)', async () => {
    const { mod, mock } = await loadScoped(LIST, {
      tables: {
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
        quizSubmissions: [submission()],
      },
    });
    const res = await mod.GET(scopeReq(URL_LIST, { header: 'KFBM' }));
    expect(res.status).toBe(403);
    expect(selectsFrom(mock, 'quiz_submissions')).toHaveLength(0);
  });

  it('a trainee is turned away (403) without reading anything', async () => {
    const { mod, mock } = await loadScoped(LIST, {
      session: traineeSession('t1'),
      tables: { quizSubmissions: [submission()] },
    });
    const res = await mod.GET(scopeReq(URL_LIST));
    expect(res.status).toBe(403);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('an anonymous caller is turned away (401)', async () => {
    const { mod } = await loadScoped(LIST, { session: null });
    expect((await mod.GET(scopeReq(URL_LIST))).status).toBe(401);
  });
});

describe('PATCH /api/trainer/quiz-submissions/[submissionId]', () => {
  beforeEach(() => jest.clearAllMocks());

  const patch = (header?: string) =>
    scopeReq(URL_ONE, {
      header,
      method: 'PATCH',
      body: { is_reviewed: true, trainer_feedback: 'Gut' },
    });

  const quiz = (trainingCatalogId = FIAE) => ({
    id: 'bbbbbbb1-0000-4000-8000-000000000001',
    trainingCatalogId,
  });

  it('reviews the submission of a trainee of the own organization', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      tables: {
        quizSubmissions: [submission()],
        profiles: [traineeRow()],
        quizzes: [quiz()],
      },
      returns: { quizSubmissions: [submission({ isReviewed: true })] },
    });
    const res = await mod.PATCH(patch(), params);
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'quiz_submissions')).toHaveLength(1);
    // the change is bound to the id and to the trainee that was checked
    const where = mock.filters('update', 'quiz_submissions');
    expect(where.sql).toContain('"quiz_submissions"."trainee_id" = $');
    expect(where.params).toContain(T1);
    expect(mock.writes('insert', 'notifications')).toHaveLength(1);
  });

  it('a submission of a trainee of another organization is not found (404) and not changed', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      tables: {
        quizSubmissions: [submission()],
        profiles: [traineeRow(OTHER_ORG)],
        quizzes: [quiz()],
      },
    });
    const res = await mod.PATCH(patch(), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Submission not found' });
    expect(mock.writes('update', 'quiz_submissions')).toEqual([]);
    expect(mock.writes('insert', 'notifications')).toEqual([]);
  });

  it('answers the same for a submission that does not exist', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      tables: { quizSubmissions: [], profiles: [traineeRow()] },
    });
    const res = await mod.PATCH(patch(), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Submission not found' });
    expect(mock.writes('update', 'quiz_submissions')).toEqual([]);
  });

  it('a trainee of the platform organization is no exception for a trainer of that organization', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      session: trainerSession({ isPlatformOwner: true }),
      tables: {
        quizSubmissions: [submission()],
        profiles: [traineeRow(OTHER_ORG)],
        quizzes: [quiz()],
      },
    });
    const res = await mod.PATCH(patch(), params);
    expect(res.status).toBe(404);
    expect(mock.writes('update', 'quiz_submissions')).toEqual([]);
  });

  it('the super admin may review a submission of any organization', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      session: superAdminSession(),
      tables: {
        quizSubmissions: [submission()],
        profiles: [traineeRow(OTHER_ORG)],
        quizzes: [quiz()],
      },
      returns: { quizSubmissions: [submission({ isReviewed: true })] },
    });
    const res = await mod.PATCH(patch(), params);
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'quiz_submissions')).toHaveLength(1);
  });

  it('a trainee of another occupation than the chosen one is not found (404) and not changed', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      tables: {
        quizSubmissions: [submission()],
        // the second lookup is the occupation check, it finds nobody
        profiles: { sequence: [[traineeRow()], []] },
        quizzes: [quiz(KFBM)],
      },
    });
    const res = await mod.PATCH(patch('KFBM'), params);
    expect(res.status).toBe(404);
    expect(mock.writes('update', 'quiz_submissions')).toEqual([]);
  });

  it('a quiz outside the catalogs of the caller is not found (404) and not changed', async () => {
    const { mod, mock } = await loadScoped(ONE, {
      tables: {
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
        quizSubmissions: [submission()],
        profiles: [traineeRow()],
        quizzes: [quiz(KFBM)],
      },
    });
    const res = await mod.PATCH(patch(), params);
    expect(res.status).toBe(404);
    expect(mock.writes('update', 'quiz_submissions')).toEqual([]);
  });

  it('a trainee is turned away (403) and an anonymous caller too (401)', async () => {
    const trainee = await loadScoped(ONE, {
      session: traineeSession('t1'),
      tables: { quizSubmissions: [submission()] },
    });
    expect((await trainee.mod.PATCH(patch(), params)).status).toBe(403);
    expect(trainee.mock.db.select).not.toHaveBeenCalled();
    const anonymous = await loadScoped(ONE, { session: null });
    expect((await anonymous.mod.PATCH(patch(), params)).status).toBe(401);
  });

  it('still asks for something to update (400)', async () => {
    const { mod } = await loadScoped(ONE, {
      tables: { quizSubmissions: [submission()], profiles: [traineeRow()] },
    });
    const res = await mod.PATCH(
      scopeReq(URL_ONE, { method: 'PATCH', body: {} }),
      params
    );
    expect(res.status).toBe(400);
  });
});
