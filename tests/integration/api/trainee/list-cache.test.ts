/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { FIAE, T1, loadScoped, scopeReq } from '../../../helpers/trainerScope';
import { TRAINEE_LIST_CACHE_TAGS } from '@/lib/catalog/trainee-cache';

// The lists of a trainee (Lernen, Quizze, dashboard) are cached for minutes
// under a key of the trainee and the catalogs. A write that changes what they
// show clears the cache, or the trainee keeps seeing the old list: an empty
// "Lernen" after the trainer added the courses, an empty "Quizze" after a quiz
// was assigned, the lists of the old occupation after a new enrollment.

const API = 'http://localhost/api';
const COURSE = 'bbbbbbb3-0000-4000-8000-000000000003';
const QUIZ = 'aaaaaaa6-0000-4000-8000-000000000006';
// the modules are loaded again for every route, so the mock of next/cache is
// read after the route was loaded
const tags = () =>
  (
    (jest.requireMock('next/cache') as { revalidateTag: jest.Mock })
      .revalidateTag as jest.Mock
  ).mock.calls.map(c => c[0]);
const cleared = () => expect(tags()).toEqual([...TRAINEE_LIST_CACHE_TAGS]);
const untouched = () => expect(tags()).toEqual([]);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('the list tags', () => {
  it('are the resource tags of the cache keys of the three lists', () => {
    expect([...TRAINEE_LIST_CACHE_TAGS]).toEqual([
      'trainee_courses',
      'trainee_quizzes',
      'trainee_dashboard',
    ]);
  });
});

describe('course members: the course list of the trainee', () => {
  const route = 'trainer/courses/[courseId]/members/route';
  const params = { params: Promise.resolve({ courseId: COURSE }) };
  const url = `${API}/trainer/courses/${COURSE}/members`;
  const base = {
    courses: [{ id: COURSE, title: 'Kurs', trainingCatalogId: FIAE }],
    profiles: [{ id: T1, role: 'TRAINEE', organizationId: 'org-1' }],
  };

  it('is cleared after a member is added', async () => {
    const { mod } = await loadScoped(route, {
      tables: { ...base, courseMembers: [] },
    });
    const res = await mod.POST(
      scopeReq(url, { method: 'POST', body: { userId: T1, role: 'TRAINEE' } }),
      params
    );
    expect(res.status).toBe(200);
    cleared();
  });

  it('is cleared after a member is removed', async () => {
    const { mod } = await loadScoped(route, {
      tables: {
        ...base,
        courseMembers: [{ courseId: COURSE, userId: T1, role: 'TRAINEE' }],
      },
    });
    const res = await mod.DELETE(
      scopeReq(`${url}?userId=${T1}`, {
        method: 'DELETE',
        body: { userId: T1 },
      }),
      params
    );
    expect(res.status).toBe(200);
    cleared();
  });

  it('is left alone when nobody is added (the person is already a member)', async () => {
    const { mod } = await loadScoped(route, {
      tables: {
        ...base,
        courseMembers: [{ courseId: COURSE, userId: T1, role: 'TRAINEE' }],
      },
    });
    const res = await mod.POST(
      scopeReq(url, { method: 'POST', body: { userId: T1, role: 'TRAINEE' } }),
      params
    );
    expect(res.status).toBe(409);
    untouched();
  });
});

describe('PATCH /api/trainer/trainees/[traineeId]/activate: the quiz list of the trainee', () => {
  const route = 'trainer/trainees/[traineeId]/activate/route';
  const params = { params: Promise.resolve({ traineeId: T1 }) };
  const url = `${API}/trainer/trainees/${T1}/activate`;
  const tables = {
    profiles: [
      {
        id: T1,
        role: 'TRAINEE',
        organizationId: 'org-1',
        startOfTrainingDate: new Date(2026, 7, 1),
        ausbildungDurationYears: 3,
      },
    ],
    quizzes: [{ trainingCatalogId: FIAE }],
    // the enabler lies in a course the trainee works in
    enablers: [{ trainingCatalogId: FIAE, courseId: 'c1' }],
    courseMembers: [{ courseId: 'c1', userId: T1, role: 'TRAINEE' }],
  };
  const patch = (itemType: string, isActive: boolean) =>
    scopeReq(url, {
      method: 'PATCH',
      body: { itemType, itemId: QUIZ, isActive },
    });

  it('is cleared when a global quiz is assigned and when it is taken away', async () => {
    const on = await loadScoped(route, { tables });
    expect(
      (await on.mod.PATCH(patch('GLOBAL_QUIZ', true), params)).status
    ).toBe(200);
    cleared();
    jest.clearAllMocks();
    const off = await loadScoped(route, { tables });
    expect(
      (await off.mod.PATCH(patch('GLOBAL_QUIZ', false), params)).status
    ).toBe(200);
    cleared();
  });

  it('is left alone for an enabler (no list of the trainee shows it)', async () => {
    const { mod } = await loadScoped(route, { tables });
    expect((await mod.PATCH(patch('ENABLER', true), params)).status).toBe(200);
    untouched();
  });
});

describe('PUT /api/admin/users/[userId]/enrollment: the lists of the old occupation', () => {
  const route = 'admin/users/[userId]/enrollment/route';
  const KFBM = '00000000-0000-4000-8000-000000000002';

  async function loadEnrollment(sync: unknown) {
    return loadScoped(route, {
      session: {
        id: 'sa1',
        email: 'a@example.com',
        fullName: 'Admin',
        role: 'ADMIN',
        organizationId: 'org-2',
        isPlatformOwner: true,
        isSuperAdmin: true,
        isAdmin: true,
        isTrainerLevel: true,
      },
      tables: {
        profiles: [
          {
            id: T1,
            role: 'TRAINEE',
            organizationId: 'org-1',
            startOfTrainingDate: new Date(2026, 8, 1),
            ausbildungDurationYears: 3,
          },
        ],
        traineeEnrollments: [{ id: 'e1', trainingCatalogId: KFBM }],
      },
      setup: () => {
        jest.doMock('@/lib/catalog/admin', () => {
          const actual = jest.requireActual('@/lib/catalog/admin') as any;
          return {
            ...actual,
            setTraineeEnrollment: async () => ({
              ok: true,
              value: { changed: true, replaced: true },
            }),
            getTraineeEnrollment: async () => ({
              enrollment: null,
              effectiveCatalogId: FIAE,
              isImplicit: false,
            }),
          };
        });
        jest.doMock('@/lib/catalog/trainee-content', () => ({
          __esModule: true,
          syncTraineeContentAfterEnrollment: async () => sync,
        }));
      },
    });
  }
  const put = () =>
    scopeReq(`${API}/admin/users/${T1}/enrollment`, {
      method: 'PUT',
      body: { catalogId: FIAE },
    });
  const params = { params: Promise.resolve({ userId: T1 }) };

  it('is cleared after the sync worked', async () => {
    const { mod } = await loadEnrollment({
      courseMembersAdded: 0,
      quizAssignmentsAdded: 0,
    });
    const res = await mod.PUT(put(), params);
    expect(res.status).toBe(200);
    cleared();
  });

  it('is cleared although the sync failed (it used to stay)', async () => {
    const { mod } = await loadEnrollment(null);
    const res = await mod.PUT(put(), params);
    expect(res.status).toBe(200);
    expect('contentSync' in (await res.json())).toBe(false);
    cleared();
  });
});
