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
  mockTraineeAccess,
  traineeSession,
} from '../../../helpers/mockNext';
import {
  PDF_BYTES,
  createMemorySubmissionStorage,
} from '../../../helpers/memorySubmissionStorage';
import { filePath, submissionFolder } from '@/lib/submission-file/rules';

// WMCNL-2927: the trainer looks at the file of a submission in the platform. The
// route delivers the bytes of a PDF, a PNG or a JPG with the same access as the
// download route next to it, and refuses Word and Excel files (only downloaded).

const ORG = '11111111-1111-4111-8111-111111111111';
const TRAINEE = '22222222-2222-4222-8222-222222222222';
const USE_CASE = '33333333-3333-4333-8333-333333333333';
const SUBMISSION = '88888888-8888-4888-8888-888888888888';
const folder = submissionFolder(
  { organizationId: ORG, traineeId: TRAINEE, useCaseId: USE_CASE },
  'public'
) as string;
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

type Setup = {
  session?: ReturnType<typeof fakeSession> | null;
  submissions?: any[];
  access?: 'ok' | 'forbidden' | 'missing';
  denyUseCase?: boolean;
  storage?: ReturnType<typeof createMemorySubmissionStorage>;
};

async function load(setup: Setup = {}) {
  jest.resetModules();
  const storage = setup.storage ?? createMemorySubmissionStorage('public');
  const { db } = createTableDb({
    useCaseSubmissions: setup.submissions ?? [
      { traineeId: TRAINEE, useCaseId: USE_CASE, organizationId: ORG },
    ],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: db }));
  mockSession(setup.session === undefined ? fakeSession() : setup.session);
  mockCatalogScope();
  if (setup.denyUseCase) {
    jest.doMock('@/lib/catalog/scope', () => {
      const actual = jest.requireActual('@/lib/catalog/scope') as any;
      const { NextResponse } = jest.requireActual('next/server') as any;
      return {
        ...actual,
        requireCatalogScope: async () => ({
          allowedCatalogIds: ['x'],
          activeCatalogId: 'x',
          selected: false,
        }),
        ensureContentInScope: async () =>
          NextResponse.json({ error: 'Not found' }, { status: 404 }),
      };
    });
  }
  mockTraineeAccess(setup.access ?? 'ok');
  jest.doMock('@/lib/submission-file/storage', () => {
    const actual = jest.requireActual('@/lib/submission-file/storage') as any;
    return { ...actual, createSubmissionStorage: () => storage };
  });
  const route =
    await import('@/app/api/trainer/reviews/use-cases/[submissionId]/file/content/route');
  return { storage, GET: route.GET };
}

const call = (
  GET: (req: any, ctx: any) => Promise<Response>,
  submissionId = SUBMISSION
) =>
  GET(
    makeRequest(
      'GET',
      `http://localhost/api/trainer/reviews/use-cases/${submissionId}/file/content`,
      { token: 't' }
    ),
    { params: Promise.resolve({ submissionId }) }
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

describe('GET /api/trainer/reviews/use-cases/[submissionId]/file/content', () => {
  it('delivers a PDF to the responsible trainer, shown in the page and never cached', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(
      filePath(folder, 1761700000000, 'Loesung.pdf'),
      PDF_BYTES
    );
    const { GET } = await load({ storage });
    const res = await call(GET);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it('delivers a PNG as an image', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(filePath(folder, 1761700000000, 'Bild.png'), PNG_BYTES);
    const { GET } = await load({ storage });
    const res = await call(GET);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-length')).toBe(String(PNG_BYTES.length));
  });

  it('takes the newest file when there are several', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(filePath(folder, 1761700000000, 'alt.pdf'), PDF_BYTES);
    storage.objects.set(filePath(folder, 1761700009999, 'neu.png'), PNG_BYTES);
    const { GET } = await load({ storage });
    expect((await call(GET)).headers.get('content-type')).toBe('image/png');
  });

  it.each(['Bericht.docx', 'Tabelle.xlsx'])(
    'answers 415 for %s: Word and Excel files are only downloaded',
    async name => {
      const storage = createMemorySubmissionStorage('public');
      storage.objects.set(
        filePath(folder, 1761700000000, name),
        new Uint8Array([0x50, 0x4b, 3, 4])
      );
      const { GET } = await load({ storage });
      const res = await call(GET);
      expect(res.status).toBe(415);
      expect((await res.json()).code).toBe('NOT_PREVIEWABLE');
    }
  );

  it('answers 404 when the trainee attached no file', async () => {
    const { GET } = await load();
    expect((await call(GET)).status).toBe(404);
  });

  it('does not show the file of another use case of the same trainee', async () => {
    const storage = createMemorySubmissionStorage('public');
    const otherFolder = submissionFolder(
      {
        organizationId: ORG,
        traineeId: TRAINEE,
        useCaseId: '99999999-9999-4999-8999-999999999999',
      },
      'public'
    ) as string;
    storage.objects.set(
      filePath(otherFolder, 1761700000000, 'andere.pdf'),
      PDF_BYTES
    );
    const { GET } = await load({ storage });
    expect((await call(GET)).status).toBe(404);
  });

  it('answers 404 for a trainee outside of the responsibility of the trainer, without the file', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(filePath(folder, 1761700000000, 'a.pdf'), PDF_BYTES);
    const { GET } = await load({ storage, access: 'missing' });
    const res = await call(GET);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).not.toBe('application/pdf');
  });

  it('answers 403 where the responsibility check says so', async () => {
    const { GET } = await load({ access: 'forbidden' });
    expect((await call(GET)).status).toBe(403);
  });

  it('answers 404 for a use case outside of the occupation of the trainer', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(filePath(folder, 1761700000000, 'a.pdf'), PDF_BYTES);
    const { GET } = await load({ storage, denyUseCase: true });
    expect((await call(GET)).status).toBe(404);
  });

  it('answers 404 for an unknown submission and for an id that is no uuid', async () => {
    const empty = await load({ submissions: [] });
    expect((await call(empty.GET)).status).toBe(404);
    const { GET } = await load();
    expect((await call(GET, '../x')).status).toBe(404);
  });

  it('is closed for a trainee and for a caller without a session', async () => {
    const trainee = await load({ session: traineeSession(TRAINEE) });
    expect((await call(trainee.GET)).status).toBe(403);
    const anonymous = await load({ session: null });
    expect((await call(anonymous.GET)).status).toBe(401);
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
    expect((await res.json()).code).toBe('STORAGE_ERROR');
  });
});

describe('GET /api/trainer/reviews/use-cases/[submissionId]/file?link=0', () => {
  it('answers name, size and date without a read link', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(filePath(folder, 1761700000000, 'a.pdf'), PDF_BYTES);
    jest.resetModules();
    const { db } = createTableDb({
      useCaseSubmissions: [
        { traineeId: TRAINEE, useCaseId: USE_CASE, organizationId: ORG },
      ],
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: db }));
    mockSession(fakeSession());
    mockCatalogScope();
    mockTraineeAccess('ok');
    jest.doMock('@/lib/submission-file/storage', () => {
      const actual = jest.requireActual('@/lib/submission-file/storage') as any;
      return { ...actual, createSubmissionStorage: () => storage };
    });
    const { GET } =
      await import('@/app/api/trainer/reviews/use-cases/[submissionId]/file/route');
    const read = async (suffix: string) =>
      (
        await GET(
          makeRequest(
            'GET',
            `http://localhost/api/trainer/reviews/use-cases/${SUBMISSION}/file${suffix}`,
            { token: 't' }
          ),
          { params: Promise.resolve({ submissionId: SUBMISSION }) }
        )
      ).json();
    expect((await read('?link=0')).file).toMatchObject({ fileName: 'a.pdf' });
    expect((await read('?link=0')).file.url).toBeUndefined();
    expect((await read('')).file.url).toContain('t=120');
  });
});
