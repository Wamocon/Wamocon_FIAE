/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const TRAINEE = '33333333-3333-4333-8333-333333333333';

const fiae = { id: FIAE, code: 'FIAE', title: 'FIAE', isActive: true };
const kfbm = { id: KFBM, code: 'KFBM', title: 'KfBM', isActive: true };
const kfbmInactive = { ...kfbm, isActive: false };
const catalogs = [fiae, kfbm];

const enabled = (id: string) => ({ trainingCatalogId: id, isEnabled: true });
const disabled = (id: string) => ({ trainingCatalogId: id, isEnabled: false });
const noUsage = { enrollmentCounts: {}, unenrolledTrainees: 0 };

async function load(tables: Record<string, any> = {}) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import('@/lib/catalog/admin');
  return { mod, mock };
}

describe('catalog admin rules (pure)', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('organization rows', () => {
    it('an organization without any row counts as FIAE enabled', async () => {
      const { mod } = await load();
      expect(mod.effectiveOrganizationRows([])).toEqual([
        { trainingCatalogId: FIAE, isEnabled: true },
      ]);
      expect(mod.isCatalogEnabled([], FIAE)).toBe(true);
      expect(mod.isCatalogEnabled([], KFBM)).toBe(false);
    });

    it('keeps the rows of an organization that has rows', async () => {
      const { mod } = await load();
      const rows = [enabled(KFBM)];
      expect(mod.effectiveOrganizationRows(rows)).toBe(rows);
      // FIAE is not implied once the organization has its own rows
      expect(mod.isCatalogEnabled(rows, FIAE)).toBe(false);
      expect(mod.isCatalogEnabled(rows, KFBM)).toBe(true);
    });

    it('only enabled and active catalogs are usable', async () => {
      const { mod } = await load();
      expect(
        mod.usableCatalogIds([enabled(FIAE), enabled(KFBM)], catalogs)
      ).toEqual([FIAE, KFBM]);
      expect(
        mod.usableCatalogIds([enabled(FIAE), disabled(KFBM)], catalogs)
      ).toEqual([FIAE]);
      expect(
        mod.usableCatalogIds(
          [enabled(FIAE), enabled(KFBM)],
          [fiae, kfbmInactive]
        )
      ).toEqual([FIAE]);
      // a null flag counts as enabled, like in the catalog scope
      expect(
        mod.usableCatalogIds(
          [{ trainingCatalogId: FIAE, isEnabled: null }],
          [fiae]
        )
      ).toEqual([FIAE]);
    });
  });

  describe('trainee counts', () => {
    it('trainees without an enrollment count as FIAE', async () => {
      const { mod } = await load();
      const usage = {
        enrollmentCounts: { [FIAE]: 2, [KFBM]: 4 },
        unenrolledTrainees: 3,
      };
      expect(mod.countTraineesInCatalog(FIAE, usage)).toBe(5);
      expect(mod.countTraineesInCatalog(KFBM, usage)).toBe(4);
      expect(mod.countTraineesInCatalog('other', usage)).toBe(0);
    });
  });

  describe('checkCatalogDeactivation', () => {
    const base = { usage: noUsage, dependentOrganizations: 0 };

    it('FIAE can never be deactivated (DEFAULT_CATALOG, 409)', async () => {
      const { mod } = await load();
      expect(
        mod.checkCatalogDeactivation({
          ...base,
          catalog: fiae,
          isActive: false,
        })
      ).toEqual({
        ok: false,
        status: 409,
        code: 'DEFAULT_CATALOG',
      });
    });

    it('an unknown catalog is 404', async () => {
      const { mod } = await load();
      expect(
        mod.checkCatalogDeactivation({ ...base, catalog: null, isActive: true })
      ).toMatchObject({ ok: false, status: 404, code: 'CATALOG_NOT_FOUND' });
    });

    it('activating a catalog is always allowed', async () => {
      const { mod } = await load();
      const result = mod.checkCatalogDeactivation({
        ...base,
        catalog: kfbmInactive,
        isActive: true,
      });
      expect(result).toEqual({ ok: true, value: kfbmInactive });
      // FIAE is active already, activating it again is harmless
      expect(
        mod.checkCatalogDeactivation({ ...base, catalog: fiae, isActive: true })
          .ok
      ).toBe(true);
    });

    it('a catalog without trainees can be deactivated', async () => {
      const { mod } = await load();
      expect(
        mod.checkCatalogDeactivation({
          ...base,
          catalog: kfbm,
          isActive: false,
        })
      ).toEqual({ ok: true, value: kfbm });
    });

    it('a catalog with enrolled trainees is in use (409 with count)', async () => {
      const { mod } = await load();
      const usage = { enrollmentCounts: { [KFBM]: 2 }, unenrolledTrainees: 0 };
      expect(
        mod.checkCatalogDeactivation({
          ...base,
          usage,
          catalog: kfbm,
          isActive: false,
        })
      ).toEqual({ ok: false, status: 409, code: 'CATALOG_IN_USE', count: 2 });
    });

    it('trainees without enrollment do not block a catalog other than FIAE', async () => {
      const { mod } = await load();
      const usage = { enrollmentCounts: {}, unenrolledTrainees: 9 };
      expect(
        mod.checkCatalogDeactivation({
          ...base,
          usage,
          catalog: kfbm,
          isActive: false,
        }).ok
      ).toBe(true);
    });

    it('an organization that would be left without a catalog blocks it', async () => {
      const { mod } = await load();
      expect(
        mod.checkCatalogDeactivation({
          catalog: kfbm,
          isActive: false,
          usage: noUsage,
          dependentOrganizations: 2,
        })
      ).toEqual({
        ok: false,
        status: 409,
        code: 'LAST_ENABLED_CATALOG',
        count: 2,
      });
    });

    it('an inactive catalog stays deactivatable (nothing changes)', async () => {
      const { mod } = await load();
      const usage = { enrollmentCounts: { [KFBM]: 2 }, unenrolledTrainees: 0 };
      expect(
        mod.checkCatalogDeactivation({
          ...base,
          usage,
          catalog: kfbmInactive,
          isActive: false,
        }).ok
      ).toBe(true);
    });
  });

  describe('checkOrganizationCatalogChange', () => {
    const base = { catalogs, usage: noUsage };

    it('an unknown catalog is 404', async () => {
      const { mod } = await load();
      expect(
        mod.checkOrganizationCatalogChange({
          ...base,
          catalogId: 'missing',
          isEnabled: true,
          orgRows: [],
        })
      ).toMatchObject({ ok: false, status: 404, code: 'CATALOG_NOT_FOUND' });
    });

    it('enabling a catalog is always allowed', async () => {
      const { mod } = await load();
      expect(
        mod.checkOrganizationCatalogChange({
          ...base,
          catalogId: KFBM,
          isEnabled: true,
          orgRows: [],
        })
      ).toEqual({ ok: true, value: kfbm });
    });

    it('the last enabled catalog cannot be switched off (409)', async () => {
      const { mod } = await load();
      expect(
        mod.checkOrganizationCatalogChange({
          ...base,
          catalogId: FIAE,
          isEnabled: false,
          orgRows: [enabled(FIAE)],
        })
      ).toEqual({ ok: false, status: 409, code: 'LAST_ENABLED_CATALOG' });
    });

    it('a legacy organization without rows has FIAE as its last catalog', async () => {
      const { mod } = await load();
      expect(
        mod.checkOrganizationCatalogChange({
          ...base,
          catalogId: FIAE,
          isEnabled: false,
          orgRows: [],
        })
      ).toMatchObject({ ok: false, code: 'LAST_ENABLED_CATALOG' });
    });

    it('an enabled but inactive catalog does not count as remaining', async () => {
      const { mod } = await load();
      expect(
        mod.checkOrganizationCatalogChange({
          catalogs: [fiae, kfbmInactive],
          usage: noUsage,
          catalogId: FIAE,
          isEnabled: false,
          orgRows: [enabled(FIAE), enabled(KFBM)],
        })
      ).toMatchObject({ ok: false, code: 'LAST_ENABLED_CATALOG' });
    });

    it('switching off one of two enabled catalogs is allowed', async () => {
      const { mod } = await load();
      expect(
        mod.checkOrganizationCatalogChange({
          ...base,
          catalogId: KFBM,
          isEnabled: false,
          orgRows: [enabled(FIAE), enabled(KFBM)],
        })
      ).toEqual({ ok: true, value: kfbm });
    });

    it('a catalog with enrolled trainees of the organization is in use', async () => {
      const { mod } = await load();
      expect(
        mod.checkOrganizationCatalogChange({
          catalogs,
          usage: { enrollmentCounts: { [KFBM]: 4 }, unenrolledTrainees: 0 },
          catalogId: KFBM,
          isEnabled: false,
          orgRows: [enabled(FIAE), enabled(KFBM)],
        })
      ).toEqual({ ok: false, status: 409, code: 'CATALOG_IN_USE', count: 4 });
    });

    it('trainees without enrollment are counted when FIAE is switched off', async () => {
      const { mod } = await load();
      expect(
        mod.checkOrganizationCatalogChange({
          catalogs,
          usage: { enrollmentCounts: { [FIAE]: 2 }, unenrolledTrainees: 3 },
          catalogId: FIAE,
          isEnabled: false,
          orgRows: [enabled(FIAE), enabled(KFBM)],
        })
      ).toEqual({ ok: false, status: 409, code: 'CATALOG_IN_USE', count: 5 });
    });

    it('the same trainees do not block switching off KfBM', async () => {
      const { mod } = await load();
      expect(
        mod.checkOrganizationCatalogChange({
          catalogs,
          usage: { enrollmentCounts: {}, unenrolledTrainees: 3 },
          catalogId: KFBM,
          isEnabled: false,
          orgRows: [enabled(FIAE), enabled(KFBM)],
        }).ok
      ).toBe(true);
    });

    it('switching off a catalog that is not enabled changes nothing', async () => {
      const { mod } = await load();
      expect(
        mod.checkOrganizationCatalogChange({
          catalogs,
          usage: { enrollmentCounts: { [KFBM]: 4 }, unenrolledTrainees: 0 },
          catalogId: KFBM,
          isEnabled: false,
          orgRows: [enabled(FIAE), disabled(KFBM)],
        }).ok
      ).toBe(true);
    });
  });

  describe('checkEnrollmentTarget', () => {
    const trainee = { role: 'TRAINEE' };
    const both = [enabled(FIAE), enabled(KFBM)];

    it.each(['TRAINER', 'ADMIN', 'TEMP_ADMIN', 'SUPER_ADMIN', null])(
      'the target must be a trainee (%s is rejected with 400)',
      async role => {
        const { mod } = await load();
        expect(
          mod.checkEnrollmentTarget({
            trainee: { role },
            catalog: kfbm,
            orgRows: both,
          })
        ).toEqual({ ok: false, status: 400, code: 'NOT_A_TRAINEE' });
      }
    );

    it('accepts the stored role in any letter case', async () => {
      const { mod } = await load();
      expect(
        mod.checkEnrollmentTarget({
          trainee: { role: 'trainee' },
          catalog: kfbm,
          orgRows: both,
        }).ok
      ).toBe(true);
    });

    it('an unknown catalog is 404', async () => {
      const { mod } = await load();
      expect(
        mod.checkEnrollmentTarget({ trainee, catalog: null, orgRows: both })
      ).toMatchObject({ ok: false, status: 404, code: 'CATALOG_NOT_FOUND' });
    });

    it('an inactive catalog is rejected with 400', async () => {
      const { mod } = await load();
      expect(
        mod.checkEnrollmentTarget({
          trainee,
          catalog: kfbmInactive,
          orgRows: both,
        })
      ).toEqual({ ok: false, status: 400, code: 'CATALOG_INACTIVE' });
    });

    it('a catalog that is not enabled for the organization is rejected', async () => {
      const { mod } = await load();
      expect(
        mod.checkEnrollmentTarget({
          trainee,
          catalog: kfbm,
          orgRows: [enabled(FIAE)],
        })
      ).toEqual({ ok: false, status: 400, code: 'CATALOG_NOT_ENABLED' });
      expect(
        mod.checkEnrollmentTarget({
          trainee,
          catalog: kfbm,
          orgRows: [enabled(FIAE), disabled(KFBM)],
        })
      ).toMatchObject({ ok: false, code: 'CATALOG_NOT_ENABLED' });
    });

    it('a legacy organization without rows only offers FIAE', async () => {
      const { mod } = await load();
      expect(
        mod.checkEnrollmentTarget({ trainee, catalog: fiae, orgRows: [] }).ok
      ).toBe(true);
      expect(
        mod.checkEnrollmentTarget({ trainee, catalog: kfbm, orgRows: [] })
      ).toMatchObject({ ok: false, code: 'CATALOG_NOT_ENABLED' });
    });

    it('an active, enabled catalog is accepted', async () => {
      const { mod } = await load();
      expect(
        mod.checkEnrollmentTarget({ trainee, catalog: kfbm, orgRows: both })
      ).toEqual({ ok: true, value: kfbm });
    });
  });

  describe('organizations that depend on a catalog', () => {
    it('counts organizations where the catalog is the only usable one', async () => {
      const { mod } = await load();
      const rows = new Map([
        [ORG, [enabled(KFBM)]],
        [ORG_B, [enabled(FIAE), enabled(KFBM)]],
      ]);
      // ORG has only KfBM, ORG_B also has FIAE, a third org is legacy (FIAE)
      expect(
        mod.countDependentOrganizations(
          KFBM,
          catalogs,
          [ORG, ORG_B, 'legacy'],
          rows
        )
      ).toBe(1);
      expect(
        mod.countDependentOrganizations(
          FIAE,
          catalogs,
          [ORG, ORG_B, 'legacy'],
          rows
        )
      ).toBe(1);
    });
  });

  describe('request helpers', () => {
    it('builds the error body with code and count', async () => {
      const { mod } = await load();
      expect(
        mod.ruleFailureBody({
          ok: false,
          status: 409,
          code: 'CATALOG_IN_USE',
          count: 3,
        })
      ).toEqual({
        error: expect.stringContaining('trainees'),
        code: 'CATALOG_IN_USE',
        count: 3,
      });
      const withoutCount = mod.ruleFailureBody({
        ok: false,
        status: 409,
        code: 'DEFAULT_CATALOG',
      });
      expect(withoutCount).toEqual({
        error: expect.any(String),
        code: 'DEFAULT_CATALOG',
      });
      expect('count' in withoutCount).toBe(false);
    });

    it('recognises ids that the database accepts as uuid', async () => {
      const { mod } = await load();
      expect(mod.isUuid(FIAE)).toBe(true);
      expect(mod.isUuid('00000000-0000-0000-0000-000000000001')).toBe(true);
      expect(mod.isUuid('org-1')).toBe(false);
      expect(mod.isUuid(undefined)).toBe(false);
      expect(mod.isUuid(`${FIAE}x`)).toBe(false);
    });

    it('reads a JSON object body and rejects everything else', async () => {
      const { mod } = await load();
      const reqOf = (value: unknown) => ({ json: async () => value }) as any;
      expect(await mod.readJsonObject(reqOf({ a: 1 }))).toEqual({ a: 1 });
      expect(await mod.readJsonObject(reqOf(null))).toBeNull();
      expect(await mod.readJsonObject(reqOf([1]))).toBeNull();
      expect(await mod.readJsonObject(reqOf('text'))).toBeNull();
      const broken = {
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input');
        },
      } as any;
      expect(await mod.readJsonObject(broken)).toBeNull();
    });
  });
});

describe('catalog admin database helpers', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listCatalogsWithUsage', () => {
    it('counts trainees and organizations per catalog', async () => {
      const { mod } = await load({
        trainingCatalogs: [kfbm, fiae],
        // grouped enrollment counts and the trainees without a row
        traineeEnrollments: [
          { catalogId: FIAE, count: 1 },
          { catalogId: KFBM, count: 2 },
        ],
        profiles: [{ count: 3 }],
        organizations: [{ id: ORG }, { id: ORG_B }],
        organizationCatalogs: [
          { organizationId: ORG, trainingCatalogId: FIAE, isEnabled: true },
          { organizationId: ORG, trainingCatalogId: KFBM, isEnabled: true },
          { organizationId: ORG_B, trainingCatalogId: KFBM, isEnabled: false },
        ],
      });
      const list = await mod.listCatalogsWithUsage();
      // FIAE first, then by code
      expect(list.map(c => c.code)).toEqual(['FIAE', 'KFBM']);
      expect(list[0]).toMatchObject({
        id: FIAE,
        // one enrolled plus three without an enrollment row
        traineeCount: 4,
        organizationCount: 1,
      });
      expect(list[1]).toMatchObject({
        id: KFBM,
        traineeCount: 2,
        organizationCount: 1,
      });
    });

    it('an organization without rows counts for FIAE', async () => {
      const { mod } = await load({
        trainingCatalogs: [fiae, kfbm],
        traineeEnrollments: [],
        profiles: [{ count: 0 }],
        organizations: [{ id: ORG }, { id: ORG_B }],
        organizationCatalogs: [],
      });
      const list = await mod.listCatalogsWithUsage();
      expect(list.find(c => c.id === FIAE)?.organizationCount).toBe(2);
      expect(list.find(c => c.id === KFBM)?.organizationCount).toBe(0);
    });
  });

  describe('setCatalogActive', () => {
    const tables = (extra: Record<string, any> = {}) => ({
      trainingCatalogs: catalogs,
      traineeEnrollments: [],
      profiles: [{ count: 0 }],
      organizations: [{ id: ORG }],
      organizationCatalogs: [
        { organizationId: ORG, trainingCatalogId: FIAE, isEnabled: true },
        { organizationId: ORG, trainingCatalogId: KFBM, isEnabled: true },
      ],
      ...extra,
    });

    it('deactivates a catalog nobody uses', async () => {
      const { mod, mock } = await load(tables());
      const result = await mod.setCatalogActive(KFBM, false);
      expect(result).toEqual({ ok: true, value: { ...kfbm, isActive: false } });
      expect(mock.writes('update', 'training_catalogs')).toEqual([
        { isActive: false },
      ]);
      // checks and write run in one transaction under the catalog lock
      expect(mock.db.transaction).toHaveBeenCalledTimes(1);
      expect(mock.db.execute).toHaveBeenCalledTimes(1);
    });

    it('activates a catalog', async () => {
      const { mod, mock } = await load(
        tables({ trainingCatalogs: [fiae, kfbmInactive] })
      );
      const result = await mod.setCatalogActive(KFBM, true);
      expect(result).toEqual({ ok: true, value: { ...kfbm, isActive: true } });
      expect(mock.writes('update', 'training_catalogs')).toEqual([
        { isActive: true },
      ]);
    });

    it('refuses FIAE and writes nothing', async () => {
      const { mod, mock } = await load(tables());
      expect(await mod.setCatalogActive(FIAE, false)).toEqual({
        ok: false,
        status: 409,
        code: 'DEFAULT_CATALOG',
      });
      expect(mock.writes('update', 'training_catalogs')).toHaveLength(0);
    });

    it('refuses a catalog with enrolled trainees and writes nothing', async () => {
      const { mod, mock } = await load(
        tables({ traineeEnrollments: [{ catalogId: KFBM, count: 2 }] })
      );
      expect(await mod.setCatalogActive(KFBM, false)).toEqual({
        ok: false,
        status: 409,
        code: 'CATALOG_IN_USE',
        count: 2,
      });
      expect(mock.writes('update', 'training_catalogs')).toHaveLength(0);
    });

    it('refuses when an organization would be left without a catalog', async () => {
      const { mod, mock } = await load(
        tables({
          organizationCatalogs: [
            { organizationId: ORG, trainingCatalogId: KFBM, isEnabled: true },
          ],
        })
      );
      expect(await mod.setCatalogActive(KFBM, false)).toEqual({
        ok: false,
        status: 409,
        code: 'LAST_ENABLED_CATALOG',
        count: 1,
      });
      expect(mock.writes('update', 'training_catalogs')).toHaveLength(0);
    });

    it('an unknown catalog is 404', async () => {
      const { mod, mock } = await load(tables());
      expect(await mod.setCatalogActive(ORG, false)).toMatchObject({
        ok: false,
        status: 404,
        code: 'CATALOG_NOT_FOUND',
      });
      expect(mock.writes('update', 'training_catalogs')).toHaveLength(0);
    });

    it('a vanished row during the update is 404', async () => {
      const base = createTableDb(tables(), { trainingCatalogs: [] });
      jest.resetModules();
      jest.doMock('@/db', () => ({ __esModule: true, default: base.db }));
      const mod = await import('@/lib/catalog/admin');
      expect(await mod.setCatalogActive(KFBM, false)).toMatchObject({
        ok: false,
        status: 404,
        code: 'CATALOG_NOT_FOUND',
      });
    });
  });

  describe('listOrganizationCatalogs', () => {
    const tables = {
      trainingCatalogs: [fiae, kfbmInactive],
      organizationCatalogs: [
        { trainingCatalogId: FIAE, isEnabled: true },
        { trainingCatalogId: KFBM, isEnabled: true },
      ],
      traineeEnrollments: [{ catalogId: KFBM, count: 2 }],
      profiles: [{ count: 1 }],
    };

    it('lists inactive catalogs too when asked (platform admin)', async () => {
      const { mod } = await load(tables);
      const list = await mod.listOrganizationCatalogs(ORG, {
        includeInactive: true,
      });
      expect(list).toEqual([
        {
          trainingCatalogId: FIAE,
          code: 'FIAE',
          title: 'FIAE',
          isActive: true,
          isEnabled: true,
          traineeCount: 1,
        },
        {
          trainingCatalogId: KFBM,
          code: 'KFBM',
          title: 'KfBM',
          isActive: false,
          isEnabled: true,
          traineeCount: 2,
        },
      ]);
    });

    it('hides inactive catalogs from organization admins', async () => {
      const { mod } = await load(tables);
      const list = await mod.listOrganizationCatalogs(ORG, {
        includeInactive: false,
      });
      expect(list.map(c => c.code)).toEqual(['FIAE']);
    });

    it('a legacy organization without rows has FIAE enabled only', async () => {
      const { mod } = await load({
        ...tables,
        trainingCatalogs: [fiae, kfbm],
        organizationCatalogs: [],
      });
      const list = await mod.listOrganizationCatalogs(ORG, {
        includeInactive: false,
      });
      expect(list.map(c => [c.code, c.isEnabled])).toEqual([
        ['FIAE', true],
        ['KFBM', false],
      ]);
    });
  });

  describe('setOrganizationCatalog', () => {
    const tables = (extra: Record<string, any> = {}) => ({
      trainingCatalogs: catalogs,
      organizationCatalogs: [enabled(FIAE)],
      traineeEnrollments: [],
      profiles: [{ count: 0 }],
      ...extra,
    });

    it('enables a catalog with one upsert', async () => {
      const { mod, mock } = await load(tables());
      const result = await mod.setOrganizationCatalog(ORG, KFBM, true);
      expect(result).toEqual({ ok: true, value: kfbm });
      expect(mock.writes('insert', 'organization_catalogs')).toEqual([
        { organizationId: ORG, trainingCatalogId: KFBM, isEnabled: true },
      ]);
      expect(mock.db.transaction).toHaveBeenCalledTimes(1);
      expect(mock.db.execute).toHaveBeenCalledTimes(1);
    });

    it('adds the FIAE row first when the organization has no rows yet', async () => {
      const { mod, mock } = await load(tables({ organizationCatalogs: [] }));
      const result = await mod.setOrganizationCatalog(ORG, KFBM, true);
      expect(result.ok).toBe(true);
      expect(mock.writes('insert', 'organization_catalogs')).toEqual([
        { organizationId: ORG, trainingCatalogId: FIAE, isEnabled: true },
        { organizationId: ORG, trainingCatalogId: KFBM, isEnabled: true },
      ]);
    });

    it('does not add a second FIAE row when FIAE itself is written', async () => {
      const { mod, mock } = await load(tables({ organizationCatalogs: [] }));
      const result = await mod.setOrganizationCatalog(ORG, FIAE, true);
      expect(result.ok).toBe(true);
      expect(mock.writes('insert', 'organization_catalogs')).toEqual([
        { organizationId: ORG, trainingCatalogId: FIAE, isEnabled: true },
      ]);
    });

    it('switches a catalog off when another one stays enabled', async () => {
      const { mod, mock } = await load(
        tables({ organizationCatalogs: [enabled(FIAE), enabled(KFBM)] })
      );
      const result = await mod.setOrganizationCatalog(ORG, KFBM, false);
      expect(result.ok).toBe(true);
      expect(mock.writes('insert', 'organization_catalogs')).toEqual([
        { organizationId: ORG, trainingCatalogId: KFBM, isEnabled: false },
      ]);
    });

    it('refuses the last enabled catalog and writes nothing', async () => {
      const { mod, mock } = await load(tables());
      expect(await mod.setOrganizationCatalog(ORG, FIAE, false)).toEqual({
        ok: false,
        status: 409,
        code: 'LAST_ENABLED_CATALOG',
      });
      expect(mock.writes('insert', 'organization_catalogs')).toHaveLength(0);
    });

    it('refuses FIAE while trainees without enrollment exist', async () => {
      const { mod, mock } = await load(
        tables({
          organizationCatalogs: [enabled(FIAE), enabled(KFBM)],
          profiles: [{ count: 3 }],
        })
      );
      expect(await mod.setOrganizationCatalog(ORG, FIAE, false)).toEqual({
        ok: false,
        status: 409,
        code: 'CATALOG_IN_USE',
        count: 3,
      });
      expect(mock.writes('insert', 'organization_catalogs')).toHaveLength(0);
    });

    it('an unknown catalog is 404', async () => {
      const { mod, mock } = await load(tables());
      expect(await mod.setOrganizationCatalog(ORG, ORG_B, true)).toMatchObject({
        ok: false,
        status: 404,
        code: 'CATALOG_NOT_FOUND',
      });
      expect(mock.writes('insert', 'organization_catalogs')).toHaveLength(0);
    });
  });

  describe('getTraineeEnrollment', () => {
    it('a trainee without an enrollment row counts as FIAE', async () => {
      const { mod } = await load({ traineeEnrollments: [] });
      expect(await mod.getTraineeEnrollment(TRAINEE)).toEqual({
        enrollments: [],
        enrollment: null,
        effectiveCatalogId: FIAE,
        isImplicit: true,
      });
    });

    it('lists every enrollment, the training started with first', async () => {
      const first = {
        id: 'e1',
        trainingCatalogId: FIAE,
        code: 'FIAE',
        title: 'FIAE',
        startDate: '2026-09-01',
        durationYears: 3,
        createdAt: new Date('2026-09-01T08:00:00Z'),
      };
      const second = {
        id: 'e2',
        trainingCatalogId: KFBM,
        code: 'KFBM',
        title: 'KfBM',
        startDate: '2024-09-01',
        durationYears: 2,
        createdAt: new Date('2026-10-01T08:00:00Z'),
      };
      const { mod } = await load({ traineeEnrollments: [second, first] });
      const view = await mod.getTraineeEnrollment(TRAINEE);
      expect(view.enrollments.map(e => e.id)).toEqual(['e1', 'e2']);
      // the first enrollment is the default occupation, whatever the start dates say
      expect(view.enrollment).toMatchObject({ id: 'e1' });
      expect(view.effectiveCatalogId).toBe(FIAE);
      expect(view.isImplicit).toBe(false);
      // the creation time is no part of the answer
      expect(view.enrollments[0]).not.toHaveProperty('createdAt');
    });

    it('sorts a missing start date last when nothing else decides', async () => {
      const dated = {
        id: 'e1',
        trainingCatalogId: FIAE,
        code: 'FIAE',
        title: 'FIAE',
        startDate: '2024-09-01',
        durationYears: 3,
      };
      const undated = {
        id: 'e2',
        trainingCatalogId: KFBM,
        code: 'KFBM',
        title: 'KfBM',
        startDate: null,
        durationYears: 3,
      };
      const { mod } = await load({ traineeEnrollments: [undated, dated] });
      expect((await mod.getTraineeEnrollment(TRAINEE)).effectiveCatalogId).toBe(
        FIAE
      );
    });
  });

  describe('getTrainingCatalogCodes', () => {
    const rows = [
      {
        traineeId: 't1',
        trainingCatalogId: KFBM,
        startDate: '2026-09-01',
        createdAt: new Date('2026-09-01'),
      },
      {
        traineeId: 't2',
        trainingCatalogId: KFBM,
        startDate: '2022-09-01',
        createdAt: new Date('2026-10-05'),
      },
      {
        traineeId: 't2',
        trainingCatalogId: FIAE,
        startDate: '2024-09-01',
        createdAt: new Date('2026-09-05'),
      },
    ];

    it('maps every trainee to the code of the first enrollment, FIAE by default', async () => {
      const { mod } = await load({
        traineeEnrollments: rows,
        trainingCatalogs: catalogs,
      });
      const codes = await mod.getTrainingCatalogCodes(['t1', 't2', 't3']);
      expect(codes.get('t1')).toBe('KFBM');
      // the training started with first wins
      expect(codes.get('t2')).toBe('FIAE');
      expect(codes.get('t3')).toBe('FIAE');
    });

    it('lists all codes of a trainee with several trainings', async () => {
      const { mod } = await load({
        traineeEnrollments: rows,
        trainingCatalogs: catalogs,
      });
      const lists = await mod.getTrainingCatalogCodeLists(['t1', 't2', 't3']);
      expect(lists.get('t1')).toEqual(['KFBM']);
      expect(lists.get('t2')).toEqual(['FIAE', 'KFBM']);
      expect(lists.get('t3')).toEqual(['FIAE']);
    });

    it('does not query anything for an empty list', async () => {
      const { mod, mock } = await load({});
      expect((await mod.getTrainingCatalogCodes([])).size).toBe(0);
      expect((await mod.getTrainingCatalogCodeLists([])).size).toBe(0);
      expect(mock.db.select).not.toHaveBeenCalled();
    });
  });

  describe('addTraineeEnrollment', () => {
    const traineeRow = {
      id: TRAINEE,
      role: 'TRAINEE',
      organizationId: ORG,
      startOfTrainingDate: new Date('2026-09-01T00:00:00.000Z'),
      ausbildungDurationYears: 2,
    };
    const tables = (extra: Record<string, any> = {}) => ({
      profiles: [traineeRow],
      trainingCatalogs: catalogs,
      organizationCatalogs: [enabled(FIAE), enabled(KFBM)],
      traineeEnrollments: [{ id: 'e1', trainingCatalogId: FIAE }],
      ...extra,
    });

    it('adds a second enrollment and keeps the first one', async () => {
      const { mod, mock } = await load(tables());
      const result = await mod.addTraineeEnrollment(TRAINEE, KFBM);
      expect(result).toEqual({
        ok: true,
        value: { trainingCatalogId: KFBM, changed: true, enrollmentCount: 2 },
      });
      // nothing is deleted: the first enrollment and its elective choices stay
      expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(0);
      // start and duration come from the profile
      expect(mock.writes('insert', 'trainee_enrollments')).toEqual([
        {
          traineeId: TRAINEE,
          trainingCatalogId: KFBM,
          startDate: '2026-09-01',
          durationYears: 2,
        },
      ]);
      expect(mock.db.transaction).toHaveBeenCalledTimes(1);
      expect(mock.db.execute).toHaveBeenCalledTimes(1);
    });

    it('takes the start date and duration that the admin gives', async () => {
      const { mod, mock } = await load(tables());
      const result = await mod.addTraineeEnrollment(TRAINEE, KFBM, {
        startDate: '2027-03-01',
        durationYears: 3,
      });
      expect(result.ok).toBe(true);
      expect(mock.writes('insert', 'trainee_enrollments')).toEqual([
        {
          traineeId: TRAINEE,
          trainingCatalogId: KFBM,
          startDate: '2027-03-01',
          durationYears: 3,
        },
      ]);
    });

    it('a given start date of null means "unknown", not "take the profile"', async () => {
      const { mod, mock } = await load(tables());
      await mod.addTraineeEnrollment(TRAINEE, KFBM, { startDate: null });
      expect(
        (mock.writes('insert', 'trainee_enrollments')[0] as any).startDate
      ).toBeNull();
    });

    it.each([
      [{ startDate: '01.03.2027' }],
      [{ startDate: '2027-02-30' }],
      [{ durationYears: 4 }],
      [{ durationYears: 1.5 }],
    ])('refuses unusable terms %j (400) and writes nothing', async terms => {
      const { mod, mock } = await load(tables());
      expect(
        await mod.addTraineeEnrollment(TRAINEE, KFBM, terms as any)
      ).toEqual({
        ok: false,
        status: 400,
        code: 'INVALID_ENROLLMENT_TERMS',
      });
      expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
    });

    it('a trainee without any row works in FIAE: adding KfBM makes that FIAE a real enrollment first', async () => {
      const { mod, mock } = await load(tables({ traineeEnrollments: [] }));
      const result = await mod.addTraineeEnrollment(TRAINEE, KFBM);
      // "add" never replaces: what the trainee has (the implicit FIAE) stays
      expect(result).toEqual({
        ok: true,
        value: { trainingCatalogId: KFBM, changed: true, enrollmentCount: 2 },
      });
      expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(0);
      const inserts = mock.writes('insert', 'trainee_enrollments') as any[];
      expect(inserts.map(row => row.trainingCatalogId)).toEqual([FIAE, KFBM]);
      // both with the terms of the profile
      expect(inserts.map(row => row.startDate)).toEqual([
        '2026-09-01',
        '2026-09-01',
      ]);
      // the default is made older than the new row on purpose (same
      // transaction, same now()), so it stays the first enrollment
      expect(inserts[0]).toHaveProperty('createdAt');
      expect(inserts[1]).not.toHaveProperty('createdAt');
    });

    it('the implicit FIAE is not made real when the organization does not offer FIAE', async () => {
      const { mod, mock } = await load(
        tables({
          traineeEnrollments: [],
          organizationCatalogs: [enabled(KFBM)],
        })
      );
      const result = await mod.addTraineeEnrollment(TRAINEE, KFBM);
      expect(result).toEqual({
        ok: true,
        value: { trainingCatalogId: KFBM, changed: true, enrollmentCount: 1 },
      });
      expect(
        (mock.writes('insert', 'trainee_enrollments') as any[]).map(
          row => row.trainingCatalogId
        )
      ).toEqual([KFBM]);
    });

    it('adding FIAE itself to a trainee without any row creates one row', async () => {
      const { mod, mock } = await load(tables({ traineeEnrollments: [] }));
      const result = await mod.addTraineeEnrollment(TRAINEE, FIAE);
      expect(result).toEqual({
        ok: true,
        value: { trainingCatalogId: FIAE, changed: true, enrollmentCount: 1 },
      });
      expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(1);
    });

    it('keeps the enrollment (and its elective choices) when it exists already', async () => {
      const { mod, mock } = await load(
        tables({
          traineeEnrollments: [
            { id: 'e1', trainingCatalogId: FIAE },
            { id: 'e2', trainingCatalogId: KFBM },
          ],
        })
      );
      const result = await mod.addTraineeEnrollment(TRAINEE, KFBM, {
        startDate: '2030-01-01',
      });
      expect(result).toEqual({
        ok: true,
        value: { trainingCatalogId: KFBM, changed: false, enrollmentCount: 2 },
      });
      expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(0);
      expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
      expect(mock.writes('update', 'trainee_enrollments')).toHaveLength(0);
    });

    it('defaults start and duration when the profile has none', async () => {
      const { mod, mock } = await load(
        tables({
          profiles: [
            {
              ...traineeRow,
              startOfTrainingDate: null,
              ausbildungDurationYears: 4,
            },
          ],
        })
      );
      await mod.addTraineeEnrollment(TRAINEE, KFBM);
      expect(mock.writes('insert', 'trainee_enrollments')).toEqual([
        {
          traineeId: TRAINEE,
          trainingCatalogId: KFBM,
          startDate: null,
          durationYears: 3,
        },
      ]);
    });

    it('accepts a start date that already is a date string', async () => {
      const { mod, mock } = await load(
        tables({
          profiles: [
            { ...traineeRow, startOfTrainingDate: '2026-02-15 00:00:00' },
          ],
        })
      );
      await mod.addTraineeEnrollment(TRAINEE, KFBM);
      expect(
        (mock.writes('insert', 'trainee_enrollments')[0] as any).startDate
      ).toBe('2026-02-15');
    });

    it('an unknown user is 404 and nothing is written', async () => {
      const { mod, mock } = await load(tables({ profiles: [] }));
      expect(await mod.addTraineeEnrollment(TRAINEE, KFBM)).toMatchObject({
        ok: false,
        status: 404,
        code: 'USER_NOT_FOUND',
      });
      expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
    });

    it('only a trainee can be enrolled', async () => {
      const { mod, mock } = await load(
        tables({ profiles: [{ ...traineeRow, role: 'TRAINER' }] })
      );
      expect(await mod.addTraineeEnrollment(TRAINEE, KFBM)).toEqual({
        ok: false,
        status: 400,
        code: 'NOT_A_TRAINEE',
      });
      expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
      expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(0);
    });

    it('the catalog must be enabled for the organization of the trainee', async () => {
      const { mod, mock } = await load(
        tables({ organizationCatalogs: [enabled(FIAE)] })
      );
      expect(await mod.addTraineeEnrollment(TRAINEE, KFBM)).toEqual({
        ok: false,
        status: 400,
        code: 'CATALOG_NOT_ENABLED',
      });
      expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(0);
      expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
    });

    it('the catalog must be active', async () => {
      const { mod } = await load(
        tables({ trainingCatalogs: [fiae, kfbmInactive] })
      );
      expect(await mod.addTraineeEnrollment(TRAINEE, KFBM)).toMatchObject({
        ok: false,
        status: 400,
        code: 'CATALOG_INACTIVE',
      });
    });

    it('a trainee without an organization only offers FIAE', async () => {
      const { mod } = await load(
        tables({ profiles: [{ ...traineeRow, organizationId: null }] })
      );
      expect(await mod.addTraineeEnrollment(TRAINEE, KFBM)).toMatchObject({
        ok: false,
        code: 'CATALOG_NOT_ENABLED',
      });
      expect((await mod.addTraineeEnrollment(TRAINEE, FIAE)).ok).toBe(true);
    });

    it('setTraineeEnrollment is the same function (old name, no replacing any more)', async () => {
      const { mod, mock } = await load(tables());
      expect(mod.setTraineeEnrollment).toBe(mod.addTraineeEnrollment);
      await mod.setTraineeEnrollment(TRAINEE, KFBM);
      expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(0);
    });
  });

  describe('removeTraineeEnrollment', () => {
    const two = [
      { id: 'e1', trainingCatalogId: FIAE },
      { id: 'e2', trainingCatalogId: KFBM },
    ];
    const tables = (extra: Record<string, any> = {}) => ({
      profiles: [{ id: TRAINEE, role: 'TRAINEE', organizationId: ORG }],
      traineeEnrollments: two,
      ...extra,
    });

    it('removes only the enrollment of that catalog, after the confirmation', async () => {
      const { mod, mock } = await load(tables());
      const result = await mod.removeTraineeEnrollment(TRAINEE, KFBM, {
        confirmed: true,
      });
      expect(result).toEqual({
        ok: true,
        value: { trainingCatalogId: KFBM, remaining: 1 },
      });
      expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(1);
      // the row of this trainee in this catalog, by its id: nothing else
      expect(mock.filters('delete', 'trainee_enrollments').params).toEqual([
        'e2',
        TRAINEE,
      ]);
      // memberships, quiz assignments and submissions are not touched
      for (const table of [
        'course_members',
        'quiz_assignments',
        'quiz_submissions',
        'use_case_submissions',
        'profiles',
      ]) {
        expect(mock.writes('delete', table)).toHaveLength(0);
        expect(mock.writes('update', table)).toHaveLength(0);
      }
      expect(mock.db.transaction).toHaveBeenCalledTimes(1);
      expect(mock.db.execute).toHaveBeenCalledTimes(1);
    });

    describe('removing the first training', () => {
      const first = {
        id: 'e1',
        trainingCatalogId: FIAE,
        startDate: '2024-09-01',
        durationYears: 3,
        createdAt: new Date('2026-09-01'),
      };
      const second = (startDate: string | null) => ({
        id: 'e2',
        trainingCatalogId: KFBM,
        startDate,
        durationYears: 2,
        createdAt: new Date('2026-10-01'),
      });

      it('the second training becomes the first and the profile takes over its own start date and duration', async () => {
        // the profile describes the first training; without this the second
        // one would be counted with the dates of the training that is gone
        const { mod, mock } = await load(
          tables({ traineeEnrollments: [first, second('2027-03-01')] })
        );
        const result = await mod.removeTraineeEnrollment(TRAINEE, FIAE, {
          confirmed: true,
        });
        expect(result.ok).toBe(true);
        expect(mock.writes('update', 'profiles')).toEqual([
          {
            startOfTrainingDate: new Date('2027-03-01T00:00:00.000Z'),
            ausbildungDurationYears: 2,
          },
        ]);
      });

      it('without a start date of its own the profile is left alone', async () => {
        const { mod, mock } = await load(
          tables({ traineeEnrollments: [first, second(null)] })
        );
        await mod.removeTraineeEnrollment(TRAINEE, FIAE, { confirmed: true });
        expect(mock.writes('update', 'profiles')).toHaveLength(0);
      });

      it('removing a further training never touches the profile', async () => {
        const { mod, mock } = await load(
          tables({ traineeEnrollments: [first, second('2027-03-01')] })
        );
        await mod.removeTraineeEnrollment(TRAINEE, KFBM, { confirmed: true });
        expect(mock.writes('update', 'profiles')).toHaveLength(0);
      });
    });

    it('without the confirmation nothing happens (400)', async () => {
      const { mod, mock } = await load(tables());
      for (const confirmed of [false, undefined as unknown as boolean]) {
        expect(
          await mod.removeTraineeEnrollment(TRAINEE, KFBM, { confirmed })
        ).toEqual({ ok: false, status: 400, code: 'CONFIRMATION_REQUIRED' });
      }
      expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(0);
      expect(mock.db.transaction).not.toHaveBeenCalled();
    });

    it('the only enrollment cannot be removed (409), the trainee would count as FIAE', async () => {
      const { mod, mock } = await load(
        tables({ traineeEnrollments: [two[1]] })
      );
      expect(
        await mod.removeTraineeEnrollment(TRAINEE, KFBM, { confirmed: true })
      ).toEqual({ ok: false, status: 409, code: 'LAST_ENROLLMENT' });
      expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(0);
    });

    it('a catalog the trainee is not enrolled in is 404', async () => {
      const { mod, mock } = await load(
        tables({ traineeEnrollments: [two[0]] })
      );
      expect(
        await mod.removeTraineeEnrollment(TRAINEE, KFBM, { confirmed: true })
      ).toEqual({ ok: false, status: 404, code: 'ENROLLMENT_NOT_FOUND' });
      expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(0);
    });

    it('an unknown user is 404', async () => {
      const { mod, mock } = await load(tables({ profiles: [] }));
      expect(
        await mod.removeTraineeEnrollment(TRAINEE, KFBM, { confirmed: true })
      ).toMatchObject({ ok: false, status: 404, code: 'USER_NOT_FOUND' });
      expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(0);
    });
  });

  describe('trainees with several enrollments in the counts', () => {
    it('a trainee counts once in every catalog and once as a person', async () => {
      const { mod } = await load();
      // 3 trainees: one in FIAE only, one in KfBM only, one in both
      const usage = {
        enrollmentCounts: { [FIAE]: 2, [KFBM]: 2 },
        unenrolledTrainees: 0,
      };
      expect(mod.countTraineesInCatalog(FIAE, usage)).toBe(2);
      expect(mod.countTraineesInCatalog(KFBM, usage)).toBe(2);
      // the people are counted by the seats (profiles), not by this sum
      expect(
        mod.countTraineesInCatalog(FIAE, usage) +
          mod.countTraineesInCatalog(KFBM, usage)
      ).toBe(4);
    });

    it('a trainee in two catalogs blocks switching off either of them', async () => {
      const { mod } = await load();
      const usage = {
        enrollmentCounts: { [FIAE]: 1, [KFBM]: 1 },
        unenrolledTrainees: 0,
      };
      expect(
        mod.checkOrganizationCatalogChange({
          catalogId: KFBM,
          isEnabled: false,
          catalogs,
          orgRows: [enabled(FIAE), enabled(KFBM)],
          usage,
        })
      ).toMatchObject({ ok: false, status: 409, code: 'CATALOG_IN_USE' });
    });
  });
});
