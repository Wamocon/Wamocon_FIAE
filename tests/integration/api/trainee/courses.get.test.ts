/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

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

  it('GET /api/trainee/courses lists courses for trainee', async () => {
    // Call order:
    // 1) courseMembers by trainee -> 2 memberships
    // 2) courses inArray -> 2 courses
    // 3) enablers for those courses with orderBy -> 3 enablers
    const sequence: any[] = [
      // memberships
      [
        { userId: 't1', courseId: 'c1' },
        { userId: 't1', courseId: 'c2' },
      ],
      // courses rows
      [
        { id: 'c1', title: 'Course 1', year: 2024, chapter: 'A' },
        { id: 'c2', title: 'Course 2', year: 2025, chapter: 'B' },
      ],
      // enablers rows (with orderBy)
      { withOrderBy: true, data: [
        { id: 'e1', courseId: 'c1', title: 'E1', orderIndex: 1, isActive: true },
        { id: 'e2', courseId: 'c2', title: 'E2', orderIndex: 1, isActive: true },
        { id: 'e3', courseId: 'c1', title: 'E3', orderIndex: 2, isActive: true },
      ]},
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

    const GET = await importListHandlerWithDb(mockDb);
    const res = await GET(makeGet('http://localhost/api/trainee/courses?traineeId=t1'));
    const body = await (res as any).json();
    expect((res as any).status).toBe(200);
    expect(body).toEqual({
      courses: [
        { id: 'c1', title: 'Course 1', year: 2024, chapter: 'A', enablers: [
          { id: 'e1', title: 'E1' },
          { id: 'e3', title: 'E3' },
        ] },
        { id: 'c2', title: 'Course 2', year: 2025, chapter: 'B', enablers: [
          { id: 'e2', title: 'E2' },
        ] },
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
      { withOrderBy: true, data: [
        { id: 'e1', title: 'E1', courseId: 'c1', isActive: true, orderIndex: 1 },
        { id: 'e2', title: 'E2', courseId: 'c1', isActive: true, orderIndex: 2 },
      ]},
      // useCases with orderBy
      { withOrderBy: true, data: [
        { id: 'u1', title: 'UC1', courseId: 'c1', isActive: true, orderIndex: 1 },
      ]},
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
      enablers: [ { id: 'e1', title: 'E1' }, { id: 'e2', title: 'E2' } ],
      useCases: [ { id: 'u1', title: 'UC1' } ],
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
