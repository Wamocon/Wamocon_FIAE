/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  FIAE,
  ORG,
  OTHER_ORG,
  loadScoped,
  scopeReq,
  superAdminSession,
  trainerSession,
} from '../../../helpers/trainerScope';

// The document lists of enablers and use cases showed the documents of every
// organization, and the delete check let a person of the platform organization
// delete the documents of any customer. Now (src/lib/auth/document-scope.ts):
//   list    the shared curriculum (no organization), the platform organization
//           and the own organization; the super admin sees all
//   delete  the super admin, or a person for a document of the own
//           organization; the shared curriculum and platform documents only the
//           super admin. The platform flag of a person widens nothing.

const PLATFORM = '00000000-0000-4000-8000-0000000000aa';
const ENABLER = 'aaaaaaa6-0000-4000-8000-000000000006';
const USE_CASE = 'aaaaaaa7-0000-4000-8000-000000000007';
const DOC = 'ccccccc1-0000-4000-8000-000000000001';

type Target = {
  name: string;
  route: string;
  url: string;
  params: Record<string, string>;
  tables: Record<string, any>;
  parentColumn: string;
};

const targets: Target[] = [
  {
    name: 'enabler documents',
    route: 'trainer/enablers/[enablerId]/documents/route',
    url: `http://localhost/api/trainer/enablers/${ENABLER}/documents`,
    params: { enablerId: ENABLER },
    tables: { enablers: [{ id: ENABLER, trainingCatalogId: FIAE }] },
    parentColumn: '"content_documents"."enabler_id" = $',
  },
  {
    name: 'use case documents',
    route: 'trainer/use-cases/[useCaseId]/documents/route',
    url: `http://localhost/api/trainer/use-cases/${USE_CASE}/documents`,
    params: { useCaseId: USE_CASE },
    tables: {
      useCases: [{ id: USE_CASE, trainingCatalogId: FIAE, courseId: 'c' }],
    },
    parentColumn: '"content_documents"."use_case_id" = $',
  },
];

const document = (organizationId: string | null) => ({
  id: DOC,
  title: 'Skript',
  documentType: 'THEORY',
  organizationId,
  storageUrl: 'https://example.test/file.pdf',
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe.each(targets)('$name', target => {
  async function run(
    method: 'GET' | 'DELETE',
    options: {
      session?: any;
      docs?: Array<ReturnType<typeof document>>;
      query?: string;
    } = {}
  ) {
    const { mod, mock } = await loadScoped(target.route, {
      session: options.session,
      tables: {
        ...target.tables,
        contentDocuments: options.docs ?? [document(ORG)],
        organizations: [{ id: PLATFORM, isPlatformOwner: true }],
      },
    });
    const res = await mod[method](
      scopeReq(`${target.url}${options.query ?? ''}`, { method }),
      { params: Promise.resolve(target.params) }
    );
    return { res, mock };
  }

  describe('list', () => {
    it('shows the shared curriculum, the platform organization and the own organization', async () => {
      const { res, mock } = await run('GET');
      expect(res.status).toBe(200);
      const where = mock.filters('select', 'content_documents');
      expect(where.sql).toContain(
        '"content_documents"."organization_id" is null'
      );
      expect(where.sql).toContain('"content_documents"."organization_id" = $');
      expect(where.sql).toContain('"organizations"."is_platform_owner" = true');
      expect(where.params).toContain(ORG);
      // still bound to the enabler or use case of the path
      expect(where.sql).toContain(target.parentColumn);
    });

    it('does not widen the list for a trainer of the platform organization', async () => {
      const { mock } = await run('GET', {
        session: trainerSession({ isPlatformOwner: true }),
      });
      const where = mock.filters('select', 'content_documents');
      expect(where.params).toContain(ORG);
      expect(where.sql).toContain('"content_documents"."organization_id" = $');
    });

    it('shows every document to the super admin', async () => {
      const { res, mock } = await run('GET', { session: superAdminSession() });
      expect(res.status).toBe(200);
      const where = mock.filters('select', 'content_documents');
      expect(where.sql).not.toContain('organization_id');
      expect(where.sql).toContain(target.parentColumn);
    });
  });

  describe('delete', () => {
    const query = `?documentId=${DOC}`;
    const deletes = (mock: any) => mock.writes('delete', 'content_documents');

    it('lets a person delete a document of the own organization', async () => {
      const { res, mock } = await run('DELETE', { query });
      expect(res.status).toBe(200);
      expect(deletes(mock)).toHaveLength(1);
    });

    it('binds the lookup to the enabler or use case of the path', async () => {
      const { mock } = await run('DELETE', { query });
      const where = mock.filters('select', 'content_documents');
      expect(where.sql).toContain(target.parentColumn);
      expect(where.sql).toContain('"content_documents"."id" = $');
    });

    it('answers 403 for a document of another organization and deletes nothing', async () => {
      const { res, mock } = await run('DELETE', {
        query,
        docs: [document(OTHER_ORG)],
      });
      expect(res.status).toBe(403);
      expect(deletes(mock)).toEqual([]);
    });

    it('answers 403 for a document of the shared curriculum (no organization)', async () => {
      const { res, mock } = await run('DELETE', {
        query,
        docs: [document(null)],
      });
      expect(res.status).toBe(403);
      expect(deletes(mock)).toEqual([]);
    });

    it('answers 403 for a platform document, also for a trainer of the platform organization', async () => {
      for (const session of [
        trainerSession(),
        trainerSession({ isPlatformOwner: true, organizationId: PLATFORM }),
      ]) {
        const { res, mock } = await run('DELETE', {
          query,
          session,
          docs: [document(PLATFORM)],
        });
        expect(res.status).toBe(403);
        expect(deletes(mock)).toEqual([]);
      }
    });

    it('does not let the platform flag open a document of another organization', async () => {
      const { res, mock } = await run('DELETE', {
        query,
        session: trainerSession({
          isPlatformOwner: true,
          organizationId: PLATFORM,
        }),
        docs: [document(OTHER_ORG)],
      });
      expect(res.status).toBe(403);
      expect(deletes(mock)).toEqual([]);
    });

    it.each([
      ['a document of another organization', OTHER_ORG],
      ['a platform document', PLATFORM],
      ['a document of the shared curriculum', null],
    ])('lets the super admin delete %s', async (_name, organizationId) => {
      const { res, mock } = await run('DELETE', {
        query,
        session: superAdminSession(),
        docs: [document(organizationId)],
      });
      expect(res.status).toBe(200);
      expect(deletes(mock)).toHaveLength(1);
    });

    it('answers 404 for an unknown document', async () => {
      const { res, mock } = await run('DELETE', { query, docs: [] });
      expect(res.status).toBe(404);
      expect(deletes(mock)).toEqual([]);
    });

    it.each(['x1', "1'; drop table content_documents; --"])(
      'answers 404 for the documentId %p without a lookup',
      async bad => {
        const { res, mock } = await run('DELETE', {
          query: `?documentId=${encodeURIComponent(bad)}`,
        });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Document not found' });
        expect(deletes(mock)).toEqual([]);
        expect(
          mock.filters('select', 'content_documents').params
        ).not.toContain(bad);
      }
    );

    it('still asks for the documentId', async () => {
      const { res } = await run('DELETE');
      expect(res.status).toBe(400);
    });
  });
});

// The trainee list of the use case documents: the same limit as the trainer
// list, on top of the visibility rules of a trainee.
describe('trainee use case documents', () => {
  it('shows a trainee the shared curriculum and the documents of their own organization only', async () => {
    const { mod, mock } = await loadScoped(
      'trainee/use-cases/[useCaseId]/documents/route',
      {
        session: {
          ...trainerSession(),
          id: 'aaaaaaa8-0000-4000-8000-000000000008',
          role: 'TRAINEE',
          isTrainerLevel: false,
        },
        tables: {
          profiles: [{ role: 'TRAINEE' }],
          useCases: [
            {
              id: USE_CASE,
              trainingCatalogId: FIAE,
              courseId: 'c',
              title: 'UC',
            },
          ],
          courseMembers: [{ courseId: 'c' }],
          contentDocuments: [],
          organizations: [{ id: PLATFORM, isPlatformOwner: true }],
        },
      }
    );
    const res = await mod.GET(
      scopeReq(`http://localhost/api/trainee/use-cases/${USE_CASE}/documents`),
      { params: Promise.resolve({ useCaseId: USE_CASE }) }
    );
    expect(res.status).toBe(200);
    const where = mock.filters('select', 'content_documents');
    expect(where.sql).toContain(
      '"content_documents"."organization_id" is null'
    );
    expect(where.sql).toContain('"content_documents"."organization_id" = $');
    expect(where.params).toContain(ORG);
    // the visibility rules of a trainee stay
    expect(where.sql).toContain('"content_documents"."use_case_id" = $');
    expect(where.params).toContain('TRAINER_SOLUTION');
  });
});
