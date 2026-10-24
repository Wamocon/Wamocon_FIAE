/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

// Enrollment of a trainee that is created by an admin (KfBM S5): which catalog
// a new trainee gets, and the writes that go into the same transaction as the
// profile. The rules are pure, the writes use the executor of the caller.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';
const TRAINEE = '33333333-3333-4333-8333-333333333333';

const fiae = { id: FIAE, code: 'FIAE', title: 'FIAE', isActive: true };
const kfbm = { id: KFBM, code: 'KFBM', title: 'KfBM', isActive: true };
const kfbmInactive = { ...kfbm, isActive: false };
const third = {
  id: '44444444-4444-4444-8444-444444444444',
  code: 'XYZ',
  title: 'Third',
  isActive: true,
};
const catalogs = [fiae, kfbm];

const enabled = (id: string) => ({ trainingCatalogId: id, isEnabled: true });
const disabled = (id: string) => ({ trainingCatalogId: id, isEnabled: false });

async function load(tables: Record<string, any> = {}) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import('@/lib/catalog/admin');
  return { mod, mock };
}

describe('resolveNewTraineeCatalog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('takes the requested catalog when it is active and enabled', async () => {
    const { mod } = await load();
    expect(
      mod.resolveNewTraineeCatalog({
        requestedCatalogId: KFBM,
        catalogs,
        orgRows: [enabled(FIAE), enabled(KFBM)],
      })
    ).toEqual({ ok: true, value: kfbm });
  });

  it('an unknown catalog is 404, an inactive one 400, one that is not enabled 400', async () => {
    const { mod } = await load();
    const unknown = '99999999-9999-4999-8999-999999999999';
    expect(
      mod.resolveNewTraineeCatalog({
        requestedCatalogId: unknown,
        catalogs,
        orgRows: [enabled(FIAE)],
      })
    ).toEqual({ ok: false, status: 404, code: 'CATALOG_NOT_FOUND' });
    expect(
      mod.resolveNewTraineeCatalog({
        requestedCatalogId: KFBM,
        catalogs: [fiae, kfbmInactive],
        orgRows: [enabled(FIAE), enabled(KFBM)],
      })
    ).toEqual({ ok: false, status: 400, code: 'CATALOG_INACTIVE' });
    expect(
      mod.resolveNewTraineeCatalog({
        requestedCatalogId: KFBM,
        catalogs,
        orgRows: [enabled(FIAE), disabled(KFBM)],
      })
    ).toEqual({ ok: false, status: 400, code: 'CATALOG_NOT_ENABLED' });
  });

  it('without a request an organization with FIAE only gets FIAE (legacy, as before)', async () => {
    const { mod } = await load();
    for (const orgRows of [
      [],
      [enabled(FIAE)],
      [enabled(FIAE), disabled(KFBM)],
    ]) {
      expect(
        mod.resolveNewTraineeCatalog({
          requestedCatalogId: null,
          catalogs,
          orgRows,
        })
      ).toEqual({ ok: true, value: fiae });
    }
  });

  it('without a request an organization with one usable catalog gets that one', async () => {
    const { mod } = await load();
    expect(
      mod.resolveNewTraineeCatalog({
        requestedCatalogId: null,
        catalogs,
        orgRows: [disabled(FIAE), enabled(KFBM)],
      })
    ).toEqual({ ok: true, value: kfbm });
    // an inactive catalog is not usable, so FIAE is the only one left
    expect(
      mod.resolveNewTraineeCatalog({
        requestedCatalogId: null,
        catalogs: [fiae, kfbmInactive],
        orgRows: [enabled(FIAE), enabled(KFBM)],
      })
    ).toEqual({ ok: true, value: fiae });
  });

  it('without a request several usable catalogs mean the default FIAE', async () => {
    const { mod } = await load();
    expect(
      mod.resolveNewTraineeCatalog({
        requestedCatalogId: null,
        catalogs,
        orgRows: [enabled(KFBM), enabled(FIAE)],
      })
    ).toEqual({ ok: true, value: fiae });
  });

  it('without a request and without FIAE among several catalogs the choice is required (400)', async () => {
    const { mod } = await load();
    expect(
      mod.resolveNewTraineeCatalog({
        requestedCatalogId: null,
        catalogs: [fiae, kfbm, third],
        orgRows: [disabled(FIAE), enabled(KFBM), enabled(third.id)],
      })
    ).toEqual({ ok: false, status: 400, code: 'CATALOG_REQUIRED' });
  });

  it('without a request and without any usable catalog nothing can be enrolled (400)', async () => {
    const { mod } = await load();
    expect(
      mod.resolveNewTraineeCatalog({
        requestedCatalogId: null,
        catalogs: [fiae, kfbmInactive],
        orgRows: [disabled(FIAE), enabled(KFBM)],
      })
    ).toEqual({ ok: false, status: 400, code: 'CATALOG_NOT_ENABLED' });
  });

  it('the new code has a readable English text', async () => {
    const { mod } = await load();
    expect(
      mod.ruleFailureBody({ ok: false, status: 400, code: 'CATALOG_REQUIRED' })
    ).toEqual({
      error:
        'The organization offers several training catalogs, choose one for the trainee',
      code: 'CATALOG_REQUIRED',
    });
  });
});

describe('loadNewTraineeCatalog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads the catalogs and the rows of the organization and decides', async () => {
    const { mod, mock } = await load({
      trainingCatalogs: catalogs,
      organizationCatalogs: [enabled(FIAE), enabled(KFBM)],
    });
    expect(await mod.loadNewTraineeCatalog(mock.db, ORG, KFBM)).toEqual({
      ok: true,
      value: kfbm,
    });
    expect(await mod.loadNewTraineeCatalog(mock.db, ORG, null)).toEqual({
      ok: true,
      value: fiae,
    });
    // reads only, nothing is written
    expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
  });
});

describe('insertTraineeEnrollment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes one enrollment with the defaults of a new profile', async () => {
    const { mod, mock } = await load();
    await mod.insertTraineeEnrollment(mock.db, TRAINEE, KFBM);
    expect(mock.writes('insert', 'trainee_enrollments')).toEqual([
      {
        traineeId: TRAINEE,
        trainingCatalogId: KFBM,
        startDate: null,
        durationYears: 3,
      },
    ]);
  });
});

describe('takeCatalogAdminLock', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is the lock of every catalog administration write', async () => {
    const { mod, mock } = await load();
    await mod.takeCatalogAdminLock(mock.db);
    expect(mock.db.execute).toHaveBeenCalledTimes(1);
  });
});
