// Shared setup for the tests that check the organization and occupation scope
// of the trainer routes. The routes run with a fake session, the real catalog
// scope and the real scope helpers against a table mock. The mock ignores
// where(), so the tests assert on the rendered conditions (mock.filters), on
// the queries that were (not) made and on what was written. The real SQL is
// checked against a database in the smoke test of the pull request.

import { jest } from '@jest/globals';
import { createTableDb, type TableRows } from './mockDb';
import { fakeSession, mockSession, type FakeSession } from './mockNext';

export const FIAE = '00000000-0000-4000-8000-000000000001';
export const KFBM = '00000000-0000-4000-8000-000000000002';

/** Organizations of the two callers in the tests (the second one is foreign). */
export const ORG = 'org-1';
export const OTHER_ORG = 'org-2';

/** Ids that are valid uuids, as the scope helpers require. */
export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const T3 = '33333333-3333-4333-8333-333333333333';
export const TRAINER = '99999999-9999-4999-8999-999999999999';

export const catalogs = [
  { id: FIAE, code: 'FIAE', isActive: true },
  { id: KFBM, code: 'KFBM', isActive: true },
];
export const fiaeOnly = [{ trainingCatalogId: FIAE, isEnabled: true }];
export const bothCatalogs = [
  ...fiaeOnly,
  { trainingCatalogId: KFBM, isEnabled: true },
];

/** A request double with the header x-catalog and an optional json body. */
export function scopeReq(
  url: string,
  opts: { header?: string; method?: string; body?: unknown } = {}
) {
  return {
    url,
    method: opts.method ?? 'GET',
    nextUrl: new URL(url),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-catalog' ? (opts.header ?? null) : null,
    },
    json: async () => opts.body ?? {},
  } as any;
}

export const trainerSession = (overrides: Partial<FakeSession> = {}) =>
  fakeSession({ id: TRAINER, organizationId: ORG, ...overrides });

export const superAdminSession = () =>
  trainerSession({ role: 'SUPER_ADMIN', isSuperAdmin: true, isAdmin: true });

export type ScopedLoad = {
  session?: FakeSession | null;
  tables?: Record<string, TableRows>;
  returns?: Record<string, any[]>;
  /** Extra jest.doMock calls, run before the route is imported. */
  setup?: () => void;
};

/**
 * Load a route handler module as the given session. The catalogs of the
 * organization are FIAE and KFBM unless `tables` says otherwise.
 */
export async function loadScoped(routePath: string, options: ScopedLoad = {}) {
  jest.resetModules();
  const session =
    options.session === undefined ? trainerSession() : options.session;
  const mock = createTableDb(
    {
      trainingCatalogs: catalogs,
      organizationCatalogs: bothCatalogs,
      ...(options.tables ?? {}),
    },
    options.returns ?? {}
  );
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    verifyTrainer: async () => true,
    verifyPlatformOwner: async () => session?.isPlatformOwner === true,
    getUserOrgId: async () => session?.organizationId ?? ORG,
  }));
  mockSession(session);
  options.setup?.();
  const mod = await import(`@/app/api/${routePath}`);
  return { mock, mod };
}

export const selectsFrom = (
  mock: ReturnType<typeof createTableDb>,
  table: string
) => mock.calls.filter(c => c.op === 'select' && c.table === table);

/** Params of the rendered where() conditions of all selects on a table. */
export const selectParams = (
  mock: ReturnType<typeof createTableDb>,
  table: string
) => mock.filters('select', table).params;
