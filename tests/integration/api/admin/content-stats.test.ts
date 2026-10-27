/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb, renderCondition } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// GET /api/admin/content-stats and PUT /api/admin/catalogs/[catalogId]/
// content-targets. Who sees what:
//  - platform admin: every catalog, with targets, may change the targets
//  - ADMIN and TEMP_ADMIN of an organization: only the catalogs that are
//    enabled and active for the own organization, actual numbers only
//  - trainer, trainee, anonymous: nothing (403, 403, 401)
// The session guards are replaced, the database is a table mock. The statistics
// statement is one execute() call, its rendered SQL and parameters show which
// catalogs it was limited to. The counting rules themselves run against a real
// local database in content-stats-pg.test.ts.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const OTHER = '00000000-0000-4000-8000-000000000003';
const ORG = '11111111-1111-4111-8111-111111111111';

const catalogRow = (id: string, code: string, isActive = true) => ({
  id,
  code,
  title: `Beruf ${code}`,
  description: null,
  isActive,
  durationYears: 3,
  electivePickCount: 0,
});

const statsRow = (id: string, code: string, settings: unknown = {}) => ({
  id,
  code,
  title: `Beruf ${code}`,
  is_active: true,
  settings,
  components: 27,
  enablers: 226,
  enablers_active: 200,
  scenarios: 225,
  use_cases: 225,
  use_cases_active: 0,
  lesson_quizzes: 678,
  lesson_quizzes_active: 600,
  global_quizzes: 27,
  global_quizzes_active: 27,
  learning_fields: 13,
  questions: 4000,
  mappings: 451,
});

const superAdmin = () =>
  fakeSession({
    id: 'sa1',
    role: 'ADMIN',
    organizationId: ORG,
    isAdmin: true,
    isSuperAdmin: true,
    isPlatformOwner: true,
  });
const admin = () =>
  fakeSession({
    id: 'ad1',
    role: 'ADMIN',
    organizationId: ORG,
    isAdmin: true,
  });
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

const tables = (over: Record<string, any> = {}) => ({
  trainingCatalogs: [
    catalogRow(KFBM, 'KFBM'),
    catalogRow(FIAE, 'FIAE'),
    catalogRow(OTHER, 'ZZZ', false),
  ],
  organizations: [{ id: ORG }],
  organizationCatalogs: [
    { organizationId: ORG, trainingCatalogId: FIAE, isEnabled: true },
    { organizationId: ORG, trainingCatalogId: KFBM, isEnabled: true },
    { organizationId: ORG, trainingCatalogId: OTHER, isEnabled: true },
  ],
  ...over,
});

const targetSettings = {
  content_targets: { enablers: 226, scenarios: 226, use_cases: 226 },
};
// Targets that differ from every actual number, so a leak is easy to spot
const secretSettings = {
  content_targets: { enablers: 7771, scenarios: 7772, use_cases: 7773 },
};

async function load(
  route: string,
  session: ReturnType<typeof fakeSession> | null,
  tableRows: Record<string, any> = tables(),
  statRows: unknown[] = [
    statsRow(KFBM, 'KFBM', targetSettings),
    statsRow(FIAE, 'FIAE'),
  ]
) {
  jest.resetModules();
  const mock = createTableDb(tableRows, {
    trainingCatalogs: [{ settings: { content_targets: { enablers: 1 } } }],
  });
  mock.db.execute.mockImplementation(async () => statRows);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(session);
  const mod = await import(`@/app/api/${route}/route`);
  return { mock, mod };
}

const statsUrl = 'http://localhost/api/admin/content-stats';
const get = (mod: any) => mod.GET(makeRequest('GET', statsUrl, { token: 't' }));

/** Parameters of the one statistics statement (the catalogs it counts). */
function statementOf(mock: { db: any }) {
  expect(mock.db.execute).toHaveBeenCalledTimes(1);
  return renderCondition(mock.db.execute.mock.calls[0][0]);
}

describe('GET /api/admin/content-stats: platform admin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads every catalog in one statement, FIAE first, with targets', async () => {
    const { mock, mod } = await load('admin/content-stats', superAdmin());
    const res = await get(mod);
    expect(res.status).toBe(200);
    const body = await res.json();

    // One statement for all catalogs, not limited by an id list
    const statement = statementOf(mock);
    expect(statement.params).toEqual([]);
    expect(statement.sql).toContain('from training_catalogs c');
    expect(statement.sql).not.toMatch(/where c\.id in/);

    expect(body.targetsVisible).toBe(true);
    expect(body.canEditTargets).toBe(true);
    expect(body.catalogs.map((c: any) => c.code)).toEqual(['FIAE', 'KFBM']);

    const kfbm = body.catalogs[1];
    expect(kfbm).toMatchObject({
      catalogId: KFBM,
      isActive: true,
      questions: 4000,
      mappings: 451,
    });
    const byId = Object.fromEntries(kfbm.metrics.map((m: any) => [m.id, m]));
    expect(kfbm.metrics.map((m: any) => m.id)).toEqual([
      'components',
      'enablers',
      'scenarios',
      'useCases',
      'lessonQuizzes',
      'globalQuizzes',
      'learningFields',
    ]);
    expect(byId.enablers).toEqual({
      id: 'enablers',
      actual: 226,
      active: 200,
      target: 226,
      difference: 0,
      status: 'met',
      percent: 100,
    });
    expect(byId.scenarios).toMatchObject({
      actual: 225,
      target: 226,
      difference: -1,
      status: 'missing',
      percent: 99,
    });
    expect(byId.useCases).toMatchObject({ difference: -1, status: 'missing' });
    // Without a target the status says so (the screen shows "kein Soll")
    expect(byId.components).toMatchObject({
      actual: 27,
      active: null,
      target: null,
      difference: null,
      status: 'no_target',
      percent: null,
    });
    // FIAE has no targets at all
    expect(
      body.catalogs[0].metrics.every((m: any) => m.status === 'no_target')
    ).toBe(true);
  });

  it('is the same for an ADMIN of the platform organization', async () => {
    const session = fakeSession({
      id: 'pa1',
      role: 'ADMIN',
      organizationId: ORG,
      isAdmin: true,
      isSuperAdmin: true,
      isPlatformOwner: true,
    });
    const { mod } = await load('admin/content-stats', session);
    const body = await (await get(mod)).json();
    expect(body.targetsVisible).toBe(true);
    expect(body.catalogs).toHaveLength(2);
  });

  it('shows an inactive catalog too (the platform admin sees all)', async () => {
    const { mod } = await load('admin/content-stats', superAdmin(), tables(), [
      { ...statsRow(OTHER, 'ZZZ'), is_active: false },
    ]);
    const body = await (await get(mod)).json();
    expect(body.catalogs[0]).toMatchObject({ code: 'ZZZ', isActive: false });
  });

  it('survives bad settings and a null count', async () => {
    const { mod } = await load('admin/content-stats', superAdmin(), tables(), [
      {
        ...statsRow(KFBM, 'KFBM', { content_targets: 'broken' }),
        scenarios: null,
      },
    ]);
    const body = await (await get(mod)).json();
    const scenarios = body.catalogs[0].metrics.find(
      (m: any) => m.id === 'scenarios'
    );
    expect(scenarios).toMatchObject({ actual: 0, status: 'no_target' });
  });

  it('answers 500 when the database fails', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { mock, mod } = await load('admin/content-stats', superAdmin());
    mock.db.execute.mockImplementation(async () => {
      throw new Error('boom');
    });
    const res = await get(mod);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    spy.mockRestore();
  });
});

describe.each([
  ['ADMIN', admin],
  ['TEMP_ADMIN', tempAdmin],
])('GET /api/admin/content-stats: %s of an organization', (_name, who) => {
  beforeEach(() => jest.clearAllMocks());

  it('gets only the catalogs usable by the own organization, no targets', async () => {
    const { mock, mod } = await load(
      'admin/content-stats',
      who(),
      tables({
        // KFBM is switched off for the organization, ZZZ is inactive
        organizationCatalogs: [
          { organizationId: ORG, trainingCatalogId: FIAE, isEnabled: true },
          { organizationId: ORG, trainingCatalogId: KFBM, isEnabled: false },
          { organizationId: ORG, trainingCatalogId: OTHER, isEnabled: true },
        ],
      }),
      [statsRow(FIAE, 'FIAE', secretSettings)]
    );
    const res = await get(mod);
    expect(res.status).toBe(200);
    const body = await res.json();

    // The statement counts exactly the usable catalogs: FIAE only
    const statement = statementOf(mock);
    expect(statement.sql).toMatch(/where c\.id in \(\$1::uuid\)/);
    expect(statement.params).toEqual([FIAE]);

    expect(body.targetsVisible).toBe(false);
    expect(body.canEditTargets).toBe(false);
    expect(body.catalogs.map((c: any) => c.code)).toEqual(['FIAE']);
    // Even when targets are stored, none of them leaves the server
    for (const metric of body.catalogs[0].metrics) {
      expect(metric.target).toBeNull();
      expect(metric.difference).toBeNull();
      expect(metric.percent).toBeNull();
      expect(metric.status).toBe('no_target');
    }
    expect(JSON.stringify(body)).not.toMatch(/777[123]/);
    // The actual numbers are there
    expect(
      body.catalogs[0].metrics.find((m: any) => m.id === 'enablers').actual
    ).toBe(226);
  });

  it('never reaches a catalog of another organization', async () => {
    // The organization has no row for KFBM, another organization has
    const { mock, mod } = await load(
      'admin/content-stats',
      who(),
      tables({
        organizationCatalogs: [
          { organizationId: ORG, trainingCatalogId: FIAE, isEnabled: true },
        ],
      }),
      [statsRow(FIAE, 'FIAE')]
    );
    await get(mod);
    expect(statementOf(mock).params).toEqual([FIAE]);
  });

  it('an organization without catalog rows counts as FIAE enabled (legacy)', async () => {
    const { mock, mod } = await load(
      'admin/content-stats',
      who(),
      tables({ organizationCatalogs: [] }),
      [statsRow(FIAE, 'FIAE')]
    );
    const body = await (await get(mod)).json();
    expect(statementOf(mock).params).toEqual([FIAE]);
    expect(body.catalogs.map((c: any) => c.code)).toEqual(['FIAE']);
  });

  it('fails closed when the organization of the session does not exist', async () => {
    const { mock, mod } = await load(
      'admin/content-stats',
      who(),
      tables({ organizations: [] })
    );
    const res = await get(mod);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.catalogs).toEqual([]);
    // No statistics statement was sent at all
    expect(mock.db.execute).not.toHaveBeenCalled();
  });

  it('reads the organization from the session, never from the request', async () => {
    const { mock, mod } = await load('admin/content-stats', who(), tables(), [
      statsRow(FIAE, 'FIAE'),
    ]);
    await mod.GET(
      makeRequest(
        'GET',
        `${statsUrl}?organizationId=22222222-2222-4222-8222-222222222222&catalogId=${OTHER}`,
        { token: 't' }
      )
    );
    const orgFilter = mock.filters('select', 'organization_catalogs');
    expect(orgFilter.params).toEqual([ORG]);
  });
});

describe('GET /api/admin/content-stats: everybody else', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['trainer', 403, trainer],
    ['trainee', 403, trainee],
    ['anonymous', 401, () => null],
  ])(
    '%s is turned away (%s) before anything is counted',
    async (_n, status, who) => {
      const { mock, mod } = await load('admin/content-stats', who());
      const res = await get(mod);
      expect(res.status).toBe(status);
      expect(mock.db.execute).not.toHaveBeenCalled();
      expect(mock.db.select).not.toHaveBeenCalled();
    }
  );
});

// ---------------------------------------------------------------------------
// PUT content targets
// ---------------------------------------------------------------------------

const putUrl = (id: string) =>
  `http://localhost/api/admin/catalogs/${id}/content-targets`;
const params = (catalogId: string) => ({
  params: Promise.resolve({ catalogId }),
});
const put = (mod: any, id: string, body: unknown) =>
  mod.PUT(makeRequest('PUT', putUrl(id), { token: 't', body }), params(id));

const ROUTE = 'admin/catalogs/[catalogId]/content-targets';

describe('PUT /api/admin/catalogs/[catalogId]/content-targets', () => {
  beforeEach(() => jest.clearAllMocks());

  it('the platform admin saves the whole set in one statement', async () => {
    const { mock, mod } = await load(ROUTE, superAdmin());
    const res = await put(mod, KFBM, {
      targets: {
        components: 27,
        enablers: 226,
        useCases: 226,
        scenarios: null,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.catalogId).toBe(KFBM);
    expect(Object.keys(body)).toEqual(['catalogId', 'targets']);

    const updates = mock.writes('update', 'training_catalogs');
    expect(updates).toHaveLength(1);
    const rendered = renderCondition((updates[0] as any).settings);
    // The other settings keys stay: one jsonb_set on the settings column
    expect(rendered.sql).toContain(`jsonb_set(`);
    expect(rendered.sql).toContain(`'{content_targets}'`);
    expect(rendered.params).toEqual([
      JSON.stringify({ components: 27, enablers: 226, use_cases: 226 }),
    ]);
    // Limited to the one catalog
    expect(mock.filters('update', 'training_catalogs').params).toEqual([KFBM]);
  });

  it('an empty set removes the key and leaves the other settings alone', async () => {
    const { mock, mod } = await load(ROUTE, superAdmin());
    const res = await put(mod, KFBM, { targets: {} });
    expect(res.status).toBe(200);
    const rendered = renderCondition(
      (mock.writes('update', 'training_catalogs')[0] as any).settings
    );
    expect(rendered.sql).toContain(`- 'content_targets'`);
    expect(rendered.sql).not.toContain('jsonb_set');
  });

  it('answers 404 for a catalog that does not exist', async () => {
    const { mock, mod } = await load(ROUTE, superAdmin());
    // the update matched no row
    mock.db.update.mockImplementation(() => {
      const chain: any = new Proxy(function () {}, {
        get: (_t, prop) =>
          prop === 'then'
            ? (ok: any) => Promise.resolve([]).then(ok)
            : () => chain,
      });
      return chain;
    });
    const res = await put(mod, KFBM, { targets: { enablers: 1 } });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('CATALOG_NOT_FOUND');
  });

  it.each([
    ['a value above the maximum', { targets: { enablers: 100001 } }],
    ['a negative value', { targets: { enablers: -1 } }],
    ['a fraction', { targets: { enablers: 2.5 } }],
    ['a text', { targets: { enablers: '12' } }],
    ['an unknown key', { targets: { enablerz: 12 } }],
    ['the stored spelling', { targets: { use_cases: 12 } }],
    ['no targets object', {}],
    ['targets that are not an object', { targets: 5 }],
    ['an extra top level key', { targets: {}, settings: { hai: {} } }],
  ])('answers 400 for %s and writes nothing', async (_name, body) => {
    const { mock, mod } = await load(ROUTE, superAdmin());
    const res = await put(mod, KFBM, body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_TARGETS');
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is no JSON object', async () => {
    const { mock, mod } = await load(ROUTE, superAdmin());
    const res = await mod.PUT(
      makeRequest('PUT', putUrl(KFBM), { token: 't', body: [1, 2] }),
      params(KFBM)
    );
    expect(res.status).toBe(400);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('answers 404 for an id that is no uuid before asking the database', async () => {
    const { mock, mod } = await load(ROUTE, superAdmin());
    const res = await put(mod, 'not-an-id', { targets: {} });
    expect(res.status).toBe(404);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it.each([
    ['ADMIN of an organization', 403, admin],
    ['TEMP_ADMIN of an organization', 403, tempAdmin],
    ['trainer', 403, trainer],
    ['trainee', 403, trainee],
    ['anonymous', 401, () => null],
  ])('%s cannot change targets (%s)', async (_n, status, who) => {
    const { mock, mod } = await load(ROUTE, who());
    const res = await put(mod, KFBM, { targets: { enablers: 1 } });
    expect(res.status).toBe(status);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('answers 500 when the database fails', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { mock, mod } = await load(ROUTE, superAdmin());
    mock.db.update.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await put(mod, KFBM, { targets: { enablers: 1 } });
    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});
