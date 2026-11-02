/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb, renderCondition } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';

// GET /api/hai/insights follows the occupation the person works in (header
// x-catalog, checked by requireCatalogScope): a trainee gets the reminders of
// ONE occupation (report of the week, progress in the courses, next step), a
// trainer the counts of pending reviews of that occupation. The route runs for
// real here (route, scope and proactive checks), only the database is a table
// mock. The mock ignores where(), so the proof is the rendered condition of
// each read: it carries the id of the chosen occupation and never the id of the
// other one. The numbers in the messages come from the rows of the doubles.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ME = '10000000-0000-4000-8000-000000000001';
const VICTIM = '10000000-0000-4000-8000-000000000009';
const ORG = 'b0000000-0000-4000-8000-00000000000b';

const catalogs = [
  { id: FIAE, code: 'FIAE', isActive: true, settings: null },
  { id: KFBM, code: 'KFBM', isActive: true, settings: null },
];
const orgBoth = [
  { trainingCatalogId: FIAE, isEnabled: true },
  { trainingCatalogId: KFBM, isEnabled: true },
];
const orgFiae = [{ trainingCatalogId: FIAE, isEnabled: true }];
const enrollFiae = {
  trainingCatalogId: FIAE,
  startDate: '2025-08-01',
  createdAt: new Date(2025, 7, 1),
};
const enrollKfbm = {
  trainingCatalogId: KFBM,
  startDate: '2026-08-01',
  createdAt: new Date(2026, 7, 1),
};

type Rows = Record<string, any[]>;

async function load(
  options: {
    role?: 'TRAINEE' | 'TRAINER';
    tables?: Rows;
  } = {}
) {
  const { role = 'TRAINEE', tables = {} } = options;
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockSession(
    role === 'TRAINEE'
      ? traineeSession(ME, { organizationId: ORG })
      : fakeSession({
          id: ME,
          role: 'TRAINER',
          isTrainerLevel: true,
          organizationId: ORG,
        })
  );
  const rec = createTableDb({
    trainingCatalogs: catalogs,
    organizationCatalogs: orgBoth,
    traineeEnrollments: [enrollFiae, enrollKfbm],
    profiles: [{ id: ME, role, organizationId: ORG, fullName: 'Test Person' }],
    activityReports: [],
    ...tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/auth-helpers') as object),
    requireProPlan: async () => true,
    getUserOrgIdStrict: async () => ORG,
  }));
  const mod = (await import('@/app/api/hai/insights/route')) as any;
  return { mod, rec };
}

function get(catalog?: string, query = '') {
  return makeRequest('GET', `http://localhost/api/hai/insights${query}`, {
    token: 't',
    headers: catalog ? { 'x-catalog': catalog } : undefined,
  });
}

async function titles(res: Response) {
  const body = (await res.json()) as {
    insights: { title: string; message: string }[];
    count: number;
  };
  return { body, titles: body.insights.map(i => i.title) };
}

/** Every rendered condition of every read of the traced tables, plus the raw sql calls. */
function allParams(rec: ReturnType<typeof createTableDb>, tables: string[]) {
  const fromTables = tables.flatMap(t => rec.filters('select', t).params);
  const fromSql = (rec.db.execute as jest.Mock).mock.calls.flatMap(
    (c: any[]) => renderCondition(c[0]).params
  );
  return [...fromTables, ...fromSql];
}

// courses of the person: more than 5 enablers, 1 done: below 30 percent
const progressRows = {
  courseMembers: [{ courseId: 'c1', courseTitle: 'Kurs des Berufs' }],
  enablers: [{ count: 10 }],
  enablerCompletions: [{ count: 1 }],
};

beforeEach(() => jest.clearAllMocks());

describe('insights of a trainee in two occupations', () => {
  it.each([
    ['KFBM', KFBM, FIAE],
    ['FIAE', FIAE, KFBM],
  ])(
    'tab %s: every occupation bound read carries this occupation only',
    async (code, chosen, other) => {
      const { mod, rec } = await load({ tables: progressRows });
      const res = await mod.GET(get(code));
      expect(res.status).toBe(200);
      const { titles: found } = await titles(res);
      expect(found).toEqual(
        expect.arrayContaining([
          'Fehlender Tätigkeitsnachweis',
          'Niedriger Fortschritt',
        ])
      );

      // report of the week (and the week before)
      const reports = rec.filters('select', 'activity_reports');
      expect(reports.sql).toContain(
        '"activity_reports"."training_catalog_id" = $'
      );
      expect(reports.params).toContain(chosen);
      expect(reports.params).not.toContain(other);
      // progress in the courses
      const courses = rec.filters('select', 'course_members');
      expect(courses.sql).toContain('"courses"."training_catalog_id" = $');
      expect(courses.params).toContain(chosen);
      expect(courses.params).not.toContain(other);
      // next step (raw sql)
      const next = renderCondition(
        (rec.db.execute as jest.Mock).mock.calls[0][0]
      );
      expect(next.sql).toContain('c.training_catalog_id = $');
      expect(next.params).toContain(chosen);
      expect(next.params).not.toContain(other);
    }
  );

  it('the person is the session: a userId in the query changes nothing', async () => {
    const { mod, rec } = await load({ tables: progressRows });
    const res = await mod.GET(get('KFBM', `?userId=${VICTIM}`));
    expect(res.status).toBe(200);
    const params = allParams(rec, [
      'activity_reports',
      'course_members',
      'ausbildung_blocks',
    ]);
    expect(params).toContain(ME);
    expect(params).not.toContain(VICTIM);
  });

  it('without a choice the default occupation (first enrollment) counts, as before', async () => {
    const { mod, rec } = await load({ tables: progressRows });
    const res = await mod.GET(get());
    expect(res.status).toBe(200);
    const params = allParams(rec, ['activity_reports', 'course_members']);
    expect(params).toContain(FIAE);
    expect(params).not.toContain(KFBM);
  });

  it('an occupation the person does not have: answered like without a choice, nothing of it is read', async () => {
    const { mod, rec } = await load({
      tables: { ...progressRows, traineeEnrollments: [enrollFiae] },
    });
    const res = await mod.GET(get('KFBM'));
    // the scope refuses the occupation (403), the route does not widen it and
    // keeps its open default: the own default occupation
    expect(res.status).toBe(200);
    const { titles: found } = await titles(res);
    expect(found).toContain('Fehlender Tätigkeitsnachweis');
    const params = allParams(rec, ['activity_reports', 'course_members']);
    expect(params).toContain(FIAE);
    expect(params).not.toContain(KFBM);
  });

  it('a trainee with one occupation is unchanged: FIAE, no enrollment row needed', async () => {
    const { mod, rec } = await load({
      tables: {
        ...progressRows,
        traineeEnrollments: [],
        organizationCatalogs: orgFiae,
      },
    });
    const res = await mod.GET(get());
    expect(res.status).toBe(200);
    const { body, titles: found } = await titles(res);
    expect(found).toEqual(
      expect.arrayContaining([
        'Fehlender Tätigkeitsnachweis',
        'Niedriger Fortschritt',
      ])
    );
    expect(body.count).toBe(body.insights.length);
    const params = allParams(rec, ['activity_reports', 'course_members']);
    expect(params).toContain(FIAE);
    expect(params).not.toContain(KFBM);
  });

  it('no occupation can be determined: nothing that belongs to one is asked', async () => {
    const { mod, rec } = await load({
      tables: { ...progressRows, trainingCatalogs: [] },
    });
    const res = await mod.GET(get());
    expect(res.status).toBe(200);
    expect(rec.calls.filter(c => c.table === 'activity_reports')).toEqual([]);
    expect(rec.calls.filter(c => c.table === 'course_members')).toEqual([]);
    expect(rec.db.execute).not.toHaveBeenCalled();
  });
});

describe('insights of a trainer', () => {
  const pending = {
    enablerSubmissions: [{ count: 3 }],
    activityReports: [{ count: 2 }],
  };

  it.each([
    ['KFBM', KFBM, FIAE],
    ['FIAE', FIAE, KFBM],
  ])(
    'tab %s: pending reviews are counted in this occupation only',
    async (code, chosen, other) => {
      const { mod, rec } = await load({ role: 'TRAINER', tables: pending });
      const res = await mod.GET(get(code));
      expect(res.status).toBe(200);
      const { body } = await titles(res);
      // the numbers are those of the rows of the doubles
      expect(body.insights.map(i => i.message)).toEqual(
        expect.arrayContaining([
          '3 Einreichungen warten auf deine Bewertung.',
          '2 Tätigkeitsnachweise warten auf Genehmigung.',
        ])
      );
      const submissions = rec.filters('select', 'enabler_submissions');
      expect(submissions.sql).toContain('"enablers"."training_catalog_id" = $');
      expect(submissions.params).toContain(chosen);
      expect(submissions.params).not.toContain(other);
      const reports = rec.filters('select', 'activity_reports');
      expect(reports.sql).toContain(
        '"activity_reports"."training_catalog_id" = $'
      );
      expect(reports.params).toContain(chosen);
      expect(reports.params).not.toContain(other);
      // the organization of the trainer stays the first limit
      expect(submissions.params).toContain(ORG);
      expect(reports.params).toContain(ORG);
      // a trainer gets no trainee reminders
      expect(rec.calls.filter(c => c.table === 'course_members')).toEqual([]);
    }
  );

  it('without a choice the counts cover the occupations of the organization, as before', async () => {
    const { mod, rec } = await load({ role: 'TRAINER', tables: pending });
    const res = await mod.GET(get());
    expect(res.status).toBe(200);
    const params = allParams(rec, ['enabler_submissions', 'activity_reports']);
    expect(params).toContain(ORG);
    expect(params).not.toContain(FIAE);
    expect(params).not.toContain(KFBM);
  });

  it('an occupation the organization does not offer: not widened, nothing of it is read', async () => {
    const { mod, rec } = await load({
      role: 'TRAINER',
      tables: { ...pending, organizationCatalogs: orgFiae },
    });
    const res = await mod.GET(get('KFBM'));
    expect(res.status).toBe(200);
    const params = allParams(rec, ['enabler_submissions', 'activity_reports']);
    expect(params).toContain(ORG);
    expect(params).not.toContain(KFBM);
  });
});
