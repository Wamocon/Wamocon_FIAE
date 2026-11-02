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

// GET /api/trainee/documents/[documentId]/content: the bytes of the PDF of one
// learning document, for the viewer of a trainee. The page holds no address of
// the file. The route reads the file on the server (secret key) and answers
// with the PDF inline, without a file name, not cached. The rule is that of
// the document lists: occupation, organization, visibility, course membership.
// Everything that is no access is a 404. Only the id of a row names the file.

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
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

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

const request = (
  url = `http://localhost/api/trainee/documents/${DOC}/content`
) =>
  ({
    url,
    method: 'GET',
    nextUrl: new URL(url),
    headers: { get: () => null },
  }) as any;

const ctx = (documentId = DOC) => ({ params: Promise.resolve({ documentId }) });

type Storage = { downloads: Array<{ bucket: string; path: string }> };

async function load(
  session: ReturnType<typeof fakeSession> | null,
  rows: Record<string, any> = tables(),
  options: {
    bytes?: Buffer;
    storage?: 'ok' | 'error';
    big?: boolean;
  } = {}
) {
  jest.resetModules();
  jest.dontMock('@/lib/catalog/scope');
  const mock = createTableDb(rows);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const state: Storage = { downloads: [] };
  jest.doMock('@supabase/supabase-js', () => ({
    __esModule: true,
    createClient: () => ({
      storage: {
        from: (bucket: string) => ({
          download: async (path: string) => {
            state.downloads.push({ bucket, path });
            if (options.storage === 'error') {
              return { data: null, error: new Error('down') };
            }
            const bytes = options.bytes ?? PDF;
            return {
              data: {
                size: options.big ? 60 * 1024 * 1024 : bytes.length,
                arrayBuffer: async () =>
                  bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength
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
    await import('@/app/api/trainee/documents/[documentId]/content/route');
  return { mock, GET: mod.GET, storage: state };
}

const asTrainee = () => traineeSession('t1', { organizationId: ORG });

const saved = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.SUPABASE_SECRET_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

const restore = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
  process.env.SUPABASE_SECRET_KEY = 'sb-secret';
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  restore('NEXT_PUBLIC_SUPABASE_URL', saved.url);
  restore('SUPABASE_SECRET_KEY', saved.key);
  restore('SUPABASE_SERVICE_ROLE_KEY', saved.service);
  jest.restoreAllMocks();
});

const notFound = { error: 'Not found' };

describe('GET /api/trainee/documents/[documentId]/content: the answer', () => {
  it('delivers the bytes of the PDF inline, without a file name, not cached', async () => {
    const { GET, storage } = await load(asTrainee());
    const res = await GET(request(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-length')).toBe(String(PDF.length));
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    // read from the bucket content, with the path of the row
    expect(storage.downloads).toEqual([{ bucket: 'content', path: PATH }]);
  });

  it('never names the file, the path or the address in the answer', async () => {
    const { GET } = await load(asTrainee());
    const res = await GET(request(), ctx());
    const headers = JSON.stringify([...res.headers.entries()]);
    expect(headers).not.toContain('filename');
    expect(headers).not.toContain('UC_6d_Titel');
    expect(headers).not.toContain('supabase.co');
  });

  it('works for the stored forms: public url, private reference and bare path', async () => {
    for (const storageUrl of [PUBLIC, `private://content/${PATH}`, PATH]) {
      const { GET, storage } = await load(
        asTrainee(),
        tables({ contentDocuments: [doc({ storageUrl })] })
      );
      expect((await GET(request(), ctx())).status).toBe(200);
      expect(storage.downloads).toEqual([{ bucket: 'content', path: PATH }]);
    }
  });

  it('works for a document of a use case the trainee belongs to', async () => {
    const { GET } = await load(
      asTrainee(),
      tables({
        contentDocuments: [
          doc({
            enablerId: null,
            useCaseId: USE_CASE,
            documentType: 'TRAINEE_QUESTION',
          }),
        ],
      })
    );
    expect((await GET(request(), ctx())).status).toBe(200);
  });

  it('takes the file from the row: a path, a bucket or an address in the request change nothing', async () => {
    const { GET, storage } = await load(asTrainee());
    const res = await GET(
      request(
        `http://localhost/api/trainee/documents/${DOC}/content?path=other/secret.pdf&bucket=avatar&storageUrl=${encodeURIComponent('private://content/x.pdf')}&url=${encodeURIComponent('https://evil.test/a.pdf')}`
      ),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(storage.downloads).toEqual([{ bucket: 'content', path: PATH }]);
  });

  it('a path in place of the id is no document: 404, no read', async () => {
    for (const id of [
      PATH,
      `${DOC}/../${DOC}`,
      '../../etc/passwd',
      'not-a-uuid',
    ]) {
      const { GET, mock, storage } = await load(asTrainee());
      const res = await GET(request(), ctx(id));
      expect(res.status).toBe(404);
      expect(mock.calls.some(c => c.table === 'content_documents')).toBe(false);
      expect(storage.downloads).toEqual([]);
    }
  });
});

describe('GET /api/trainee/documents/[documentId]/content: no access is a 404', () => {
  const denied = async (rows: Record<string, any>) => {
    const { GET, storage } = await load(asTrainee(), rows);
    const res = await GET(request(), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(notFound);
    expect(storage.downloads).toEqual([]);
  };

  it('a document that does not exist', async () => {
    await denied(tables({ contentDocuments: [] }));
  });

  it('a document of another occupation', async () => {
    await denied(
      tables({ enablers: [{ ...enabler, trainingCatalogId: KFBM }] })
    );
  });

  it('a document of a course the trainee is no member of', async () => {
    await denied(tables({ courseMembers: [] }));
  });

  it('a document of an enabler that is off', async () => {
    await denied(tables({ enablers: [{ ...enabler, isActive: false }] }));
  });

  it('a document of a foreign organization', async () => {
    await denied(
      tables({ contentDocuments: [doc({ organizationId: OTHER_ORG })] })
    );
  });

  it('trainer material, a solution, a Word original and a course level document', async () => {
    for (const over of [
      { visibility: 'TRAINER_ONLY' },
      { documentType: 'TRAINER_SOLUTION' },
      { mimeType: 'application/msword' },
      {
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      { enablerId: null, courseId: COURSE },
      { storageUrl: 'private://content-solutions/preview/kfbm/x.pdf' },
      { storageUrl: '' },
    ]) {
      await denied(tables({ contentDocuments: [doc(over)] }));
    }
  });

  it('the shared curriculum and the platform are open to a trainee', async () => {
    for (const organizationId of [null, PLATFORM]) {
      const { GET } = await load(
        asTrainee(),
        tables({ contentDocuments: [doc({ organizationId })] })
      );
      expect((await GET(request(), ctx())).status).toBe(200);
    }
  });
});

describe('GET /api/trainee/documents/[documentId]/content: what is read', () => {
  it('a link to another host is never fetched on behalf of a trainee', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('x'));
    const { GET, storage } = await load(
      asTrainee(),
      tables({
        contentDocuments: [doc({ storageUrl: 'https://example.test/a.pdf' })],
      })
    );
    const res = await GET(request(), ctx());
    expect(res.status).toBe(404);
    expect(storage.downloads).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a file that is no PDF is not delivered as one', async () => {
    const { GET } = await load(asTrainee(), tables(), {
      bytes: Buffer.from('<html>not a pdf</html>'),
    });
    expect((await GET(request(), ctx())).status).toBe(404);
  });

  it('a file that is too large is not delivered (the storage reports its size first)', async () => {
    const { GET } = await load(asTrainee(), tables(), { big: true });
    const res = await GET(request(), ctx());
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).not.toBe('application/pdf');
  });

  it('a storage that does not answer is a 502 without a trace of the path', async () => {
    const { GET } = await load(asTrainee(), tables(), { storage: 'error' });
    const res = await GET(request(), ctx());
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain(PATH);
  });

  it('without a secret key the checked public address of the own project is read', async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(PDF));
    const { GET } = await load(asTrainee());
    const res = await GET(request(), ctx());
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(PUBLIC);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('without a secret key a failing public read is a 502', async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('no', { status: 503 }));
    const { GET } = await load(asTrainee());
    expect((await GET(request(), ctx())).status).toBe(502);
  });
});

describe('GET /api/trainee/documents/[documentId]/content: guards', () => {
  it('401 without a session, the database is not touched', async () => {
    const { GET, mock } = await load(null);
    const res = await GET(request(), ctx());
    expect(res.status).toBe(401);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('403 for a trainer: this is the way of the trainee viewer, trainers have their own', async () => {
    const { GET, mock, storage } = await load(
      fakeSession({ organizationId: ORG })
    );
    const res = await GET(request(), ctx());
    expect(res.status).toBe(403);
    expect(mock.calls.some(c => c.table === 'content_documents')).toBe(false);
    expect(storage.downloads).toEqual([]);
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
