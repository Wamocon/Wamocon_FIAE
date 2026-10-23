/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession } from '../../../helpers/mockNext';

// Module under test: src/lib/auth/trainee-access.ts. A trainer may only work
// with trainees of their own organization (or assigned to them), org admins
// see their organization, the super admin sees everything.

type Scope = {
  id: string;
  role: string;
  organizationId: string | null;
  isPlatformOwner: boolean;
  isSuperAdmin: boolean;
  canSeeOrgWide: boolean;
  profileIds: string[];
};

const trainerScope: Scope = {
  id: 'trainer-1',
  role: 'TRAINER',
  organizationId: 'org-1',
  isPlatformOwner: false,
  isSuperAdmin: false,
  canSeeOrgWide: false,
  profileIds: ['trainer-1'],
};

async function load(
  trainee: Record<string, unknown> | null,
  scope: Scope | null
) {
  jest.resetModules();
  const { db } = createTableDb({ profiles: trainee ? [trainee] : [] });
  jest.doMock('@/db', () => ({ __esModule: true, default: db }));
  // Keep the real visibility rules, only replace the database lookup
  const actual = jest.requireActual('@/lib/trainer-scope') as any;
  jest.doMock('@/lib/trainer-scope', () => ({
    ...actual,
    getTrainerScope: jest.fn().mockResolvedValue(scope),
  }));
  return import('@/lib/auth/trainee-access');
}

const traineeOf = (
  organizationId: string | null,
  assignedTrainerId: string | null = null
) => ({
  id: 'trainee-1',
  role: 'TRAINEE',
  organizationId,
  assignedTrainerId,
});

describe('requireTraineeAccess', () => {
  beforeEach(() => jest.clearAllMocks());

  it('404 when the trainee does not exist', async () => {
    const { requireTraineeAccess } = await load(null, trainerScope);
    const res = await requireTraineeAccess(fakeSession() as any, 'trainee-1');
    expect((res as Response).status).toBe(404);
  });

  it('404 for an empty id without touching the database', async () => {
    const { requireTraineeAccess } = await load(
      traineeOf('org-1'),
      trainerScope
    );
    const res = await requireTraineeAccess(fakeSession() as any, '');
    expect((res as Response).status).toBe(404);
  });

  it('403 when the caller has no trainer scope', async () => {
    const { requireTraineeAccess } = await load(traineeOf('org-1'), null);
    const res = await requireTraineeAccess(fakeSession() as any, 'trainee-1');
    expect((res as Response).status).toBe(403);
  });

  it('grants a trainer access to a trainee of the own organization', async () => {
    const { requireTraineeAccess } = await load(
      traineeOf('org-1'),
      trainerScope
    );
    const res = await requireTraineeAccess(fakeSession() as any, 'trainee-1');
    expect(res).toMatchObject({
      trainee: { id: 'trainee-1', organizationId: 'org-1' },
      scope: { id: 'trainer-1' },
    });
  });

  it('denies a trainer access to a trainee of another organization', async () => {
    const { requireTraineeAccess } = await load(
      traineeOf('org-2'),
      trainerScope
    );
    const res = await requireTraineeAccess(fakeSession() as any, 'trainee-1');
    expect((res as Response).status).toBe(403);
    expect(await (res as Response).json()).toEqual({ error: 'Forbidden' });
  });

  it('grants access to a trainee assigned to the trainer, even across organizations', async () => {
    const { requireTraineeAccess } = await load(
      traineeOf('org-2', 'trainer-1'),
      trainerScope
    );
    const res = await requireTraineeAccess(fakeSession() as any, 'trainee-1');
    expect(res).toHaveProperty('trainee');
  });

  it('treats a trainee without organization as part of the default organization', async () => {
    const defaultOrg = '00000000-0000-0000-0000-000000000001';
    const { requireTraineeAccess } = await load(traineeOf(null), {
      ...trainerScope,
      organizationId: defaultOrg,
    });
    const res = await requireTraineeAccess(fakeSession() as any, 'trainee-1');
    expect(res).toHaveProperty('trainee');
  });

  it('limits an org admin to their organization', async () => {
    const adminScope = { ...trainerScope, role: 'ADMIN', canSeeOrgWide: true };
    const same = await load(traineeOf('org-1'), adminScope);
    expect(
      await same.requireTraineeAccess(fakeSession() as any, 'trainee-1')
    ).toHaveProperty('trainee');
    const other = await load(traineeOf('org-2'), adminScope);
    const res = await other.requireTraineeAccess(
      fakeSession() as any,
      'trainee-1'
    );
    expect((res as Response).status).toBe(403);
  });

  it('lets the super admin see every organization', async () => {
    const superScope = {
      ...trainerScope,
      role: 'ADMIN',
      isPlatformOwner: true,
      isSuperAdmin: true,
      canSeeOrgWide: true,
    };
    const { requireTraineeAccess } = await load(traineeOf('org-9'), superScope);
    const res = await requireTraineeAccess(fakeSession() as any, 'trainee-1');
    expect(res).toHaveProperty('trainee');
  });

  it('does not let a TEMP_ADMIN of the platform organization see other organizations', async () => {
    const tempScope = {
      ...trainerScope,
      role: 'TEMP_ADMIN',
      isPlatformOwner: true,
      isSuperAdmin: false,
      canSeeOrgWide: true,
    };
    const { requireTraineeAccess } = await load(traineeOf('org-9'), tempScope);
    const res = await requireTraineeAccess(fakeSession() as any, 'trainee-1');
    expect((res as Response).status).toBe(403);
  });
});
