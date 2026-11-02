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
} from '../../../helpers/mockNext';

// WMCNL-2962: the notification "Kurs aktualisiert" linked to /trainee/modules,
// a list that redirects to the courses of the first occupation (FIAE). A click
// on the notification of a KfBM course ended in the empty FIAE list. The link
// names the course now (its page opens in the occupation of the course).

const KFBM = '00000000-0000-4000-8000-000000000002';
const COURSE = 'c0c0c0c0-0000-4000-8000-000000000001';

const admin = fakeSession({
  id: 'admin-1',
  role: 'SUPER_ADMIN',
  isTrainerLevel: true,
  isAdmin: true,
  isSuperAdmin: true,
  organizationId: 'org-1',
});

describe('PATCH /api/trainer/courses/[courseId]: notification of the members', () => {
  beforeEach(() => jest.clearAllMocks());

  it('links a trainee to the course, a co-trainer to the trainer page of it', async () => {
    jest.resetModules();
    const mock = createTableDb({
      courses: [{ id: COURSE, title: 'Informationsmanagement anwenden' }],
      courseMembers: [
        { userId: 'trainee-1', role: 'TRAINEE' },
        { userId: 'trainer-2', role: 'TRAINER' },
      ],
      courseSkills: [],
      skills: [],
      notifications: [],
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    jest.doMock('@/lib/auth-helpers', () => ({
      getUserOrgId: async () => 'org-1',
    }));
    mockSession(admin);
    mockCatalogScope({
      allowedCatalogIds: [KFBM],
      activeCatalogId: KFBM,
      selected: true,
    });
    const mod = await import('@/app/api/trainer/courses/[courseId]/route');
    const res = await mod.PATCH(
      makeRequest('PATCH', `http://localhost/api/trainer/courses/${COURSE}`, {
        token: 'tok',
        body: { title: 'Informationsmanagement anwenden' },
      }),
      { params: Promise.resolve({ courseId: COURSE }) }
    );
    expect(res.status).toBe(200);

    const [rows] = mock.writes('insert', 'notifications') as any[][];
    const byUser = Object.fromEntries(rows.map((r: any) => [r.userId, r]));
    expect(byUser['trainee-1'].linkUrl).toBe(`/trainee/modules/${COURSE}`);
    expect(byUser['trainer-2'].linkUrl).toBe(`/trainer/courses/${COURSE}`);
    expect(byUser['trainee-1'].title).toBe('Kurs aktualisiert');
  });
});
