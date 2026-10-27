/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession, mockSession } from '../../../helpers/mockNext';

// Role matrix of the occupation tabs. The tabs send the chosen occupation as
// `?catalog=CODE` (and as x-catalog). The real catalog scope runs against a
// table mock, the assertions read the rendered conditions (mock.filters) and the
// answers. Rule: the choice is only ever a narrowing inside the set the session
// may reach, a code outside of it is refused (403), never widened.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';
const COURSE = 'bbbbbbb3-0000-4000-8000-000000000003';

const bothActive = [
  { id: FIAE, code: 'FIAE', isActive: true },
  { id: KFBM, code: 'KFBM', isActive: true },
];
const kfbmInactive = [
  { id: FIAE, code: 'FIAE', isActive: true },
  { id: KFBM, code: 'KFBM', isActive: false },
];
const fiaeOnly = [{ trainingCatalogId: FIAE, isEnabled: true }];
const both = [
  { trainingCatalogId: FIAE, isEnabled: true },
  { trainingCatalogId: KFBM, isEnabled: true },
];

function req(url: string, header?: string) {
  return {
    url,
    method: 'GET',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-catalog' ? (header ?? null) : null,
    },
    json: async () => ({}),
  } as any;
}

async function load(
  route: string,
  tables: Record<string, any>,
  session: ReturnType<typeof fakeSession> | null | undefined,
  catalogs = bothActive
) {
  jest.resetModules();
  const mock = createTableDb({ trainingCatalogs: catalogs, ...tables });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    verifyPlatformOwner: async () => true,
    getUserOrgId: async () => ORG,
  }));
  if (session !== undefined) mockSession(session);
  const mod = await import(`@/app/api/${route}/route`);
  return { mock, mod };
}

const COURSES = 'http://localhost/api/trainer/courses';
const trainer = (overrides = {}) =>
  fakeSession({ id: 'tr1', organizationId: ORG, ...overrides });
const orgAdmin = () =>
  fakeSession({
    id: 'ad1',
    role: 'ADMIN',
    isAdmin: true,
    organizationId: ORG,
  });
const superAdmin = () =>
  fakeSession({
    id: 'sa1',
    role: 'SUPER_ADMIN',
    isAdmin: true,
    isSuperAdmin: true,
  });

describe('occupation tabs: role matrix on a list route', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('without a session', () => {
    it.each(['', '?catalog=KFBM'])('answers 401 for %p', async query => {
      const { mock, mod } = await load('trainer/courses', {}, null);
      const res = await mod.GET(req(`${COURSES}${query}`, 'KFBM'));
      expect(res.status).toBe(401);
      expect(mock.filters('select', 'courses').sql).toBe('');
    });
  });

  describe('super admin', () => {
    it('without a parameter reaches both catalogs', async () => {
      const { mock, mod } = await load(
        'trainer/courses',
        { courses: [] },
        superAdmin()
      );
      await mod.GET(req(COURSES));
      expect(mock.filters('select', 'courses').params).toEqual(
        expect.arrayContaining([FIAE, KFBM])
      );
    });

    it.each([
      ['query KFBM', `${COURSES}?catalog=KFBM`, undefined, KFBM],
      ['query in lower case', `${COURSES}?catalog=kfbm`, undefined, KFBM],
      ['header FIAE', COURSES, 'FIAE', FIAE],
    ])(
      'narrows to exactly one catalog with %s',
      async (_label, url, header, expected) => {
        const { mock, mod } = await load(
          'trainer/courses',
          { courses: [] },
          superAdmin()
        );
        const res = await mod.GET(req(url, header));
        expect(res.status).toBe(200);
        expect(mock.filters('select', 'courses').params).toEqual([expected]);
      }
    );

    it.each(['NOPE', "KFBM'--", 'KFBM,FIAE'])(
      'refuses the unknown code %p (fail closed)',
      async code => {
        const { mock, mod } = await load(
          'trainer/courses',
          { courses: [] },
          superAdmin()
        );
        const res = await mod.GET(
          req(`${COURSES}?catalog=${encodeURIComponent(code)}`)
        );
        expect(res.status).toBe(403);
        expect(mock.filters('select', 'courses').sql).toBe('');
      }
    );

    it('refuses an inactive catalog as a view', async () => {
      const { mock, mod } = await load(
        'trainer/courses',
        { courses: [] },
        superAdmin(),
        kfbmInactive
      );
      const res = await mod.GET(req(`${COURSES}?catalog=KFBM`));
      expect(res.status).toBe(403);
      expect(mock.filters('select', 'courses').sql).toBe('');
      // the active one still works
      const ok = await load(
        'trainer/courses',
        { courses: [] },
        superAdmin(),
        kfbmInactive
      );
      expect((await ok.mod.GET(req(`${COURSES}?catalog=FIAE`))).status).toBe(
        200
      );
    });
  });

  describe.each([
    ['trainer', () => trainer()],
    ['organization admin', () => orgAdmin()],
  ])('%s', (_name, session) => {
    it('with two enabled occupations narrows to the chosen one', async () => {
      const { mock, mod } = await load(
        'trainer/courses',
        { organizationCatalogs: both, courses: [] },
        session()
      );
      const res = await mod.GET(req(`${COURSES}?catalog=KFBM`));
      expect(res.status).toBe(200);
      expect(mock.filters('select', 'courses').params).toEqual([KFBM]);
    });

    it('without a parameter keeps the allowed set (FIAE regression)', async () => {
      const { mock, mod } = await load(
        'trainer/courses',
        { organizationCatalogs: fiaeOnly, courses: [] },
        session()
      );
      const res = await mod.GET(req(COURSES));
      expect(res.status).toBe(200);
      expect(mock.filters('select', 'courses').params).toEqual([FIAE]);
    });

    it('refuses an occupation the organization has not enabled', async () => {
      const { mock, mod } = await load(
        'trainer/courses',
        { organizationCatalogs: fiaeOnly, courses: [] },
        session()
      );
      const res = await mod.GET(req(`${COURSES}?catalog=KFBM`));
      expect(res.status).toBe(403);
      expect(mock.filters('select', 'courses').sql).toBe('');
    });

    it('refuses an occupation that is enabled but inactive', async () => {
      const { mod } = await load(
        'trainer/courses',
        { organizationCatalogs: both, courses: [] },
        session(),
        kfbmInactive
      );
      expect((await mod.GET(req(`${COURSES}?catalog=KFBM`))).status).toBe(403);
    });

    it('an organization without any catalog row gets FIAE only', async () => {
      const { mod } = await load(
        'trainer/courses',
        { organizationCatalogs: [], courses: [] },
        session()
      );
      expect((await mod.GET(req(`${COURSES}?catalog=KFBM`))).status).toBe(403);
      const ok = await load(
        'trainer/courses',
        { organizationCatalogs: [], courses: [] },
        session()
      );
      expect((await ok.mod.GET(req(`${COURSES}?catalog=FIAE`))).status).toBe(
        200
      );
    });

    it('cannot write for an occupation outside its set either', async () => {
      const { mod } = await load(
        'trainer/courses',
        { organizationCatalogs: fiaeOnly },
        session()
      );
      const res = await mod.POST({
        ...req(`${COURSES}?catalog=KFBM`),
        method: 'POST',
        json: async () => ({ title: 'X' }),
      });
      // curriculum writes need the super admin, the answer is 403 either way
      expect(res.status).toBe(403);
    });
  });

  describe('trainee (no tabs, one enrollment)', () => {
    const profile = {
      id: 't1',
      role: 'TRAINEE',
      organizationId: ORG,
      isPlatformOwner: false,
    };
    const traineeUrl = 'http://localhost/api/trainee/courses?traineeId=t1';

    it('reads the occupation of the enrollment without a parameter', async () => {
      const { mock, mod } = await load(
        'trainee/courses',
        {
          profiles: [profile],
          organizationCatalogs: both,
          traineeEnrollments: [
            { trainingCatalogId: KFBM, startDate: '2026-08-01' },
          ],
          courseMembers: [{ userId: 't1', courseId: COURSE }],
          courses: [],
        },
        undefined
      );
      const res = await mod.GET(req(traineeUrl));
      expect(res.status).toBe(200);
      const params = mock.filters('select', 'courses').params;
      expect(params).toContain(KFBM);
      expect(params).not.toContain(FIAE);
    });

    it.each(['FIAE', 'NOPE'])(
      'refuses ?catalog=%s: the parameter never reaches another occupation',
      async code => {
        const { mock, mod } = await load(
          'trainee/courses',
          {
            profiles: [profile],
            organizationCatalogs: both,
            traineeEnrollments: [
              { trainingCatalogId: KFBM, startDate: '2026-08-01' },
            ],
            courseMembers: [{ userId: 't1', courseId: COURSE }],
            courses: [],
          },
          undefined
        );
        const res = await mod.GET(req(`${traineeUrl}&catalog=${code}`));
        expect(res.status).toBe(403);
        expect(mock.filters('select', 'courses').sql).toBe('');
      }
    );

    it('has no access to the trainer list at all', async () => {
      const { mod } = await load(
        'trainer/courses',
        { organizationCatalogs: both },
        fakeSession({
          id: 't1',
          role: 'TRAINEE',
          organizationId: ORG,
          isTrainerLevel: false,
        })
      );
      expect((await mod.GET(req(`${COURSES}?catalog=KFBM`))).status).toBe(403);
    });
  });
});
