/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession, mockSession } from '../../../helpers/mockNext';

// Trainee lists and trainee records per occupation (KfBM S3). The tests run the
// real catalog scope against a table mock. The mock ignores where(), so the
// assertions look at the rendered conditions (mock.filters), at the queries
// that were (not) made and at the answers of the routes. The real SQL is
// checked against a database in the smoke test of the pull request.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';

const catalogs = [
  { id: FIAE, code: 'FIAE', isActive: true },
  { id: KFBM, code: 'KFBM', isActive: true },
];
const fiaeOnly = [{ trainingCatalogId: FIAE, isEnabled: true }];
const both = [...fiaeOnly, { trainingCatalogId: KFBM, isEnabled: true }];

const requester = {
  id: 'tr1',
  email: 'tr1@example.com',
  fullName: 'Trainer One',
  role: 'TRAINER',
  organizationId: ORG,
};

const traineeRow = {
  id: 't1',
  fullName: 'Azubi Eins',
  firstName: 'Azubi',
  lastName: 'Eins',
  email: 'a1@example.com',
  avatarUrl: null,
  isActive: true,
  trainerActivated: true,
  ausbildungDurationYears: 3,
  assignedTrainerId: 'tr1',
  birthDate: null,
  startOfTrainingDate: null,
};

function req(
  url: string,
  opts: { header?: string; body?: unknown; method?: string } = {}
) {
  return {
    url,
    method: opts.method ?? 'GET',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-catalog' ? (opts.header ?? null) : null,
    },
    json: async () => opts.body ?? {},
  } as any;
}

async function load(
  route: string,
  tables: Record<string, any>,
  returns: Record<string, any[]> = {}
) {
  jest.resetModules();
  const mock = createTableDb(
    { trainingCatalogs: catalogs, organizationCatalogs: both, ...tables },
    returns
  );
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    verifyPlatformOwner: async () => false,
    verifyTrainer: async () => true,
    getUserOrgId: async () => ORG,
  }));
  mockSession(fakeSession({ id: 'tr1', organizationId: ORG }));
  const mod = await import(`@/app/api/trainer/trainees/${route}`);
  return { mock, mod };
}

const selectsFrom = (mock: ReturnType<typeof createTableDb>, table: string) =>
  mock.calls.filter(c => c.op === 'select' && c.table === table);

const ids = (body: any) => body.trainees.map((t: any) => t.id);

describe('trainee lists per occupation', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each([
    [
      'list',
      'route',
      () => ({
        profiles: { sequence: [[requester], [{ id: 'tr1' }], [traineeRow]] },
      }),
      // index of the first query of the catalog scope (after the trainer scope)
      2,
    ],
    [
      'list with stats',
      'with-stats/route',
      () => ({ profiles: { sequence: [[traineeRow]] } }),
      0,
    ],
  ])('%s', (_name, route, tables, scopeQuery) => {
    const url = `http://localhost/api/trainer/trainees${
      route === 'route' ? '' : '/with-stats'
    }`;

    it('FIAE regression: without a header it asks nothing about occupations and filters as before', async () => {
      const { mock, mod } = await load(route, tables());
      const res = await mod.GET(req(url));
      expect(res.status).toBe(200);
      expect(ids(await res.json())).toEqual(['t1']);
      expect(selectsFrom(mock, 'training_catalogs')).toHaveLength(0);
      expect(selectsFrom(mock, 'organization_catalogs')).toHaveLength(0);
      expect(selectsFrom(mock, 'trainee_enrollments')).toHaveLength(0);
      const filter = mock.filters('select', 'profiles');
      expect(filter.sql).not.toContain('trainee_enrollments');
      expect(filter.sql).not.toContain('exists');
    });

    it('KfBM selected: only trainees with a KfBM enrollment (no enrollment counts as FIAE)', async () => {
      const { mock, mod } = await load(route, tables());
      const res = await mod.GET(req(url, { header: 'KFBM' }));
      expect(res.status).toBe(200);
      expect(ids(await res.json())).toEqual(['t1']);
      const filter = mock.filters('select', 'profiles');
      expect(filter.sql).toContain(
        'exists (select 1 from "trainee_enrollments"'
      );
      expect(filter.sql).toContain(
        '"trainee_enrollments"."trainee_id" = "profiles"."id"'
      );
      expect(filter.sql).toContain(
        '"trainee_enrollments"."training_catalog_id" = $'
      );
      expect(filter.sql).not.toContain('not exists');
      expect(filter.params).toContain(KFBM);
      expect(filter.params).not.toContain(FIAE);
    });

    it('FIAE selected: FIAE enrollments and trainees without any enrollment', async () => {
      const { mock, mod } = await load(route, tables());
      const res = await mod.GET(req(url, { header: 'FIAE' }));
      expect(res.status).toBe(200);
      const filter = mock.filters('select', 'profiles');
      expect(filter.sql).toContain(
        'not exists (select 1 from "trainee_enrollments"'
      );
      expect(filter.params).toContain(FIAE);
      expect(filter.params).not.toContain(KFBM);
    });

    it('the code is case-insensitive like everywhere else', async () => {
      const { mock, mod } = await load(route, tables());
      const res = await mod.GET(req(url, { header: 'kfbm' }));
      expect(res.status).toBe(200);
      expect(mock.filters('select', 'profiles').params).toContain(KFBM);
    });

    it('refuses an occupation the organization has not enabled (403)', async () => {
      const { mock, mod } = await load(route, {
        ...tables(),
        organizationCatalogs: fiaeOnly,
      });
      const res = await mod.GET(req(url, { header: 'KFBM' }));
      expect(res.status).toBe(403);
      expect(selectsFrom(mock, 'profiles').length).toBeLessThanOrEqual(2);
    });

    it('refuses an unknown occupation (403)', async () => {
      const { mod } = await load(route, tables());
      const res = await mod.GET(req(url, { header: 'NOPE' }));
      expect(res.status).toBe(403);
    });

    it('answers 503 and hides the details when the scope cannot be determined (fail closed)', async () => {
      const { mock, mod } = await load(route, tables());
      const original = mock.db.select.getMockImplementation() as (
        ...args: unknown[]
      ) => unknown;
      let calls = 0;
      mock.db.select.mockImplementation((...args: unknown[]) => {
        if (calls++ === scopeQuery) {
          throw new Error('connection refused at 10.0.0.1');
        }
        return original(...args);
      });
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const res = await mod.GET(req(url, { header: 'KFBM' }));
      spy.mockRestore();
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain('10.0.0.1');
    });
  });

  describe('trainee record, overview and activation', () => {
    const traineeUrl = 'http://localhost/api/trainer/trainees/t1';
    const params = { params: Promise.resolve({ traineeId: 't1' }) };

    // the catalog check is the query on profiles that selects only the id and
    // is made after the organization check, so each route needs its own mock
    const record = (inScope: boolean, withHeader: boolean) => ({
      profiles: {
        sequence: [
          ...(withHeader ? [inScope ? [{ id: 't1' }] : []] : []),
          [{ id: 't1', fullName: 'A', organizationId: ORG }],
          [{ assignedTrainerId: null }],
        ],
      },
    });

    it('GET record: a trainee of another occupation is not found (404)', async () => {
      const { mod } = await load('[traineeId]/route', record(false, true));
      const res = await mod.GET(req(traineeUrl, { header: 'KFBM' }), params);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found' });
    });

    it('GET record: a trainee of the chosen occupation is returned', async () => {
      const { mock, mod } = await load('[traineeId]/route', record(true, true));
      const res = await mod.GET(req(traineeUrl, { header: 'KFBM' }), params);
      expect(res.status).toBe(200);
      expect((await res.json()).trainee.id).toBe('t1');
      expect(mock.filters('select', 'profiles').sql).toContain(
        'exists (select 1 from "trainee_enrollments"'
      );
    });

    it('GET record, FIAE regression: without a header nothing about occupations is asked', async () => {
      const { mock, mod } = await load(
        '[traineeId]/route',
        record(true, false)
      );
      const res = await mod.GET(req(traineeUrl), params);
      expect(res.status).toBe(200);
      expect(selectsFrom(mock, 'training_catalogs')).toHaveLength(0);
      expect(selectsFrom(mock, 'trainee_enrollments')).toHaveLength(0);
      expect(mock.filters('select', 'profiles').sql).not.toContain('exists');
    });

    it('PATCH record: a trainee of another occupation is not changed (404)', async () => {
      const { mock, mod } = await load(
        '[traineeId]/route',
        {
          profiles: {
            sequence: [
              [{ id: 't1', organizationId: ORG, assignedTrainerId: null }],
              [],
            ],
          },
        },
        { profiles: [{ id: 't1' }] }
      );
      const res = await mod.PATCH(
        req(traineeUrl, {
          header: 'KFBM',
          method: 'PATCH',
          body: { full_name: 'Neu' },
        }),
        params
      );
      expect(res.status).toBe(404);
      expect(mock.writes('update', 'profiles')).toEqual([]);
    });

    it('PATCH record: a trainee of the chosen occupation is changed', async () => {
      const { mock, mod } = await load(
        '[traineeId]/route',
        {
          profiles: {
            sequence: [
              [{ id: 't1', organizationId: ORG, assignedTrainerId: null }],
              [{ id: 't1' }],
            ],
          },
        },
        {
          profiles: [
            {
              id: 't1',
              fullName: 'Neu',
              ausbildungDurationYears: 3,
              assignedTrainerId: null,
              trainerActivated: false,
            },
          ],
        }
      );
      const res = await mod.PATCH(
        req(traineeUrl, {
          header: 'KFBM',
          method: 'PATCH',
          body: { full_name: 'Neu' },
        }),
        params
      );
      expect(res.status).toBe(200);
      expect(mock.writes('update', 'profiles')).toHaveLength(1);
    });

    it('PATCH record, FIAE regression: without a header the trainee is changed as before', async () => {
      const { mock, mod } = await load(
        '[traineeId]/route',
        {
          profiles: {
            sequence: [
              [{ id: 't1', organizationId: ORG, assignedTrainerId: null }],
            ],
          },
        },
        {
          profiles: [
            {
              id: 't1',
              fullName: 'Neu',
              ausbildungDurationYears: 3,
              assignedTrainerId: null,
              trainerActivated: false,
            },
          ],
        }
      );
      const res = await mod.PATCH(
        req(traineeUrl, { method: 'PATCH', body: { full_name: 'Neu' } }),
        params
      );
      expect(res.status).toBe(200);
      expect(selectsFrom(mock, 'trainee_enrollments')).toHaveLength(0);
      expect(selectsFrom(mock, 'training_catalogs')).toHaveLength(0);
    });

    it('overview: a trainee of another occupation is not found (404)', async () => {
      const { mod } = await load('[traineeId]/overview/route', {
        profiles: { sequence: [[]] },
      });
      const res = await mod.GET(
        req(`${traineeUrl}/overview`, { header: 'KFBM' }),
        params
      );
      expect(res.status).toBe(404);
    });

    it('overview: a trainee of the chosen occupation is shown', async () => {
      const { mod } = await load('[traineeId]/overview/route', {
        profiles: {
          sequence: [[{ id: 't1' }], [{ id: 't1', fullName: 'A' }]],
        },
      });
      const res = await mod.GET(
        req(`${traineeUrl}/overview`, { header: 'KFBM' }),
        params
      );
      expect(res.status).toBe(200);
      expect((await res.json()).trainee.id).toBe('t1');
    });

    it('overview, FIAE regression: without a header nothing about occupations is asked', async () => {
      const { mock, mod } = await load('[traineeId]/overview/route', {
        profiles: { sequence: [[{ id: 't1', fullName: 'A' }]] },
      });
      const res = await mod.GET(req(`${traineeUrl}/overview`), params);
      expect(res.status).toBe(200);
      expect(selectsFrom(mock, 'training_catalogs')).toHaveLength(0);
      expect(selectsFrom(mock, 'trainee_enrollments')).toHaveLength(0);
    });

    const activate = (header?: string) =>
      req(`${traineeUrl}/activate`, {
        header,
        method: 'PATCH',
        body: { itemType: 'ENABLER', itemId: 'e1', isActive: true },
      });

    it('activation: a trainee of another occupation is not changed (404)', async () => {
      const { mock, mod } = await load('[traineeId]/activate/route', {
        profiles: { sequence: [[{ role: 'TRAINER' }], []] },
      });
      const res = await mod.PATCH(activate('KFBM'), params);
      expect(res.status).toBe(404);
      expect(mock.writes('insert', 'trainee_enabler_overrides')).toEqual([]);
      expect(mock.writes('insert', 'notifications')).toEqual([]);
    });

    it('activation: a trainee of the chosen occupation is changed', async () => {
      const { mock, mod } = await load('[traineeId]/activate/route', {
        profiles: { sequence: [[{ role: 'TRAINER' }], [{ id: 't1' }]] },
      });
      const res = await mod.PATCH(activate('KFBM'), params);
      expect(res.status).toBe(200);
      expect(mock.writes('insert', 'trainee_enabler_overrides')).toHaveLength(
        1
      );
    });

    it('activation, FIAE regression: without a header nothing about occupations is asked', async () => {
      const { mock, mod } = await load('[traineeId]/activate/route', {
        profiles: { sequence: [[{ role: 'TRAINER' }]] },
      });
      const res = await mod.PATCH(activate(), params);
      expect(res.status).toBe(200);
      expect(selectsFrom(mock, 'training_catalogs')).toHaveLength(0);
      expect(selectsFrom(mock, 'trainee_enrollments')).toHaveLength(0);
    });

    it('answers 403 for an occupation the organization has not enabled, before anything is changed', async () => {
      const { mock, mod } = await load('[traineeId]/activate/route', {
        organizationCatalogs: fiaeOnly,
        profiles: { sequence: [[{ role: 'TRAINER' }], [{ id: 't1' }]] },
      });
      const res = await mod.PATCH(activate('KFBM'), params);
      expect(res.status).toBe(403);
      expect(mock.writes('insert', 'trainee_enabler_overrides')).toEqual([]);
    });
  });
});
