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
import {
  filePath,
  incomingPath,
  submissionFolder,
} from '@/lib/submission-file/rules';

const ORG = '11111111-1111-4111-8111-111111111111';
const TRAINEE = '22222222-2222-4222-8222-222222222222';
const USE_CASE = '33333333-3333-4333-8333-333333333333';
const UPLOAD = '44444444-4444-4444-8444-444444444444';
const scope = { organizationId: ORG, traineeId: TRAINEE, useCaseId: USE_CASE };
const folder = submissionFolder(scope, 'public') as string;

const useCaseRow = {
  id: USE_CASE,
  courseId: 'c1',
  isActive: true,
  title: 'UC',
  enablerId: null,
};
const memberRow = { userId: TRAINEE, courseId: 'c1' };

type Setup = {
  session?: ReturnType<typeof fakeSession> | null;
  tables?: Record<string, any[]>;
  denyCatalog?: boolean;
  lockedEnabler?: boolean;
  storage?: ReturnType<typeof createMemorySubmissionStorage>;
  storageThrows?: unknown;
};

async function load(setup: Setup = {}) {
  jest.resetModules();
  const storage = setup.storage ?? createMemorySubmissionStorage('public');
  const { db } = createTableDb({
    useCases: [useCaseRow],
    courseMembers: [memberRow],
    enablers: [],
    useCaseSubmissions: [],
    ...(setup.tables ?? {}),
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
  jest.doMock('@/lib/catalog/progression-db', () => {
    const { NextResponse } = jest.requireActual('next/server') as any;
    return {
      __esModule: true,
      requireEnablerOpen: async () =>
        setup.lockedEnabler
          ? NextResponse.json({ error: 'Locked' }, { status: 423 })
          : null,
    };
  });
  jest.doMock('@/lib/submission-file/storage', () => {
    const actual = jest.requireActual('@/lib/submission-file/storage') as any;
    return {
      ...actual,
      createSubmissionStorage: () => {
        if (setup.storageThrows) throw setup.storageThrows;
        return storage;
      },
    };
  });
  const main =
    await import('@/app/api/trainee/use-cases/[useCaseId]/submission-file/route');
  const upload =
    await import('@/app/api/trainee/use-cases/[useCaseId]/submission-file/upload-url/route');
  const complete =
    await import('@/app/api/trainee/use-cases/[useCaseId]/submission-file/complete/route');
  return { storage, main, upload, complete };
}

const ctx = (useCaseId = USE_CASE) => ({
  params: Promise.resolve({ useCaseId }),
});
const url = (suffix = '') =>
  `http://localhost/api/trainee/use-cases/${USE_CASE}/submission-file${suffix}`;
const announce = {
  fileName: 'Lösung Übung.pdf',
  size: 5000,
  contentType: 'application/pdf',
};

const originalEnv = { ...process.env };
beforeEach(() => {
  // the routes log the cause of a storage failure, the tests do not need the noise
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

describe('POST .../submission-file/upload-url', () => {
  beforeEach(() => {
    delete (process.env as Record<string, unknown>).VERCEL_ENV;
  });

  it('answers with a path in the own folder, built from the session and the use case', async () => {
    const { upload, storage } = await load();
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), {
        token: 't',
        // none of this is trusted
        body: {
          ...announce,
          traineeId: 'someone-else',
          path: '../../x',
          organizationId: 'org-x',
        },
      }),
      ctx()
    );
    expect(res.status).toBe(200);
    const { upload: answer } = await res.json();
    expect(answer.bucket).toBe('submission-files');
    expect(answer.path.startsWith(`${folder}/incoming/`)).toBe(true);
    expect(answer.path.endsWith('.pdf')).toBe(true);
    expect(answer.fileName).toBe('Loesung_Uebung.pdf');
    expect(storage.signedFor).toEqual([answer.path]);
  });

  it('refuses a type that is not allowed', async () => {
    const { upload, storage } = await load();
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), {
        token: 't',
        body: { fileName: 'tool.exe', size: 10 },
      }),
      ctx()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('UNSUPPORTED_TYPE');
    expect(storage.signedFor).toEqual([]);
  });

  it('refuses a file above 10 MB with 413', async () => {
    const { upload } = await load();
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), {
        token: 't',
        body: { fileName: 'a.pdf', size: 10 * 1024 * 1024 + 1 },
      }),
      ctx()
    );
    expect(res.status).toBe(413);
  });

  it('refuses a body that is no object', async () => {
    const { upload } = await load();
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), { token: 't', body: null }),
      ctx()
    );
    expect(res.status).toBe(400);
  });

  it('refuses a request without a readable body', async () => {
    const { upload } = await load();
    const req = makeRequest('POST', url('/upload-url'), { token: 't' });
    req.json = async () => {
      throw new Error('bad json');
    };
    const res = await upload.POST(req, ctx());
    expect(res.status).toBe(400);
  });

  it('is limited per person', async () => {
    const { upload } = await load();
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) {
      last = await upload.POST(
        makeRequest('POST', url('/upload-url'), { token: 't', body: announce }),
        ctx()
      );
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get('Retry-After')).toMatch(/^\d+$/);
  });

  it('is closed for a trainer level caller', async () => {
    const { upload } = await load({ session: fakeSession({ id: TRAINEE }) });
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), { token: 't', body: announce }),
      ctx()
    );
    expect(res.status).toBe(403);
  });

  it('answers 401 without a session', async () => {
    const { upload } = await load({ session: null });
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), { body: announce }),
      ctx()
    );
    expect(res.status).toBe(401);
  });

  it('answers 404 for a use case id that is no uuid', async () => {
    const { upload } = await load();
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), { token: 't', body: announce }),
      ctx('../etc')
    );
    expect(res.status).toBe(404);
  });

  it('answers 404 for a use case outside of the catalog (occupation) of the trainee', async () => {
    const { upload, storage } = await load({ denyCatalog: true });
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), { token: 't', body: announce }),
      ctx()
    );
    expect(res.status).toBe(404);
    expect(storage.signedFor).toEqual([]);
  });

  it('answers 404 for an inactive or missing use case', async () => {
    const inactive = await load({
      tables: { useCases: [{ ...useCaseRow, isActive: false }] },
    });
    expect(
      (
        await inactive.upload.POST(
          makeRequest('POST', url('/upload-url'), {
            token: 't',
            body: announce,
          }),
          ctx()
        )
      ).status
    ).toBe(404);
    const missing = await load({ tables: { useCases: [] } });
    expect(
      (
        await missing.upload.POST(
          makeRequest('POST', url('/upload-url'), {
            token: 't',
            body: announce,
          }),
          ctx()
        )
      ).status
    ).toBe(404);
  });

  it('answers 403 for a trainee who is no member of the course', async () => {
    const { upload } = await load({ tables: { courseMembers: [] } });
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), { token: 't', body: announce }),
      ctx()
    );
    expect(res.status).toBe(403);
  });

  it('keeps the lock of the order of work for a use case of a locked enabler', async () => {
    const { upload } = await load({
      tables: {
        useCases: [{ ...useCaseRow, enablerId: 'e1' }],
        enablers: [{ id: 'e1', courseId: 'c1', isActive: true }],
      },
      lockedEnabler: true,
    });
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), { token: 't', body: announce }),
      ctx()
    );
    expect(res.status).toBe(423);
  });

  it('does not ask for the lock when the enabler of the use case is inactive', async () => {
    const { upload } = await load({
      tables: {
        useCases: [{ ...useCaseRow, enablerId: 'e1' }],
        enablers: [{ id: 'e1', courseId: 'c1', isActive: false }],
      },
      lockedEnabler: true,
    });
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), { token: 't', body: announce }),
      ctx()
    );
    expect(res.status).toBe(200);
  });

  it.each(['PENDING', 'APPROVED'])(
    'answers 409 while the submission is %s',
    async status => {
      const { upload } = await load({
        tables: { useCaseSubmissions: [{ status }] },
      });
      const res = await upload.POST(
        makeRequest('POST', url('/upload-url'), { token: 't', body: announce }),
        ctx()
      );
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('SUBMISSION_LOCKED');
    }
  );

  it('allows a new file after the trainer has rejected the submission', async () => {
    const { upload } = await load({
      tables: { useCaseSubmissions: [{ status: 'REJECTED' }] },
    });
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), { token: 't', body: announce }),
      ctx()
    );
    expect(res.status).toBe(200);
  });

  it('is off in Production and answers 404', async () => {
    process.env.VERCEL_ENV = 'production';
    const { upload } = await load();
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), { token: 't', body: announce }),
      ctx()
    );
    expect(res.status).toBe(404);
  });

  it('answers 503 and no detail when the storage is not configured', async () => {
    const { SubmissionStorageError } =
      await import('@/lib/submission-file/storage');
    const { upload } = await load({
      storageThrows: new SubmissionStorageError(
        'NOT_CONFIGURED',
        'secret detail'
      ),
    });
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), { token: 't', body: announce }),
      ctx()
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('STORAGE_NOT_CONFIGURED');
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });

  it('answers 503 when the storage fails during the call', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.failNext('list');
    const { upload } = await load({ storage });
    const res = await upload.POST(
      makeRequest('POST', url('/upload-url'), { token: 't', body: announce }),
      ctx()
    );
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('STORAGE_ERROR');
  });
});

describe('POST .../submission-file/complete', () => {
  beforeEach(() => {
    delete (process.env as Record<string, unknown>).VERCEL_ENV;
  });

  it('checks the bytes and makes the upload the file of the submission', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(incomingPath(folder, `${UPLOAD}.pdf`), PDF_BYTES);
    const { complete } = await load({ storage });
    const res = await complete.POST(
      makeRequest('POST', url('/complete'), {
        token: 't',
        body: { uploadId: `${UPLOAD}.pdf`, fileName: 'Lösung.pdf' },
      }),
      ctx()
    );
    expect(res.status).toBe(200);
    expect((await res.json()).file.fileName).toBe('Loesung.pdf');
    expect(
      [...storage.objects.keys()].every(p => p.startsWith(`${folder}/file/`))
    ).toBe(true);
  });

  it('rejects and deletes a file whose bytes do not match', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(
      incomingPath(folder, `${UPLOAD}.pdf`),
      new TextEncoder().encode('<script>alert(1)</script>')
    );
    const { complete } = await load({ storage });
    const res = await complete.POST(
      makeRequest('POST', url('/complete'), {
        token: 't',
        body: { uploadId: `${UPLOAD}.pdf`, fileName: 'a.pdf' },
      }),
      ctx()
    );
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('NOT_A_PDF');
    expect(storage.objects.size).toBe(0);
  });

  it('can not complete the upload of another trainee', async () => {
    const storage = createMemorySubmissionStorage('public');
    const other = submissionFolder(
      { ...scope, traineeId: '66666666-6666-4666-8666-666666666666' },
      'public'
    ) as string;
    storage.objects.set(incomingPath(other, `${UPLOAD}.pdf`), PDF_BYTES);
    const { complete } = await load({ storage });
    const res = await complete.POST(
      makeRequest('POST', url('/complete'), {
        token: 't',
        body: { uploadId: `${UPLOAD}.pdf`, fileName: 'a.pdf' },
      }),
      ctx()
    );
    expect(res.status).toBe(409);
    expect(storage.objects.has(incomingPath(other, `${UPLOAD}.pdf`))).toBe(
      true
    );
  });

  it('is limited per person, before any database query', async () => {
    const { complete } = await load();
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) {
      last = await complete.POST(
        makeRequest('POST', url('/complete'), {
          token: 't',
          body: { uploadId: `${UPLOAD}.pdf` },
        }),
        ctx()
      );
    }
    expect(last?.status).toBe(429);
  });

  it('answers 400 for a body that is no object and 409 for a locked submission', async () => {
    const open = await load();
    expect(
      (
        await open.complete.POST(
          makeRequest('POST', url('/complete'), { token: 't', body: null }),
          ctx()
        )
      ).status
    ).toBe(400);
    const req = makeRequest('POST', url('/complete'), { token: 't' });
    req.json = async () => {
      throw new Error('bad');
    };
    expect((await open.complete.POST(req, ctx())).status).toBe(400);
    const locked = await load({
      tables: { useCaseSubmissions: [{ status: 'APPROVED' }] },
    });
    expect(
      (
        await locked.complete.POST(
          makeRequest('POST', url('/complete'), {
            token: 't',
            body: { uploadId: `${UPLOAD}.pdf` },
          }),
          ctx()
        )
      ).status
    ).toBe(409);
  });

  it('answers 404 in Production, 401 without a session and 503 without storage', async () => {
    process.env.VERCEL_ENV = 'production';
    const off = await load();
    expect(
      (
        await off.complete.POST(
          makeRequest('POST', url('/complete'), { token: 't', body: {} }),
          ctx()
        )
      ).status
    ).toBe(404);
    delete (process.env as Record<string, unknown>).VERCEL_ENV;
    const anonymous = await load({ session: null });
    expect(
      (
        await anonymous.complete.POST(
          makeRequest('POST', url('/complete'), { body: {} }),
          ctx()
        )
      ).status
    ).toBe(401);
    const { SubmissionStorageError } =
      await import('@/lib/submission-file/storage');
    const broken = await load({
      storageThrows: new SubmissionStorageError('NOT_CONFIGURED', 'x'),
    });
    expect(
      (
        await broken.complete.POST(
          makeRequest('POST', url('/complete'), {
            token: 't',
            body: { uploadId: 'x' },
          }),
          ctx()
        )
      ).status
    ).toBe(503);
  });
});

describe('GET and DELETE .../submission-file', () => {
  beforeEach(() => {
    delete (process.env as Record<string, unknown>).VERCEL_ENV;
  });

  it('answers the own file without a link, and with a short lived one on request', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(filePath(folder, 1761700000000, 'a.pdf'), PDF_BYTES);
    const { main } = await load({ storage });

    const plain = await main.GET(
      makeRequest('GET', url(), { token: 't' }),
      ctx()
    );
    expect(await plain.json()).toEqual({
      enabled: true,
      file: {
        fileName: 'a.pdf',
        size: PDF_BYTES.length,
        uploadedAt: new Date(1761700000000).toISOString(),
      },
    });

    const linked = await main.GET(
      makeRequest('GET', url('?link=1'), { token: 't' }),
      ctx()
    );
    expect((await linked.json()).file.url).toContain('t=120');
  });

  it('answers file null when there is none', async () => {
    const { main } = await load();
    const res = await main.GET(
      makeRequest('GET', url(), { token: 't' }),
      ctx()
    );
    expect(await res.json()).toEqual({ enabled: true, file: null });
  });

  it('says the feature is off instead of failing, so the page can hide the field', async () => {
    process.env.VERCEL_ENV = 'production';
    const { main } = await load();
    const res = await main.GET(
      makeRequest('GET', url(), { token: 't' }),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, file: null });
  });

  it('does not show the file of another trainee, whatever the query says', async () => {
    const storage = createMemorySubmissionStorage('public');
    const other = submissionFolder(
      { ...scope, traineeId: '66666666-6666-4666-8666-666666666666' },
      'public'
    ) as string;
    storage.objects.set(
      filePath(other, 1761700000000, 'secret.pdf'),
      PDF_BYTES
    );
    const { main } = await load({ storage });
    const res = await main.GET(
      makeRequest(
        'GET',
        url('?traineeId=66666666-6666-4666-8666-666666666666'),
        { token: 't' }
      ),
      ctx()
    );
    expect((await res.json()).file).toBeNull();
  });

  it('answers 401, 403 and 503 where they belong', async () => {
    const anonymous = await load({ session: null });
    expect(
      (await anonymous.main.GET(makeRequest('GET', url()), ctx())).status
    ).toBe(401);
    const trainer = await load({ session: fakeSession({ id: TRAINEE }) });
    expect(
      (await trainer.main.GET(makeRequest('GET', url(), { token: 't' }), ctx()))
        .status
    ).toBe(403);
    const storage = createMemorySubmissionStorage('public');
    storage.failNext('list');
    const failing = await load({ storage });
    expect(
      (await failing.main.GET(makeRequest('GET', url(), { token: 't' }), ctx()))
        .status
    ).toBe(503);
  });

  it('passes an error of the service through, and 503 without storage', async () => {
    // a trainee whose organization is no uuid gets no folder
    const bad = await load({
      session: traineeSession(TRAINEE, { organizationId: 'org-1' }),
    });
    expect(
      (await bad.main.GET(makeRequest('GET', url(), { token: 't' }), ctx()))
        .status
    ).toBe(400);
    const { SubmissionStorageError } =
      await import('@/lib/submission-file/storage');
    const broken = await load({
      storageThrows: new SubmissionStorageError('NOT_CONFIGURED', 'x'),
    });
    expect(
      (await broken.main.GET(makeRequest('GET', url(), { token: 't' }), ctx()))
        .status
    ).toBe(503);
  });

  it('deletes the file and any unchecked upload, as long as the submission is open', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(filePath(folder, 1761700000000, 'a.pdf'), PDF_BYTES);
    storage.objects.set(incomingPath(folder, `${UPLOAD}.pdf`), PDF_BYTES);
    const { main } = await load({ storage });
    const res = await main.DELETE(
      makeRequest('DELETE', url(), { token: 't' }),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 2 });
    expect(storage.objects.size).toBe(0);
  });

  it('does not delete the file of a submission that is handed in', async () => {
    const storage = createMemorySubmissionStorage('public');
    storage.objects.set(filePath(folder, 1761700000000, 'a.pdf'), PDF_BYTES);
    const { main } = await load({
      storage,
      tables: { useCaseSubmissions: [{ status: 'PENDING' }] },
    });
    const res = await main.DELETE(
      makeRequest('DELETE', url(), { token: 't' }),
      ctx()
    );
    expect(res.status).toBe(409);
    expect(storage.objects.size).toBe(1);
  });

  it('answers 404 in Production, 401 without a session and 503 without storage on DELETE', async () => {
    process.env.VERCEL_ENV = 'production';
    const off = await load();
    expect(
      (
        await off.main.DELETE(
          makeRequest('DELETE', url(), { token: 't' }),
          ctx()
        )
      ).status
    ).toBe(404);
    delete (process.env as Record<string, unknown>).VERCEL_ENV;
    const anonymous = await load({ session: null });
    expect(
      (await anonymous.main.DELETE(makeRequest('DELETE', url()), ctx())).status
    ).toBe(401);
    const { SubmissionStorageError } =
      await import('@/lib/submission-file/storage');
    const broken = await load({
      storageThrows: new SubmissionStorageError('NOT_CONFIGURED', 'x'),
    });
    expect(
      (
        await broken.main.DELETE(
          makeRequest('DELETE', url(), { token: 't' }),
          ctx()
        )
      ).status
    ).toBe(503);
  });
});
