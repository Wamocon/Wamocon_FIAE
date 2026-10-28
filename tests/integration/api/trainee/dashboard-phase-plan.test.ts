/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  mockCatalogScope,
  mockTraineeSession,
} from '../../../helpers/mockNext';

// Dashboard deadlines come from the phase plan of the trainee's occupation
// (KfBM S4). FIAE keeps 18 + 18 months (shortened 12 + 12).

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

const fiaeSettings = {
  shortening_threshold: 2.45,
  school_organization: 'block',
  phase_months: [18, 18],
};
const kfbmSettings = {
  shortening_threshold: 2.49,
  school_organization: 'weekdays',
  phase_months: [15, 21],
};

// The start lies in the future, so the trainee is always in phase 1 and the
// test does not depend on today's date.
const start = new Date(2099, 7, 1);
const iso = (year: number, monthIndex: number) =>
  new Date(year, monthIndex, 1).toISOString();

// One course per phase year, so phase 1, 2 and 3 all show up as deadlines
const courseRows = [
  { id: 'c1', title: 'P1', year: 1 },
  { id: 'c2', title: 'P2', year: 2 },
  { id: 'c3', title: 'P3', year: 3 },
];

async function dashboard(options: {
  catalogId: string;
  settings?: unknown;
  durationYears: number;
  catalogRows?: any[];
}) {
  jest.resetModules();
  const mock = createTableDb({
    courseMembers: courseRows,
    profiles: [
      {
        startOfTrainingDate: start,
        ausbildungDurationYears: options.durationYears,
      },
    ],
    trainingCatalogs: options.catalogRows ?? [
      { id: options.catalogId, settings: options.settings },
    ],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockTraineeSession();
  mockCatalogScope({
    allowedCatalogIds: [options.catalogId],
    activeCatalogId: options.catalogId,
    selected: false,
  });
  const mod = await import('@/app/api/trainee/dashboard/route');
  const res = await mod.GET({
    url: 'http://localhost/api/trainee/dashboard?userId=t1',
  } as any);
  return { res, body: await res.json(), mock };
}

describe('dashboard deadlines per occupation', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('FIAE (unchanged)', () => {
    it('3 years: phase 1 ends after 18 months, phase 2 and 3 after 36', async () => {
      const { res, body } = await dashboard({
        catalogId: FIAE,
        settings: fiaeSettings,
        durationYears: 3,
      });
      expect(res.status).toBe(200);
      expect(body.deadlines).toEqual([
        {
          label: 'Phase 1 (1. bis 18. Ausbildungsmonat)',
          dueDate: iso(2101, 1),
          year: 1,
        },
        {
          label: 'Phase 2 (19. bis 36. Ausbildungsmonat)',
          dueDate: iso(2102, 7),
          year: 2,
        },
        {
          label: 'Integrative Fertigkeiten (1. bis 36. Ausbildungsmonat)',
          dueDate: iso(2102, 7),
          year: 3,
        },
      ]);
    });

    it('2 years (shortened): 12 + 12 months', async () => {
      const { body } = await dashboard({
        catalogId: FIAE,
        settings: fiaeSettings,
        durationYears: 2,
      });
      expect(body.deadlines).toEqual([
        {
          label: 'Phase 1 (1. bis 12. Ausbildungsmonat)',
          dueDate: iso(2100, 7),
          year: 1,
        },
        {
          label: 'Phase 2 (13. bis 24. Ausbildungsmonat)',
          dueDate: iso(2101, 7),
          year: 2,
        },
        {
          label: 'Integrative Fertigkeiten (1. bis 24. Ausbildungsmonat)',
          dueDate: iso(2101, 7),
          year: 3,
        },
      ]);
    });

    it.each([
      ['no settings row', { catalogRows: [] }],
      ['empty settings', { settings: {} }],
      ['unusable settings', { settings: { phase_months: [1, 2, 3] } }],
    ])('keeps 18 + 18 months with %s', async (_label, extra) => {
      const { body } = await dashboard({
        catalogId: FIAE,
        durationYears: 3,
        ...extra,
      });
      expect(body.deadlines.map((d: any) => [d.year, d.dueDate])).toEqual([
        [1, iso(2101, 1)],
        [2, iso(2102, 7)],
        [3, iso(2102, 7)],
      ]);
    });
  });

  describe('KfBM', () => {
    it('3 years: phase 1 ends after 15 months, the training after 36', async () => {
      const { body, mock } = await dashboard({
        catalogId: KFBM,
        settings: kfbmSettings,
        durationYears: 3,
      });
      expect(body.deadlines).toEqual([
        {
          label: 'Phase 1 (1. bis 15. Ausbildungsmonat)',
          dueDate: iso(2100, 10),
          year: 1,
        },
        {
          label: 'Phase 2 (16. bis 36. Ausbildungsmonat)',
          dueDate: iso(2102, 7),
          year: 2,
        },
        {
          label: 'Integrative Fertigkeiten (1. bis 36. Ausbildungsmonat)',
          dueDate: iso(2102, 7),
          year: 3,
        },
      ]);
      // the plan comes from the catalog of the scope
      const filter = mock.filters('select', 'training_catalogs');
      expect(filter.params).toContain(KFBM);
      expect(filter.params).not.toContain(FIAE);
    });

    it('2 years: the shortened plan is prorated to 10 + 14 months', async () => {
      const { body } = await dashboard({
        catalogId: KFBM,
        settings: kfbmSettings,
        durationYears: 2,
      });
      expect(body.deadlines.map((d: any) => [d.label, d.dueDate])).toEqual([
        ['Phase 1 (1. bis 10. Ausbildungsmonat)', iso(2100, 5)],
        ['Phase 2 (11. bis 24. Ausbildungsmonat)', iso(2101, 7)],
        [
          'Integrative Fertigkeiten (1. bis 24. Ausbildungsmonat)',
          iso(2101, 7),
        ],
      ]);
    });

    it('2 years: uses the shortening rules of the catalog when present', async () => {
      const { body } = await dashboard({
        catalogId: KFBM,
        settings: {
          ...kfbmSettings,
          shortened_training_rules: { phase_months: [12, 12] },
        },
        durationYears: 2,
      });
      expect(body.deadlines[0]).toEqual({
        label: 'Phase 1 (1. bis 12. Ausbildungsmonat)',
        dueDate: iso(2100, 7),
        year: 1,
      });
    });
  });
});

describe('dashboard deadlines for a trainee in two trainings', () => {
  beforeEach(() => jest.clearAllMocks());

  // The profile says: started 2099-08-01. KfBM is the second enrollment, it
  // started 2100-03-01 (7 months later) and has its own duration.
  async function twoTrainings(options: {
    active: string;
    kfbmStart: string | null;
    kfbmDuration: number;
  }) {
    jest.resetModules();
    const mock = createTableDb({
      courseMembers: courseRows,
      profiles: [
        { startOfTrainingDate: start, ausbildungDurationYears: 3 },
      ],
      traineeEnrollments: [
        {
          trainingCatalogId: FIAE,
          startDate: '2099-08-01',
          durationYears: 3,
          createdAt: new Date('2026-09-01'),
        },
        {
          trainingCatalogId: KFBM,
          startDate: options.kfbmStart,
          durationYears: options.kfbmDuration,
          createdAt: new Date('2026-10-01'),
        },
      ],
      trainingCatalogs: [
        { id: FIAE, settings: fiaeSettings },
        { id: KFBM, settings: kfbmSettings },
      ].filter(row => row.id === options.active),
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    mockTraineeSession();
    mockCatalogScope({
      allowedCatalogIds: [FIAE, KFBM],
      activeCatalogId: options.active,
      selected: true,
    });
    const mod = await import('@/app/api/trainee/dashboard/route');
    const res = await mod.GET({
      url: 'http://localhost/api/trainee/dashboard',
    } as any);
    return (await res.json()) as {
      deadlines: { label: string; dueDate: string; year: number }[];
    };
  }

  it('the tab of the first enrollment counts with the profile', async () => {
    const body = await twoTrainings({
      active: FIAE,
      kfbmStart: '2100-03-01',
      kfbmDuration: 2,
    });
    expect(body.deadlines[0]).toEqual({
      label: 'Phase 1 (1. bis 18. Ausbildungsmonat)',
      dueDate: iso(2101, 1),
      year: 1,
    });
  });

  it('the tab of a further enrollment counts with its own start date and duration', async () => {
    const body = await twoTrainings({
      active: KFBM,
      kfbmStart: '2100-03-01',
      kfbmDuration: 2,
    });
    // KfBM shortened: phase 1 is 10 months, counted from 2100-03 (not from the
    // 2099-08 of the profile, which would end in 2100)
    expect(body.deadlines[0].label).toBe(
      'Phase 1 (1. bis 10. Ausbildungsmonat)'
    );
    // 2100-03 plus 10 months is January 2101 (or the day before, in a zone
    // ahead of UTC), the profile start would give June 2100
    const due = new Date(body.deadlines[0].dueDate);
    expect(due.getTime()).toBeGreaterThan(new Date('2100-12-30').getTime());
    expect(due.getTime()).toBeLessThan(new Date('2101-02-02').getTime());
  });

  it('without an own start date the profile start is used for the second training too', async () => {
    const body = await twoTrainings({
      active: KFBM,
      kfbmStart: null,
      kfbmDuration: 3,
    });
    expect(body.deadlines[0]).toEqual({
      label: 'Phase 1 (1. bis 15. Ausbildungsmonat)',
      dueDate: iso(2100, 10),
      year: 1,
    });
  });
});
