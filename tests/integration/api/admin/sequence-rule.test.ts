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
import {
  normalizeSince,
  sequenceRuleBodySchema,
} from '@/lib/catalog/sequence-rule';
import { validateCatalogSettings } from '@/lib/catalog/settings';

// GET and PUT /api/admin/catalogs/[catalogId]/sequence-rule: the cut-off date
// of the order of work. Platform admin only, set by hand, written to the
// activity log, stored as one more key of the catalog settings.

const FIAE = '00000000-0000-4000-8000-000000000001';
const ORG = '11111111-1111-4111-8111-111111111111';
const ROUTE = 'admin/catalogs/[catalogId]/sequence-rule';
const url = (id = FIAE) =>
  `http://localhost/api/admin/catalogs/${id}/sequence-rule`;
const params = (id = FIAE) => ({ params: Promise.resolve({ catalogId: id }) });

const superAdmin = () =>
  fakeSession({
    id: 'sa1',
    role: 'ADMIN',
    organizationId: ORG,
    isAdmin: true,
    isSuperAdmin: true,
    isPlatformOwner: true,
  });
const orgAdmin = () =>
  fakeSession({ id: 'ad1', role: 'ADMIN', organizationId: ORG, isAdmin: true });
const trainer = () => fakeSession({ id: 'tr1', organizationId: ORG });

async function load(
  session: ReturnType<typeof fakeSession> | null,
  settings: Record<string, unknown> = {}
) {
  jest.resetModules();
  const mock = createTableDb({
    trainingCatalogs: [{ id: FIAE, code: 'FIAE', settings }],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(session);
  const mod = await import(`@/app/api/${ROUTE}/route`);
  return { mock, mod };
}

const put = (since: unknown) =>
  makeRequest('PUT', url(), { token: 't', body: { since } });

describe('sequence rule: body and stored form', () => {
  it('accepts a date, an ISO timestamp and null', () => {
    expect(
      sequenceRuleBodySchema.safeParse({ since: '2026-11-01' }).success
    ).toBe(true);
    expect(
      sequenceRuleBodySchema.safeParse({ since: '2026-11-01T10:00:00Z' })
        .success
    ).toBe(true);
    expect(sequenceRuleBodySchema.safeParse({ since: null }).success).toBe(
      true
    );
  });

  it('refuses everything else', () => {
    for (const bad of [
      {},
      { since: 'tomorrow' },
      { since: '2026-13-45' },
      { since: 5 },
      { since: '2026-11-01', extra: 1 },
    ]) {
      expect(sequenceRuleBodySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('stores a full UTC timestamp, a date means the start of that day', () => {
    expect(normalizeSince('2026-11-01')).toBe('2026-11-01T00:00:00.000Z');
    expect(normalizeSince('2026-11-01T10:00:00+01:00')).toBe(
      '2026-11-01T09:00:00.000Z'
    );
  });

  it('is a known key of the catalog settings', () => {
    expect(
      validateCatalogSettings({ sequence_since: '2026-11-01T00:00:00.000Z' })
        .success
    ).toBe(true);
    expect(validateCatalogSettings({ sequence_since: 'x' }).success).toBe(
      false
    );
  });
});

describe('GET /api/admin/catalogs/[catalogId]/sequence-rule', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

  it('reads the date for the platform admin', async () => {
    const { mod } = await load(superAdmin(), {
      sequence_since: '2026-11-01T00:00:00.000Z',
    });
    const res = await mod.GET(
      makeRequest('GET', url(), { token: 't' }),
      params()
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      catalogId: FIAE,
      since: '2026-11-01T00:00:00.000Z',
    });
  });

  it('answers null when the order is not switched on', async () => {
    const { mod } = await load(superAdmin());
    const res = await mod.GET(
      makeRequest('GET', url(), { token: 't' }),
      params()
    );
    expect((await res.json()).since).toBeNull();
  });

  it('is closed to everybody else', async () => {
    for (const [session, status] of [
      [orgAdmin(), 403],
      [trainer(), 403],
      [null, 401],
    ] as const) {
      const { mod } = await load(session);
      const res = await mod.GET(
        makeRequest('GET', url(), { token: 't' }),
        params()
      );
      expect(res.status).toBe(status);
    }
  });

  it('answers 404 for a bad id', async () => {
    const { mod } = await load(superAdmin());
    const res = await mod.GET(
      makeRequest('GET', url('nope'), { token: 't' }),
      params('nope')
    );
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/admin/catalogs/[catalogId]/sequence-rule', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

  it('sets the date, keeps the other settings and writes the activity log', async () => {
    const { mod, mock } = await load(superAdmin(), {
      content_targets: { enablers: 5 },
    });
    const res = await mod.PUT(put('2026-11-01'), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      catalogId: FIAE,
      since: '2026-11-01T00:00:00.000Z',
    });
    // one statement on the settings column (jsonb_set keeps the other keys)
    const update = mock.calls.find(
      c => c.op === 'update' && c.table === 'training_catalogs'
    );
    expect(update).toBeDefined();
    expect(mock.writes('insert', 'activity_log')).toEqual([
      expect.objectContaining({
        userId: 'sa1',
        organizationId: ORG,
        activityType: 'CATALOG_SEQUENCE_RULE',
        relatedItemId: FIAE,
        relatedItemTable: 'training_catalogs',
        context: expect.objectContaining({
          catalogCode: 'FIAE',
          previous: null,
          value: '2026-11-01T00:00:00.000Z',
        }),
      }),
    ]);
  });

  it('removes the date with null and logs the previous one', async () => {
    const { mod, mock } = await load(superAdmin(), {
      sequence_since: '2026-11-01T00:00:00.000Z',
    });
    const res = await mod.PUT(put(null), params());
    expect(res.status).toBe(200);
    expect((await res.json()).since).toBeNull();
    expect(mock.writes('insert', 'activity_log')[0]).toMatchObject({
      context: expect.objectContaining({
        previous: '2026-11-01T00:00:00.000Z',
        value: null,
      }),
    });
  });

  it('refuses a bad value (400), nothing written', async () => {
    const { mod, mock } = await load(superAdmin());
    const res = await mod.PUT(put('soon'), params());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_SINCE');
    expect(mock.writes('insert', 'activity_log')).toEqual([]);
    expect(mock.calls.some(c => c.op === 'update')).toBe(false);
  });

  it('is closed to an organization admin, a trainer and an anonymous caller', async () => {
    for (const [session, status] of [
      [orgAdmin(), 403],
      [trainer(), 403],
      [null, 401],
    ] as const) {
      const { mod, mock } = await load(session);
      const res = await mod.PUT(put('2026-11-01'), params());
      expect(res.status).toBe(status);
      expect(mock.calls.some(c => c.op === 'update')).toBe(false);
    }
  });

  it('answers 404 for an unknown catalog and for a bad id', async () => {
    jest.resetModules();
    const mock = createTableDb({ trainingCatalogs: [] });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    mockSession(superAdmin());
    const mod = await import(`@/app/api/${ROUTE}/route`);
    expect((await mod.PUT(put('2026-11-01'), params())).status).toBe(404);
    expect(
      (
        await mod.PUT(
          makeRequest('PUT', url('x'), { token: 't', body: { since: null } }),
          params('x')
        )
      ).status
    ).toBe(404);
  });
});
