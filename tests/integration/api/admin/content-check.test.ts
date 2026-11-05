/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderCondition } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// POST /api/admin/catalogs/[catalogId]/content-check. Who may call it:
//  - platform admin: yes (200, the report)
//  - ADMIN and TEMP_ADMIN of an organization, trainer, trainee: no (403), the
//    check holds targets and planning
//  - anonymous: 401
// The session guards are replaced and the database is a statement double that
// answers by the marker comment of each statement. The AI review runs against
// a fake `fetch` only where a test turns the switch of the owner on.

const CATALOG = '00000000-0000-4000-8000-0000000000aa';
const ORG = '11111111-1111-4111-8111-111111111111';

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
const orgAdmin = (role = 'ADMIN') =>
  fakeSession({
    id: `oa-${++sessionCounter}`,
    role,
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

const rowsOf: Record<string, unknown[]> = {
  catalog: [
    {
      id: CATALOG,
      code: 'TEST',
      title: 'Testberuf',
      is_active: true,
      duration_years: 3,
      settings: {},
    },
  ],
  courses: [
    {
      id: 'c1',
      code: 'K1',
      title: 'Komponente',
      description: null,
      training_component_id: null,
      is_active: true,
    },
  ],
  enablers: [
    {
      id: 'e1',
      course_id: 'c1',
      training_catalog_id: CATALOG,
      course_catalog_id: CATALOG,
      code: 'K1-a',
      title: 'Ein Thema',
      order_index: 1,
      description_text: 'Eine Beschreibung des Themas',
      has_scenario_pdf: false,
      is_active: true,
    },
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
    if (hang && name === 'courses') await hang;
    return name ? (rows[name] ?? []) : [];
  });
  const db = { execute };
  jest.doMock('@/db', () => ({ __esModule: true, default: db }));
  mockSession(session);
  const mod =
    await import('@/app/api/admin/catalogs/[catalogId]/content-check/route');
  return { db, mod };
}

const post = (
  mod: any,
  body: unknown = {},
  catalogId = CATALOG,
  rawBody?: unknown
) =>
  mod.POST(
    makeRequest(
      'POST',
      `http://localhost/api/admin/catalogs/${catalogId}/content-check`,
      { token: 't', body: rawBody === undefined ? body : rawBody }
    ),
    { params: Promise.resolve({ catalogId }) }
  );

describe('content check route: rights', () => {
  beforeEach(() => jest.clearAllMocks());

  it('anonymous: 401, nothing is read', async () => {
    const { db, mod } = await load(null);
    const res = await post(mod);
    expect(res.status).toBe(401);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['trainer', trainer],
    ['trainee', trainee],
    ['ADMIN of an organization', () => orgAdmin('ADMIN')],
    ['TEMP_ADMIN of an organization', () => orgAdmin('TEMP_ADMIN')],
  ])('%s: 403, nothing is read', async (_name, who) => {
    const { db, mod } = await load(who());
    const res = await post(mod, { ki: true });
    expect(res.status).toBe(403);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('platform admin: 200 with the report of the catalog', async () => {
    const { mod } = await load(superAdmin());
    const res = await post(mod);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      catalogId: CATALOG,
      catalogCode: 'TEST',
      ran: { script: true, ki: false },
    });
    expect(new Date(body.generatedAt).toString()).not.toBe('Invalid Date');
    expect(body.counts.error + body.counts.warning + body.counts.info).toBe(
      body.findings.length
    );
    // The enabler has no quizzes, theory or scenario
    const rules = body.findings.map((x: any) => x.rule);
    expect(rules).toContain('enabler.quiz.missing');
    expect(rules).toContain('enabler.theory.missing');
    expect(body.findings[0].severity).toBe('error');
    for (const finding of body.findings) {
      expect(finding.refs.length).toBeLessThanOrEqual(20);
    }
  });
});

describe('content check route: input', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a catalog id that is no uuid is 404, an unknown catalog is 404', async () => {
    const a = await load(superAdmin());
    const bad = await post(a.mod, {}, 'not-a-uuid');
    expect(bad.status).toBe(404);
    expect(a.db.execute).not.toHaveBeenCalled();

    const b = await load(superAdmin(), { catalog: [] });
    const unknown = await post(b.mod);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: 'CATALOG_NOT_FOUND' });
  });

  it('answers 400 for a body with other keys or the wrong type', async () => {
    const { mod } = await load(superAdmin());
    expect((await post(mod, { ki: 'yes' })).status).toBe(400);
    expect((await post(mod, { ki: true, catalogId: 'x' })).status).toBe(400);
    expect((await post(mod, { other: 1 })).status).toBe(400);
  });

  it('no body means the script checks only', async () => {
    const { mod } = await load(superAdmin());
    const res = await post(mod, undefined, CATALOG, null);
    expect(res.status).toBe(200);
    expect((await res.json()).ran.ki).toBe(false);
  });

  it('the catalog is only bound as a parameter of the statements', async () => {
    const { db, mod } = await load(superAdmin());
    await post(mod);
    expect(db.execute.mock.calls.length).toBeGreaterThanOrEqual(10);
    for (const [statement] of db.execute.mock.calls) {
      expect(renderCondition(statement).params).toContain(CATALOG);
    }
  });

  it('answers 500 when the database fails', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { db, mod } = await load(superAdmin());
    db.execute.mockImplementation(async () => {
      throw new Error('boom');
    });
    const res = await post(mod);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    spy.mockRestore();
  });
});

describe('content check route: the AI review', () => {
  const env = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env };
    delete process.env.CONTENT_UPLOAD_KI_ENABLED;
    delete process.env.OPENAI_COMPATIBLE_API_KEY;
  });

  afterAll(() => {
    process.env = env;
  });

  it('without the switch of the owner no call is made and the report says so', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((async () => {
        throw new Error('no network call expected');
      }) as never);
    const { mod } = await load(superAdmin());
    const res = await post(mod, { ki: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ran.ki).toBe(false);
    expect(body.notes.join(' ')).toContain('nicht eingeschaltet');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('with the switch the review runs against Sokrates and findings carry the source ki', async () => {
    process.env.CONTENT_UPLOAD_KI_ENABLED = 'true';
    process.env.OPENAI_COMPATIBLE_API_KEY = 'sk-test-only';
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation((async (
      url: string
    ) => {
      expect(new URL(url).host).toBe('sokrates.test-qualitaetsmanagement.com');
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  auffaelligkeiten: [
                    {
                      art: 'textfehler',
                      objekt: 'E1',
                      begruendung: 'Ein Tippfehler.',
                      konfidenz: 0.6,
                    },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 300, completion_tokens: 50 },
        }),
        { status: 200 }
      );
    }) as never);
    const { mod } = await load(superAdmin());
    const res = await post(mod, { ki: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ran.ki).toBe(true);
    const ki = body.findings.filter((x: any) => x.source === 'ki');
    expect(ki).toHaveLength(1);
    expect(ki[0]).toMatchObject({ severity: 'warning', rule: 'ki.textfehler' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain('sk-test-only');
    fetchSpy.mockRestore();
  });

  it('only one review per catalog at the same time (409)', async () => {
    let release: () => void = () => {};
    const hang = new Promise<void>(resolve => {
      release = resolve;
    });
    const { mod } = await load(superAdmin(), rowsOf, hang);
    const first = post(mod, { ki: true });
    // give the first request time to take the lock
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = await post(mod, { ki: true });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'KI_RUNNING' });
    // The script check of the same catalog is not blocked by the lock
    release();
    expect((await first).status).toBe(200);
    // After the run the lock is free again
    expect((await post(mod, { ki: true })).status).toBe(200);
  });

  it('the lock is freed when the run fails', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { db, mod } = await load(superAdmin());
    db.execute.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    expect((await post(mod, { ki: true })).status).toBe(500);
    expect((await post(mod, { ki: true })).status).toBe(200);
    spy.mockRestore();
  });

  it('limits the reviews per person (429 with Retry-After)', async () => {
    const session = superAdmin();
    const { mod } = await load(session);
    let last: any;
    for (let i = 0; i < 5; i += 1) {
      last = await post(mod, { ki: true });
      expect(last.status).toBe(200);
    }
    last = await post(mod, { ki: true });
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('Retry-After'))).toBeGreaterThan(0);
    // The script check has its own, larger limit
    expect((await post(mod, {})).status).toBe(200);
  });
});

describe('content check route: limit of the script check', () => {
  it('answers 429 after twenty calls in a minute', async () => {
    const { mod } = await load(superAdmin());
    const codes: number[] = [];
    for (let i = 0; i < 21; i += 1) codes.push((await post(mod)).status);
    expect(codes.slice(0, 20).every(c => c === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });
});
