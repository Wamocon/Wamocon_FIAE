/**
 * @jest-environment node
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterAll,
  jest,
} from '@jest/globals';
import { renderCondition } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// POST /api/admin/catalogs/[catalogId]/content-check/files (button "Dateien prüfen").
// Platform admin only (403 for everyone else, 401 anonymous), a random sample of
// at most 50 documents is asked for the existence of its file in the storage,
// one run per catalog at the same time (409), a rate limit per person (429).
// The database is a statement double that answers by the marker comment, the
// storage client is replaced.

const CATALOG = '00000000-0000-4000-8000-0000000000aa';
const ORG = '11111111-1111-4111-8111-111111111111';
const HOST = 'https://project.example.supabase.co';

let sessionCounter = 0;
const superAdmin = () =>
  fakeSession({
    id: `sa-${++sessionCounter}`,
    role: 'ADMIN',
    organizationId: ORG,
    isAdmin: true,
    isSuperAdmin: true,
    isPlatformOwner: true,
  });
const orgAdmin = () =>
  fakeSession({
    id: `oa-${++sessionCounter}`,
    role: 'ADMIN',
    organizationId: ORG,
    isAdmin: true,
  });
const trainer = () =>
  fakeSession({ id: `tr-${++sessionCounter}`, organizationId: ORG });
const trainee = () =>
  fakeSession({
    id: `te-${++sessionCounter}`,
    role: 'TRAINEE',
    organizationId: ORG,
    isTrainerLevel: false,
  });

const address = (file: string) =>
  `${HOST}/storage/v1/object/public/content/kfbm/${file}`;

const rowsOf: Record<string, unknown[]> = {
  file_catalog: [{ code: 'TEST' }],
  file_sample: [
    { id: 'd1', title: 'Vorhanden', storage_url: address('ok.pdf'), total: 40 },
    { id: 'd2', title: 'Fehlt', storage_url: address('gone.pdf'), total: 40 },
  ],
};

async function load(
  session: ReturnType<typeof fakeSession> | null,
  rows: Record<string, unknown[]> = rowsOf,
  hang?: Promise<void>
) {
  jest.resetModules();
  const execute = jest.fn(async (statement: unknown) => {
    const { sql } = renderCondition(statement);
    const name = /\/\* cc:(\w+) \*\//.exec(sql)?.[1];
    if (hang && name === 'file_sample') await hang;
    return name ? (rows[name] ?? []) : [];
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: { execute } }));
  const exists = jest.fn(async (path: string) => ({
    data: path === 'kfbm/ok.pdf',
    error: null,
  }));
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({ storage: { from: () => ({ exists }) } }),
  }));
  mockSession(session);
  const mod =
    await import('@/app/api/admin/catalogs/[catalogId]/content-check/files/route');
  return { execute, exists, mod };
}

const post = (mod: any, catalogId = CATALOG) =>
  mod.POST(
    makeRequest(
      'POST',
      `http://localhost/api/admin/catalogs/${catalogId}/content-check/files`,
      { token: 't' }
    ),
    { params: Promise.resolve({ catalogId }) }
  );

describe('content check files route', () => {
  const env = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: HOST,
      SUPABASE_SECRET_KEY: 'sb_secret_test_only',
    };
  });

  afterAll(() => {
    process.env = env;
  });

  it('anonymous: 401, nothing is read', async () => {
    const { execute, mod } = await load(null);
    expect((await post(mod)).status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['trainer', trainer],
    ['trainee', trainee],
    ['ADMIN of an organization', orgAdmin],
  ])('%s: 403, nothing is read', async (_name, who) => {
    const { execute, exists, mod } = await load(who());
    expect((await post(mod)).status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  it('platform admin: 200 with the result, the missing file is an error, nothing is stored', async () => {
    const { exists, mod } = await load(superAdmin());
    const res = await post(mod);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      catalogId: CATALOG,
      catalogCode: 'TEST',
      totalWithFile: 40,
      sampleSize: 2,
      checked: 2,
      missing: 1,
    });
    expect(typeof body.durationMs).toBe('number');
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0]).toMatchObject({
      rule: 'document.storage.missing',
      severity: 'error',
    });
    expect(body.findings[0].refs[0].label).toBe('Fehlt');
    // existence only, the file is never loaded
    expect(exists).toHaveBeenCalledTimes(2);
    const text = JSON.stringify(body);
    expect(text).not.toContain('gone.pdf');
    expect(text).not.toContain('sb_secret_test_only');
  });

  it('a catalog id that is no uuid is 404, an unknown catalog is 404', async () => {
    const a = await load(superAdmin());
    expect((await post(a.mod, 'not-a-uuid')).status).toBe(404);
    expect(a.execute).not.toHaveBeenCalled();
    const b = await load(superAdmin(), { file_catalog: [] });
    const res = await post(b.mod);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'CATALOG_NOT_FOUND' });
  });

  it('the catalog is only bound as a parameter of the statements', async () => {
    const { execute, mod } = await load(superAdmin());
    await post(mod);
    expect(execute).toHaveBeenCalledTimes(2);
    for (const [statement] of execute.mock.calls) {
      expect(renderCondition(statement).params).toContain(CATALOG);
    }
  });

  it('only one file check per catalog at the same time (409), freed afterwards', async () => {
    let release: () => void = () => {};
    const hang = new Promise<void>(resolve => {
      release = resolve;
    });
    const { mod } = await load(superAdmin(), rowsOf, hang);
    const first = post(mod);
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = await post(mod);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'FILES_RUNNING' });
    release();
    expect((await first).status).toBe(200);
    expect((await post(mod)).status).toBe(200);
  });

  it('limits the checks per person (429 with Retry-After)', async () => {
    const { mod } = await load(superAdmin());
    let last: any;
    for (let i = 0; i < 11; i += 1) last = await post(mod);
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('answers 500 when the database fails, and frees the lock', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { execute, mod } = await load(superAdmin());
    execute.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = await post(mod);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    expect((await post(mod)).status).toBe(200);
    spy.mockRestore();
  });
});
