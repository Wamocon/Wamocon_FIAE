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

const ORG = '11111111-1111-4111-8111-111111111111';
const TRAINEE = '22222222-2222-4222-8222-222222222222';
const USE_CASE = '33333333-3333-4333-8333-333333333333';
const SUBMISSION = '88888888-8888-4888-8888-888888888888';
const folder = submissionFolder(
  { organizationId: ORG, traineeId: TRAINEE, useCaseId: USE_CASE },
  'public'
) as string;

const submissionRow = {
  traineeId: TRAINEE,
  useCaseId: USE_CASE,
  organizationId: ORG,
};

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
    useCaseSubmissions: setup.submissions ?? [submissionRow],
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
    await import('@/app/api/trainer/reviews/use-cases/[submissionId]/file/route');
  return { storage, GET: route.GET };
}

const call = (
  GET: (req: any, ctx: any) => Promise<Response>,
  submissionId = SUBMISSION
) =>
  GET(
    makeRequest(
      'GET',
      `http://localhost/api/trainer/reviews/use-cases/${submissionId}/file`,
      {
        token: 't',
      }
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

describe('GET /api/trainer/reviews/use-cases/[submissionId]/file', () => {
  it('gives the responsible trainer the file with a short lived read link', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(
      filePath(folder, 1761700000000, 'Loesung.pdf'),
      PDF_BYTES
    );
    const { GET } = await load({ storage });
    const res = await call(GET);
    expect(res.status).toBe(200);
    const { file } = await res.json();
    expect(file.fileName).toBe('Loesung.pdf');
    expect(file.url).toContain('t=120');
    expect(file.url).toContain('download=Loesung.pdf');
  });

  it('answers file null when the trainee attached none', async () => {
    const { GET } = await load();
    expect(await (await call(GET)).json()).toEqual({ file: null });
  });

  it('uses the ids of the stored submission, not anything from the request', async () => {
    const storage = createMemorySubmissionStorage('public');
    // a file of another use case of the same trainee must not show up
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
    expect((await (await call(GET)).json()).file).toBeNull();
  });

  it('answers 404 for a submission of a trainee outside of the responsibility of the trainer', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(filePath(folder, 1761700000000, 'a.pdf'), PDF_BYTES);
    const { GET } = await load({ storage, access: 'missing' });
    const res = await call(GET);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('a.pdf');
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

describe('GET /api/me/submission-file', () => {
  async function loadStatus(session: ReturnType<typeof fakeSession> | null) {
    jest.resetModules();
    mockSession(session);
    return import('@/app/api/me/submission-file/route');
  }

  it('tells a signed-in user whether the feature is on, with the limits', async () => {
    const { GET } = await loadStatus(traineeSession(TRAINEE));
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/me/submission-file', {
        token: 't',
      })
    );
    expect(await res.json()).toEqual({
      enabled: true,
      maxBytes: 10 * 1024 * 1024,
      extensions: ['pdf', 'docx', 'xlsx', 'png', 'jpg'],
    });
  });

  it('says off in Production', async () => {
    process.env.VERCEL_ENV = 'production';
    const { GET } = await loadStatus(traineeSession(TRAINEE));
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/me/submission-file', {
        token: 't',
      })
    );
    expect((await res.json()).enabled).toBe(false);
  });

  it('needs a session', async () => {
    const { GET } = await loadStatus(null);
    const res = await GET(
      makeRequest('GET', 'http://localhost/api/me/submission-file')
    );
    expect(res.status).toBe(401);
  });
});
