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
    await import('@/app/api/trainee/enablers/[enablerId]/submit/route');
  return mod.POST as (
    req: any,
    ctx: { params: Promise<{ enablerId: string }> }
  ) => Promise<Response>;
}

const enablerRow = {
  id: 'e1',
  courseId: 'c1',
  isActive: true,
  title: 'Enabler 1',
};
const orgRow = { organizationId: 'org1' };

describe('API: POST /api/trainee/enablers/[enablerId]/submit', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('creates first submission (PENDING)', async () => {
    const { db, writes } = createTableDb({
      profiles: [orgRow],
      enablers: [enablerRow],
      courseMembers: [{ userId: 't1', courseId: 'c1' }],
      enablerSubmissions: [],
    });
    const POST = await importHandlerWithDb(db);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/submit', {
        traineeId: 't1',
        solutionText: 'Hello',
      }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(200);
    expect(body).toEqual({
      submission: {
        id: 'generated-1',
        solutionText: 'Hello',
        status: 'PENDING',
      },
    });
    expect(writes('insert', 'enablerSubmissions')[0]).toMatchObject({
      enablerId: 'e1',
      traineeId: 't1',
      solutionText: 'Hello',
      status: 'PENDING',
      attemptNumber: 1,
      organizationId: 'org1',
    });
  });

  it('notifies the trainer with the name of the trainee in German (WMCNL-3029)', async () => {
    const { db, writes } = createTableDb({
      profiles: [orgRow],
      enablers: [enablerRow],
      courses: [{ id: 'c1', createdById: 'trainer1' }],
      courseMembers: [{ userId: 't1', courseId: 'c1' }],
      enablerSubmissions: [],
    });
    const POST = await importHandlerWithDb(db);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/submit', {
        solutionText: 'Hello',
      }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    expect((res as any).status).toBe(200);
    const [notice] = writes('insert', 'notifications')[0] as any[];
    expect(notice).toMatchObject({
      userId: 'trainer1',
      actorId: 't1',
      type: 'ENABLER_SUBMITTED',
      title: 'Szenario eingereicht',
      message: 'Test Trainee hat ein Szenario eingereicht: Enabler 1',
      context: { traineeName: 'Test Trainee', subjectTitle: 'Enabler 1' },
    });
    expect(`${notice.title} ${notice.message}`).not.toMatch(
      /Ein Trainee|Enabler-Szenario/
    );
  });

  it('updates the latest submission on resubmit and bumps the attempt', async () => {
    const existing = [
      {
        id: 'a',
        enablerId: 'e1',
        traineeId: 't1',
        status: 'REJECTED',
        attemptNumber: 1,
        submittedAt: '2023-01-01T00:00:00.000Z',
      },
      {
        id: 'b',
        enablerId: 'e1',
        traineeId: 't1',
        status: 'REJECTED',
        attemptNumber: 2,
        submittedAt: '2024-01-01T00:00:00.000Z',
      },
    ];
    const { db, writes } = createTableDb(
      {
        profiles: [orgRow],
        enablers: [enablerRow],
        courseMembers: [{ userId: 't1', courseId: 'c1' }],
        enablerSubmissions: existing,
      },
      {
        enablerSubmissions: [
          { id: 'b', solutionText: 'Updated', status: 'PENDING' },
        ],
      }
    );
    const POST = await importHandlerWithDb(db);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/submit', {
        traineeId: 't1',
        solutionText: 'Updated',
      }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(200);
    expect(body.submission).toMatchObject({
      id: 'b',
      solutionText: 'Updated',
      status: 'PENDING',
    });
    expect(writes('update', 'enablerSubmissions')[0]).toMatchObject({
      solutionText: 'Updated',
      status: 'PENDING',
      attemptNumber: 3,
    });
  });

  it('400 if the latest submission is still pending review', async () => {
    const { db } = createTableDb({
      profiles: [orgRow],
      enablers: [enablerRow],
      courseMembers: [{ userId: 't1', courseId: 'c1' }],
      enablerSubmissions: [
        {
          id: 'a',
          enablerId: 'e1',
          traineeId: 't1',
          status: 'PENDING',
          submittedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    });
    const POST = await importHandlerWithDb(db);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/submit', {
        traineeId: 't1',
        solutionText: 'X',
      }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    expect((res as any).status).toBe(400);
    expect(await (res as any).json()).toEqual({
      error: 'Submission already pending review',
    });
  });

  describe('a summary without text (WMCNL-2925)', () => {
    const run = async (body: any) => {
      const { db, writes } = createTableDb({
        profiles: [orgRow],
        enablers: [enablerRow],
        courseMembers: [{ userId: 't1', courseId: 'c1' }],
        enablerSubmissions: [],
      });
      const POST = await importHandlerWithDb(db);
      const res = await POST(
        makePost('http://localhost/api/trainee/enablers/e1/submit', body),
        { params: Promise.resolve({ enablerId: 'e1' }) }
      );
      return { res: res as any, writes };
    };

    it.each([
      ['nothing at all', {}],
      ['an empty text', { solutionText: '' }],
      ['only white space', { solutionText: '  \n\t ' }],
      ['an empty list', { solutions: [] }],
      [
        'a list of blank entries',
        { solutions: [{ scenarioIndex: 0, text: '   ' }] },
      ],
      ['entries without a text', { solutions: [{ scenarioIndex: 0 }, null] }],
    ])('400 EMPTY_SUBMISSION for %s and nothing is stored', async (_n, body) => {
      const { res, writes } = await run({ traineeId: 't1', ...body });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Empty submission',
        code: 'EMPTY_SUBMISSION',
      });
      expect(writes('insert', 'enablerSubmissions')).toHaveLength(0);
      expect(writes('update', 'enablerSubmissions')).toHaveLength(0);
      expect(writes('insert', 'notifications')).toHaveLength(0);
    });

    it('takes a list with at least one filled solution', async () => {
      const { res, writes } = await run({
        solutions: [
          { scenarioIndex: 0, text: ' ' },
          { scenarioIndex: 1, text: 'Meine Lösung' },
        ],
      });
      expect(res.status).toBe(200);
      expect(writes('insert', 'enablerSubmissions')).toHaveLength(1);
    });
  });

  it('403 if trainee not member of course', async () => {
    const { db } = createTableDb({
      profiles: [orgRow],
      enablers: [enablerRow],
      courseMembers: [],
    });
    const POST = await importHandlerWithDb(db);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/submit', {
        traineeId: 't1',
        solutionText: 'X',
      }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('404 if enabler not found or inactive', async () => {
    const { db } = createTableDb({ profiles: [orgRow], enablers: [] });
    const POST = await importHandlerWithDb(db);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/submit', {
        traineeId: 't1',
        solutionText: 'X',
      }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(404);
    expect(body).toEqual({ error: 'Not found' });
  });
});
