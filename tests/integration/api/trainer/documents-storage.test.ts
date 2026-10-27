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
import { getTableName } from 'drizzle-orm';
import {
  FIAE,
  ORG,
  loadScoped,
  scopeReq,
  superAdminSession,
  trainerSession,
  TRAINER,
  T1,
} from '../../../helpers/trainerScope';

// The delete of a document removes its file from the storage with the service
// key. The url of the file came unchecked from the body of the create request,
// so a prepared document could point to the file of somebody else. Now:
//   create  the url has to be the public url of an own upload (own project,
//           bucket content, folder of the person), see src/lib/document-storage.ts
//   delete  only a file that lies in the folder of the uploader of the document
//           and that no other document (or enabler) references is removed, and
//           only after the permission check
//   create  uses the strict organization lookup, no fallback to the platform

const PLATFORM_FIXTURE_ID = '00000000-0000-4000-8000-0000000000aa';
const SUPABASE = 'https://abc.supabase.co';
const PUBLIC = `${SUPABASE}/storage/v1/object/public/content/`;
const FILE = '1700000000000_skript.pdf';
const OWN_PATH = `${TRAINER}/${FILE}`;
const OWN_URL = `${PUBLIC}${OWN_PATH}`;
const ENABLER = 'aaaaaaa6-0000-4000-8000-000000000006';
const USE_CASE = 'aaaaaaa7-0000-4000-8000-000000000007';
const DOC = 'ccccccc1-0000-4000-8000-000000000001';
const OTHER_DOC = 'ccccccc2-0000-4000-8000-000000000002';

type Target = {
  name: string;
  route: string;
  url: string;
  params: Record<string, string>;
  /** Rows of the tables that the route reads before the document lookup. */
  tables: (extra?: { enablerRows?: any[][] }) => Record<string, any>;
};

const targets: Target[] = [
  {
    name: 'enabler documents',
    route: 'trainer/enablers/[enablerId]/documents/route',
    url: `http://localhost/api/trainer/enablers/${ENABLER}/documents`,
    params: { enablerId: ENABLER },
    // selects on enablers: catalog scope, existence, then the reference check
    tables: extra => ({
      enablers: {
        sequence: extra?.enablerRows ?? [
          [{ id: ENABLER, trainingCatalogId: FIAE }],
          [{ id: ENABLER, trainingCatalogId: FIAE }],
          [],
        ],
      },
    }),
  },
  {
    name: 'use case documents',
    route: 'trainer/use-cases/[useCaseId]/documents/route',
    url: `http://localhost/api/trainer/use-cases/${USE_CASE}/documents`,
    params: { useCaseId: USE_CASE },
    tables: () => ({
      useCases: [{ id: USE_CASE, trainingCatalogId: FIAE, courseId: 'c' }],
      enablers: [],
    }),
  },
];

const removeCalls: Array<{ bucket: string; paths: string[] }> = [];
const savedEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  removeCalls.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  process.env.SUPABASE_SECRET_KEY = 'test-only-key';
  delete process.env.SUPABASE_URL_INTERNAL;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

const doc = (overrides: Record<string, unknown> = {}) => ({
  id: DOC,
  title: 'Skript',
  documentType: 'THEORY',
  organizationId: ORG,
  uploadedById: TRAINER,
  storageUrl: OWN_URL,
  storagePath: OWN_PATH,
  ...overrides,
});

describe.each(targets)('$name', target => {
  async function run(
    method: 'POST' | 'DELETE',
    options: {
      session?: any;
      docs?: any;
      body?: unknown;
      query?: string;
      enablerRows?: any[][];
      setup?: () => void;
      failSecondDocumentSelect?: boolean;
    } = {}
  ) {
    const { mod, mock } = await loadScoped(target.route, {
      session: options.session,
      tables: {
        ...target.tables({ enablerRows: options.enablerRows }),
        contentDocuments: options.docs ?? [doc()],
        organizations: [{ id: PLATFORM_FIXTURE_ID, isPlatformOwner: true }],
      },
      setup: () => {
        jest.doMock('@supabase/supabase-js', () => ({
          __esModule: true,
          createClient: () => ({
            storage: {
              from: (bucket: string) => ({
                remove: async (paths: string[]) => {
                  removeCalls.push({ bucket, paths });
                  return { data: [], error: null };
                },
              }),
            },
          }),
        }));
        options.setup?.();
      },
    });
    if (options.failSecondDocumentSelect) {
      // the look-up of other documents that point to the same file fails
      const original = mock.db.select;
      let documentSelects = 0;
      mock.db.select = jest.fn((...args: any[]) => {
        const chain = (original as any)(...args);
        return new Proxy(chain, {
          get(target, prop) {
            if (prop !== 'from') return target[prop];
            return (table: any) => {
              if (
                getTableName(table) === 'content_documents' &&
                ++documentSelects === 2
              ) {
                throw new Error('db down');
              }
              return chain.from(table);
            };
          },
        });
      });
    }
    const res = await mod[method](
      scopeReq(`${target.url}${options.query ?? ''}`, {
        method,
        body: options.body,
      }),
      { params: Promise.resolve(target.params) }
    );
    return { res, mock };
  }

  describe('create', () => {
    const body = (extra: Record<string, unknown> = {}) => ({
      title: 'Skript',
      fileName: FILE,
      storageUrl: OWN_URL,
      ...extra,
    });
    const inserts = (mock: any) => mock.writes('insert', 'content_documents');

    it('stores the public url of an own upload and the path derived from it', async () => {
      const { res, mock } = await run('POST', { body: body() });
      expect(res.status).toBe(200);
      expect(inserts(mock)).toHaveLength(1);
      expect(inserts(mock)[0]).toMatchObject({
        storageUrl: OWN_URL,
        storagePath: OWN_PATH,
        uploadedById: TRAINER,
      });
    });

    it('accepts the bare path of an own upload and stores the public url of it', async () => {
      const { res, mock } = await run('POST', {
        body: body({ storageUrl: OWN_PATH }),
      });
      expect(res.status).toBe(200);
      expect(inserts(mock)[0]).toMatchObject({
        storageUrl: OWN_URL,
        storagePath: OWN_PATH,
      });
    });

    it('accepts a storagePath that matches the url', async () => {
      const { res } = await run('POST', {
        body: body({ storagePath: OWN_PATH }),
      });
      expect(res.status).toBe(200);
    });

    it('ignores the storagePath of the body and stores the derived one for an empty value', async () => {
      const { mock } = await run('POST', { body: body({ storagePath: '' }) });
      expect(inserts(mock)[0]).toMatchObject({ storagePath: OWN_PATH });
    });

    it.each([
      ['a file in the folder of another person', `${PUBLIC}${T1}/${FILE}`],
      ['a curriculum file', `${PUBLIC}use-cases/A/B/${FILE}`],
      ['a path with dot dot', `${PUBLIC}${TRAINER}/../${T1}/${FILE}`],
      ['an encoded dot dot', `${PUBLIC}${TRAINER}/%2e%2e/${T1}/${FILE}`],
      [
        'another bucket',
        `${SUPABASE}/storage/v1/object/public/avatar/${OWN_PATH}`,
      ],
      [
        'another project',
        `https://evil.test/storage/v1/object/public/content/${OWN_PATH}`,
      ],
      [
        'another scheme',
        `ftp://abc.supabase.co/storage/v1/object/public/content/${OWN_PATH}`,
      ],
      ['a query string', `${OWN_URL}?download=1`],
      ['a javascript url', 'javascript:alert(1)'],
      ['a number', 5],
      ['an object', { a: 1 }],
    ])('answers 400 for %s and stores nothing', async (_name, storageUrl) => {
      const { res, mock } = await run('POST', { body: body({ storageUrl }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid storageUrl' });
      expect(inserts(mock)).toEqual([]);
    });

    it('answers 400 for a storagePath that does not match the url', async () => {
      const { res, mock } = await run('POST', {
        body: body({ storagePath: `${T1}/${FILE}` }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid storagePath' });
      expect(inserts(mock)).toEqual([]);
    });

    it('answers 400 for a body that is not json', async () => {
      const { mod } = await loadScoped(target.route, {
        tables: {
          ...target.tables(),
          contentDocuments: [],
          organizations: [{ id: PLATFORM_FIXTURE_ID, isPlatformOwner: true }],
        },
      });
      const req = scopeReq(target.url, { method: 'POST' });
      req.json = async () => {
        throw new SyntaxError('Unexpected token');
      };
      const res = await mod.POST(req, {
        params: Promise.resolve(target.params),
      });
      expect(res.status).toBe(400);
    });

    it('checks the permission before the url: a platform trainer gets 403', async () => {
      const { res, mock } = await run('POST', {
        session: trainerSession({ organizationId: PLATFORM_FIXTURE_ID }),
        body: body({ storageUrl: 'javascript:alert(1)' }),
      });
      expect(res.status).toBe(403);
      expect(inserts(mock)).toEqual([]);
    });

    it('lets the super admin add a document with an own upload', async () => {
      const { res } = await run('POST', {
        session: superAdminSession(),
        body: body(),
      });
      expect(res.status).toBe(200);
    });

    it('does not let the super admin point to the file of somebody else either', async () => {
      const { res, mock } = await run('POST', {
        session: superAdminSession(),
        body: body({ storageUrl: `${PUBLIC}${T1}/${FILE}` }),
      });
      expect(res.status).toBe(400);
      expect(inserts(mock)).toEqual([]);
    });

    it('uses the strict organization lookup and never the one with the platform fallback', async () => {
      const strict = jest.fn(async () => ORG);
      const loose = jest.fn(async () => 'platform');
      const { res, mock } = await run('POST', {
        body: body(),
        setup: () =>
          jest.doMock('@/lib/auth-helpers', () => ({
            __esModule: true,
            verifyTrainer: async () => true,
            verifyPlatformOwner: async () => false,
            getUserOrgId: loose,
            getUserOrgIdStrict: strict,
          })),
      });
      expect(res.status).toBe(200);
      expect(strict).toHaveBeenCalledWith(TRAINER);
      expect(loose).not.toHaveBeenCalled();
      expect(inserts(mock)[0]).toMatchObject({ organizationId: ORG });
    });

    it('answers 403 and stores nothing when the account has no organization', async () => {
      const { res, mock } = await run('POST', {
        body: body(),
        setup: () =>
          jest.doMock('@/lib/auth-helpers', () => ({
            __esModule: true,
            verifyTrainer: async () => true,
            verifyPlatformOwner: async () => false,
            getUserOrgId: async () => 'platform',
            getUserOrgIdStrict: async () => {
              throw new Error('[getUserOrgIdStrict] no organization');
            },
          })),
      });
      expect(res.status).toBe(403);
      expect(inserts(mock)).toEqual([]);
    });
  });

  describe('delete', () => {
    const query = `?documentId=${DOC}`;
    const deletes = (mock: any) => mock.writes('delete', 'content_documents');
    // selects on content_documents: the lookup of the document, then the
    // check for other documents that point to the same file
    const docs = (row: any, others: any[] = []) => ({
      sequence: [[row], others],
    });

    it('removes the file of the document and the row', async () => {
      const { res, mock } = await run('DELETE', { query, docs: docs(doc()) });
      expect(res.status).toBe(200);
      expect(removeCalls).toEqual([{ bucket: 'content', paths: [OWN_PATH] }]);
      expect(deletes(mock)).toHaveLength(1);
    });

    it('removes the file of the uploader when a colleague deletes the document', async () => {
      const path = `${T1}/${FILE}`;
      const { res } = await run('DELETE', {
        query,
        docs: docs(doc({ uploadedById: T1, storageUrl: `${PUBLIC}${path}` })),
      });
      expect(res.status).toBe(200);
      expect(removeCalls).toEqual([{ bucket: 'content', paths: [path] }]);
    });

    it('checks the other documents and the enablers for the same file', async () => {
      const { mock } = await run('DELETE', { query, docs: docs(doc()) });
      const where = mock.filters('select', 'content_documents');
      expect(where.sql).toContain('"content_documents"."id" <> $');
      expect(where.sql).toContain('"content_documents"."storage_path" = $');
      expect(where.sql).toContain('right("content_documents"."storage_url"');
      expect(where.params).toContain(DOC);
      expect(where.params).toContain(OWN_PATH);
      const enablers = mock.filters('select', 'enablers');
      expect(enablers.sql).toContain('right("enablers"."ppt_url"');
      expect(enablers.sql).toContain('right("enablers"."scenario_pdf_url"');
      expect(enablers.sql).toContain('right("enablers"."video_url"');
    });

    it('keeps the file for another document of another organization that points to it', async () => {
      const { res, mock } = await run('DELETE', {
        query,
        docs: docs(doc(), [{ id: OTHER_DOC }]),
      });
      expect(res.status).toBe(200);
      expect(removeCalls).toEqual([]);
      expect(deletes(mock)).toHaveLength(1);
    });

    it('keeps the file for an enabler that points to it', async () => {
      if (target.name !== 'enabler documents') return;
      const row = { id: ENABLER, trainingCatalogId: FIAE };
      const { res } = await run('DELETE', {
        query,
        docs: docs(doc()),
        enablerRows: [[row], [row], [{ id: ENABLER }]],
      });
      expect(res.status).toBe(200);
      expect(removeCalls).toEqual([]);
    });

    it.each([
      [
        'the folder of another person',
        { storageUrl: `${PUBLIC}${T1}/${FILE}` },
      ],
      ['a curriculum file', { storageUrl: `${PUBLIC}use-cases/A/B/${FILE}` }],
      [
        'a path with dot dot',
        { storageUrl: `${PUBLIC}${TRAINER}/../${T1}/${FILE}` },
      ],
      [
        'a file of another project',
        {
          storageUrl: `https://evil.test/storage/v1/object/public/content/${OWN_PATH}`,
        },
      ],
      [
        'another bucket',
        {
          storageUrl: `${SUPABASE}/storage/v1/object/public/avatar/${OWN_PATH}`,
        },
      ],
      ['a document without an uploader', { uploadedById: null }],
      ['an empty url', { storageUrl: '' }],
    ])(
      'keeps the file of %s and still removes the row',
      async (_name, change) => {
        const { res, mock } = await run('DELETE', {
          query,
          docs: docs(doc(change)),
        });
        expect(res.status).toBe(200);
        expect(removeCalls).toEqual([]);
        expect(deletes(mock)).toHaveLength(1);
      }
    );

    it('does not touch the storage when the permission check fails', async () => {
      const { res, mock } = await run('DELETE', {
        query,
        docs: docs(doc({ organizationId: 'org-2' })),
      });
      expect(res.status).toBe(403);
      expect(removeCalls).toEqual([]);
      expect(deletes(mock)).toEqual([]);
      // not even the look-up of other references
      expect(
        mock.calls.filter(
          c => c.op === 'select' && c.table === 'content_documents'
        )
      ).toHaveLength(1);
    });

    it('does not touch the storage for a document of the shared curriculum', async () => {
      const { res } = await run('DELETE', {
        query,
        docs: docs(doc({ organizationId: null })),
      });
      expect(res.status).toBe(403);
      expect(removeCalls).toEqual([]);
    });

    it('does not touch the storage for an unknown document', async () => {
      const { res } = await run('DELETE', { query, docs: [] });
      expect(res.status).toBe(404);
      expect(removeCalls).toEqual([]);
    });

    it('lets the super admin remove the file of a document of another organization', async () => {
      const { res } = await run('DELETE', {
        query,
        session: superAdminSession(),
        docs: docs(doc({ organizationId: 'org-2' })),
      });
      expect(res.status).toBe(200);
      expect(removeCalls).toEqual([{ bucket: 'content', paths: [OWN_PATH] }]);
    });

    it('keeps the file and still removes the row when the reference check fails', async () => {
      const { res, mock } = await run('DELETE', {
        query,
        docs: docs(doc()),
        failSecondDocumentSelect: true,
      });
      expect(res.status).toBe(200);
      expect(removeCalls).toEqual([]);
      expect(deletes(mock)).toHaveLength(1);
    });

    it('removes the file after the row, and keeps the row delete when the storage answers with an error', async () => {
      const { res, mock } = await run('DELETE', {
        query,
        docs: docs(doc()),
        setup: () =>
          jest.doMock('@supabase/supabase-js', () => ({
            __esModule: true,
            createClient: () => ({
              storage: {
                from: () => ({
                  remove: async () => ({
                    data: null,
                    error: { message: 'denied' },
                  }),
                }),
              },
            }),
          })),
      });
      expect(res.status).toBe(200);
      expect(deletes(mock)).toHaveLength(1);
    });

    it('still deletes the row when the storage call fails', async () => {
      const { res, mock } = await run('DELETE', {
        query,
        docs: docs(doc()),
        setup: () =>
          jest.doMock('@supabase/supabase-js', () => ({
            __esModule: true,
            createClient: () => {
              throw new Error('storage down');
            },
          })),
      });
      expect(res.status).toBe(200);
      expect(deletes(mock)).toHaveLength(1);
    });

    it('does not remove anything without a service key and a project url', async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SECRET_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const { res } = await run('DELETE', { query, docs: docs(doc()) });
      expect(res.status).toBe(200);
      expect(removeCalls).toEqual([]);
    });
  });
});
