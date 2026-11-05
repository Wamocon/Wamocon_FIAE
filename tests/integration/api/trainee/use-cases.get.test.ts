/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  mockCatalogScope,
  mockTraineeSession,
} from '../../../helpers/mockNext';

function makeGet(url: string) {
  return { url } as any;
}

async function importHandlerWithDb(mockDb: any, progression?: any) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  if (progression) {
    jest.doMock('@/lib/catalog/progression-db', () => ({
      __esModule: true,
      getEnablerProgression: jest.fn(async () => progression),
    }));
  }
  mockTraineeSession();
  mockCatalogScope();
  const mod = await import('@/app/api/trainee/use-cases/[useCaseId]/route');
  return mod.GET as (
    req: any,
    ctx: { params: Promise<{ useCaseId: string }> }
  ) => Promise<Response>;
}

describe('API: GET /api/trainee/use-cases/[useCaseId]', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns detail and latest submission with links', async () => {
    const submissions = [
      {
        id: 's1',
        useCaseId: 'u1',
        traineeId: 't1',
        submittedAt: '2023-01-01T00:00:00.000Z',
        submissionText: 'Old',
        status: 'PENDING',
      },
      {
        id: 's2',
        useCaseId: 'u1',
        traineeId: 't1',
        submittedAt: '2024-01-01T00:00:00.000Z',
        submissionText: 'New',
        status: 'APPROVED',
      },
    ];
    const sequence: any[] = [
      [
        {
          id: 'u1',
          title: 'UC',
          descriptionText: 'Desc',
          isActive: true,
          courseId: 'c1',
          durationValue: 1,
          durationUnit: 'h',
          activatedAt: '2023-01-01',
        },
      ],
      [{ userId: 't1', courseId: 'c1' }],
      submissions,
      [
        { id: 'l1', submissionId: 's2', url: 'https://a', description: 'A' },
        { id: 'l2', submissionId: 's2', url: 'https://b', description: 'B' },
      ],
      // course title lookup
      [{ id: 'c1', title: 'Course One' }],
    ];
    let idx = 0;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({ where: () => sequence[idx++] }),
      })),
    };
    const GET = await importHandlerWithDb(mockDb);
    const res = await GET(
      makeGet('http://localhost/api/trainee/use-cases/u1?traineeId=t1'),
      { params: Promise.resolve({ useCaseId: 'u1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(200);
    expect(body.useCase).toMatchObject({
      id: 'u1',
      title: 'UC',
      descriptionText: 'Desc',
      isActive: true,
      courseTitle: 'Course One',
    });
    expect(body.submission).toMatchObject({
      id: 's2',
      submissionText: 'New',
      status: 'APPROVED',
    });
    expect(body.submission.links).toHaveLength(2);
  });

  // use case, member, no submission, course, enabler of the use case
  const lockSequence = (): any[] => [
    [
      {
        id: 'u1',
        title: 'UC',
        isActive: true,
        courseId: 'c1',
        enablerId: 'e4',
      },
    ],
    [{ userId: 't1', courseId: 'c1' }],
    [],
    [{ id: 'c1', title: 'Course One' }],
    [{ id: 'e4', courseId: 'c1', isActive: true }],
  ];
  const dbOf = (sequence: any[]) => {
    let idx = 0;
    return {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({ where: () => sequence[idx++] }),
      })),
    };
  };
  const callGet = (GET: any) =>
    GET(makeGet('http://localhost/api/trainee/use-cases/u1'), {
      params: Promise.resolve({ useCaseId: 'u1' }),
    });

  it('reports the lock of the enabler so the page can explain it', async () => {
    const GET = await importHandlerWithDb(dbOf(lockSequence()), {
      enabler: {
        locked: true,
        lockReason: 'SEQUENCE',
        lockedBy: { enablerId: 'e3', title: 'Enabler drei' },
      },
    });
    const res = await callGet(GET);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.lock).toEqual({
      reason: 'SEQUENCE',
      lockedBy: { title: 'Enabler drei' },
    });
  });

  it('has no lock when the enabler is open', async () => {
    const GET = await importHandlerWithDb(dbOf(lockSequence()), {
      enabler: { locked: false, lockReason: null, lockedBy: null },
    });
    const res = await callGet(GET);
    expect((await res.json()).lock).toBeNull();
  });

  it('403 forbidden if not member', async () => {
    const sequence: any[] = [
      [{ id: 'u1', title: 'UC', isActive: true, courseId: 'c1' }],
      [], // not a member
    ];
    let idx = 0;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({ where: () => sequence[idx++] }),
      })),
    };
    const GET = await importHandlerWithDb(mockDb);
    const res = await GET(
      makeGet('http://localhost/api/trainee/use-cases/u1?traineeId=t1'),
      { params: Promise.resolve({ useCaseId: 'u1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('404 if not found or inactive', async () => {
    const sequence: any[] = [[]];
    let idx = 0;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({ where: () => sequence[idx++] }),
      })),
    };
    const GET = await importHandlerWithDb(mockDb);
    const res = await GET(
      makeGet('http://localhost/api/trainee/use-cases/u1?traineeId=t1'),
      { params: Promise.resolve({ useCaseId: 'u1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(404);
    expect(body).toEqual({ error: 'Not found' });
  });
});
