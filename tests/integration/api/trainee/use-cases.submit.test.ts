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
  const mod = await import('@/app/api/trainee/use-cases/[useCaseId]/submit/route');
  return mod.POST as (req: any, ctx: { params: Promise<{ useCaseId: string }> }) => Promise<Response>;
}

describe('API: POST /api/trainee/use-cases/[useCaseId]/submit', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('creates or updates submission and replaces links', async () => {
    // First call: no existing -> insert submission and links
    // Second call: existing found -> update, delete links, insert new links
    const sequenceBase: any[] = [
      [{ id: 'u1', courseId: 'c1', isActive: true }],
      [{ userId: 't1', courseId: 'c1' }],
    ];
    // Variation for existing/non-existing
    let callCount = 0;
    let existingPhase = 0; // 0: create flow (no existing), 1: update flow (existing present)
    const selectMock = jest.fn().mockImplementation(() => ({
      from: () => ({
        where: () => {
          callCount += 1;
          if (callCount % 3 === 1) return sequenceBase[0]; // useCase
          if (callCount % 3 === 2) return sequenceBase[1]; // member
          // existing submissions (every 3rd call)
          return existingPhase === 0 ? [] : [{ id: 's1', traineeId: 't1', useCaseId: 'u1' }];
        },
      }),
    }));
    const txOps: any[] = [];
    const mockDb = {
      select: selectMock,
      transaction: jest.fn(async (fn: any) => {
        const tx = {
          select: selectMock,
          insert: (_table: any) => ({
            values: (vals: any) => ({ returning: () => [{ id: 's1', ...(!Array.isArray(vals) ? vals : {}) }] }),
          }),
          update: (_table: any) => ({
            set: (_vals: any) => ({ where: () => ({ returning: () => [{ id: 's1' }] }) }),
          }),
          delete: (_table: any) => ({ where: (_: any) => { txOps.push('deleteLinks'); return; } }),
        } as any;
        return fn(tx);
      }),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const POST = await importHandlerWithDb(mockDb);

    // First submission (create)
    const res1 = await POST(
      makePost('http://localhost/api/trainee/use-cases/u1/submit', {
        traineeId: 't1',
        submissionText: 'Hello',
        links: [ { url: ' https://a ' }, { url: '' }, { url: 'https://b', description: 'B' } ],
      }),
      { params: Promise.resolve({ useCaseId: 'u1' }) },
    );
    const body1 = await (res1 as any).json();
    expect((res1 as any).status).toBe(200);
    expect(body1).toEqual({ ok: true, submissionId: 's1' });

    // Second submission (update + replace links)
    // Switch to update flow
    existingPhase = 1;
    callCount = 0;
    const res2 = await POST(
      makePost('http://localhost/api/trainee/use-cases/u1/submit', {
        traineeId: 't1',
        submissionText: 'Updated',
        links: [ { url: 'https://c' } ],
      }),
      { params: Promise.resolve({ useCaseId: 'u1' }) },
    );
    const body2 = await (res2 as any).json();
    expect((res2 as any).status).toBe(200);
    expect(body2).toEqual({ ok: true, submissionId: 's1' });
  });

  it('400 if missing traineeId', async () => {
    const mockDb = { select: jest.fn() };
    const POST = await importHandlerWithDb(mockDb);
    const res = await POST(
      makePost('http://localhost/api/trainee/use-cases/u1/submit', { submissionText: 'X' }),
      { params: Promise.resolve({ useCaseId: 'u1' }) },
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(400);
    expect(body).toEqual({ error: 'Missing traineeId' });
  });

  it('403 if not member', async () => {
    const sequence: any[] = [
      [{ id: 'u1', courseId: 'c1', isActive: true }],
      [],
    ];
    let idx = 0;
    const mockDb = { select: jest.fn().mockImplementation(() => ({ from: () => ({ where: () => sequence[idx++] }) })) };
    const POST = await importHandlerWithDb(mockDb);
    const res = await POST(
      makePost('http://localhost/api/trainee/use-cases/u1/submit', { traineeId: 't1', submissionText: 'X' }),
      { params: Promise.resolve({ useCaseId: 'u1' }) },
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('404 if use-case not found or inactive', async () => {
    const mockDb = { select: jest.fn().mockImplementation(() => ({ from: () => ({ where: () => [] }) })) };
    const POST = await importHandlerWithDb(mockDb);
    const res = await POST(
      makePost('http://localhost/api/trainee/use-cases/u1/submit', { traineeId: 't1', submissionText: 'X' }),
      { params: Promise.resolve({ useCaseId: 'u1' }) },
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(404);
    expect(body).toEqual({ error: 'Not found' });
  });
});
