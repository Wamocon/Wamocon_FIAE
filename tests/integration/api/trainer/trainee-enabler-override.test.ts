/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  FIAE,
  ORG,
  OTHER_ORG,
  T1,
  TRAINER,
  loadScoped,
  scopeReq,
} from '../../../helpers/trainerScope';

// PATCH /api/trainer/trainees/[traineeId]/activate for an ENABLER: the
// exception to the order of work. true releases the enabler for the trainee out
// of turn, false locks it, null removes the exception. Only a trainee of the own
// organization, only an enabler of a course the trainee works in, never a
// trainee without an organization, and every change is in the activity log
// together with the exception (one transaction).

const ENABLER = 'bbbbbbb4-0000-4000-8000-000000000004';
const url = `http://localhost/api/trainer/trainees/${T1}/activate`;
const params = { params: Promise.resolve({ traineeId: T1 }) };

const traineeRow = (organizationId: string | null = ORG) => ({
  id: T1,
  role: 'TRAINEE',
  organizationId,
});

const world = {
  profiles: [traineeRow()],
  enablers: [{ trainingCatalogId: FIAE, courseId: 'c1' }],
  courseMembers: [{ courseId: 'c1', userId: T1, role: 'TRAINEE' }],
  traineeEnablerOverrides: [] as any[],
};

const patch = (isActive: unknown) =>
  scopeReq(url, {
    method: 'PATCH',
    body: { itemType: 'ENABLER', itemId: ENABLER, isActive },
  });

describe('exception to the order of work (enabler)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('releases an enabler out of turn and writes the activity log', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/trainees/[traineeId]/activate/route',
      { tables: world }
    );
    const res = await mod.PATCH(patch(true), params);
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'trainee_enabler_overrides')).toEqual([
      expect.objectContaining({ enablerId: ENABLER, isActive: true }),
    ]);
    expect(mock.writes('insert', 'activity_log')).toEqual([
      expect.objectContaining({
        userId: TRAINER,
        organizationId: ORG,
        activityType: 'TRAINEE_ENABLER_OVERRIDE',
        relatedItemId: ENABLER,
        relatedItemTable: 'enablers',
        context: expect.objectContaining({
          traineeId: T1,
          enablerId: ENABLER,
          value: true,
          previous: null,
        }),
      }),
    ]);
    // the exception and its protocol entry run in one transaction
    expect(mock.db.transaction).toHaveBeenCalledTimes(1);
  });

  it('locks an enabler for the trainee and logs the previous value', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/trainees/[traineeId]/activate/route',
      {
        tables: {
          ...world,
          traineeEnablerOverrides: [{ isActive: true }],
        },
      }
    );
    const res = await mod.PATCH(patch(false), params);
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'trainee_enabler_overrides')[0]).toMatchObject(
      {
        isActive: false,
      }
    );
    expect(mock.writes('insert', 'activity_log')[0]).toMatchObject({
      context: expect.objectContaining({ value: false, previous: true }),
    });
  });

  it('removes the exception with null (the order applies again)', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/trainees/[traineeId]/activate/route',
      { tables: world }
    );
    const res = await mod.PATCH(patch(null), params);
    expect(res.status).toBe(200);
    expect(
      mock.calls.some(
        c => c.op === 'delete' && c.table === 'trainee_enabler_overrides'
      )
    ).toBe(true);
    expect(mock.writes('insert', 'trainee_enabler_overrides')).toEqual([]);
    expect(mock.writes('insert', 'activity_log')[0]).toMatchObject({
      context: expect.objectContaining({ value: null }),
    });
  });

  it('refuses an enabler of a course the trainee does not work in (404), nothing written', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/trainees/[traineeId]/activate/route',
      { tables: { ...world, courseMembers: [] } }
    );
    const res = await mod.PATCH(patch(true), params);
    expect(res.status).toBe(404);
    expect(mock.writes('insert', 'trainee_enabler_overrides')).toEqual([]);
    expect(mock.writes('insert', 'activity_log')).toEqual([]);
    expect(mock.writes('insert', 'notifications')).toEqual([]);
  });

  it('refuses an unknown enabler (404)', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/trainees/[traineeId]/activate/route',
      {
        tables: {
          ...world,
          // the scope check reads the catalog of the item, the owner lookup
          // finds the same row: no course, so no membership
          enablers: [{ trainingCatalogId: FIAE, courseId: null }],
          courseMembers: [],
        },
      }
    );
    const res = await mod.PATCH(patch(true), params);
    expect(res.status).toBe(404);
    expect(mock.writes('insert', 'activity_log')).toEqual([]);
  });

  it('refuses a trainee of another organization (404), nothing written', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/trainees/[traineeId]/activate/route',
      { tables: { ...world, profiles: [traineeRow(OTHER_ORG)] } }
    );
    const res = await mod.PATCH(patch(true), params);
    expect(res.status).toBe(404);
    expect(mock.writes('insert', 'trainee_enabler_overrides')).toEqual([]);
    expect(mock.writes('insert', 'activity_log')).toEqual([]);
  });

  it('fails closed for a trainee without an organization (409), nothing written', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/trainees/[traineeId]/activate/route',
      {
        tables: world,
        setup: () => {
          jest.doMock('@/lib/auth-helpers', () => ({
            __esModule: true,
            verifyTrainer: async () => true,
            verifyPlatformOwner: async () => false,
            getUserOrgId: async () => ORG,
            getUserOrgIdStrict: async () => {
              throw new Error('profile has no organization');
            },
          }));
        },
      }
    );
    const res = await mod.PATCH(patch(true), params);
    expect(res.status).toBe(409);
    expect(mock.writes('insert', 'trainee_enabler_overrides')).toEqual([]);
    expect(mock.writes('insert', 'activity_log')).toEqual([]);
  });

  it('answers 403 for a trainee caller (rights unchanged)', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/trainees/[traineeId]/activate/route',
      {
        tables: world,
        session: {
          id: T1,
          email: 't@example.com',
          fullName: 'T',
          role: 'TRAINEE',
          organizationId: ORG,
          isPlatformOwner: false,
          isSuperAdmin: false,
          isAdmin: false,
          isTrainerLevel: false,
        } as any,
      }
    );
    const res = await mod.PATCH(patch(true), params);
    expect([401, 403]).toContain(res.status);
    expect(mock.writes('insert', 'trainee_enabler_overrides')).toEqual([]);
  });

  it('accepts null only for an enabler', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/trainees/[traineeId]/activate/route',
      { tables: world }
    );
    const res = await mod.PATCH(
      scopeReq(url, {
        method: 'PATCH',
        body: { itemType: 'USE_CASE', itemId: ENABLER, isActive: null },
      }),
      params
    );
    expect(res.status).toBe(400);
    expect(mock.writes('insert', 'trainee_use_case_overrides')).toEqual([]);
  });

  it('rejects a value that is neither a boolean nor null', async () => {
    const { mod } = await loadScoped(
      'trainer/trainees/[traineeId]/activate/route',
      { tables: world }
    );
    const res = await mod.PATCH(patch('yes'), params);
    expect(res.status).toBe(400);
  });
});
