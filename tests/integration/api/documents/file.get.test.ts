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

// GET /api/documents/[documentId]/file: a fresh signed address for the file of
// one document, only for a person who may see that document. The rules are those
// of the document lists: occupation (catalog), organization, visibility (ALL and
// TRAINEE_ONLY for a trainee, TRAINER_ONLY and solutions for trainers only),
// course membership for a trainee. Everything that is no access is a 404, the
// same as for a document that does not exist. The path of the file comes from
// the row of the database, never from the request.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const DOC = 'dddddddd-0000-4000-8000-000000000001';
const ENABLER = 'aaaaaaa6-0000-4000-8000-000000000006';
const USE_CASE = 'aaaaaaa7-0000-4000-8000-000000000007';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const PLATFORM = '00000000-0000-4000-8000-0000000000aa';
const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const ORIGIN = 'https://proj.supabase.co';
const PATH = 'preview/kfbm/K6.2-d/szenario/UC_6d_Titel.pdf';
const PUBLIC = `${ORIGIN}/storage/v1/object/public/content/${PATH}`;
const REFERENCE = `private://content/${PATH}`;
const SIGNED = `${ORIGIN}/storage/v1/object/sign/content/${PATH}?token=t`;

const enabler = {
  id: ENABLER,
  isActive: true,
  courseId: COURSE,
  trainingCatalogId: FIAE,
};
const useCase = { id: USE_CASE, courseId: COURSE, trainingCatalogId: FIAE };

const doc = (overrides: Record<string, unknown> = {}) => ({
  id: DOC,
  enablerId: ENABLER,
  useCaseId: null,
  courseId: null,
  organizationId: ORG,
  documentType: 'THEORY',
  visibility: 'ALL',
  mimeType: 'application/pdf',
  storageUrl: PUBLIC,
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
    enablers: [enabler],
    useCases: [useCase],
    courses: [{ id: COURSE, trainingCatalogId: FIAE }],
    courseMembers: [{ userId: 't1', courseId: COURSE, role: 'TRAINEE' }],
    contentDocuments: [doc()],
    organizations: [{ id: PLATFORM, isPlatformOwner: true }],
    ...overrides,
  };
}

const request = (url = `http://localhost/api/documents/${DOC}/file`) =>
  ({
    url,
    method: 'GET',
    nextUrl: new URL(url),
    headers: { get: () => null },
  }) as any;

const ctx = (documentId = DOC) => ({ params: Promise.resolve({ documentId }) });

type Signing = {
  calls: Array<{ bucket: string; paths: string[]; seconds: number }>;
};

async function load(
  session: ReturnType<typeof fakeSession> | null,
  rows: Record<string, any> = tables(),
  signing: 'ok' | 'error' = 'ok'
) {
  jest.resetModules();
  jest.dontMock('@/lib/catalog/scope');
  const mock = createTableDb(rows);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const state: Signing = { calls: [] };
  jest.doMock('@supabase/supabase-js', () => ({
    __esModule: true,
    createClient: () => ({
      storage: {
        from: (bucket: string) => ({
          createSignedUrls: async (paths: string[], seconds: number) => {
            state.calls.push({ bucket, paths, seconds });
            return signing === 'ok'
              ? {
                  data: paths.map(path => ({
                    path,
                    signedUrl: SIGNED,
                    error: null,
                  })),
                  error: null,
                }
              : { data: null, error: new Error('down') };
          },
        }),
      },
    }),
  }));
  mockSession(session);
  const mod = await import('@/app/api/documents/[documentId]/file/route');
  return { mock, GET: mod.GET, signing: state };
}

const asTrainee = () => traineeSession('t1', { organizationId: ORG });
const asTrainer = (overrides: Record<string, unknown> = {}) =>
  fakeSession({ organizationId: ORG, ...overrides });

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

const notFound = { error: 'Not found' };

describe('GET /api/documents/[documentId]/file: a trainee', () => {
  it('gets a signed address for 15 minutes, for the path of the row in the bucket content only', async () => {
    const { GET, signing } = await load(asTrainee());
    const res = await GET(request(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: SIGNED, expiresIn: 900 });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(signing.calls).toEqual([
      { bucket: 'content', paths: [PATH], seconds: 900 },
    ]);
  });

  it('works for a row in the old public form and for a row in the private form alike', async () => {
    for (const storageUrl of [PUBLIC, REFERENCE, PATH]) {
      const { GET } = await load(
        asTrainee(),
        tables({ contentDocuments: [doc({ storageUrl })] })
      );
      const res = await GET(request(), ctx());
      expect(res.status).toBe(200);
      expect((await res.json()).url).toBe(SIGNED);
    }
  });

  it('works for a document of a use case the trainee belongs to', async () => {
    const { GET } = await load(
      asTrainee(),
      tables({
        contentDocuments: [doc({ enablerId: null, useCaseId: USE_CASE })],
      })
    );
    expect((await GET(request(), ctx())).status).toBe(200);
  });

  it('follows the trainee lists: no course level document, no use case row without a document type', async () => {
    for (const over of [
      { enablerId: null, courseId: COURSE },
      { enablerId: null, useCaseId: USE_CASE, documentType: null },
    ]) {
      const { GET, signing } = await load(
        asTrainee(),
        tables({ contentDocuments: [doc(over)] })
      );
      expect((await GET(request(), ctx())).status).toBe(404);
      expect(signing.calls).toEqual([]);
    }
    // a trainer sees both
    for (const over of [
      { enablerId: null, courseId: COURSE },
      { enablerId: null, useCaseId: USE_CASE, documentType: null },
    ]) {
      const { GET } = await load(
        asTrainer(),
        tables({ contentDocuments: [doc(over)] })
      );
      expect((await GET(request(), ctx())).status).toBe(200);
    }
  });

  it('takes the path from the row, a path in the request changes nothing', async () => {
    const { GET, signing } = await load(asTrainee());
    const res = await GET(
      request(
        `http://localhost/api/documents/${DOC}/file?path=other/secret.pdf&bucket=avatar&storageUrl=${encodeURIComponent('private://content/x.pdf')}`
      ),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(signing.calls).toEqual([
      { bucket: 'content', paths: [PATH], seconds: 900 },
    ]);
  });

  it('a link to another host is returned as it is (after the access check)', async () => {
    const { GET, signing } = await load(
      asTrainee(),
      tables({
        contentDocuments: [doc({ storageUrl: 'https://example.test/a.pdf' })],
      })
    );
    const res = await GET(request(), ctx());
    expect(await res.json()).toEqual({
      url: 'https://example.test/a.pdf',
      expiresIn: 900,
    });
    expect(signing.calls).toEqual([]);
  });

  it('while the bucket is public a failing signing still gives the stored public url, never a private reference', async () => {
    const publicRow = await load(asTrainee(), tables(), 'error');
    const ok = await publicRow.GET(request(), ctx());
    expect(ok.status).toBe(200);
    expect((await ok.json()).url).toBe(PUBLIC);

    const privateRow = await load(
      asTrainee(),
      tables({ contentDocuments: [doc({ storageUrl: REFERENCE })] }),
      'error'
    );
    const refused = await privateRow.GET(request(), ctx());
    expect(refused.status).toBe(404);
    expect(JSON.stringify(await refused.json())).not.toContain('private://');
  });

  it('sees visibility ALL, TRAINEE_ONLY and unset, nothing else', async () => {
    for (const [visibility, status] of [
      ['ALL', 200],
      ['TRAINEE_ONLY', 200],
      [null, 200],
      ['TRAINER_ONLY', 404],
    ] as const) {
      const { GET } = await load(
        asTrainee(),
        tables({ contentDocuments: [doc({ visibility })] })
      );
      expect((await GET(request(), ctx())).status).toBe(status);
    }
  });

  it('never gets a solution, a Word original, a trainer reference or a row without a file', async () => {
    for (const over of [
      { documentType: 'TRAINER_SOLUTION' },
      {
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      { mimeType: 'application/msword' },
      { storageUrl: 'private://content-solutions/preview/kfbm/x.pdf' },
      { storageUrl: '' },
      { storageUrl: '   ' },
      { storageUrl: null },
    ]) {
      const { GET, signing } = await load(
        asTrainee(),
        tables({ contentDocuments: [doc(over)] })
      );
      const res = await GET(request(), ctx());
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(notFound);
      expect(signing.calls).toEqual([]);
    }
  });

  it('does not get a document of a foreign organization, but the shared curriculum and the platform', async () => {
    for (const [organizationId, status] of [
      [ORG, 200],
      [null, 200],
      [PLATFORM, 200],
      [OTHER_ORG, 404],
    ] as const) {
      const { GET, signing } = await load(
        asTrainee(),
        tables({ contentDocuments: [doc({ organizationId })] })
      );
      const res = await GET(request(), ctx());
      expect(res.status).toBe(status);
      if (status === 404) expect(signing.calls).toEqual([]);
    }
  });

  it('does not get a document of another occupation', async () => {
    const { GET, signing } = await load(
      asTrainee(),
      tables({ enablers: [{ ...enabler, trainingCatalogId: KFBM }] })
    );
    const res = await GET(request(), ctx());
    expect(res.status).toBe(404);
    expect(signing.calls).toEqual([]);
  });

  it('gets a document of the KfBM when enrolled in it', async () => {
    const { GET } = await load(
      asTrainee(),
      tables({
        enablers: [{ ...enabler, trainingCatalogId: KFBM }],
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-09-01' },
        ],
      })
    );
    expect((await GET(request(), ctx())).status).toBe(200);
  });

  it('does not get a document of a course it is no member of, or of an enabler that is off', async () => {
    for (const rows of [
      tables({ courseMembers: [] }),
      tables({ enablers: [{ ...enabler, isActive: false }] }),
      tables({
        useCases: [],
        contentDocuments: [doc({ enablerId: null, useCaseId: USE_CASE })],
      }),
    ]) {
      const { GET, signing } = await load(asTrainee(), rows);
      expect((await GET(request(), ctx())).status).toBe(404);
      expect(signing.calls).toEqual([]);
    }
  });

  it('does not get a document whose enabler is gone, or that hangs on nothing', async () => {
    for (const rows of [
      tables({ enablers: [] }),
      tables({ contentDocuments: [doc({ enablerId: null })] }),
      tables({ contentDocuments: [] }),
    ]) {
      const { GET } = await load(asTrainee(), rows);
      expect((await GET(request(), ctx())).status).toBe(404);
    }
  });

  it('404 for an id that is no uuid, without a query on the documents', async () => {
    const { GET, mock } = await load(asTrainee());
    const res = await GET(request(), ctx('not-a-uuid'));
    expect(res.status).toBe(404);
    expect(mock.calls.some(c => c.table === 'content_documents')).toBe(false);
  });

  it('uses the organization of the session, not one from the query', async () => {
    const { GET } = await load(
      asTrainee(),
      tables({ contentDocuments: [doc({ organizationId: OTHER_ORG })] })
    );
    const res = await GET(
      request(
        `http://localhost/api/documents/${DOC}/file?organizationId=${OTHER_ORG}`
      ),
      ctx()
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/documents/[documentId]/file: a trainer', () => {
  it('sees trainer-only material and gets a signed address', async () => {
    const { GET } = await load(
      asTrainer(),
      tables({
        contentDocuments: [
          doc({ visibility: 'TRAINER_ONLY', documentType: 'TRAINER_SOLUTION' }),
        ],
      })
    );
    const res = await GET(request(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe(SIGNED);
  });

  it('does not see a document of a foreign organization or of an occupation the organization has not enabled', async () => {
    for (const rows of [
      tables({ contentDocuments: [doc({ organizationId: OTHER_ORG })] }),
      tables({
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
        enablers: [{ ...enabler, trainingCatalogId: KFBM }],
      }),
    ]) {
      const { GET, signing } = await load(asTrainer(), rows);
      expect((await GET(request(), ctx())).status).toBe(404);
      expect(signing.calls).toEqual([]);
    }
  });

  it('sees the shared curriculum and the platform documents', async () => {
    for (const organizationId of [null, PLATFORM]) {
      const { GET } = await load(
        asTrainer(),
        tables({ contentDocuments: [doc({ organizationId })] })
      );
      expect((await GET(request(), ctx())).status).toBe(200);
    }
  });

  it('a super admin sees the document of any organization', async () => {
    const { GET } = await load(
      asTrainer({ role: 'SUPER_ADMIN', isSuperAdmin: true, isAdmin: true }),
      tables({ contentDocuments: [doc({ organizationId: OTHER_ORG })] })
    );
    expect((await GET(request(), ctx())).status).toBe(200);
  });

  it('the model solutions of the private bucket are not served by this route', async () => {
    const { GET, signing } = await load(
      asTrainer(),
      tables({
        contentDocuments: [
          doc({
            visibility: 'TRAINER_ONLY',
            storageUrl: 'private://content-solutions/preview/kfbm/x.pdf',
          }),
        ],
      })
    );
    const res = await GET(request(), ctx());
    expect(res.status).toBe(404);
    expect(signing.calls).toEqual([]);
  });

  it('an unsafe path in the row is never signed', async () => {
    for (const storageUrl of [
      'private://content/../x.pdf',
      `${ORIGIN}/storage/v1/object/public/content/a/../../x.pdf`,
      `${ORIGIN}/storage/v1/object/public/content/a.pdf?download=1`,
    ]) {
      const { GET, signing } = await load(
        asTrainer(),
        tables({ contentDocuments: [doc({ storageUrl })] })
      );
      expect((await GET(request(), ctx())).status).toBe(404);
      expect(signing.calls).toEqual([]);
    }
  });

  it('answers a catalog choice that is not allowed with the 403 of the scope', async () => {
    const { GET } = await load(asTrainer());
    const req = {
      ...request(),
      headers: {
        get: (n: string) => (n.toLowerCase() === 'x-catalog' ? 'XYZ' : null),
      },
    };
    expect((await GET(req, ctx())).status).toBe(403);
  });
});

describe('GET /api/documents/[documentId]/file: guards', () => {
  it('401 without a session, the database is not touched', async () => {
    const { GET, mock } = await load(null);
    const res = await GET(request(), ctx());
    expect(res.status).toBe(401);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('403 for an account that is neither trainer level nor trainee', async () => {
    const { GET, mock } = await load(
      fakeSession({ role: 'GUEST', isTrainerLevel: false })
    );
    const res = await GET(request(), ctx());
    expect(res.status).toBe(403);
    expect(mock.calls.some(c => c.table === 'content_documents')).toBe(false);
  });

  it('500 when the database fails, without a trace of the address', async () => {
    const { GET, mock } = await load(asTrainee());
    mock.db.select.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const res = await GET(request(), ctx());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(PATH);
  });
});
