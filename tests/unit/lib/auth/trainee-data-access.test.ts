/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextResponse } from 'next/server';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession, traineeSession } from '../../../helpers/mockNext';

// resolveTraineeForRead decides whose data a read route of a trainee returns:
// the caller for a trainee (an id in the query is ignored), a trainee inside
// the organization scope and the chosen occupation for a trainer-level caller,
// 404 for everything else.

const ME = '11111111-1111-4111-8111-111111111111';
const TRAINEE = '22222222-2222-4222-8222-222222222222';
const ORG = 'org-1';
const OTHER_ORG = 'org-2';

const req = (url = 'http://localhost/api/trainee/evaluations') =>
  ({ url, headers: { get: () => null } }) as any;

async function load(
  profiles: any[],
  ensure: () => Promise<NextResponse | null> = async () => null
) {
  jest.resetModules();
  const mock = createTableDb({ profiles });
  const ensureTraineeInCatalog = jest.fn(
    async (..._args: any[]): Promise<NextResponse | null> => ensure()
  );
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/catalog/trainee-scope', () => ({
    __esModule: true,
    ensureTraineeInCatalog,
  }));
  const mod = await import('@/lib/auth/trainee-data-access');
  return { resolve: mod.resolveTraineeForRead, mock, ensureTraineeInCatalog };
}

const traineeRow = (overrides: Record<string, unknown> = {}) => ({
  id: TRAINEE,
  role: 'TRAINEE',
  organizationId: ORG,
  ...overrides,
});

const trainer = fakeSession({ id: 'trainer-1', organizationId: ORG });

describe('resolveTraineeForRead', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  describe('a trainee', () => {
    it('gets the own id and ignores the requested one, without a lookup', async () => {
      const { resolve, mock, ensureTraineeInCatalog } = await load([]);
      const result = await resolve(traineeSession(ME), req(), TRAINEE);
      expect(result).toBe(ME);
      expect(mock.db.select).not.toHaveBeenCalled();
      expect(ensureTraineeInCatalog).not.toHaveBeenCalled();
    });

    it('needs no requested id', async () => {
      const { resolve } = await load([]);
      expect(await resolve(traineeSession(ME), req(), null)).toBe(ME);
      expect(await resolve(traineeSession(ME), req(), undefined)).toBe(ME);
    });
  });

  describe('a trainer-level caller', () => {
    it('gets a trainee of the own organization', async () => {
      const { resolve, ensureTraineeInCatalog } = await load([traineeRow()]);
      const request = req();
      const result = await resolve(trainer, request, TRAINEE);
      expect(result).toBe(TRAINEE);
      // The occupation check runs for this trainee with the same request
      expect(ensureTraineeInCatalog).toHaveBeenCalledWith(
        trainer,
        request,
        TRAINEE
      );
    });

    it('does not count a profile without an organization as the default organization (fail closed)', async () => {
      const defaultOrg = '00000000-0000-0000-0000-000000000001';
      const { resolve, ensureTraineeInCatalog } = await load([
        traineeRow({ organizationId: null }),
      ]);
      const result = (await resolve(
        fakeSession({ organizationId: defaultOrg }),
        req(),
        TRAINEE
      )) as NextResponse;
      expect(result.status).toBe(404);
      expect(ensureTraineeInCatalog).not.toHaveBeenCalled();
    });

    it('lets only the super admin read a trainee without an organization', async () => {
      const { resolve } = await load([traineeRow({ organizationId: null })]);
      const result = await resolve(
        fakeSession({ isSuperAdmin: true, role: 'SUPER_ADMIN' }),
        req(),
        TRAINEE
      );
      expect(result).toBe(TRAINEE);
    });

    it('answers 404 for a trainee of another organization', async () => {
      const { resolve, ensureTraineeInCatalog } = await load([
        traineeRow({ organizationId: OTHER_ORG }),
      ]);
      const result = (await resolve(trainer, req(), TRAINEE)) as NextResponse;
      expect(result.status).toBe(404);
      expect(await result.json()).toEqual({ error: 'Not found' });
      expect(ensureTraineeInCatalog).not.toHaveBeenCalled();
    });

    it('lets the super admin read a trainee of any organization', async () => {
      const { resolve } = await load([
        traineeRow({ organizationId: OTHER_ORG }),
      ]);
      const result = await resolve(
        fakeSession({ role: 'SUPER_ADMIN', isSuperAdmin: true, isAdmin: true }),
        req(),
        TRAINEE
      );
      expect(result).toBe(TRAINEE);
    });

    it('answers 404 for a person who is not a trainee', async () => {
      const { resolve } = await load([traineeRow({ role: 'TRAINER' })]);
      const result = (await resolve(trainer, req(), TRAINEE)) as NextResponse;
      expect(result.status).toBe(404);
    });

    it('answers 404 for an unknown person', async () => {
      const { resolve } = await load([]);
      const result = (await resolve(trainer, req(), TRAINEE)) as NextResponse;
      expect(result.status).toBe(404);
    });

    it('answers 404 for an id that is not a uuid, without a lookup', async () => {
      const { resolve, mock } = await load([traineeRow()]);
      const result = (await resolve(trainer, req(), 't1')) as NextResponse;
      expect(result.status).toBe(404);
      expect(mock.db.select).not.toHaveBeenCalled();
    });

    it('answers 400 without an id', async () => {
      const { resolve, mock } = await load([traineeRow()]);
      const result = (await resolve(trainer, req(), null)) as NextResponse;
      expect(result.status).toBe(400);
      expect(mock.db.select).not.toHaveBeenCalled();
    });

    it('passes on the answer of the occupation check (a trainee of another occupation)', async () => {
      const { resolve } = await load([traineeRow()], async () =>
        NextResponse.json({ error: 'Not found' }, { status: 404 })
      );
      const result = (await resolve(trainer, req(), TRAINEE)) as NextResponse;
      expect(result.status).toBe(404);
    });

    it('passes on a rejected occupation (403)', async () => {
      const { resolve } = await load([traineeRow()], async () =>
        NextResponse.json(
          { error: 'Training catalog not allowed' },
          { status: 403 }
        )
      );
      const result = (await resolve(trainer, req(), TRAINEE)) as NextResponse;
      expect(result.status).toBe(403);
    });

    it('fails closed with 503 if the lookup breaks', async () => {
      jest.resetModules();
      const db = {
        select: jest.fn(() => {
          throw new Error('db down');
        }),
      };
      jest.doMock('@/db', () => ({ __esModule: true, default: db }));
      jest.doMock('@/lib/db-retry', () => ({
        __esModule: true,
        withDbRetry: (fn: () => unknown) => fn(),
      }));
      jest.doMock('@/lib/catalog/trainee-scope', () => ({
        __esModule: true,
        ensureTraineeInCatalog: async () => null,
      }));
      const { resolveTraineeForRead } =
        await import('@/lib/auth/trainee-data-access');
      const result = (await resolveTraineeForRead(
        trainer,
        req(),
        TRAINEE
      )) as NextResponse;
      expect(result.status).toBe(503);
    });
  });
});
