/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

function makePost(url: string, body: any) {
  return { url, json: async () => body } as any;
}

async function importHandlerWithDb(mockDb: any) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  const mod = await import('@/app/api/trainee/enablers/[enablerId]/submit/route');
  return mod.POST as (req: any, ctx: { params: Promise<{ enablerId: string }> }) => Promise<Response>;
}

describe('API: POST /api/trainee/enablers/[enablerId]/submit', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('creates first submission (PENDING)', async () => {
    const sequence: any[] = [
      [{ id: 'e1', courseId: 'c1', isActive: true }], // enabler
      [{ userId: 't1', courseId: 'c1' }], // member
      [], // existing submissions
    ];
    let idx = 0;
    let inserted: any = null;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({ from: () => ({ where: () => sequence[idx++] }) })),
      insert: jest.fn().mockImplementation((table: any) => ({
        values: (vals: any) => ({ returning: () => { inserted = vals; return [{ id: 's1', ...vals }]; } }),
      })),
    };
    const POST = await importHandlerWithDb(mockDb);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/submit', { traineeId: 't1', solutionText: 'Hello' }),
      { params: Promise.resolve({ enablerId: 'e1' }) },
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(200);
    expect(body).toEqual({ submission: { id: 's1', solutionText: 'Hello', status: 'PENDING' } });
    expect(inserted).toMatchObject({ enablerId: 'e1', traineeId: 't1', solutionText: 'Hello', status: 'PENDING' });
  });

  it('updates latest submission on second submit', async () => {
    const existing = [
      { id: 'a', enablerId: 'e1', traineeId: 't1', submittedAt: '2023-01-01T00:00:00.000Z' },
      { id: 'b', enablerId: 'e1', traineeId: 't1', submittedAt: '2024-01-01T00:00:00.000Z' },
    ];
    const sequence: any[] = [
      [{ id: 'e1', courseId: 'c1', isActive: true }],
      [{ userId: 't1', courseId: 'c1' }],
      existing,
    ];
    let idx = 0;
    let updatedSet: any = null;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({ from: () => ({ where: () => sequence[idx++] }) })),
      update: jest.fn().mockImplementation((table: any) => ({
        set: (vals: any) => { updatedSet = vals; return ({ where: () => ({ returning: () => [{ id: 'b', ...vals }] }) }); },
      })),
    };
    const POST = await importHandlerWithDb(mockDb);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/submit', { traineeId: 't1', solutionText: 'Updated' }),
      { params: Promise.resolve({ enablerId: 'e1' }) },
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(200);
    expect(body.submission).toMatchObject({ id: 'b', solutionText: 'Updated', status: 'PENDING' });
    expect(updatedSet).toMatchObject({ solutionText: 'Updated', status: 'PENDING' });
  });

  it('403 if trainee not member of course', async () => {
    const sequence: any[] = [
      [{ id: 'e1', courseId: 'c1', isActive: true }],
      [], // not member
    ];
    let idx = 0;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({ from: () => ({ where: () => sequence[idx++] }) })),
    };
    const POST = await importHandlerWithDb(mockDb);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/submit', { traineeId: 't1', solutionText: 'X' }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('404 if enabler not found or inactive', async () => {
    const sequence: any[] = [
      [], // enabler missing
    ];
    let idx = 0;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({ from: () => ({ where: () => sequence[idx++] }) })),
    };
    const POST = await importHandlerWithDb(mockDb);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/submit', { traineeId: 't1', solutionText: 'X' }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(404);
    expect(body).toEqual({ error: 'Not found' });
  });
});
