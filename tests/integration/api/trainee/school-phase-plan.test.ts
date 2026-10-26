/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// The school routes of a trainee (blocks, exams, reports) work out the phase
// of a date (ausbildungsjahr) with the phase plan of the occupation of the
// trainee (KfBM S4b), the same rule the Ausbildungsnachweis and the dashboard
// already use. FIAE keeps the old results. The tests run the real catalog scope
// and the real phase plan loading against a table mock, which ignores where().

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';

const settings = {
  FIAE: { phase_months: [18, 18] },
  KFBM: { phase_months: [15, 21] },
} as const;

// Training began on 2026-08-01, 2027-11-15 is month 15: still phase 1 for FIAE
// (18 months), phase 2 for KfBM (15 months) and for a shortened FIAE (12).
const START = new Date(2026, 7, 1);
const DATE = '2027-11-15';

type Occupation = keyof typeof settings;

function tablesFor(occupation: Occupation, durationYears = 3) {
  const id = occupation === 'FIAE' ? FIAE : KFBM;
  return {
    profiles: [
      {
        id: 't1',
        role: 'TRAINEE',
        organizationId: ORG,
        isPlatformOwner: false,
        fullName: 'Azubi',
        startOfTrainingDate: START,
        ausbildungDurationYears: durationYears,
      },
    ],
    trainingCatalogs: [
      { id, code: occupation, isActive: true, settings: settings[occupation] },
    ],
    organizationCatalogs: [{ trainingCatalogId: id, isEnabled: true }],
    traineeEnrollments:
      occupation === 'KFBM'
        ? [{ trainingCatalogId: KFBM, startDate: '2026-08-01' }]
        : [],
    ausbildungBlocks: [
      {
        id: 'b1',
        traineeId: 't1',
        startDate: new Date(2026, 8, 1),
        blockType: 'SCHOOL',
      },
    ],
    schoolExams: [
      { id: 'e1', traineeId: 't1', examDate: new Date(2026, 8, 1) },
    ],
    activityReports: [],
  };
}

async function loadRoute(
  route: string,
  tables: Record<string, any>,
  returns: Record<string, any[]> = {}
) {
  jest.resetModules();
  // The routes work as the signed-in trainee (own data only)
  mockSession(
    fakeSession({
      id: 't1',
      role: 'TRAINEE',
      isTrainerLevel: false,
      organizationId: ORG,
    })
  );
  const mock = createTableDb(tables, returns);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    getUserOrgId: async () => ORG,
  }));
  const mod = await import(`@/app/api/trainee/school/${route}/route`);
  return { mod, mock };
}

const call = (method: string, url: string, body?: unknown) =>
  makeRequest(method, `http://localhost${url}`, { token: 'tok', body });
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

// Every case runs for the three plans: FIAE, FIAE shortened, KfBM
const cases: [string, Occupation, number, number][] = [
  ['FIAE (18 + 18 months)', 'FIAE', 3, 1],
  ['FIAE shortened (12 + 12 months)', 'FIAE', 2, 2],
  ['KfBM (15 + 21 months)', 'KFBM', 3, 2],
];

describe('school routes of a trainee use the phase plan of the occupation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  describe('POST /api/trainee/school/blocks', () => {
    it.each(cases)('%s', async (_name, occupation, years, phase) => {
      const { mod, mock } = await loadRoute(
        'blocks',
        tablesFor(occupation, years)
      );
      const res = await mod.POST(
        call('POST', '/api/trainee/school/blocks', {
          traineeId: 't1',
          calendarWeek: 46,
          year: 2027,
          startDate: DATE,
          endDate: '2027-11-19',
          blockType: 'SCHOOL',
        })
      );
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
        ausbildungsjahr: phase,
      });
    });

    it('reads the phase plan of the trainee catalog', async () => {
      const { mod, mock } = await loadRoute('blocks', tablesFor('KFBM'));
      await mod.POST(
        call('POST', '/api/trainee/school/blocks', {
          traineeId: 't1',
          calendarWeek: 46,
          year: 2027,
          startDate: DATE,
          endDate: '2027-11-19',
          blockType: 'SCHOOL',
        })
      );
      expect(mock.filters('select', 'training_catalogs').params).toContain(
        KFBM
      );
    });

    it('keeps the given phase for a trainee without a start date and asks for no plan', async () => {
      const tables = tablesFor('KFBM');
      tables.profiles[0].startOfTrainingDate = null as any;
      const { mod, mock } = await loadRoute('blocks', tables);
      const res = await mod.POST(
        call('POST', '/api/trainee/school/blocks', {
          traineeId: 't1',
          ausbildungsjahr: 2,
          calendarWeek: 46,
          year: 2027,
          startDate: DATE,
          endDate: '2027-11-19',
          blockType: 'SCHOOL',
        })
      );
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
        ausbildungsjahr: 2,
      });
      expect(mock.calls.some(c => c.table === 'training_catalogs')).toBe(false);
    });

    it('still works when the phase plan cannot be read (previous 18 months)', async () => {
      // no catalog row: the scope fails closed, the plan falls back
      const tables: Record<string, any> = tablesFor('KFBM');
      tables.trainingCatalogs = [];
      const { mod, mock } = await loadRoute('blocks', tables);
      const res = await mod.POST(
        call('POST', '/api/trainee/school/blocks', {
          traineeId: 't1',
          calendarWeek: 46,
          year: 2027,
          startDate: DATE,
          endDate: '2027-11-19',
          blockType: 'SCHOOL',
        })
      );
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
        ausbildungsjahr: 1,
      });
    });
  });

  describe('PUT /api/trainee/school/blocks/[id]', () => {
    it.each(cases)('%s', async (_name, occupation, years, phase) => {
      const { mod, mock } = await loadRoute(
        'blocks/[id]',
        tablesFor(occupation, years)
      );
      const res = await mod.PUT(
        call('PUT', '/api/trainee/school/blocks/b1', { startDate: DATE }),
        withId('b1')
      );
      expect(res.status).toBe(200);
      expect(mock.writes('update', 'ausbildung_blocks')[0]).toMatchObject({
        ausbildungsjahr: phase,
      });
    });

    it('does not read a phase plan when the date does not change', async () => {
      const { mod, mock } = await loadRoute('blocks/[id]', tablesFor('KFBM'));
      const res = await mod.PUT(
        call('PUT', '/api/trainee/school/blocks/b1', { title: 'Neu' }),
        withId('b1')
      );
      expect(res.status).toBe(200);
      expect(mock.calls.some(c => c.table === 'training_catalogs')).toBe(false);
    });
  });

  describe('POST /api/trainee/school/blocks/import', () => {
    const body = {
      traineeId: 't1',
      baseYear: 2027,
      csvData: [
        {
          KW: '46',
          Datum: '15.11. - 19.11.',
          '10IT': '',
          '11IT': '',
          '12IT': '',
          Anmerkungen: 'Ferien',
        },
      ],
    };

    it.each(cases)('%s', async (_name, occupation, years, phase) => {
      const { mod, mock } = await loadRoute(
        'blocks/import',
        tablesFor(occupation, years)
      );
      const res = await mod.POST(
        call('POST', '/api/trainee/school/blocks/import', body)
      );
      expect(res.status).toBe(201);
      const rows = mock.writes('insert', 'ausbildung_blocks');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ausbildungsjahr: phase });
    });

    it('reads the phase plan once for the whole file', async () => {
      const { mod, mock } = await loadRoute('blocks/import', tablesFor('KFBM'));
      const many = {
        ...body,
        csvData: [
          ['46', '15.11. - 19.11.'],
          ['47', '22.11. - 26.11.'],
          ['48', '29.11. - 03.12.'],
        ].map(([KW, Datum]) => ({ ...body.csvData[0], KW, Datum })),
      };
      await mod.POST(call('POST', '/api/trainee/school/blocks/import', many));
      expect(mock.writes('insert', 'ausbildung_blocks')).toHaveLength(3);
      // one catalog settings lookup for the plan, one list of catalogs in the scope
      expect(
        mock.calls.filter(
          c => c.op === 'select' && c.table === 'training_catalogs'
        )
      ).toHaveLength(2);
    });
  });

  describe('POST /api/trainee/school/exams', () => {
    it.each(cases)('%s', async (_name, occupation, years, phase) => {
      const { mod, mock } = await loadRoute(
        'exams',
        tablesFor(occupation, years)
      );
      const res = await mod.POST(
        call('POST', '/api/trainee/school/exams', {
          traineeId: 't1',
          examDate: DATE,
          subject: 'LF1',
        })
      );
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'school_exams')[0]).toMatchObject({
        ausbildungsjahr: phase,
      });
    });
  });

  describe('PUT /api/trainee/school/exams/[id]', () => {
    it.each(cases)('%s', async (_name, occupation, years, phase) => {
      const { mod, mock } = await loadRoute(
        'exams/[id]',
        tablesFor(occupation, years)
      );
      const res = await mod.PUT(
        call('PUT', '/api/trainee/school/exams/e1', { examDate: DATE }),
        withId('e1')
      );
      expect(res.status).toBe(200);
      expect(mock.writes('update', 'school_exams')[0]).toMatchObject({
        ausbildungsjahr: phase,
      });
    });
  });

  describe('POST /api/trainee/school/reports', () => {
    it.each(cases)('%s', async (_name, occupation, years, phase) => {
      const { mod, mock } = await loadRoute(
        'reports',
        tablesFor(occupation, years)
      );
      const res = await mod.POST(
        call('POST', '/api/trainee/school/reports', {
          traineeId: 't1',
          weekNumber: 46,
          year: 2027,
        })
      );
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'activity_reports')[0]).toMatchObject({
        ausbildungsjahr: phase,
      });
    });
  });
});
