/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  mockCatalogScope,
  mockTraineeSession,
} from '../../../helpers/mockNext';

function makePost(url: string, body: any) {
  return { url, json: async () => body } as any;
}

async function importHandlerWithDb(mockDb: any) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  mockTraineeSession();
  mockCatalogScope();
  const mod =
    await import('@/app/api/trainee/use-cases/[useCaseId]/submit/route');
  return mod.POST as (
    req: any,
    ctx: { params: Promise<{ useCaseId: string }> }
  ) => Promise<Response>;
}

const useCaseRow = { id: 'u1', courseId: 'c1', isActive: true, title: 'UC' };
const memberRow = { userId: 't1', courseId: 'c1' };
const orgRow = { organizationId: 'org1' };

describe('API: POST /api/trainee/use-cases/[useCaseId]/submit', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('creates a submission and stores the trimmed, non-empty links', async () => {
    const { db, writes } = createTableDb(
      {
        profiles: [orgRow],
        useCases: [useCaseRow],
        courseMembers: [memberRow],
        useCaseSubmissions: [], // no earlier attempt
      },
      { useCaseSubmissions: [{ id: 's1' }] }
    );
    const POST = await importHandlerWithDb(db);

    const res = await POST(
      makePost('http://localhost/api/trainee/use-cases/u1/submit', {
        traineeId: 't1',
        submissionText: 'Hello',
        links: [
          { url: ' https://a ' },
          { url: '' },
          { url: 'https://b', description: 'B' },
        ],
      }),
      { params: Promise.resolve({ useCaseId: 'u1' }) }
    );
    expect((res as any).status).toBe(200);
    expect(await (res as any).json()).toEqual({ ok: true, submissionId: 's1' });
    expect(writes('insert', 'useCaseSubmissions')[0]).toMatchObject({
      traineeId: 't1',
      useCaseId: 'u1',
      status: 'PENDING',
      attemptNumber: 1,
      organizationId: 'org1',
    });
    expect(writes('insert', 'useCaseSubmissionLinks')[0]).toEqual([
      { submissionId: 's1', url: 'https://a', description: null },
      { submissionId: 's1', url: 'https://b', description: 'B' },
    ]);
    expect(writes('delete', 'useCaseSubmissionLinks')).toHaveLength(0);
  });

  it('updates the existing submission, bumps the attempt and replaces links', async () => {
    const { db, writes } = createTableDb(
      {
        profiles: [orgRow],
        useCases: [useCaseRow],
        courseMembers: [memberRow],
        useCaseSubmissions: [
          {
            id: 's1',
            traineeId: 't1',
            useCaseId: 'u1',
            attemptNumber: 1,
            submittedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
      { useCaseSubmissions: [{ id: 's1' }] }
    );
    const POST = await importHandlerWithDb(db);

    const res = await POST(
      makePost('http://localhost/api/trainee/use-cases/u1/submit', {
        traineeId: 't1',
        submissionText: 'Updated',
        links: [{ url: 'https://c' }],
      }),
      { params: Promise.resolve({ useCaseId: 'u1' }) }
    );
    expect((res as any).status).toBe(200);
    expect(await (res as any).json()).toEqual({ ok: true, submissionId: 's1' });
    expect(writes('update', 'useCaseSubmissions')[0]).toMatchObject({
      submissionText: 'Updated',
      status: 'PENDING',
      attemptNumber: 2,
    });
    expect(writes('delete', 'useCaseSubmissionLinks')).toHaveLength(1);
    expect(writes('insert', 'useCaseSubmissionLinks')[0]).toEqual([
      { submissionId: 's1', url: 'https://c', description: null },
    ]);
  });

  describe('a hand-in without content (WMCNL-2926)', () => {
    // fileFound: undefined = the file feature is off, false/true = on, with or
    // without a file in the storage
    const run = async (body: any, fileFound?: boolean) => {
      const { db, writes } = createTableDb(
        {
          profiles: [orgRow],
          useCases: [useCaseRow],
          courseMembers: [memberRow],
          useCaseSubmissions: [],
        },
        { useCaseSubmissions: [{ id: 's1' }] }
      );
      jest.resetModules();
      jest.doMock('@/db', () => ({ __esModule: true, default: db }));
      mockTraineeSession();
      mockCatalogScope();
      jest.doMock('@/lib/submission-file/availability', () => ({
        isSubmissionFileEnabled: () => fileFound !== undefined,
      }));
      jest.doMock('@/lib/submission-file/access', () => ({
        openStorage: () => ({}),
      }));
      jest.doMock('@/lib/submission-file/service', () => ({
        getFile: async () => ({
          ok: true,
          value: fileFound ? { fileName: 'a.pdf', size: 3 } : null,
        }),
      }));
      const mod =
        await import('@/app/api/trainee/use-cases/[useCaseId]/submit/route');
      const res = (await mod.POST(
        makePost('http://localhost/api/trainee/use-cases/u1/submit', body),
        { params: Promise.resolve({ useCaseId: 'u1' }) }
      )) as any;
      return { res, writes };
    };

    it.each([
      ['nothing at all', {}],
      ['an empty text and no link', { submissionText: '', links: [] }],
      ['a null text', { submissionText: null, links: [] }],
      ['only white space', { submissionText: ' \n\t', links: [] }],
      ['a link without an address', { links: [{ url: '  ' }, { url: '' }] }],
    ])('400 EMPTY_SUBMISSION for %s and nothing is stored', async (_n, body) => {
      const { res, writes } = await run({ traineeId: 't1', ...body }, false);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Empty submission',
        code: 'EMPTY_SUBMISSION',
      });
      expect(writes('insert', 'useCaseSubmissions')).toHaveLength(0);
      expect(writes('update', 'useCaseSubmissions')).toHaveLength(0);
      expect(writes('insert', 'notifications')).toHaveLength(0);
    });

    it('is refused while the file feature is off and nothing else is given', async () => {
      const { res, writes } = await run({ submissionText: '  ' });
      expect(res.status).toBe(400);
      expect(writes('insert', 'useCaseSubmissions')).toHaveLength(0);
    });

    it('takes a link without a text', async () => {
      const { res } = await run({ links: [{ url: 'https://a' }] }, false);
      expect(res.status).toBe(200);
    });

    it('takes a hand-in with only a file', async () => {
      const { res, writes } = await run({ submissionText: ' ' }, true);
      expect(res.status).toBe(200);
      expect(writes('insert', 'useCaseSubmissions')).toHaveLength(1);
    });
  });

  it('403 if not member', async () => {
    const { db } = createTableDb({
      profiles: [orgRow],
      useCases: [useCaseRow],
      courseMembers: [],
    });
    const POST = await importHandlerWithDb(db);
    const res = await POST(
      makePost('http://localhost/api/trainee/use-cases/u1/submit', {
        traineeId: 't1',
        submissionText: 'X',
      }),
      { params: Promise.resolve({ useCaseId: 'u1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('404 if use-case not found or inactive', async () => {
    const { db } = createTableDb({ profiles: [orgRow], useCases: [] });
    const POST = await importHandlerWithDb(db);
    const res = await POST(
      makePost('http://localhost/api/trainee/use-cases/u1/submit', {
        traineeId: 't1',
        submissionText: 'X',
      }),
      { params: Promise.resolve({ useCaseId: 'u1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(404);
    expect(body).toEqual({ error: 'Not found' });
  });
});
