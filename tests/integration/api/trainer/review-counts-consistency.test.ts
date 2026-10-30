/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  KFBM,
  T1,
  loadScoped,
  scopeReq,
  selectsFrom,
} from '../../../helpers/trainerScope';
import { renderCondition } from '../../../helpers/mockDb';

// KFB-1168, KFB-1172: the dashboard showed open reviews ("Aktion erforderlich")
// but the list behind it was empty. The count was taken over every submission
// of the trainees in scope (no course, no occupation of the content), the list
// only shows the submissions of the trainer's courses and quizzes of the chosen
// occupation. The count and the list now share one filter (the helpers in
// src/lib/trainer/pending-reviews.ts), and the tests read the rendered
// conditions of both routes and compare them. The table mock ignores where().

const API = 'http://localhost/api/trainer';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const traineeRow = {
  id: T1,
  fullName: 'Azubi Eins',
  avatarUrl: null,
  isActive: true,
  organizationId: 'org-1',
};

const tables = () => ({
  profiles: [traineeRow],
  courses: [{ id: 'c1', title: 'Kurs' }],
  courseMembers: [],
  enablers: [{ id: 'e1', courseId: 'c1', title: 'E', scenarioPdfUrl: null }],
  useCases: [{ id: 'u1', courseId: 'c1', title: 'U' }],
  enablerSubmissions: [{ c: 2 }],
  useCaseSubmissions: [{ c: 1 }],
  quizSubmissions: [{ c: 3 }],
});

/** Rendered where() conditions of the selects on one table, one entry per query. */
function rendered(mock: any, table: string) {
  return selectsFrom(mock, table).flatMap(call =>
    (call.where ?? []).map(w => {
      const r = renderCondition(w);
      return `${r.sql} ${JSON.stringify(r.params)}`;
    })
  );
}

async function dashboard(header = 'KFBM') {
  const { mod, mock } = await loadScoped('trainer/dashboard/route', {
    tables: tables(),
  });
  const res = await mod.GET(scopeReq(`${API}/dashboard`, { header }));
  expect(res.status).toBe(200);
  return { mock, body: await res.json() };
}

async function reviews(header = 'KFBM') {
  const { mod, mock } = await loadScoped('trainer/reviews/route', {
    tables: tables(),
  });
  const res = await mod.GET(
    scopeReq(`${API}/reviews?onlyPending=true`, { header })
  );
  expect(res.status).toBe(200);
  return mock;
}

async function quizList(header = 'KFBM') {
  const { mod, mock } = await loadScoped('trainer/quiz-submissions/route', {
    tables: tables(),
  });
  const res = await mod.GET(
    scopeReq(`${API}/quiz-submissions?onlyPending=true`, { header })
  );
  expect(res.status).toBe(200);
  return mock;
}

describe('pending reviews: the count and the list use the same filter', () => {
  it('enabler submissions: the count is limited to the trainer courses like the list', async () => {
    const { mock: dash } = await dashboard();
    const list = await reviews();
    const listWhere = rendered(list, 'enabler_submissions');
    expect(listWhere).toHaveLength(1);
    expect(listWhere[0]).toContain('"enablers"."course_id" in');
    expect(rendered(dash, 'enabler_submissions')).toContain(listWhere[0]);
  });

  it('use case submissions: the count is limited to the trainer courses like the list', async () => {
    const { mock: dash } = await dashboard();
    const list = await reviews();
    const listWhere = rendered(list, 'use_case_submissions');
    expect(listWhere).toHaveLength(1);
    expect(listWhere[0]).toContain('"use_cases"."course_id" in');
    expect(rendered(dash, 'use_case_submissions')).toContain(listWhere[0]);
  });

  it('quiz submissions: the count is limited to the occupation of the quiz like the list', async () => {
    const { mock: dash } = await dashboard();
    const list = await quizList();
    const listWhere = rendered(list, 'quiz_submissions');
    expect(listWhere).toHaveLength(1);
    expect(listWhere[0]).toContain('"quizzes"."training_catalog_id" =');
    expect(rendered(dash, 'quiz_submissions')).toContain(listWhere[0]);
  });

  it('the catalog of the chosen occupation reaches the quiz count', async () => {
    const { mock: dash } = await dashboard('KFBM');
    const quizWhere = rendered(dash, 'quiz_submissions').filter(w =>
      w.includes('training_catalog_id')
    );
    expect(quizWhere.length).toBeGreaterThan(0);
    expect(quizWhere.join()).toContain(KFBM);
  });
});

// WMCNL-2876: a trainer who neither created a course nor is a TRAINER member of it saw
// 0 reviews and could review nothing. The owner decided for the whole organization: the
// courses are those of the catalog scope, and the trainee condition limits whose
// submissions show up.
describe('whole organization: the courses do not depend on the trainer', () => {
  it('the list reads the courses by catalog only, not by creator or membership', async () => {
    const list = await reviews();
    const where = rendered(list, 'courses');
    expect(where).toHaveLength(1);
    expect(where[0]).toContain('"courses"."training_catalog_id"');
    expect(where[0]).not.toContain('created_by_id');
    expect(selectsFrom(list, 'course_members')).toHaveLength(0);
  });

  it('the dashboard counts the reviews over the same courses, not over those of the trainer', async () => {
    const { mock: dash } = await dashboard();
    const where = rendered(dash, 'enabler_submissions');
    expect(where).toHaveLength(1);
    expect(where[0]).toContain('"enablers"."course_id" in');
    // the list of a trainer who has no course at all is not empty any more
    const list = await reviews();
    expect(rendered(list, 'enabler_submissions')).toHaveLength(1);
  });
});

describe('dashboard counts', () => {
  it('reports the pending reviews per kind and their sum', async () => {
    const { body } = await dashboard();
    expect(body.counts.pendingEnablers).toBe(2);
    expect(body.counts.pendingUseCases).toBe(1);
    expect(body.counts.pendingQuiz).toBe(3);
    expect(body.counts.pendingReviews).toBe(6);
  });
});

describe('quiz list', () => {
  it('lists a submission once even if its quiz is linked to several enablers', async () => {
    const row = (enablerTitle: string) => ({
      id: 's1',
      traineeId: T1,
      quizId: 'q1',
      isReviewed: false,
      enablerTitle,
    });
    const { mod } = await loadScoped('trainer/quiz-submissions/route', {
      tables: { quizSubmissions: [row('E1'), row('E2')] },
    });
    const res = await mod.GET(
      scopeReq(`${API}/quiz-submissions?onlyPending=true`, { header: 'KFBM' })
    );
    expect((await res.json()).submissions).toHaveLength(1);
  });
});
