/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// The two tools that bring the content of an occupation to the trainees:
//  - POST /api/admin/catalogs/[catalogId]/content-release (release and lock)
//  - POST /api/admin/catalogs/[catalogId]/trainee-content (assign the trainees)
// Roles, input checks and the typed confirmation. The writes themselves run
// against a real database in tests/unit/lib/catalog/trainee-content-pg.test.ts.

const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';

const platformAdmin = () =>
  fakeSession({
    id: 'sa1',
    role: 'ADMIN',
    organizationId: OTHER_ORG,
    isAdmin: true,
    isSuperAdmin: true,
    isPlatformOwner: true,
  });
const orgAdmin = () =>
  fakeSession({ id: 'ad1', role: 'ADMIN', organizationId: ORG, isAdmin: true });
const tempAdmin = () =>
  fakeSession({
    id: 'ta1',
    role: 'TEMP_ADMIN',
    organizationId: ORG,
    isAdmin: true,
  });
const trainer = () => fakeSession({ id: 'tr1', organizationId: ORG });
const trainee = () =>
  fakeSession({
    id: 'te1',
    role: 'TRAINEE',
    organizationId: ORG,
    isTrainerLevel: false,
  });

const tables = {
  trainingCatalogs: [
    { id: KFBM, code: 'KFBM', title: 'KfBM', isActive: true, settings: {} },
  ],
  organizations: [{ id: ORG }],
  // KfBM is NOT enabled for the organization of the org admin
  organizationCatalogs: [{ trainingCatalogId: 'other', isEnabled: true }],
};

async function loadRoute(
  path: 'content-release' | 'trainee-content',
  session: ReturnType<typeof fakeSession> | null,
  data: Record<string, any> = tables
) {
  jest.resetModules();
  const mock = createTableDb(data);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(session);
  const mod = await import(
    `@/app/api/admin/catalogs/[catalogId]/${path}/route`
  );
  return { mock, mod };
}

const url = (path: string) => `http://localhost/api/admin/catalogs/x/${path}`;
const params = (catalogId: string) => ({
  params: Promise.resolve({ catalogId }),
});
const post = (path: string, body: unknown) =>
  makeRequest('POST', url(path), { token: 't', body });

describe('content release route', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['anonymous', null, 401],
    ['trainee', trainee(), 403],
    ['trainer', trainer(), 403],
    ['ADMIN of a customer organization', orgAdmin(), 403],
    ['TEMP_ADMIN', tempAdmin(), 403],
  ])('%s is refused', async (_n, session, status) => {
    const { mod } = await loadRoute('content-release', session as any);
    const res = await mod.POST(
      post('content-release', { mode: 'release' }),
      params(KFBM)
    );
    expect(res.status).toBe(status);
  });

  it('a path id that is no uuid is a 404', async () => {
    const { mod } = await loadRoute('content-release', platformAdmin());
    const res = await mod.POST(
      post('content-release', { mode: 'release' }),
      params('nope')
    );
    expect(res.status).toBe(404);
  });

  it('an unknown mode is a 400', async () => {
    const { mod } = await loadRoute('content-release', platformAdmin());
    for (const body of [{}, { mode: 'delete' }, { mode: 1 }, null]) {
      const res = await mod.POST(post('content-release', body), params(KFBM));
      expect(res.status).toBe(400);
    }
  });

  it('a real run needs the typed code of the catalog, nothing is written without it', async () => {
    const { mod, mock } = await loadRoute('content-release', platformAdmin());
    for (const confirmCode of [undefined, '', 'kfbm', 'FIAE', 'KFBM!']) {
      const res = await mod.POST(
        post('content-release', {
          mode: 'release',
          execute: true,
          confirmCode,
        }),
        params(KFBM)
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('CONFIRMATION_MISMATCH');
    }
    expect(mock.db.update).not.toHaveBeenCalled();
    expect(mock.db.transaction).not.toHaveBeenCalled();
  });

  it('a trial run needs no code and writes nothing', async () => {
    const { mod, mock } = await loadRoute('content-release', platformAdmin());
    const res = await mod.POST(
      post('content-release', { mode: 'release' }),
      params(KFBM)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      code: 'KFBM',
      mode: 'release',
      dryRun: true,
      logged: false,
    });
    expect(mock.db.update).not.toHaveBeenCalled();
    expect(mock.db.insert).not.toHaveBeenCalled();
  });

  it('the right code runs the release and writes the protocol row', async () => {
    const { mod, mock } = await loadRoute('content-release', platformAdmin());
    const res = await mod.POST(
      post('content-release', {
        mode: 'lock',
        execute: true,
        confirmCode: ' KFBM ',
      }),
      params(KFBM)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dryRun: false, mode: 'lock' });
    // courses, enablers, use cases, quizzes: four updates, one protocol row
    expect(mock.db.update).toHaveBeenCalledTimes(4);
    const log = mock.writes('insert', 'activity_log')[0] as any;
    expect(log).toMatchObject({
      userId: 'sa1',
      organizationId: OTHER_ORG,
      activityType: 'CONTENT_LOCK',
      relatedItemId: KFBM,
    });
    // the visibility columns only, never a text column
    const sets = mock.writes('update', 'courses')[0] as Record<string, unknown>;
    expect(Object.keys(sets).sort()).toEqual(['isActive', 'isPublished']);
    const enablerSet = mock.writes('update', 'enablers')[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(enablerSet)).toEqual(['isActive']);
  });

  it('a real run on the default catalog (FIAE) is refused, the trial run works', async () => {
    const FIAE = '00000000-0000-4000-8000-000000000001';
    const { mod, mock } = await loadRoute('content-release', platformAdmin(), {
      trainingCatalogs: [
        { id: FIAE, code: 'FIAE', title: 'FIAE', isActive: true },
      ],
    });
    const refused = await mod.POST(
      post('content-release', {
        mode: 'lock',
        execute: true,
        confirmCode: 'FIAE',
      }),
      params(FIAE)
    );
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe('DEFAULT_CATALOG_PROTECTED');
    expect(mock.db.update).not.toHaveBeenCalled();
    const trial = await mod.POST(
      post('content-release', { mode: 'lock' }),
      params(FIAE)
    );
    expect(trial.status).toBe(200);
  });

  it('an unknown catalog is a 404', async () => {
    const { mod } = await loadRoute('content-release', platformAdmin(), {
      trainingCatalogs: [],
    });
    const res = await mod.POST(
      post('content-release', { mode: 'release' }),
      params(KFBM)
    );
    expect(res.status).toBe(404);
  });
});

describe('trainee content route', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['anonymous', null, 401],
    ['trainee', trainee(), 403],
    ['trainer', trainer(), 403],
  ])('%s is refused', async (_n, session, status) => {
    const { mod } = await loadRoute('trainee-content', session as any);
    const res = await mod.POST(post('trainee-content', {}), params(KFBM));
    expect(res.status).toBe(status);
  });

  it('an admin of a customer organization only reaches a catalog enabled for it', async () => {
    const { mod, mock } = await loadRoute('trainee-content', orgAdmin());
    const res = await mod.POST(
      post('trainee-content', { execute: true }),
      params(KFBM)
    );
    expect(res.status).toBe(404);
    expect(mock.db.insert).not.toHaveBeenCalled();
  });

  it('a malformed catalog id is a 404 and a malformed organizationId a 400', async () => {
    const { mod } = await loadRoute('trainee-content', platformAdmin());
    expect(
      (await mod.POST(post('trainee-content', {}), params('x'))).status
    ).toBe(404);
    const bad = await mod.POST(
      post('trainee-content', { organizationId: 'x' }),
      params(KFBM)
    );
    expect(bad.status).toBe(400);
  });

  it('the platform admin gets a trial run without trainee ids by default', async () => {
    const { mod, mock } = await loadRoute('trainee-content', platformAdmin());
    const res = await mod.POST(post('trainee-content', {}), params(KFBM));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      dryRun: true,
      catalogCode: 'KFBM',
      trainees: 0,
    });
    expect(body.details).toBeUndefined();
    expect(mock.db.insert).not.toHaveBeenCalled();
  });
});

describe('enrollment hook', () => {
  it('a failing content sync does not undo the enrollment', async () => {
    jest.resetModules();
    const mock = createTableDb({
      profiles: [
        {
          id: 'f1000000-0000-4000-8000-000000000021',
          role: 'TRAINEE',
          organizationId: ORG,
          startOfTrainingDate: null,
          ausbildungDurationYears: 3,
        },
      ],
      trainingCatalogs: [
        { id: KFBM, code: 'KFBM', title: 'KfBM', isActive: true },
      ],
      organizationCatalogs: [{ trainingCatalogId: KFBM, isEnabled: true }],
      traineeEnrollments: [],
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    jest.doMock('@/lib/catalog/trainee-content', () => ({
      __esModule: true,
      syncTraineeContentAfterEnrollment: jest.fn(async () => null),
    }));
    mockSession(platformAdmin());
    const mod = await import('@/app/api/admin/users/[userId]/enrollment/route');
    const userId = 'f1000000-0000-4000-8000-000000000021';
    const res = await mod.PUT(
      makeRequest(
        'PUT',
        `http://localhost/api/admin/users/${userId}/enrollment`,
        {
          token: 't',
          body: { catalogId: KFBM },
        }
      ),
      { params: Promise.resolve({ userId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed).toBe(true);
    expect(body.contentSync).toBeUndefined();
  });

  it('a successful content sync is reported in the answer', async () => {
    jest.resetModules();
    const userId = 'f1000000-0000-4000-8000-000000000021';
    const mock = createTableDb({
      profiles: [
        {
          id: userId,
          role: 'TRAINEE',
          organizationId: ORG,
          startOfTrainingDate: null,
          ausbildungDurationYears: 3,
        },
      ],
      trainingCatalogs: [
        { id: KFBM, code: 'KFBM', title: 'KfBM', isActive: true },
      ],
      organizationCatalogs: [{ trainingCatalogId: KFBM, isEnabled: true }],
      traineeEnrollments: [],
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    const sync = jest.fn(async () => ({
      courseMembersAdded: 4,
      quizAssignmentsAdded: 3,
    }));
    jest.doMock('@/lib/catalog/trainee-content', () => ({
      __esModule: true,
      syncTraineeContentAfterEnrollment: sync,
    }));
    mockSession(platformAdmin());
    const mod = await import('@/app/api/admin/users/[userId]/enrollment/route');
    const res = await mod.PUT(
      makeRequest(
        'PUT',
        `http://localhost/api/admin/users/${userId}/enrollment`,
        {
          token: 't',
          body: { catalogId: KFBM },
        }
      ),
      { params: Promise.resolve({ userId }) }
    );
    expect((await res.json()).contentSync).toEqual({
      courseMembersAdded: 4,
      quizAssignmentsAdded: 3,
    });
    expect(sync).toHaveBeenCalledWith({
      catalogId: KFBM,
      traineeId: userId,
      actorId: 'sa1',
    });
  });
});
