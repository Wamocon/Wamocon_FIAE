/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

function makeGet(url: string) {
  return { url } as any;
}

async function importListHandlerWithDb(mockDb: any) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  const mod = await import('@/app/api/trainee/courses/route');
  return mod.GET as (req: any) => Promise<Response>;
}

async function importDetailHandlerWithDb(mockDb: any) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  const mod = await import('@/app/api/trainee/courses/[courseId]/route');
  return mod.GET as unknown as (req: any, ctx: { params: Promise<{ courseId: string }> }) => Promise<Response>;
}

describe('API: Trainee Courses', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('GET /api/trainee/courses lists courses with strict progress', async () => {
    const { db } = createTableDb({
      courseMembers: [
        { userId: 't1', courseId: 'c1' },
        { userId: 't1', courseId: 'c2' },
      ],
      courses: [
        { id: 'c1', title: 'Course 1', year: 2024, chapter: 'A' },
        { id: 'c2', title: 'Course 2', year: 2025, chapter: 'B' },
      ],
      enablers: [
        { id: 'e1', courseId: 'c1', scenarioPdfUrl: null },
        { id: 'e2', courseId: 'c2', scenarioPdfUrl: null },
        { id: 'e3', courseId: 'c1', scenarioPdfUrl: null },
      ],
      // e1 needs a passed quiz, the trainee scored 80, so it counts as done
      enablerQuizLinks: [{ enablerId: 'e1', quizId: 'q1' }],
      quizSubmissions: [{ quizId: 'q1', score: 80 }],
    });

    const GET = await importListHandlerWithDb(db);
    const res = await GET(makeGet('http://localhost/api/trainee/courses?traineeId=t1'));
    const body = await (res as any).json();
    expect((res as any).status).toBe(200);
    expect(body).toEqual({
      courses: [
        { id: 'c1', title: 'Course 1', year: 2024, chapter: 'A', progress: 100, enablerCount: 2, completedCount: 2 },
        { id: 'c2', title: 'Course 2', year: 2025, chapter: 'B', progress: 100, enablerCount: 1, completedCount: 1 },
      ],
    });
  });

  it('GET /api/trainee/courses/[courseId] returns course summary with active enablers/use-cases', async () => {
    const sequence: any[] = [
      // membership
      [{ userId: 't1', courseId: 'c1' }],
      // course by id
      [{ id: 'c1', title: 'Course 1', year: 2024, chapter: 'A' }],
      // enablers with orderBy
      {
        withOrderBy: true, data: [
          { id: 'e1', title: 'E1', courseId: 'c1', isActive: true, orderIndex: 1 },
          { id: 'e2', title: 'E2', courseId: 'c1', isActive: true, orderIndex: 2 },
        ]
      },
      // useCases with orderBy
      {
        withOrderBy: true, data: [
          { id: 'u1', title: 'UC1', courseId: 'c1', isActive: true, orderIndex: 1 },
        ]
      },
      // enAttempts
      [],
      // ucAttempts
      [],
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

    const GET = await importDetailHandlerWithDb(mockDb);
    const res = await GET(
      makeGet('http://localhost/api/trainee/courses/c1?traineeId=t1'),
      { params: Promise.resolve({ courseId: 'c1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(200);
    expect(body).toEqual({
      course: { id: 'c1', title: 'Course 1', year: 2024, chapter: 'A' },
      enablers: [
        { id: 'e1', title: 'E1', attemptNumber: null, status: null },
        { id: 'e2', title: 'E2', attemptNumber: null, status: null }
      ],
      useCases: [
        { id: 'u1', title: 'UC1', attemptNumber: null, status: null }
      ],
    });
  });

  it('403 if trainee is not member of course', async () => {
    const sequence: any[] = [
      // membership empty
      [],
    ];
    let idx = 0;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({
          where: () => sequence[idx++],
        }),
      })),
    };
    const GET = await importDetailHandlerWithDb(mockDb);
    const res = await GET(
      makeGet('http://localhost/api/trainee/courses/c1?traineeId=t1'),
      { params: Promise.resolve({ courseId: 'c1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });
});
