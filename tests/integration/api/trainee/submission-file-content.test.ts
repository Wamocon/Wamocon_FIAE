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
  makeRequest,
  mockCatalogScope,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';
import {
  PDF_BYTES,
  createMemorySubmissionStorage,
} from '../../../helpers/memorySubmissionStorage';
import { filePath, submissionFolder } from '@/lib/submission-file/rules';

// WMCNL-2927: the trainee looks at the file of the own submission after the
// upload. The route delivers the bytes of a PDF, a PNG or a JPG to the session
// user only, with the same checks as reading the file info next to it.

const ORG = '11111111-1111-4111-8111-111111111111';
const TRAINEE = '22222222-2222-4222-8222-222222222222';
const OTHER_TRAINEE = '55555555-5555-4555-8555-555555555555';
const USE_CASE = '33333333-3333-4333-8333-333333333333';
const folder = submissionFolder(
  { organizationId: ORG, traineeId: TRAINEE, useCaseId: USE_CASE },
  'public'
) as string;
const JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

const useCaseRow = {
  id: USE_CASE,
  courseId: 'c1',
  isActive: true,
  title: 'UC',
  enablerId: null,
};

type Setup = {
  session?: ReturnType<typeof fakeSession> | null;
  member?: boolean;
  denyCatalog?: boolean;
  storage?: ReturnType<typeof createMemorySubmissionStorage>;
};

async function load(setup: Setup = {}) {
  jest.resetModules();
  const storage = setup.storage ?? createMemorySubmissionStorage('public');
  const { db } = createTableDb({
    useCases: [useCaseRow],
    courseMembers:
      setup.member === false ? [] : [{ userId: TRAINEE, courseId: 'c1' }],
    enablers: [],
    useCaseSubmissions: [],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: db }));
  mockSession(
    setup.session === undefined
      ? traineeSession(TRAINEE, { organizationId: ORG })
      : setup.session
  );
  mockCatalogScope();
  if (setup.denyCatalog) {
    jest.doMock('@/lib/catalog/scope', () => {
      const actual = jest.requireActual('@/lib/catalog/scope') as any;
      const { NextResponse } = jest.requireActual('next/server') as any;
      return {
        ...actual,
        requireContentScopeForUser: async () =>
          NextResponse.json({ error: 'Not found' }, { status: 404 }),
      };
    });
  }
  jest.doMock('@/lib/catalog/progression-db', () => ({
    __esModule: true,
    requireEnablerOpen: async () => null,
  }));
  jest.doMock('@/lib/submission-file/storage', () => {
    const actual = jest.requireActual('@/lib/submission-file/storage') as any;
    return { ...actual, createSubmissionStorage: () => storage };
  });
  const route =
    await import('@/app/api/trainee/use-cases/[useCaseId]/submission-file/content/route');
  return { storage, GET: route.GET };
}

const call = (
  GET: (req: any, ctx: any) => Promise<Response>,
  useCaseId = USE_CASE,
  query = ''
) =>
  GET(
    makeRequest(
      'GET',
      `http://localhost/api/trainee/use-cases/${useCaseId}/submission-file/content${query}`,
      { token: 't' }
    ),
    { params: Promise.resolve({ useCaseId }) }
  );

const originalEnv = { ...process.env };
beforeEach(() => {
  delete (process.env as Record<string, unknown>).VERCEL_ENV;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

describe('GET /api/trainee/use-cases/[useCaseId]/submission-file/content', () => {
  it('delivers the PDF of the own submission, shown in the page and never cached', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(filePath(folder, 1761700000000, 'a.pdf'), PDF_BYTES);
    const { GET } = await load({ storage });
    const res = await call(GET);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it('delivers a JPG as an image', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(filePath(folder, 1761700000000, 'foto.jpg'), JPG_BYTES);
    const { GET } = await load({ storage });
    expect((await call(GET)).headers.get('content-type')).toBe('image/jpeg');
  });

  it('answers 415 for a Word file, which is only downloaded', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(
      filePath(folder, 1761700000000, 'a.docx'),
      new Uint8Array([0x50, 0x4b, 3, 4])
    );
    const { GET } = await load({ storage });
    const res = await call(GET);
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe('NOT_PREVIEWABLE');
  });

  it('answers 404 when no file is attached', async () => {
    const { GET } = await load();
    expect((await call(GET)).status).toBe(404);
  });

  it('reads the folder of the session user only: a traineeId in the query does not exist', async () => {
    const storage = createMemorySubmissionStorage('public');
    const foreign = submissionFolder(
      { organizationId: ORG, traineeId: OTHER_TRAINEE, useCaseId: USE_CASE },
      'public'
    ) as string;
    storage.objects.set(
      filePath(foreign, 1761700000000, 'fremd.pdf'),
      PDF_BYTES
    );
    const { GET } = await load({ storage });
    const res = await call(GET, USE_CASE, `?traineeId=${OTHER_TRAINEE}`);
    expect(res.status).toBe(404);
  });

  it('is closed for a trainer level caller and for a caller without a session', async () => {
    const trainer = await load({ session: fakeSession() });
    expect((await call(trainer.GET)).status).toBe(403);
    const anonymous = await load({ session: null });
    expect((await call(anonymous.GET)).status).toBe(401);
  });

  it('answers 404 for a use case outside of the occupation and 403 without a course membership', async () => {
    expect((await call((await load({ denyCatalog: true })).GET)).status).toBe(
      404
    );
    expect((await call((await load({ member: false })).GET)).status).toBe(403);
  });

  it('answers 404 for an id that is no uuid', async () => {
    const { GET } = await load();
    expect((await call(GET, 'nope')).status).toBe(404);
  });

  it('answers 404 in Production', async () => {
    process.env.VERCEL_ENV = 'production';
    const { GET } = await load();
    expect((await call(GET)).status).toBe(404);
  });

  it('answers 503 when the storage fails', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.failNext('list');
    const { GET } = await load({ storage });
    const res = await call(GET);
    expect(res.status).toBe(503);
  });
});
