/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';

// GET /api/trainee/enablers/[enablerId]/documents: the documents of an enabler
// for the trainee. The trainee page used to call the trainer route, which a
// trainee cannot pass (403), so a trainee saw no document. This route has its
// own filter: the enabler has to lie in the occupation of the trainee and be
// active, the trainee has to be a member of its course, a document has to be
// meant for trainees (not TRAINER_ONLY, not a TRAINER_SOLUTION), has to belong
// to the shared curriculum, the platform or the own organization, and has to
// carry a file (a scenario without a file is no link). The answer names the
// fields the page needs, no internal field such as the uploader.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ENABLER = 'aaaaaaa6-0000-4000-8000-000000000006';
const PLATFORM = '00000000-0000-4000-8000-0000000000aa';
const ORG = 'org-1';
const OTHER_ORG = 'org-2';

const enabler = {
  id: ENABLER,
  isActive: true,
  courseId: 'c1',
  trainingCatalogId: FIAE,
};

const doc = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  enablerId: ENABLER,
  useCaseId: null,
  courseId: null,
  organizationId: ORG,
  title: 'Lehrtext',
  description: 'Kurz',
  documentType: 'THEORY',
  visibility: 'ALL',
  fileName: 'lehrtext.pdf',
  fileSize: 1234,
  mimeType: 'application/pdf',
  storageUrl: 'https://example.test/storage/v1/object/public/content/a.pdf',
  storagePath: 'INTERNAL-PATH/a.pdf',
  pageCount: 3,
  isIndexedByHai: true,
  orderIndex: 1,
  uploadedById: 'INTERNAL-UPLOADER',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...overrides,
});

const ctx = (enablerId = ENABLER) => ({
  params: Promise.resolve({ enablerId }),
});

function request(
  url = `http://localhost/api/trainee/enablers/${ENABLER}/documents`
) {
  return {
    url,
    method: 'GET',
    nextUrl: new URL(url),
    headers: { get: () => null },
  } as any;
}

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
    courseMembers: [{ userId: 't1', courseId: 'c1', role: 'TRAINEE' }],
    contentDocuments: [doc()],
    organizations: [{ id: PLATFORM, isPlatformOwner: true }],
    ...overrides,
  };
}

async function load(
  session: ReturnType<typeof fakeSession> | null,
  rows: Record<string, any> = tables(),
  db?: any
) {
  jest.resetModules();
  jest.dontMock('@/lib/catalog/scope');
  jest.dontMock('@/lib/catalog/public');
  const mock = createTableDb(rows);
  jest.doMock('@/db', () => ({ __esModule: true, default: db ?? mock.db }));
  mockSession(session);
  const mod =
    await import('@/app/api/trainee/enablers/[enablerId]/documents/route');
  return { mock, GET: mod.GET };
}

const asTrainee = () => traineeSession('t1', { organizationId: ORG });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('GET /api/trainee/enablers/[enablerId]/documents', () => {
  it('lists the documents of the enabler with the fields of the page', async () => {
    const { GET } = await load(asTrainee());
    const res = await GET(request(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      documents: [
        {
          id: 'd1',
          title: 'Lehrtext',
          description: 'Kurz',
          documentType: 'THEORY',
          fileName: 'lehrtext.pdf',
          fileSize: 1234,
          storageUrl:
            'https://example.test/storage/v1/object/public/content/a.pdf',
          pageCount: 3,
          orderIndex: 1,
          isOwnOrganization: true,
        },
      ],
    });
  });

  it('carries no internal field: uploader, storage path, organization id, index flag', async () => {
    const { GET } = await load(asTrainee());
    const body = await (await GET(request(), ctx())).json();
    const text = JSON.stringify(body);
    expect(text).not.toContain('INTERNAL');
    expect(text).not.toContain(ORG);
    for (const key of [
      'uploadedById',
      'storagePath',
      'organizationId',
      'isIndexedByHai',
      'visibility',
      'enablerId',
    ]) {
      expect(Object.keys(body.documents[0])).not.toContain(key);
    }
  });

  it('names the columns in the query, no select of the whole row', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/api/trainee/enablers/[enablerId]/documents/route.ts'
      ),
      'utf8'
    );
    expect(source).not.toMatch(/\.select\(\s*\)/);
    expect(source).not.toMatch(/uploadedById|storagePath/);
  });

  it('marks a document of the shared curriculum and of the platform as not own', async () => {
    const { GET } = await load(
      asTrainee(),
      tables({
        contentDocuments: [
          doc({ id: 'own', organizationId: ORG }),
          doc({ id: 'shared', organizationId: null }),
          doc({ id: 'platform', organizationId: PLATFORM }),
        ],
      })
    );
    const body = await (await GET(request(), ctx())).json();
    expect(body.documents.map((d: any) => [d.id, d.isOwnOrganization])).toEqual(
      [
        ['own', true],
        ['shared', false],
        ['platform', false],
      ]
    );
  });

  it('keeps TRAINER_ONLY and TRAINER_SOLUTION documents away, even if a row slips through', async () => {
    const { GET, mock } = await load(
      asTrainee(),
      tables({
        contentDocuments: [
          doc({ id: 'ok-all', visibility: 'ALL' }),
          doc({ id: 'ok-trainee', visibility: 'TRAINEE_ONLY' }),
          doc({ id: 'ok-null', visibility: null }),
          doc({ id: 'secret-only', visibility: 'TRAINER_ONLY' }),
          doc({ id: 'secret-solution', documentType: 'TRAINER_SOLUTION' }),
        ],
      })
    );
    const body = await (await GET(request(), ctx())).json();
    expect(body.documents.map((d: any) => d.id)).toEqual([
      'ok-all',
      'ok-trainee',
      'ok-null',
    ]);
    // and the query itself asks for the visible ones only
    const where = mock.filters('select', 'content_documents');
    expect(where.sql).toContain('"content_documents"."visibility" in');
    expect(where.sql).toContain('"content_documents"."visibility" is null');
    expect(where.params).toEqual(
      expect.arrayContaining(['ALL', 'TRAINEE_ONLY', 'TRAINER_SOLUTION'])
    );
    expect(where.params).not.toContain('TRAINER_ONLY');
  });

  it('shows no row without a file, a scenario without a file is no link', async () => {
    const { GET, mock } = await load(
      asTrainee(),
      tables({
        contentDocuments: [
          doc({ id: 'file' }),
          doc({ id: 'empty', storageUrl: '' }),
          doc({ id: 'blank', storageUrl: '   ' }),
          doc({ id: 'none', storageUrl: null }),
        ],
      })
    );
    const body = await (await GET(request(), ctx())).json();
    expect(body.documents.map((d: any) => d.id)).toEqual(['file']);
    const where = mock.filters('select', 'content_documents');
    expect(where.sql).toContain('btrim("content_documents"."storage_url")');
  });

  it('limits the list to the enabler of the path and to the own organization', async () => {
    const { GET, mock } = await load(asTrainee());
    await GET(request(), ctx());
    const where = mock.filters('select', 'content_documents');
    expect(where.sql).toContain('"content_documents"."enabler_id" = $');
    expect(where.params).toContain(ENABLER);
    // the shared curriculum, the platform and the own organization (PR 129)
    expect(where.sql).toContain(
      '"content_documents"."organization_id" is null'
    );
    expect(where.sql).toContain('"content_documents"."organization_id" = $');
    expect(where.sql).toContain('"organizations"."is_platform_owner" = true');
    expect(where.params).toContain(ORG);
    expect(where.params).not.toContain(OTHER_ORG);
  });

  it('uses the organization of the session, not one from the query', async () => {
    const { GET, mock } = await load(asTrainee());
    await GET(
      request(
        `http://localhost/api/trainee/enablers/${ENABLER}/documents?organizationId=${OTHER_ORG}&traineeId=x`
      ),
      ctx()
    );
    const where = mock.filters('select', 'content_documents');
    expect(where.params).toContain(ORG);
    expect(where.params).not.toContain(OTHER_ORG);
  });
});

describe('GET /api/trainee/enablers/[enablerId]/documents guards and scope', () => {
  it('401 without a session, the database is not touched', async () => {
    const { GET, mock } = await load(null);
    const res = await GET(request(), ctx());
    expect(res.status).toBe(401);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('403 for a trainer, the route is for trainees', async () => {
    const { GET, mock } = await load(fakeSession());
    const res = await GET(request(), ctx());
    expect(res.status).toBe(403);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('404 for an enabler of another occupation', async () => {
    const { GET, mock } = await load(
      asTrainee(),
      tables({ enablers: [{ ...enabler, trainingCatalogId: KFBM }] })
    );
    const res = await GET(request(), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
    expect(mock.calls.some(c => c.table === 'content_documents')).toBe(false);
  });

  it('404 for an enabler the organization has not enabled for its trainees', async () => {
    const { GET, mock } = await load(
      asTrainee(),
      tables({
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
        traineeEnrollments: [
          { trainingCatalogId: FIAE, startDate: '2026-01-01' },
          { trainingCatalogId: KFBM, startDate: '2026-09-01' },
        ],
        enablers: [{ ...enabler, trainingCatalogId: KFBM }],
      })
    );
    const res = await GET(request(), ctx());
    expect(res.status).toBe(404);
    expect(mock.calls.some(c => c.table === 'content_documents')).toBe(false);
  });

  it('serves an enabler of the KfBM to a trainee enrolled in it', async () => {
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

  it('404 for an id that is no uuid, without a query on the documents', async () => {
    const { GET, mock } = await load(asTrainee());
    const res = await GET(request(), ctx('not-a-uuid'));
    expect(res.status).toBe(404);
    expect(mock.calls.some(c => c.table === 'content_documents')).toBe(false);
  });

  it('404 for an enabler that is switched off', async () => {
    const { GET, mock } = await load(
      asTrainee(),
      tables({ enablers: [{ ...enabler, isActive: false }] })
    );
    const res = await GET(request(), ctx());
    expect(res.status).toBe(404);
    expect(mock.calls.some(c => c.table === 'content_documents')).toBe(false);
  });

  it('404 for an enabler that does not exist', async () => {
    const { GET } = await load(asTrainee(), tables({ enablers: [] }));
    expect((await GET(request(), ctx())).status).toBe(404);
  });

  it('403 for a trainee who is no member of the course of the enabler', async () => {
    const { GET, mock } = await load(
      asTrainee(),
      tables({ courseMembers: [] })
    );
    const res = await GET(request(), ctx());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
    expect(mock.calls.some(c => c.table === 'content_documents')).toBe(false);
  });

  it('500 if reading the documents fails after the scope check', async () => {
    const broken: any[] = [];
    broken.filter = () => {
      throw new Error('boom');
    };
    broken.map = () => {
      throw new Error('boom');
    };
    const { GET } = await load(
      asTrainee(),
      tables({ contentDocuments: broken })
    );
    const res = await GET(request(), ctx());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });
});
