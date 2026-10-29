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
import {
  loadScoped,
  scopeReq,
  trainerSession,
} from '../../../helpers/trainerScope';

// The lists that hand a file address to a browser (documents of an enabler and
// of a use case for trainees and trainers, the detail of an enabler) give a
// signed address for a file of the bucket content, whatever form the row stores
// (public url, private reference, bare path). The bucket is public today and
// private after the go-live: the pages must not notice. A file that is no file
// of the bucket (a video on another host) and the model solutions of the other
// private bucket keep their way.

const FIAE = '00000000-0000-4000-8000-000000000001';
const ENABLER = 'aaaaaaa6-0000-4000-8000-000000000006';
const USE_CASE = 'aaaaaaa7-0000-4000-8000-000000000007';
const ORIGIN = 'https://proj.supabase.co';
const ORG = 'org-1';
const PATH = 'preview/kfbm/K6.2-d/szenario/UC_6d_Titel.pdf';
const PUBLIC = `${ORIGIN}/storage/v1/object/public/content/${PATH}`;
const REFERENCE = `private://content/${PATH}`;
const SOLUTION_REF =
  'private://content-solutions/preview/kfbm/x/musterloesung/s.pdf';
const SOLUTION_SIGNED = `${ORIGIN}/storage/v1/object/sign/content-solutions/x?token=s`;
const signedFor = (path: string) =>
  `${ORIGIN}/storage/v1/object/sign/content/${path}?token=${path.length}`;

type Calls = Array<{ bucket: string; paths: string[]; seconds: number }>;

/** The storage client: signs for the bucket content, solutions for their bucket. */
function supabaseMock(calls: Calls, mode: 'ok' | 'error' = 'ok') {
  return () =>
    jest.doMock('@supabase/supabase-js', () => ({
      __esModule: true,
      createClient: () => ({
        storage: {
          from: (bucket: string) => ({
            createSignedUrls: async (paths: string[], seconds: number) => {
              calls.push({ bucket, paths, seconds });
              return mode === 'ok'
                ? {
                    data: paths.map(path => ({
                      path,
                      signedUrl: signedFor(path),
                      error: null,
                    })),
                    error: null,
                  }
                : { data: null, error: new Error('down') };
            },
            createSignedUrl: async () => ({
              data: { signedUrl: SOLUTION_SIGNED },
              error: null,
            }),
          }),
        },
      }),
    }));
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  enablerId: ENABLER,
  useCaseId: null,
  courseId: null,
  organizationId: ORG,
  title: 'Dokument',
  description: null,
  documentType: 'THEORY',
  visibility: 'ALL',
  fileName: 'a.pdf',
  fileSize: 10,
  mimeType: 'application/pdf',
  storageUrl: PUBLIC,
  storagePath: null,
  pageCount: 2,
  orderIndex: 1,
  uploadedById: 'u',
  ...over,
});

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

// ---------------------------------------------------------------------------
// Trainee
// ---------------------------------------------------------------------------

function traineeTables(documents: unknown[], extra: Record<string, any> = {}) {
  return {
    trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }],
    organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
    profiles: [
      {
        id: 't1',
        role: 'TRAINEE',
        organizationId: ORG,
        isPlatformOwner: false,
      },
    ],
    traineeEnrollments: [{ trainingCatalogId: FIAE, startDate: '2026-01-01' }],
    enablers: [
      {
        id: ENABLER,
        isActive: true,
        courseId: 'c1',
        trainingCatalogId: FIAE,
        title: 'E',
        scenarioPdfUrl: PUBLIC,
        pptUrl: 'slides/ppt.pdf',
        videoUrl: 'https://www.youtube.com/watch?v=abc',
        descriptionText: 'd',
      },
    ],
    useCases: [
      {
        id: USE_CASE,
        courseId: 'c1',
        trainingCatalogId: FIAE,
        title: 'UC',
        isActive: true,
      },
    ],
    courseMembers: [{ userId: 't1', courseId: 'c1', role: 'TRAINEE' }],
    contentDocuments: documents,
    organizations: [{ id: 'p', isPlatformOwner: true }],
    enablerSubmissions: [],
    ...extra,
  };
}

async function loadTrainee(
  routePath: string,
  rows: Record<string, any>,
  calls: Calls,
  mode: 'ok' | 'error' = 'ok'
) {
  jest.resetModules();
  jest.dontMock('@/lib/catalog/scope');
  jest.dontMock('@/lib/catalog/public');
  const mock = createTableDb(rows);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/catalog/progression-db', () => ({
    __esModule: true,
    getEnablerProgression: async () => null,
  }));
  supabaseMock(calls, mode)();
  mockSession(traineeSession('t1', { organizationId: ORG }));
  return import(`@/app/api/${routePath}`);
}

const get = (url: string) =>
  ({
    url,
    method: 'GET',
    nextUrl: new URL(url),
    headers: { get: () => null },
  }) as any;

describe('trainee list of the documents of an enabler', () => {
  const route = 'trainee/enablers/[enablerId]/documents/route';
  const call = async (docs: unknown[], mode: 'ok' | 'error' = 'ok') => {
    const calls: Calls = [];
    const mod = await loadTrainee(route, traineeTables(docs), calls, mode);
    const res = await mod.GET(get('http://localhost/x'), {
      params: Promise.resolve({ enablerId: ENABLER }),
    });
    return { res, body: await res.json(), calls };
  };

  it('signs the file of the bucket content, in every stored form, for an hour', async () => {
    const { body, calls } = await call([
      row({ id: 'a', storageUrl: PUBLIC }),
      row({ id: 'b', storageUrl: REFERENCE }),
      row({ id: 'c', storageUrl: 'enablers/x/y.pdf' }),
    ]);
    expect(body.documents.map((d: any) => d.storageUrl)).toEqual([
      signedFor(PATH),
      signedFor(PATH),
      signedFor('enablers/x/y.pdf'),
    ]);
    expect(calls).toEqual([
      {
        bucket: 'content',
        paths: [PATH, 'enablers/x/y.pdf'],
        seconds: 3600,
      },
    ]);
  });

  it('keeps the fields of the page and adds nothing internal', async () => {
    const { body } = await call([row()]);
    expect(Object.keys(body.documents[0]).sort()).toEqual(
      [
        'description',
        'documentType',
        'fileName',
        'fileSize',
        'id',
        'isOwnOrganization',
        'orderIndex',
        'pageCount',
        'storageUrl',
        'title',
      ].sort()
    );
  });

  it('leaves a link to another host alone and asks the storage for nothing', async () => {
    const { body, calls } = await call([
      row({ storageUrl: 'https://example.test/a.pdf' }),
    ]);
    expect(body.documents[0].storageUrl).toBe('https://example.test/a.pdf');
    expect(calls).toEqual([]);
  });

  it('while the bucket is public the stored address survives a failing storage, a reference does not leave', async () => {
    const { body } = await call(
      [row({ id: 'a' }), row({ id: 'b', storageUrl: REFERENCE })],
      'error'
    );
    expect(body.documents.map((d: any) => d.storageUrl)).toEqual([PUBLIC, '']);
    expect(JSON.stringify(body)).not.toContain('private://');
  });

  it('lists the private reference of the bucket content for a trainee, never one of the solutions', async () => {
    const { body } = await call([
      row({ id: 'teach', storageUrl: REFERENCE }),
      row({ id: 'sol', storageUrl: SOLUTION_REF }),
    ]);
    expect(body.documents.map((d: any) => d.id)).toEqual(['teach']);
  });
});

describe('trainee list of the documents of a use case', () => {
  const route = 'trainee/use-cases/[useCaseId]/documents/route';
  const call = async (docs: unknown[], mode: 'ok' | 'error' = 'ok') => {
    const calls: Calls = [];
    const mod = await loadTrainee(route, traineeTables(docs), calls, mode);
    const res = await mod.GET(get('http://localhost/x'), {
      params: Promise.resolve({ useCaseId: USE_CASE }),
    });
    return { res, body: await res.json(), calls };
  };
  const ucRow = (over: Record<string, unknown> = {}) =>
    row({ enablerId: null, useCaseId: USE_CASE, ...over });

  it('signs the file of the bucket content', async () => {
    const { res, body, calls } = await call([
      ucRow({ id: 'a' }),
      ucRow({ id: 'b', storageUrl: REFERENCE }),
    ]);
    expect(res.status).toBe(200);
    expect(body.documents.map((d: any) => d.storageUrl)).toEqual([
      signedFor(PATH),
      signedFor(PATH),
    ]);
    expect(calls).toHaveLength(1);
    expect(body.useCaseTitle).toBe('UC');
  });

  it('keeps the stored address while the bucket is public when signing fails', async () => {
    const { body } = await call([ucRow()], 'error');
    expect(body.documents[0].storageUrl).toBe(PUBLIC);
  });

  it('shows no solution reference to a trainee', async () => {
    const { body } = await call([
      ucRow({
        id: 'sol',
        storageUrl: SOLUTION_REF,
        documentType: 'TRAINER_SOLUTION',
      }),
      ucRow({ id: 'sol2', storageUrl: SOLUTION_REF }),
    ]);
    expect(body.documents).toEqual([]);
  });
});

describe('trainee detail of an enabler', () => {
  const route = 'trainee/enablers/[enablerId]/route';
  const call = async (mode: 'ok' | 'error' = 'ok', enabler: object = {}) => {
    const calls: Calls = [];
    const rows = traineeTables([]);
    rows.enablers = [{ ...rows.enablers[0], ...enabler }];
    const mod = await loadTrainee(route, rows, calls, mode);
    const res = await mod.GET(get('http://localhost/x'), {
      params: Promise.resolve({ enablerId: ENABLER }),
    });
    return { res, body: await res.json(), calls };
  };

  it('signs the scenario PDF and the slides, a video on another host stays', async () => {
    const { body, calls } = await call();
    expect(body.enabler.scenarioPdfUrl).toBe(signedFor(PATH));
    expect(body.enabler.pptUrl).toBe(signedFor('slides/ppt.pdf'));
    expect(body.enabler.videoUrl).toBe('https://www.youtube.com/watch?v=abc');
    expect(calls).toHaveLength(1);
  });

  it('keeps empty fields empty and the stored address when signing fails (public bucket)', async () => {
    const empty = await call('ok', {
      scenarioPdfUrl: null,
      pptUrl: null,
      videoUrl: null,
    });
    expect(empty.body.enabler.scenarioPdfUrl).toBeNull();
    expect(empty.calls).toEqual([]);

    const failing = await call('error');
    expect(failing.body.enabler.scenarioPdfUrl).toBe(PUBLIC);
  });
});

// ---------------------------------------------------------------------------
// Trainer
// ---------------------------------------------------------------------------

describe('trainer lists and creation of the documents of an enabler and of a use case', () => {
  const cases = [
    {
      name: 'enabler',
      route: 'trainer/enablers/[enablerId]/documents/route',
      param: { enablerId: ENABLER },
      url: `http://localhost/api/trainer/enablers/${ENABLER}/documents`,
      parent: {
        enablers: [{ id: ENABLER, trainingCatalogId: FIAE, courseId: 'c' }],
      },
      owner: { enablerId: ENABLER },
    },
    {
      name: 'use case',
      route: 'trainer/use-cases/[useCaseId]/documents/route',
      param: { useCaseId: USE_CASE },
      url: `http://localhost/api/trainer/use-cases/${USE_CASE}/documents`,
      parent: {
        useCases: [{ id: USE_CASE, trainingCatalogId: FIAE, courseId: 'c' }],
      },
      owner: { useCaseId: USE_CASE },
    },
  ];

  describe.each(cases)('$name', ({ route, param, url, parent, owner }) => {
    async function list(docs: any[], mode: 'ok' | 'error' = 'ok') {
      const calls: Calls = [];
      const { mod } = await loadScoped(route, {
        session: trainerSession(),
        tables: {
          ...parent,
          contentDocuments: docs,
          organizations: [{ id: 'p', isPlatformOwner: true }],
        },
        setup: supabaseMock(calls, mode),
      });
      const res = await mod.GET(scopeReq(url), {
        params: Promise.resolve(param),
      });
      return { res, body: await res.json(), calls };
    }

    it('signs the files of the bucket content and leaves the solution to its own bucket', async () => {
      const { body, calls } = await list([
        row({ id: 'a', ...owner }),
        row({ id: 'b', storageUrl: REFERENCE, ...owner }),
        row({
          id: 's',
          storageUrl: SOLUTION_REF,
          visibility: 'TRAINER_ONLY',
          documentType: 'TRAINER_SOLUTION',
          ...owner,
        }),
      ]);
      expect(body.documents.map((d: any) => [d.id, d.storageUrl])).toEqual([
        ['a', signedFor(PATH)],
        ['b', signedFor(PATH)],
        ['s', SOLUTION_SIGNED],
      ]);
      // the bucket content is signed in one request, the solution has its own
      expect(calls.filter(c => c.bucket === 'content')).toHaveLength(1);
      expect(JSON.stringify(body)).not.toContain('private://');
    });

    it('keeps the stored address of a public bucket when signing fails', async () => {
      const { body } = await list([row({ id: 'a', ...owner })], 'error');
      expect(body.documents[0].storageUrl).toBe(PUBLIC);
    });

    it('the document that was just created comes back with a signed address, the row keeps the stored one', async () => {
      const calls: Calls = [];
      const trainer = trainerSession();
      const stored = `${ORIGIN}/storage/v1/object/public/content/${trainer.id}/1700000000000_a.pdf`;
      const { mod, mock } = await loadScoped(route, {
        session: trainer,
        tables: {
          ...parent,
          organizations: [{ id: 'p', isPlatformOwner: true }],
        },
        returns: {
          contentDocuments: [row({ id: 'new', storageUrl: stored, ...owner })],
        },
        setup: supabaseMock(calls),
      });
      const res = await mod.POST(
        {
          ...scopeReq(url, { method: 'POST' }),
          json: async () => ({
            title: 'T',
            fileName: 'a.pdf',
            storageUrl: stored,
            documentType: 'THEORY',
          }),
          text: async () => '',
          headers: {
            get: (n: string) =>
              n.toLowerCase() === 'content-length' ? '100' : null,
          },
        } as any,
        { params: Promise.resolve(param) }
      );
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.document.storageUrl).toBe(
        signedFor(`${trainer.id}/1700000000000_a.pdf`)
      );
      const inserted = mock.writes('insert', 'content_documents')[0] as any;
      expect(inserted.storageUrl).toBe(stored);
    });
  });
});

describe('what stays as it was', () => {
  it('an account that is no trainee and no trainer is not served by the trainee lists', async () => {
    const calls: Calls = [];
    jest.resetModules();
    const mock = createTableDb(traineeTables([row()]));
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    supabaseMock(calls)();
    mockSession(fakeSession());
    const mod =
      await import('@/app/api/trainee/enablers/[enablerId]/documents/route');
    const res = await mod.GET(get('http://localhost/x'), {
      params: Promise.resolve({ enablerId: ENABLER }),
    });
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe('a private reference of another bucket never reaches a trainee', () => {
  it('is empty in the enabler detail, in any spelling', async () => {
    const calls: Calls = [];
    const rows = traineeTables([]);
    rows.enablers = [
      {
        ...rows.enablers[0],
        scenarioPdfUrl: 'PRIVATE://content-solutions/preview/kfbm/x.pdf',
        pptUrl: ' private://content-solutions/y.pdf',
        videoUrl: 'private://avatar/z.png',
      },
    ];
    const mod = await loadTrainee(
      'trainee/enablers/[enablerId]/route',
      rows,
      calls
    );
    const res = await mod.GET(get('http://localhost/x'), {
      params: Promise.resolve({ enablerId: ENABLER }),
    });
    const body = await res.json();
    expect(body.enabler.scenarioPdfUrl).toBe('');
    expect(body.enabler.pptUrl).toBe('');
    expect(body.enabler.videoUrl).toBe('');
    expect(JSON.stringify(body)).not.toMatch(/private:/i);
  });

  it('is not listed for a trainee when it has another spelling', async () => {
    const calls: Calls = [];
    const mod = await loadTrainee(
      'trainee/enablers/[enablerId]/documents/route',
      traineeTables([
        row({ id: 'a', storageUrl: 'PRIVATE://content-solutions/x.pdf' }),
        row({ id: 'b', storageUrl: ' private://content-solutions/x.pdf' }),
        row({ id: 'c', storageUrl: PUBLIC }),
      ]),
      calls
    );
    const res = await mod.GET(get('http://localhost/x'), {
      params: Promise.resolve({ enablerId: ENABLER }),
    });
    const body = await res.json();
    expect(body.documents.map((d: any) => d.id)).toEqual(['c']);
  });
});
