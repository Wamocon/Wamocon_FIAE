/**
 * @jest-environment node
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { createTableDb, renderCondition } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';
import {
  buildTemplateJson,
  buildTemplateXlsx,
  EXAMPLE_PLAN,
} from '@/lib/catalog/content-plan/template';
import {
  docxFromBlocks,
  pdfBytes,
  t as plain,
} from '../../../helpers/uploadFixtures';

// The plan document of an occupation: GET, PUT and DELETE of the stored plan,
// the template download and the reading of an uploaded file into a proposal.
// Platform admin only. The database is a table mock, nothing is written to a
// real one. The AI stage runs against a replaced fetch, never a network.

const FIAE = '00000000-0000-4000-8000-000000000001';
const ORG = '11111111-1111-4111-8111-111111111111';
const BASE = 'admin/catalogs/[catalogId]/content-plan';
const url = (suffix = '', id = FIAE) =>
  `http://localhost/api/admin/catalogs/${id}/content-plan${suffix}`;
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

const stored = {
  plan: { totals: { enablers: 226 } },
  source: {
    fileName: 'plan.xlsx',
    savedAt: '2026-11-03T10:00:00.000Z',
    fieldCount: 1,
    method: 'script',
  },
};

async function load(
  route: string,
  session: ReturnType<typeof fakeSession> | null,
  settings: Record<string, unknown> = {},
  catalogs = [{ id: FIAE, code: 'FIAE', settings }]
) {
  jest.resetModules();
  const mock = createTableDb({ trainingCatalogs: catalogs });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(session);
  const mod = await import(`@/app/api/${route}/route`);
  return { mock, mod };
}

const settingsWrites = (mock: ReturnType<typeof createTableDb>) =>
  mock
    .writes('update', 'training_catalogs')
    .map(v => renderCondition((v as { settings: unknown }).settings).sql);

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

describe('GET /content-plan', () => {
  it('reads the stored plan with its source', async () => {
    const { mod } = await load(BASE, superAdmin(), { content_plan: stored });
    const res = await mod.GET(
      makeRequest('GET', url(), { token: 't' }),
      params()
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ catalogId: FIAE, stored });
  });

  it('answers null without a plan, and ignores a damaged one', async () => {
    for (const settings of [
      {},
      { content_plan: { plan: { totals: { x: 1 } } } },
    ]) {
      const { mod } = await load(BASE, superAdmin(), settings);
      const res = await mod.GET(
        makeRequest('GET', url(), { token: 't' }),
        params()
      );
      expect((await res.json()).stored).toBeNull();
    }
  });

  it('is closed to an organization admin, a trainer and an anonymous caller', async () => {
    for (const [session, status] of [
      [orgAdmin(), 403],
      [trainer(), 403],
      [null, 401],
    ] as const) {
      const { mod } = await load(BASE, session, { content_plan: stored });
      const res = await mod.GET(
        makeRequest('GET', url(), { token: 't' }),
        params()
      );
      expect(res.status).toBe(status);
      expect(JSON.stringify(await res.json())).not.toContain('plan.xlsx');
    }
  });

  it('answers 404 for an unknown catalog and for a bad id', async () => {
    const { mod } = await load(BASE, superAdmin(), {}, []);
    expect(
      (await mod.GET(makeRequest('GET', url(), { token: 't' }), params()))
        .status
    ).toBe(404);
    expect(
      (
        await mod.GET(
          makeRequest('GET', url('', 'x'), { token: 't' }),
          params('x')
        )
      ).status
    ).toBe(404);
  });
});

describe('PUT /content-plan', () => {
  const put = (body: unknown) =>
    makeRequest('PUT', url(), { token: 't', body });

  it('saves the confirmed plan with the source set by the server', async () => {
    const { mod, mock } = await load(BASE, superAdmin(), {
      content_targets: { enablers: 5 },
    });
    const res = await mod.PUT(
      put({
        plan: {
          totals: { enablers: 226, hours: 4800 },
          notes: ['Ein Hinweis'],
        },
        fileName: 'C:\\Dokumente\\plan.xlsx',
        method: 'script',
      }),
      params()
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stored.source).toMatchObject({
      fileName: 'plan.xlsx',
      method: 'script',
      fieldCount: 3,
    });
    expect(Number.isNaN(Date.parse(body.stored.source.savedAt))).toBe(false);
    // one statement on the settings column, only the plan key: the manual
    // targets and every other key stay as they are
    const sql = settingsWrites(mock);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('jsonb_set');
    expect(sql[0]).toContain('{content_plan}');
    expect(sql[0]).not.toContain('content_targets');
  });

  it('stores no file content, only plan and source', async () => {
    const { mod, mock } = await load(BASE, superAdmin());
    await mod.PUT(
      put({
        plan: { totals: { enablers: 1 } },
        fileName: 'a.docx',
        method: 'ki',
      }),
      params()
    );
    const [values] = mock.writes('update', 'training_catalogs');
    const rendered = renderCondition(
      (values as { settings: unknown }).settings
    );
    const json = JSON.parse(String(rendered.params[0]));
    expect(Object.keys(json).sort()).toEqual(['plan', 'source']);
    expect(Object.keys(json.source).sort()).toEqual([
      'fieldCount',
      'fileName',
      'method',
      'savedAt',
    ]);
  });

  it.each([
    ['unknown key in the plan', { plan: { totals: { quizzes: 1 } } }],
    ['null instead of "not stated"', { plan: { totals: { enablers: null } } }],
    ['number above the limit', { plan: { totals: { enablers: 100001 } } }],
    ['unknown method', { plan: {}, method: 'manual' }],
    ['extra key in the body', { plan: {}, extra: 1 }],
    ['no plan', {}],
  ])('refuses %s (400), nothing written', async (_name, body) => {
    const { mod, mock } = await load(BASE, superAdmin());
    const res = await mod.PUT(
      put({ fileName: 'a.xlsx', method: 'script', ...body }),
      params()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_PLAN');
    expect(mock.calls.some(c => c.op === 'update')).toBe(false);
  });

  it('refuses an empty plan (400): it would store nothing', async () => {
    const { mod, mock } = await load(BASE, superAdmin());
    const res = await mod.PUT(
      put({ plan: {}, fileName: 'a.xlsx', method: 'script' }),
      params()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('EMPTY_PLAN');
    expect(mock.calls.some(c => c.op === 'update')).toBe(false);
  });

  it('refuses a plan above 200 KB (413)', async () => {
    const { mod, mock } = await load(BASE, superAdmin());
    const plan = {
      relations: Array.from({ length: 2000 }, (_, i) => ({
        type: 'enabler_learning_field',
        from: `K${i}-${'a'.repeat(50)}`,
        to: `LF-${i}-${'b'.repeat(50)}`,
      })),
      components: Array.from({ length: 100 }, (_, i) => ({
        code: `K${i}`,
        title: 'T'.repeat(200),
      })),
      notes: Array.from({ length: 20 }, () => 'n'.repeat(500)),
    };
    const res = await mod.PUT(
      put({ plan, fileName: 'a.xlsx', method: 'script' }),
      params()
    );
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('TOO_LARGE');
    expect(mock.calls.some(c => c.op === 'update')).toBe(false);
  });

  it('is closed to an organization admin, a trainer and an anonymous caller', async () => {
    for (const [session, status] of [
      [orgAdmin(), 403],
      [trainer(), 403],
      [null, 401],
    ] as const) {
      const { mod, mock } = await load(BASE, session);
      const res = await mod.PUT(
        put({ plan: { totals: { enablers: 1 } }, fileName: 'a', method: 'ki' }),
        params()
      );
      expect(res.status).toBe(status);
      expect(mock.calls.some(c => c.op === 'update')).toBe(false);
    }
  });

  it('answers 404 for an unknown catalog and for a bad id', async () => {
    const { mod } = await load(BASE, superAdmin(), {}, []);
    const body = {
      plan: { totals: { enablers: 1 } },
      fileName: 'a',
      method: 'ki',
    };
    expect((await mod.PUT(put(body), params())).status).toBe(404);
    expect((await mod.PUT(put(body), params('x'))).status).toBe(404);
  });
});

describe('DELETE /content-plan', () => {
  const del = () => makeRequest('DELETE', url(), { token: 't' });

  it('removes only the plan key', async () => {
    const { mod, mock } = await load(BASE, superAdmin(), {
      content_plan: stored,
    });
    const res = await mod.DELETE(del(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ catalogId: FIAE, stored: null });
    const sql = settingsWrites(mock);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain("- 'content_plan'");
    expect(sql[0]).not.toContain('content_targets');
  });

  it('is closed to everybody else and 404 for an unknown catalog', async () => {
    for (const [session, status] of [
      [orgAdmin(), 403],
      [trainer(), 403],
      [null, 401],
    ] as const) {
      const { mod, mock } = await load(BASE, session, { content_plan: stored });
      expect((await mod.DELETE(del(), params())).status).toBe(status);
      expect(mock.calls.some(c => c.op === 'update')).toBe(false);
    }
    const { mod } = await load(BASE, superAdmin(), {}, []);
    expect((await mod.DELETE(del(), params())).status).toBe(404);
  });
});

describe('GET /content-plan/template', () => {
  const ROUTE = `${BASE}/template`;
  const get = (query = '') =>
    makeRequest('GET', url(`/template${query}`), { token: 't' });

  it('delivers the Excel template (default) and the JSON template', async () => {
    const { mod } = await load(ROUTE, superAdmin());
    const xlsx = await mod.GET(get(), params());
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');
    expect(xlsx.headers.get('content-disposition')).toContain(
      'plan-vorlage.xlsx'
    );
    const bytes = new Uint8Array(await xlsx.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');

    const json = await mod.GET(get('?format=json'), params());
    expect(json.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(await json.text()).components).toEqual(
      EXAMPLE_PLAN.components
    );
  });

  it('refuses another format, and everybody without the right', async () => {
    const { mod } = await load(ROUTE, superAdmin());
    expect((await mod.GET(get('?format=exe'), params())).status).toBe(400);
    expect(
      (
        await mod.GET(
          makeRequest('GET', url('/template', 'x'), { token: 't' }),
          params('x')
        )
      ).status
    ).toBe(404);
    for (const [session, status] of [
      [orgAdmin(), 403],
      [trainer(), 403],
      [null, 401],
    ] as const) {
      const { mod: m } = await load(ROUTE, session);
      expect((await m.GET(get(), params())).status).toBe(status);
    }
  });
});

describe('POST /content-plan/parse', () => {
  const ROUTE = `${BASE}/parse`;
  const post = (
    file: File | null,
    fields: Record<string, string> = {},
    headers: Record<string, string> = {}
  ) => {
    const form = new FormData();
    if (file) form.append('file', file);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const request = makeRequest('POST', url('/parse'), { token: 't', headers });
    request.formData = async () => form;
    return request;
  };
  const file = (name: string, content: BlobPart) => new File([content], name);

  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  it('reads the template of an xlsx into a proposal and stores nothing', async () => {
    const { mod, mock } = await load(ROUTE, superAdmin());
    const res = await mod.POST(
      post(file('plan.xlsx', new Uint8Array(await buildTemplateXlsx()))),
      params()
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      catalogId: FIAE,
      fileName: 'plan.xlsx',
      method: 'script',
      issues: [],
    });
    expect(body.warnings).toContain('EXAMPLE_TEMPLATE');
    expect(body.rows.length).toBeGreaterThan(20);
    expect(body.rows[0]).toMatchObject({ scope: 'totals' });
    expect(body.rows.every((r: any) => typeof r.quote === 'string')).toBe(true);
    // nothing is saved by reading
    expect(mock.calls.some(c => c.op === 'update' || c.op === 'insert')).toBe(
      false
    );
  });

  it('reads json and csv by script', async () => {
    const { mod } = await load(ROUTE, superAdmin());
    const json = await mod.POST(
      post(file('p.json', buildTemplateJson())),
      params()
    );
    expect((await json.json()).method).toBe('script');
    const csv = await mod.POST(
      post(file('p.csv', 'Kennzahl;Wert\nEnabler;226\n')),
      params()
    );
    expect(csv.status).toBe(200);
    expect((await csv.json()).rows).toMatchObject([
      { field: 'enablers', value: 226 },
    ]);
  });

  it('refuses a type that is not read, also when the first bytes do not fit', async () => {
    const { mod } = await load(ROUTE, superAdmin());
    for (const f of [
      file('tool.exe', 'MZ'),
      file('plan.xlsx', 'this is no zip'),
      file('plan.pdf', 'no pdf'),
      file('plan.docx', '%PDF-1.4'),
      file('plan.json', new Uint8Array([123, 0, 0, 125])),
      file('plan', 'x'),
    ]) {
      const res = await mod.POST(post(f), params());
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('UNSUPPORTED_TYPE');
    }
  });

  it('checks the size on the server: 5 MB at most', async () => {
    const { mod } = await load(ROUTE, superAdmin());
    const big = file('plan.csv', new Uint8Array(5 * 1024 * 1024 + 1));
    const res = await mod.POST(post(big), params());
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('FILE_TOO_LARGE');
    // a declared size above the limit is refused before the body is read
    const declared = await mod.POST(
      post(
        file('a.csv', 'x'),
        {},
        { 'content-length': String(50 * 1024 * 1024) }
      ),
      params()
    );
    expect(declared.status).toBe(413);
    const exactly = file(
      'plan.csv',
      `Kennzahl;Wert\nEnabler;1\n${' '.repeat(5 * 1024 * 1024 - 30)}`
    );
    expect(exactly.size).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect((await mod.POST(post(exactly), params())).status).toBe(200);
  });

  it('answers 400 without a file and for an empty file', async () => {
    const { mod } = await load(ROUTE, superAdmin());
    const none = await mod.POST(post(null), params());
    expect(none.status).toBe(400);
    expect((await none.json()).code).toBe('NO_FILE');
    const empty = await mod.POST(post(file('a.json', '')), params());
    expect((await empty.json()).code).toBe('EMPTY_FILE');
    // a text in place of the file
    const request = makeRequest('POST', url('/parse'), { token: 't' });
    const form = new FormData();
    form.append('file', 'just text');
    request.formData = async () => form;
    expect((await mod.POST(request, params())).status).toBe(400);
  });

  it('answers 422 with a code for a file that is no plan', async () => {
    const { mod } = await load(ROUTE, superAdmin());
    const res = await mod.POST(post(file('a.csv', 'nur ein Satz')), params());
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('NO_PLAN_TABLE');
  });

  it('checks the catalog id (404 for a bad id and for an unknown catalog)', async () => {
    const { mod } = await load(ROUTE, superAdmin(), {}, []);
    const f = file('a.json', buildTemplateJson());
    expect((await mod.POST(post(f), params())).status).toBe(404);
    expect((await mod.POST(post(f), params('x'))).status).toBe(404);
  });

  it('is closed to an organization admin, a trainer and an anonymous caller', async () => {
    for (const [session, status] of [
      [orgAdmin(), 403],
      [trainer(), 403],
      [null, 401],
    ] as const) {
      const { mod } = await load(ROUTE, session);
      const res = await mod.POST(
        post(file('a.json', buildTemplateJson())),
        params()
      );
      expect(res.status).toBe(status);
    }
  });

  describe('Word and PDF go to the AI only when asked', () => {
    const doc = () =>
      docxFromBlocks([
        plain('Die Ausbildung umfasst 12 Komponenten und 60 Enabler.'),
        plain('Insgesamt sind 1200 Stunden vorgesehen.'),
      ]);
    const kiOn = () => {
      process.env.CONTENT_UPLOAD_KI_ENABLED = 'true';
      process.env.OPENAI_COMPATIBLE_API_KEY = 'test-key-123';
      delete process.env.OPENAI_COMPATIBLE_BASE_URL;
    };
    const answer = (felder: unknown[]) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ felder }) } }],
        }),
        { status: 200 }
      );

    it('without ki=true the AI is not used (400 KI_REQUIRED)', async () => {
      kiOn();
      const spy = jest.spyOn(global, 'fetch');
      const { mod } = await load(ROUTE, superAdmin());
      const res = await mod.POST(
        post(file('plan.docx', new Uint8Array(await doc()))),
        params()
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('KI_REQUIRED');
      expect(spy).not.toHaveBeenCalled();
    });

    it('with ki=true and the stage switched off: 503, nothing sent', async () => {
      delete process.env.CONTENT_UPLOAD_KI_ENABLED;
      const spy = jest.spyOn(global, 'fetch');
      const { mod } = await load(ROUTE, superAdmin());
      const res = await mod.POST(
        post(file('plan.docx', new Uint8Array(await doc())), { ki: 'true' }),
        params()
      );
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe('KI_DISABLED');
      expect(spy).not.toHaveBeenCalled();
    });

    describe('in Production (switch CONTENT_CHECK_KI_PRODUCTION)', () => {
      const production = () => {
        process.env.VERCEL_ENV = 'production';
        process.env.OPENAI_COMPATIBLE_API_KEY = 'test-key-123';
        process.env.OPENAI_COMPATIBLE_MODEL = 'sokrates-fast';
        delete process.env.OPENAI_COMPATIBLE_BASE_URL;
        delete process.env.CONTENT_UPLOAD_KI_ENABLED;
      };

      it('switch off (the default): 503 KI_UNAVAILABLE, nothing sent', async () => {
        production();
        delete process.env.CONTENT_CHECK_KI_PRODUCTION;
        const spy = jest.spyOn(global, 'fetch');
        const { mod } = await load(ROUTE, superAdmin());
        const res = await mod.POST(
          post(file('plan.docx', new Uint8Array(await doc())), { ki: 'true' }),
          params()
        );
        expect(res.status).toBe(503);
        expect((await res.json()).code).toBe('KI_UNAVAILABLE');
        expect(spy).not.toHaveBeenCalled();
      });

      it('switch on: the AI reads the plan, Sokrates is the only target and the model is the one of the environment', async () => {
        production();
        process.env.CONTENT_CHECK_KI_PRODUCTION = 'true';
        const spy = jest.spyOn(global, 'fetch').mockResolvedValue(
          answer([
            {
              bereich: 'gesamt',
              feld: 'komponenten',
              wert: 12,
              fundstelle:
                'Die Ausbildung umfasst 12 Komponenten und 60 Enabler.',
            },
          ])
        );
        const { mod } = await load(ROUTE, superAdmin());
        const res = await mod.POST(
          post(file('plan.docx', new Uint8Array(await doc())), { ki: 'true' }),
          params()
        );
        expect(res.status).toBe(200);
        expect((await res.json()).method).toBe('ki');
        expect(spy).toHaveBeenCalledTimes(1);
        const [target, init] = spy.mock.calls[0] as [string, RequestInit];
        expect(new URL(target).host).toBe(
          'sokrates.test-qualitaetsmanagement.com'
        );
        expect(JSON.parse(String(init.body)).model).toBe('sokrates-fast');
      });

      it('switch on, but the right stays: an organization admin gets 403 and nothing is sent', async () => {
        production();
        process.env.CONTENT_CHECK_KI_PRODUCTION = 'true';
        const spy = jest.spyOn(global, 'fetch');
        const { mod } = await load(ROUTE, orgAdmin());
        const res = await mod.POST(
          post(file('plan.docx', new Uint8Array(await doc())), { ki: 'true' }),
          params()
        );
        expect(res.status).toBe(403);
        expect(spy).not.toHaveBeenCalled();
      });
    });

    it('returns a proposal that only holds checked fields, and stores nothing', async () => {
      kiOn();
      const spy = jest.spyOn(global, 'fetch').mockResolvedValue(
        answer([
          {
            bereich: 'gesamt',
            feld: 'komponenten',
            wert: 12,
            fundstelle: 'Die Ausbildung umfasst 12 Komponenten und 60 Enabler.',
          },
          {
            bereich: 'gesamt',
            feld: 'stunden',
            wert: 1500,
            fundstelle: 'Insgesamt sind 1200 Stunden vorgesehen.',
          },
          { bereich: 'gesamt', feld: 'enabler', wert: 60 },
        ])
      );
      const { mod, mock } = await load(ROUTE, superAdmin());
      const res = await mod.POST(
        post(file('plan.docx', new Uint8Array(await doc())), { ki: 'true' }),
        params()
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.method).toBe('ki');
      expect(body.rows).toMatchObject([
        { scope: 'totals', field: 'components', value: 12 },
      ]);
      expect(body.warnings).toContain('KI_REVIEW');
      expect(body.ki).toMatchObject({ accepted: 1, dropped: 2 });
      // only the own AI host, with the key in the header and the text between markers
      expect(spy).toHaveBeenCalledTimes(1);
      const [target, init] = spy.mock.calls[0] as [string, RequestInit];
      expect(new URL(target).host).toBe(
        'sokrates.test-qualitaetsmanagement.com'
      );
      expect(init.redirect).toBe('error');
      expect(String(init.body)).not.toContain('plan.docx');
      expect(String(init.body)).not.toContain('test-key-123');
      expect(mock.calls.some(c => c.op === 'update' || c.op === 'insert')).toBe(
        false
      );
    });

    it('reads a pdf by the AI as well', async () => {
      kiOn();
      jest.spyOn(global, 'fetch').mockResolvedValue(
        answer([
          {
            bereich: 'gesamt',
            feld: 'komponenten',
            wert: 12,
            fundstelle: 'Die Ausbildung umfasst 12 Komponenten',
          },
        ])
      );
      const { mod } = await load(ROUTE, superAdmin());
      const pdf = pdfBytes({
        pages: [
          [
            'Die Ausbildung umfasst 12 Komponenten und 60 Enabler.',
            'Dies ist ein erfundener Rahmenplan fuer den Test mit genug Text.',
          ],
        ],
      });
      const res = await mod.POST(
        post(file('plan.pdf', new Uint8Array(pdf)), { ki: 'true' }),
        params()
      );
      expect(res.status).toBe(200);
      expect((await res.json()).rows).toHaveLength(1);
    });

    it('answers 429 when the budget is used up and 502 when the AI fails', async () => {
      kiOn();
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('x', { status: 500 }));
      const { mod } = await load(ROUTE, superAdmin());
      const bytes = new Uint8Array(await doc());
      const first = await mod.POST(
        post(file('plan.docx', bytes), { ki: 'true' }),
        params()
      );
      expect(first.status).toBe(502);
      expect((await first.json()).code).toBe('KI_FAILED');
      // three failures in a row open the breaker of this process
      await mod.POST(post(file('plan.docx', bytes), { ki: 'true' }), params());
      await mod.POST(post(file('plan.docx', bytes), { ki: 'true' }), params());
      const rest = await mod.POST(
        post(file('plan.docx', bytes), { ki: 'true' }),
        params()
      );
      expect(rest.status).toBe(429);
      expect((await rest.json()).code).toBe('BREAKER');
    });

    it('refuses a Word file with a macro before anything is sent', async () => {
      kiOn();
      const spy = jest.spyOn(global, 'fetch');
      const { mod } = await load(ROUTE, superAdmin());
      const macro = await docxFromBlocks(
        [plain('Text mit genug Zeichen für den Test.')],
        {
          parts: { 'word/vbaProject.bin': 'x' },
        }
      );
      const res = await mod.POST(
        post(file('plan.docx', new Uint8Array(macro)), { ki: 'true' }),
        params()
      );
      expect(res.status).toBe(422);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
