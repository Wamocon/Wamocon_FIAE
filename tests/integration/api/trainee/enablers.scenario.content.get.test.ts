/**
 * @jest-environment node
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';

// GET /api/trainee/enablers/[enablerId]/scenario/content: the bytes of the
// single scenario PDF that an enabler carries itself (no document row, so the
// enabler is the identifier). The rule is that of the enabler page: occupation,
// active enabler, course membership. No address comes from the request.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ENABLER = 'aaaaaaa6-0000-4000-8000-000000000006';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const ORG = 'org-1';
const ORIGIN = 'https://proj.supabase.co';
const PATH = 'preview/kfbm/K6.2-d/szenario/Szenario_K1a.pdf';
const PUBLIC = `${ORIGIN}/storage/v1/object/public/content/${PATH}`;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

const enabler = (overrides: Record<string, unknown> = {}) => ({
  id: ENABLER,
  isActive: true,
  courseId: COURSE,
  trainingCatalogId: FIAE,
  scenarioPdfUrl: PUBLIC,
  ...overrides,
});

function tables(overrides: Record<string, any> = {}) {
  return {
    trainingCatalogs: [
      { id: FIAE, code: 'FIAE', isActive: true },
      { id: KFBM, code: 'KFBM', isActive: true },
    ],
    organizationCatalogs: [
      { trainingCatalogId: FIAE, isEnabled: true },
      { trainingCatalogId: KFBM, isEnabled: true },
    ],
    profiles: [
      {
        id: 't1',
        role: 'TRAINEE',
        organizationId: ORG,
        isPlatformOwner: false,
      },
    ],
    traineeEnrollments: [{ trainingCatalogId: FIAE, startDate: '2026-01-01' }],
    enablers: [enabler()],
    courses: [{ id: COURSE, trainingCatalogId: FIAE }],
    courseMembers: [{ userId: 't1', courseId: COURSE, role: 'TRAINEE' }],
    ...overrides,
  };
}

const request = (
  url = `http://localhost/api/trainee/enablers/${ENABLER}/scenario/content`
) =>
  ({
    url,
    method: 'GET',
    nextUrl: new URL(url),
    headers: { get: () => null },
  }) as any;

const ctx = (enablerId = ENABLER) => ({
  params: Promise.resolve({ enablerId }),
});

async function load(
  session: ReturnType<typeof fakeSession> | null,
  rows: Record<string, any> = tables()
) {
  jest.resetModules();
  jest.dontMock('@/lib/catalog/scope');
  const mock = createTableDb(rows);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const downloads: Array<{ bucket: string; path: string }> = [];
  jest.doMock('@supabase/supabase-js', () => ({
    __esModule: true,
    createClient: () => ({
      storage: {
        from: (bucket: string) => ({
          download: async (path: string) => {
            downloads.push({ bucket, path });
            return {
              data: {
                size: PDF.length,
                arrayBuffer: async () =>
                  PDF.buffer.slice(
                    PDF.byteOffset,
                    PDF.byteOffset + PDF.byteLength
                  ),
              },
              error: null,
            };
          },
        }),
      },
    }),
  }));
  mockSession(session);
  const mod =
    await import('@/app/api/trainee/enablers/[enablerId]/scenario/content/route');
  return { mock, GET: mod.GET, downloads };
}

const asTrainee = () => traineeSession('t1', { organizationId: ORG });

const saved = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.SUPABASE_SECRET_KEY,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
  process.env.SUPABASE_SECRET_KEY = 'sb-secret';
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
  if (saved.key === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = saved.key;
});

describe('GET /api/trainee/enablers/[enablerId]/scenario/content', () => {
  it('delivers the scenario PDF of the enabler inline, not cached, without a name', async () => {
    const { GET, downloads } = await load(asTrainee());
    const res = await GET(request(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    expect(downloads).toEqual([{ bucket: 'content', path: PATH }]);
  });

  it('takes the file from the row, an address or path in the request changes nothing', async () => {
    const { GET, downloads } = await load(asTrainee());
    const res = await GET(
      request(
        `http://localhost/api/trainee/enablers/${ENABLER}/scenario/content?path=x/y.pdf&url=${encodeURIComponent('https://evil.test/a.pdf')}`
      ),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(downloads).toEqual([{ bucket: 'content', path: PATH }]);
  });

  it('404 for every case without access, nothing is read', async () => {
    for (const rows of [
      // another occupation
      tables({ enablers: [enabler({ trainingCatalogId: KFBM })] }),
      // no member of the course
      tables({ courseMembers: [] }),
      // enabler off
      tables({ enablers: [enabler({ isActive: false })] }),
      // no scenario PDF on the enabler
      tables({ enablers: [enabler({ scenarioPdfUrl: null })] }),
      tables({ enablers: [enabler({ scenarioPdfUrl: '  ' })] }),
      // a model solution of the private bucket, a link to another host
      tables({
        enablers: [
          enabler({
            scenarioPdfUrl: 'private://content-solutions/preview/kfbm/x.pdf',
          }),
        ],
      }),
      tables({
        enablers: [enabler({ scenarioPdfUrl: 'https://example.test/a.pdf' })],
      }),
      // no such enabler
      tables({ enablers: [] }),
    ]) {
      const { GET, downloads } = await load(asTrainee(), rows);
      const res = await GET(request(), ctx());
      expect(res.status).toBe(404);
      expect(downloads).toEqual([]);
    }
  });

  it('404 for an id that is no uuid, without a query', async () => {
    for (const id of ['not-a-uuid', PATH, '../x']) {
      const { GET, mock } = await load(asTrainee());
      expect((await GET(request(), ctx(id))).status).toBe(404);
      expect(mock.calls.some(c => c.table === 'enablers')).toBe(false);
    }
  });

  it('401 without a session, 403 for a trainer', async () => {
    const anonymous = await load(null);
    expect((await anonymous.GET(request(), ctx())).status).toBe(401);
    const trainer = await load(fakeSession({ organizationId: ORG }));
    expect((await trainer.GET(request(), ctx())).status).toBe(403);
    expect(trainer.downloads).toEqual([]);
  });

  it('fails closed (5xx) when the database fails, without a trace of the address', async () => {
    const { GET, mock } = await load(asTrainee());
    mock.db.select.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const res = await GET(request(), ctx());
    // the first lookup is the occupation check, which fails closed with 503
    expect([500, 503]).toContain(res.status);
    expect(JSON.stringify(await res.json())).not.toContain(PATH);
  });
});
