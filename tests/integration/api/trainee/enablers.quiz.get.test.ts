/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// helper to import the route handler with a mocked DB
async function importHandlerWithDb(mockDb: any) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  const mod = await import('@/app/api/trainee/enablers/[enablerId]/quiz/route');
  return mod.GET as (req: any, ctx: { params: Promise<{ enablerId: string }> }) => Promise<Response>;
}

function makeGet(url: string) {
  return { url } as any;
}

describe('API: GET /api/trainee/enablers/[enablerId]/quiz', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('400 if missing traineeId', async () => {
    const GET = await importHandlerWithDb({});
    const res = await GET(
      makeGet('http://localhost/api/trainee/enablers/e1/quiz'),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(400);
    expect(body).toEqual({ error: 'Missing traineeId' });
  });

  it('returns {quiz:null} if no quiz linked', async () => {
    // Create a simple sequenced mock for db.select().from().where()
    const returns: any[] = [
      // 1) enabler
      [{ id: 'e1', isActive: true, courseId: 'c1' }],
      // 2) course member
      [{ userId: 't1', courseId: 'c1' }],
      // 3) enablerQuizzes link
      [],
    ];

    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({
          where: () => returns.shift(),
        }),
      })),
    };

    const GET = await importHandlerWithDb(mockDb);
    const res = await GET(
      makeGet('http://localhost/api/trainee/enablers/e1/quiz?traineeId=t1'),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(200);
    expect(body).toEqual({ quiz: null });
  });

  it('403 if trainee is not course member', async () => {
    const returns: any[] = [
      // enabler
      [{ id: 'e1', isActive: true, courseId: 'c1' }],
      // no membership
      [],
    ];

    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({
          where: () => returns.shift(),
        }),
      })),
    };

    const GET = await importHandlerWithDb(mockDb);
    const res = await GET(
      makeGet('http://localhost/api/trainee/enablers/e1/quiz?traineeId=t1'),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('404 if enabler not found or inactive', async () => {
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({
          where: () => [], // no enabler returned
        }),
      })),
    };

    const GET = await importHandlerWithDb(mockDb);
    const res = await GET(
      makeGet('http://localhost/api/trainee/enablers/e1/quiz?traineeId=t1'),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(404);
    expect(body).toEqual({ error: 'Not found' });
  });

  it('returns {quiz:null} if link exists but quiz record missing', async () => {
    const sequence: any[] = [
      [{ id: 'e1', isActive: true, courseId: 'c1' }], // enabler
      [{ userId: 't1', courseId: 'c1' }], // membership
      [{ enablerId: 'e1', quizId: 'q1' }], // link
      [], // quizzes lookup empty
    ];
    let idx = 0;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({
          where: () => sequence[idx++],
        }),
      })),
    };
    const GET = await importHandlerWithDb(mockDb);
    const res = await GET(
      makeGet('http://localhost/api/trainee/enablers/e1/quiz?traineeId=t1'),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(200);
    expect(body).toEqual({ quiz: null });
  });

  it('returns quiz with ordered questions and options', async () => {
    // Call order and returns per handler:
    // 1) enablers -> enabler
    // 2) courseMembers -> membership
    // 3) enablerQuizzes -> link
    // 4) quizzes -> quiz
    // 5) questions -> requires orderBy
    // 6) options -> options for both questions
    const sequence: any[] = [
      [{ id: 'e1', isActive: true, courseId: 'c1' }],
      [{ userId: 't1', courseId: 'c1' }],
      [{ enablerId: 'e1', quizId: 'q1' }],
      [{ id: 'q1', title: 'Quiz Title' }],
      { withOrderBy: true, data: [
        { id: 'q-2', quizId: 'q1', questionText: 'B', orderIndex: 2 },
        { id: 'q-1', quizId: 'q1', questionText: 'A', orderIndex: 1 },
      ]},
      [
        { id: 'o-1', questionId: 'q-1', optionText: 'A1' },
        { id: 'o-2', questionId: 'q-2', optionText: 'B1' },
      ],
    ];
    let idx = 0;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({
          where: () => {
            const ret = sequence[idx++];
            if (ret && ret.withOrderBy) {
              return { orderBy: () => ret.data };
            }
            return ret;
          },
        }),
      })),
    };

    const GET = await importHandlerWithDb(mockDb);
    const res = await GET(
      makeGet('http://localhost/api/trainee/enablers/e1/quiz?traineeId=t1'),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(200);
    expect(body.quiz).toEqual({
      id: 'q1',
      title: 'Quiz Title',
      questions: [
        { id: 'q-2', questionText: 'B', options: [{ id: 'o-2', optionText: 'B1' }] },
        { id: 'q-1', questionText: 'A', options: [{ id: 'o-1', optionText: 'A1' }] },
      ],
    });
  });

  it('500 if an unexpected error occurs', async () => {
    const mockDb = {
      select: jest.fn(() => { throw new Error('boom'); }),
    };
    const GET = await importHandlerWithDb(mockDb);
    const res = await GET(
      makeGet('http://localhost/api/trainee/enablers/e1/quiz?traineeId=t1'),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(500);
    expect(body).toEqual({ error: 'Internal Server Error' });
  });
});
