/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextResponse } from 'next/server';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession, traineeSession } from '../../../helpers/mockNext';

// Module under test: src/lib/auth/trainee-access.ts. A trainer-level caller may
// only work with trainees of their own organization (the super admin with every
// organization) and, once an occupation is chosen, of that occupation. Every
// other trainee answers like a missing one (404).

const TRAINEE = '22222222-2222-4222-8222-222222222222';

async function load(
  trainee: Record<string, unknown> | null,
  catalogAnswer: () => Promise<NextResponse | null> = async () => null
) {
  jest.resetModules();
  const { db } = createTableDb({ profiles: trainee ? [trainee] : [] });
  const ensureTraineeInCatalog = jest.fn(
    async (..._args: any[]): Promise<NextResponse | null> => catalogAnswer()
  );
  jest.doMock('@/db', () => ({ __esModule: true, default: db }));
  jest.doMock('@/lib/catalog/trainee-scope', () => ({
    __esModule: true,
    ensureTraineeInCatalog,
  }));
  const mod = await import('@/lib/auth/trainee-access');
  return { ...mod, db, ensureTraineeInCatalog };
}

const traineeOf = (organizationId: string | null) => ({
  id: TRAINEE,
  role: 'TRAINEE',
  organizationId,
});

const request = { url: 'http://localhost/api/x', headers: { get: () => null } };
const trainer = fakeSession({ organizationId: 'org-1' });

describe('requireTraineeAccess', () => {
  beforeEach(() => jest.clearAllMocks());

  it('grants a trainer access to a trainee of the own organization', async () => {
    const { requireTraineeAccess, ensureTraineeInCatalog } = await load(
      traineeOf('org-1')
    );
    const res = await requireTraineeAccess(
      trainer as any,
      TRAINEE,
      request as any
    );
    expect(res).toEqual({ traineeId: TRAINEE });
    // the occupation check ran for this trainee with the same request
    expect(ensureTraineeInCatalog).toHaveBeenCalledWith(
      trainer,
      request,
      TRAINEE
    );
  });

  it('works without a request (no occupation chosen)', async () => {
    const { requireTraineeAccess } = await load(traineeOf('org-1'));
    expect(await requireTraineeAccess(trainer as any, TRAINEE)).toEqual({
      traineeId: TRAINEE,
    });
  });

  it('404 for a trainee of another organization, even one assigned to the trainer', async () => {
    const { requireTraineeAccess, ensureTraineeInCatalog } = await load({
      ...traineeOf('org-2'),
      assignedTrainerId: trainer.id,
    });
    const res = (await requireTraineeAccess(
      trainer as any,
      TRAINEE
    )) as Response;
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
    expect(ensureTraineeInCatalog).not.toHaveBeenCalled();
  });

  it('404 when the trainee does not exist', async () => {
    const { requireTraineeAccess } = await load(null);
    const res = (await requireTraineeAccess(
      trainer as any,
      TRAINEE
    )) as Response;
    expect(res.status).toBe(404);
  });

  it('404 for a person who is no trainee', async () => {
    const { requireTraineeAccess } = await load({
      ...traineeOf('org-1'),
      role: 'TRAINER',
    });
    const res = (await requireTraineeAccess(
      trainer as any,
      TRAINEE
    )) as Response;
    expect(res.status).toBe(404);
  });

  it('404 for an empty id or an id that is no uuid, without a lookup', async () => {
    const { requireTraineeAccess, db } = await load(traineeOf('org-1'));
    expect(
      ((await requireTraineeAccess(trainer as any, '')) as Response).status
    ).toBe(404);
    expect(
      ((await requireTraineeAccess(trainer as any, 'trainee-1')) as Response)
        .status
    ).toBe(404);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('404 for a trainee of another occupation than the chosen one', async () => {
    const { requireTraineeAccess } = await load(traineeOf('org-1'), async () =>
      NextResponse.json({ error: 'Not found' }, { status: 404 })
    );
    const res = (await requireTraineeAccess(
      trainer as any,
      TRAINEE,
      request as any
    )) as Response;
    expect(res.status).toBe(404);
  });

  it('403 for an occupation the caller may not choose', async () => {
    const { requireTraineeAccess } = await load(traineeOf('org-1'), async () =>
      NextResponse.json(
        { error: 'Training catalog not allowed' },
        { status: 403 }
      )
    );
    const res = (await requireTraineeAccess(
      trainer as any,
      TRAINEE,
      request as any
    )) as Response;
    expect(res.status).toBe(403);
  });

  it('403 for a caller below trainer level (a trainee)', async () => {
    const { requireTraineeAccess, db } = await load(traineeOf('org-1'));
    const res = (await requireTraineeAccess(
      traineeSession(TRAINEE) as any,
      TRAINEE
    )) as Response;
    expect(res.status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('limits an org admin to their organization', async () => {
    const admin = fakeSession({
      role: 'ADMIN',
      isAdmin: true,
      organizationId: 'org-1',
    });
    const same = await load(traineeOf('org-1'));
    expect(await same.requireTraineeAccess(admin as any, TRAINEE)).toEqual({
      traineeId: TRAINEE,
    });
    const other = await load(traineeOf('org-2'));
    const res = (await other.requireTraineeAccess(
      admin as any,
      TRAINEE
    )) as Response;
    expect(res.status).toBe(404);
  });

  it('lets the super admin see every organization', async () => {
    const { requireTraineeAccess } = await load(traineeOf('org-9'));
    const res = await requireTraineeAccess(
      fakeSession({
        role: 'SUPER_ADMIN',
        isSuperAdmin: true,
        isAdmin: true,
      }) as any,
      TRAINEE
    );
    expect(res).toEqual({ traineeId: TRAINEE });
  });

  it('does not let a trainer or TEMP_ADMIN of the platform organization see other organizations', async () => {
    // the platform-owner flag of the organization does not widen the scope
    const { requireTraineeAccess } = await load(traineeOf('org-9'));
    for (const session of [
      fakeSession({ isPlatformOwner: true }),
      fakeSession({
        role: 'TEMP_ADMIN',
        isAdmin: true,
        isPlatformOwner: true,
      }),
    ]) {
      const res = (await requireTraineeAccess(
        session as any,
        TRAINEE
      )) as Response;
      expect(res.status).toBe(404);
    }
  });
});
