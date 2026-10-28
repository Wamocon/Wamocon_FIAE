/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  mockCatalogScope,
  mockTraineeSession,
} from '../../../helpers/mockNext';

function makeGet(url: string) {
  return { url } as any;
}

async function importListHandlerWithDb(mockDb: any) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  mockTraineeSession();
  mockCatalogScope();
  const mod = await import('@/app/api/trainee/courses/route');
  return mod.GET as (req: any) => Promise<Response>;
}

async function importDetailHandlerWithDb(mockDb: any) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  mockTraineeSession();
  mockCatalogScope();
  const mod = await import('@/app/api/trainee/courses/[courseId]/route');
  return mod.GET as unknown as (req: any, ctx: { params: Promise<{ courseId: string }> }) => Promise<Response>;
}

describe('API: Trainee Courses', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('GET /api/trainee/courses lists courses with strict progress', async () => {
    const { db, filters } = createTableDb({
      courseMembers: [
        { userId: 't1', courseId: 'c1' },
        { userId: 't1', courseId: 'c2' },
      ],
      courses: [
        { id: 'c1', title: 'Course 1', year: 2024, chapter: 'A' },
        { id: 'c2', title: 'Course 2', year: 2025, chapter: 'B' },
      ],
      enablers: [
        { id: 'e1', courseId: 'c1', orderIndex: 1, isActive: true },
        { id: 'e2', courseId: 'c2', orderIndex: 1, isActive: true },
        { id: 'e3', courseId: 'c1', orderIndex: 2, isActive: true },
      ],
      // e1 needs a passed quiz, the trainee scored 80, so it counts as done
      enablerQuizLinks: [
        { enablerId: 'e1', quizId: 'q1', difficulty: 'LOW' },
      ],
      quizzes: [{ id: 'q1', isActive: true }],
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
    // Courses that are not active are not listed (the page "Lernen")
    expect(filters('select', 'courses').sql).toContain('"is_active" = $');
  });

  it('GET /api/trainee/courses counts a failed quiz as not done and a scenario as no condition', async () => {
    const { db } = createTableDb({
      courseMembers: [{ userId: 't1', courseId: 'c1' }],
      courses: [{ id: 'c1', title: 'Course 1', year: 2024, chapter: 'A' }],
      enablers: [
        // a scenario PDF is set but no submission exists: still completed
        // through its passed quiz, the scenario is not part of the rule
        {
          id: 'e1',
          courseId: 'c1',
          orderIndex: 1,
          isActive: true,
          scenarioPdfUrl: 'https://x/s.pdf',
        },
        { id: 'e2', courseId: 'c1', orderIndex: 2, isActive: true },
      ],
      enablerQuizLinks: [
        { enablerId: 'e1', quizId: 'q1', difficulty: 'LOW' },
        { enablerId: 'e2', quizId: 'q2', difficulty: 'LOW' },
      ],
      quizzes: [
        { id: 'q1', isActive: true },
        { id: 'q2', isActive: true },
      ],
      quizSubmissions: [
        { quizId: 'q1', score: 50 },
        { quizId: 'q2', score: 49 },
      ],
    });
    const GET = await importListHandlerWithDb(db);
    const res = await GET(makeGet('http://localhost/api/trainee/courses'));
    const body = await (res as any).json();
    expect(body.courses[0]).toMatchObject({
      enablerCount: 2,
      completedCount: 1,
      progress: 50,
    });
  });

  it('GET /api/trainee/courses/[courseId] returns course summary with active enablers/use-cases', async () => {
    const { db: mockDb } = createTableDb({
      courseMembers: [{ userId: 't1', courseId: 'c1' }],
      courses: [{ id: 'c1', title: 'Course 1', year: 2024, chapter: 'A' }],
      enablers: [
        { id: 'e1', title: 'E1', courseId: 'c1', isActive: true, orderIndex: 1 },
        { id: 'e2', title: 'E2', courseId: 'c1', isActive: true, orderIndex: 2 },
      ],
      useCases: [
        { id: 'u1', title: 'UC1', courseId: 'c1', isActive: true, orderIndex: 1 },
      ],
      enablerSubmissions: [],
      useCaseSubmissions: [],
    });

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
        { id: 'e1', title: 'E1', attemptNumber: null, status: null, state: 'completed', lockReason: null, lockedBy: null },
        { id: 'e2', title: 'E2', attemptNumber: null, status: null, state: 'completed', lockReason: null, lockedBy: null }
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
