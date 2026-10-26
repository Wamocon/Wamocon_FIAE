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
  T2,
  loadScoped,
  scopeReq,
  selectParams,
  superAdminSession,
  trainerSession,
} from '../../../helpers/trainerScope';
import { traineeSession } from '../../../helpers/mockNext';

// Routes that hand out trainees (quiz assignments, course members) or bundle
// the certificates of many trainees. Only trainees of the caller's
// organization (the super admin: any) and of the chosen occupation can be
// reached, a foreign person answers like an unknown one (404) and nothing is
// created, replaced or deleted for them.

const API = 'http://localhost/api/trainer';
const platformTrainer = () => trainerSession({ isPlatformOwner: true });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('POST /api/trainer/quizzes: assigned trainees', () => {
  const route = 'trainer/quizzes/route';
  const post = (ids: unknown[], header?: string) =>
    scopeReq(`${API}/quizzes`, {
      header,
      method: 'POST',
      body: { title: 'Q1', quiz_type: 'big', assigned_trainee_ids: ids },
    });

  it('assigns trainees of the own organization', async () => {
    const { mod, mock } = await loadScoped(route, {
      session: platformTrainer(),
      tables: { profiles: [{ id: T1 }] },
    });
    const res = await mod.POST(post([T1]));
    expect(res.status).toBe(201);
    expect(mock.writes('insert', 'quiz_assignments')).toHaveLength(1);
    expect(selectParams(mock, 'profiles')).toContain(ORG);
  });

  it('refuses a trainee of another organization (404) before the quiz is created', async () => {
    // the database finds nobody for the scope of the caller
    const { mod, mock } = await loadScoped(route, {
      session: platformTrainer(),
      tables: { profiles: [] },
    });
    const res = await mod.POST(post([T1]));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Trainee not found' });
    expect(mock.writes('insert', 'quizzes')).toEqual([]);
    expect(mock.writes('insert', 'quiz_assignments')).toEqual([]);
    expect(mock.writes('insert', 'notifications')).toEqual([]);
  });

  it('refuses an id that is no uuid without asking the database', async () => {
    const { mod, mock } = await loadScoped(route, {
      session: platformTrainer(),
      tables: { profiles: [{ id: T1 }] },
    });
    const res = await mod.POST(post(["x' or 1=1 --"]));
    expect(res.status).toBe(404);
    expect(mock.writes('insert', 'quizzes')).toEqual([]);
  });

  it('with an occupation (x-catalog) only its trainees can be assigned', async () => {
    const { mod, mock } = await loadScoped(route, {
      session: platformTrainer(),
      tables: { profiles: [{ id: T1 }] },
    });
    await mod.POST(post([T1], 'KFBM'));
    expect(mock.filters('select', 'profiles').sql).toContain(
      'exists (select 1 from "trainee_enrollments"'
    );
    expect(selectParams(mock, 'profiles')).toContain(KFBM);
  });

  it('the super admin may assign trainees of any organization', async () => {
    const { mod, mock } = await loadScoped(route, {
      // (the curriculum is managed by the platform organization)
      session: { ...superAdminSession(), isPlatformOwner: true },
      tables: { profiles: [{ id: T1 }, { id: T2 }] },
    });
    const res = await mod.POST(post([T1, T2]));
    expect(res.status).toBe(201);
    expect(mock.filters('select', 'profiles').sql).not.toContain(
      'organization_id'
    );
  });

  it('a quiz without assignments asks nothing about trainees', async () => {
    const { mod, mock } = await loadScoped(route, {
      session: platformTrainer(),
    });
    const res = await mod.POST(post([]));
    expect(res.status).toBe(201);
    expect(mock.calls.filter(c => c.table === 'profiles')).toHaveLength(0);
  });
});

describe('GET and PATCH /api/trainer/quizzes/[quizId]: assignments', () => {
  const route = 'trainer/quizzes/[quizId]/route';
  const params = { params: Promise.resolve({ quizId: 'q1' }) };
  const quiz = {
    id: 'q1',
    title: 'Q1',
    isActive: true,
    quizType: 'GLOBAL',
    trainingCatalogId: FIAE,
  };
  const tables = (extra: Record<string, any> = {}) => ({
    quizzes: [quiz],
    questions: [],
    options: [],
    quizAssignments: [{ traineeId: T1 }],
    ...extra,
  });

  it('GET lists only the assignments of trainees inside the scope', async () => {
    const { mod, mock } = await loadScoped(route, { tables: tables() });
    const res = await mod.GET(scopeReq(`${API}/quizzes/q1`), params);
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'quiz_assignments');
    expect(filter.sql).toContain('"quiz_assignments"."trainee_id" in (select');
    expect(filter.params).toContain(ORG);
    expect(filter.params).not.toContain(OTHER_ORG);
  });

  it('GET with an occupation lists only the assignments of its trainees', async () => {
    const { mod, mock } = await loadScoped(route, { tables: tables() });
    await mod.GET(scopeReq(`${API}/quizzes/q1`, { header: 'KFBM' }), params);
    expect(mock.filters('select', 'quiz_assignments').params).toContain(KFBM);
  });

  const patch = (ids: unknown[]) =>
    scopeReq(`${API}/quizzes/q1`, {
      method: 'PATCH',
      body: { assigned_trainee_ids: ids },
    });

  it('PATCH replaces only the assignments inside the scope and keeps the others', async () => {
    const { mod, mock } = await loadScoped(route, {
      session: platformTrainer(),
      tables: tables({ profiles: [{ id: T1 }] }),
    });
    const res = await mod.PATCH(patch([T1]), params);
    expect(res.status).toBe(200);
    const del = mock.filters('delete', 'quiz_assignments');
    expect(del.sql).toContain('"quiz_assignments"."trainee_id" in (select');
    expect(del.params).toContain(ORG);
    expect(mock.filters('select', 'quiz_assignments').sql).toContain(
      'in (select'
    );
    expect(mock.writes('insert', 'quiz_assignments')).toHaveLength(1);
  });

  it('PATCH refuses a trainee of another organization (404) and changes nothing', async () => {
    const { mod, mock } = await loadScoped(route, {
      session: platformTrainer(),
      tables: tables({ profiles: [] }),
    });
    const res = await mod.PATCH(patch([T1]), params);
    expect(res.status).toBe(404);
    expect(
      mock.calls.filter(c => c.op !== 'select' && c.table !== null)
    ).toEqual([]);
  });

  it('PATCH of a trainer of the platform organization is no exception', async () => {
    const { mod, mock } = await loadScoped(route, {
      session: platformTrainer(),
      tables: tables({ profiles: [{ id: T1 }] }),
    });
    await mod.PATCH(patch([T1]), params);
    expect(selectParams(mock, 'profiles')).toContain(ORG);
  });
});

describe('/api/trainer/courses/[courseId]/members', () => {
  const route = 'trainer/courses/[courseId]/members/route';
  const params = { params: Promise.resolve({ courseId: 'c1' }) };
  const base = {
    courses: [{ id: 'c1', title: 'Kurs', trainingCatalogId: FIAE }],
  };
  const url = `${API}/courses/c1/members`;

  it('GET lists only members of the own organization', async () => {
    const { mod, mock } = await loadScoped(route, {
      tables: { ...base, courseMembers: [] },
    });
    const res = await mod.GET(scopeReq(url), params);
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'course_members');
    expect(filter.sql).toContain('"profiles"."organization_id" = $');
    expect(filter.params).toContain(ORG);
  });

  it('GET of a trainer of the platform organization is no exception', async () => {
    const { mod, mock } = await loadScoped(route, {
      session: platformTrainer(),
      tables: { ...base, courseMembers: [] },
    });
    await mod.GET(scopeReq(url), params);
    expect(selectParams(mock, 'course_members')).toContain(ORG);
  });

  it('GET lets the super admin see the members of every organization', async () => {
    const { mod, mock } = await loadScoped(route, {
      session: superAdminSession(),
      tables: { ...base, courseMembers: [] },
    });
    await mod.GET(scopeReq(url), params);
    expect(mock.filters('select', 'course_members').sql).not.toContain(
      'organization_id'
    );
  });

  const add = (userId: string, role = 'TRAINEE') =>
    scopeReq(url, { method: 'POST', body: { userId, role } });

  it('POST adds a person of the own organization', async () => {
    const { mod, mock } = await loadScoped(route, {
      tables: {
        ...base,
        profiles: [{ id: T1, role: 'TRAINEE', organizationId: ORG }],
        courseMembers: [],
      },
    });
    const res = await mod.POST(add(T1), params);
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'course_members')).toHaveLength(1);
  });

  it('POST refuses a person of another organization (404) like an unknown one', async () => {
    const foreign = await loadScoped(route, {
      tables: {
        ...base,
        profiles: [{ id: T1, role: 'TRAINEE', organizationId: OTHER_ORG }],
        courseMembers: [],
      },
    });
    const a = await foreign.mod.POST(add(T1), params);
    expect(a.status).toBe(404);
    expect(foreign.mock.writes('insert', 'course_members')).toEqual([]);
    expect(foreign.mock.writes('insert', 'notifications')).toEqual([]);
    const unknown = await loadScoped(route, {
      tables: { ...base, profiles: [], courseMembers: [] },
    });
    const b = await unknown.mod.POST(add(T1), params);
    expect(await a.json()).toEqual(await b.json());
  });

  it('POST of a trainer of the platform organization is no exception', async () => {
    const { mod, mock } = await loadScoped(route, {
      session: platformTrainer(),
      tables: {
        ...base,
        profiles: [{ id: T1, role: 'TRAINEE', organizationId: OTHER_ORG }],
        courseMembers: [],
      },
    });
    expect((await mod.POST(add(T1), params)).status).toBe(404);
    expect(mock.writes('insert', 'course_members')).toEqual([]);
  });

  it('POST lets the super admin add a person of any organization', async () => {
    const { mod } = await loadScoped(route, {
      session: superAdminSession(),
      tables: {
        ...base,
        profiles: [{ id: T1, role: 'TRAINEE', organizationId: OTHER_ORG }],
        courseMembers: [],
      },
    });
    expect((await mod.POST(add(T1), params)).status).toBe(200);
  });

  const remove = scopeReq(`${url}?userId=${T1}`, { method: 'DELETE' });
  const member = [{ courseId: 'c1', userId: T1, role: 'TRAINEE' }];

  it('DELETE removes a member of the own organization', async () => {
    const { mod, mock } = await loadScoped(route, {
      tables: {
        ...base,
        courseMembers: member,
        profiles: [{ organizationId: ORG }],
      },
    });
    const res = await mod.DELETE(remove, params);
    expect(res.status).toBe(200);
    expect(
      mock.calls.some(c => c.op === 'delete' && c.table === 'course_members')
    ).toBe(true);
  });

  it('DELETE does not remove a member of another organization (404)', async () => {
    const { mod, mock } = await loadScoped(route, {
      tables: {
        ...base,
        courseMembers: member,
        profiles: [{ organizationId: OTHER_ORG }],
      },
    });
    const res = await mod.DELETE(remove, params);
    expect(res.status).toBe(404);
    expect(mock.calls.some(c => c.op === 'delete')).toBe(false);
    expect(mock.writes('insert', 'notifications')).toEqual([]);
  });
});

describe('certificates of many trainees', () => {
  const certificate = { id: 'cert1', traineeId: T1, snapshotData: {} };

  describe.each([
    [
      'GET /arbeitszeugnis/certificates/all',
      'trainer/arbeitszeugnis/certificates/all/route',
      'GET',
    ],
    [
      'POST /arbeitszeugnis/regenerate',
      'trainer/arbeitszeugnis/regenerate/route',
      'POST',
    ],
  ])('%s', (_name, route, method) => {
    const call = (header?: string) =>
      scopeReq(`${API}/arbeitszeugnis/x`, { header, method, body: {} });
    const tables = { workCertificates: [], profiles: [] };

    it('limits the certificates to trainees of the own organization', async () => {
      const { mod, mock } = await loadScoped(route, { tables });
      const res = await mod[method](call());
      expect(res.status).toBe(200);
      const filter = mock.filters('select', 'work_certificates');
      expect(filter.sql).toContain('"profiles"."organization_id" = $');
      expect(filter.sql).toContain('"profiles"."role" = $');
      expect(filter.params).toContain(ORG);
    });

    it('a trainer of the platform organization is no exception', async () => {
      const { mod, mock } = await loadScoped(route, {
        session: platformTrainer(),
        tables,
      });
      await mod[method](call());
      expect(selectParams(mock, 'work_certificates')).toContain(ORG);
    });

    it('with an occupation (x-catalog) only the certificates of its trainees', async () => {
      const { mod, mock } = await loadScoped(route, { tables });
      await mod[method](call('KFBM'));
      const filter = mock.filters('select', 'work_certificates');
      expect(filter.sql).toContain(
        'exists (select 1 from "trainee_enrollments"'
      );
      expect(filter.params).toContain(KFBM);
    });

    it('FIAE regression: without a header nothing about occupations is asked', async () => {
      const { mod, mock } = await loadScoped(route, { tables });
      await mod[method](call());
      expect(mock.filters('select', 'work_certificates').sql).not.toContain(
        'trainee_enrollments'
      );
    });

    it('refuses an occupation the organization has not enabled (403)', async () => {
      const { mod } = await loadScoped(route, {
        tables: {
          ...tables,
          organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
        },
      });
      expect((await mod[method](call('KFBM'))).status).toBe(403);
    });

    it('the super admin sees every organization', async () => {
      const { mod, mock } = await loadScoped(route, {
        session: superAdminSession(),
        tables,
      });
      await mod[method](call());
      expect(mock.filters('select', 'work_certificates').sql).not.toContain(
        'organization_id'
      );
    });

    it('turns a trainee (403) and an anonymous caller (401) away', async () => {
      const trainee = await loadScoped(route, {
        session: traineeSession('t9'),
        tables,
      });
      expect((await trainee.mod[method](call())).status).toBe(403);
      const anonymous = await loadScoped(route, { session: null, tables });
      expect((await anonymous.mod[method](call())).status).toBe(401);
    });
  });

  it('regenerate changes a certificate only together with its trainee', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/arbeitszeugnis/regenerate/route',
      {
        tables: {
          workCertificates: [certificate],
          profiles: [{ id: T1, birthDate: new Date(2005, 4, 1) }],
        },
      }
    );
    const res = await mod.POST(
      scopeReq(`${API}/arbeitszeugnis/regenerate`, {
        method: 'POST',
        body: {},
      })
    );
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'work_certificates')).toHaveLength(1);
    const where = mock.filters('update', 'work_certificates');
    expect(where.sql).toContain('"work_certificates"."trainee_id" = $');
    expect(where.params).toContain(T1);
  });
});
