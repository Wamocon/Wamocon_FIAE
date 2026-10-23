/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

async function load(tables: Record<string, any>) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import('@/app/api/catalogs/route');
  return { GET: mod.GET as () => Promise<Response>, mock };
}

const fiaeRow = {
  id: FIAE,
  code: 'FIAE',
  title: 'Fachinformatiker/in Anwendungsentwicklung',
  description: null,
  durationYears: 3,
  occupationCode: 'FIAE',
  regulationVersion: '2020',
  isActive: true,
  settings: {
    phase_months: [18, 18],
    school_organization: 'block',
    shortening_threshold: 2.45,
  },
};
const kfbmRow = {
  id: KFBM,
  code: 'KFBM',
  title: 'Kaufmann/-frau für Büromanagement',
  description: 'Büro, Organisation und Kommunikation',
  durationYears: 3,
  occupationCode: 'KFBM',
  regulationVersion: '2025',
  isActive: true,
  settings: {
    phase_months: [15, 21],
    school_organization: 'weekdays',
    shortening_threshold: 2.49,
  },
};

describe('GET /api/catalogs (public list of the active occupations)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists the active catalogs with the data the selection page needs', async () => {
    const { GET } = await load({ trainingCatalogs: [fiaeRow, kfbmRow] });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.catalogs).toEqual([
      {
        code: 'FIAE',
        title: 'Fachinformatiker/in Anwendungsentwicklung',
        description: null,
        durationYears: 3,
        occupationCode: 'FIAE',
        regulationVersion: '2020',
        phaseMonths: [18, 18],
        schoolOrganization: 'block',
      },
      {
        code: 'KFBM',
        title: 'Kaufmann/-frau für Büromanagement',
        description: 'Büro, Organisation und Kommunikation',
        durationYears: 3,
        occupationCode: 'KFBM',
        regulationVersion: '2025',
        phaseMonths: [15, 21],
        schoolOrganization: 'weekdays',
      },
    ]);
  });

  it('asks the database for active catalogs only, ordered by code', async () => {
    const { GET, mock } = await load({ trainingCatalogs: [fiaeRow] });
    await GET();
    const filter = mock.filters('select', 'training_catalogs');
    expect(filter.sql).toContain('"is_active"');
  });

  it('never gives out ids, internal settings or the shortening threshold', async () => {
    const { GET } = await load({ trainingCatalogs: [fiaeRow, kfbmRow] });
    const text = JSON.stringify(await (await GET()).json());
    expect(text).not.toContain(FIAE);
    expect(text).not.toContain(KFBM);
    expect(text).not.toContain('shortening');
    expect(text).not.toContain('2.45');
    expect(text).not.toContain('2.49');
    expect(text).not.toContain('settings');
    expect(text).not.toContain('isActive');
  });

  it('falls back to the defaults for broken settings instead of failing', async () => {
    const { GET } = await load({
      trainingCatalogs: [{ ...fiaeRow, settings: 'kaputt' }],
    });
    const body = await (await GET()).json();
    expect(body.catalogs[0].phaseMonths).toEqual([18, 18]);
    expect(body.catalogs[0].schoolOrganization).toBe('block');
  });

  it('is cacheable by shared caches', async () => {
    const { GET } = await load({ trainingCatalogs: [fiaeRow] });
    const res = await GET();
    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=300, stale-while-revalidate=59'
    );
  });

  it('answers with an empty list when no catalog is active', async () => {
    const { GET } = await load({ trainingCatalogs: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ catalogs: [] });
  });

  it('answers with an empty list while the catalog table does not exist yet', async () => {
    // Production before the catalog rollout: the landing page must not break.
    const { GET, mock } = await load({});
    mock.db.select.mockImplementationOnce(() => {
      throw Object.assign(new Error('relation does not exist'), {
        cause: { code: '42P01' },
      });
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ catalogs: [] });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('hides the details of any other database error', async () => {
    const { GET, mock } = await load({});
    mock.db.select.mockImplementationOnce(() => {
      throw new Error('password authentication failed for user "x"');
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET();
    spy.mockRestore();
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(text).not.toContain('password');
  });
});
