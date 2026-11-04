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
// The progress figures are NOT read from the table mock: they come from the
// loaders of the platform (loadTraineeCourseFigures for a trainee, the course
// list and dashboard figure; loadTraineeProgress for a trainer, the figure of
// the trainer pages). Their doubles record the occupation they were asked for.

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
    /** Course figures of the platform for a trainee (the double of loadTraineeCourseFigures). */
    figures?: any[];
    /** Progress of the trainees per occupation id: { catalogId: { traineeId: [pct, total] } }. */
    trainerProgress?: Record<string, Record<string, [number, number]>>;
  } = {}
) {
  const { role = 'TRAINEE', tables = {}, figures = [], trainerProgress = {} } =
    options;
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
  const loadFigures = jest.fn(async (_userId: string, _catalogs: string[]) => figures);
  jest.doMock('@/lib/hai/progressFigures', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/hai/progressFigures') as object),
    loadTraineeCourseFigures: loadFigures,
  }));
  const loadProgress = jest.fn(
    async (_ids: string[], scope: { activeCatalogId: string }) => ({
      byTrainee: new Map(
        Object.entries(trainerProgress[scope.activeCatalogId] ?? {}).map(
          ([id, [pct, total]]) => [id, { pct, total, completed: 0 }]
        )
      ),
      courses: new Map(),
    })
  );
  jest.doMock('@/lib/trainer/trainee-progress', () => ({
    __esModule: true,
    loadTraineeProgress: loadProgress,
  }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/auth-helpers') as object),
    requireProPlan: async () => true,
    getUserOrgIdStrict: async () => ORG,
  }));
  const mod = (await import('@/app/api/hai/insights/route')) as any;
  return { mod, rec, loadFigures, loadProgress };
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

// courses of the person: more than 5 enablers, 1 done: below 30 percent (the
// figure of the course card), and the first enabler that may be worked on
const lowFigure = {
  courseId: 'c1',
  title: 'Kurs des Berufs',
  catalogId: FIAE,
  enablerTotal: 10,
  enablerDone: 1,
  useCaseTotal: 0,
  useCaseDone: 0,
  percent: 10,
  enablers: [
    { id: 'e1', title: 'Fertig', completed: true, locked: false },
    { id: 'e2', title: 'Gesperrt', completed: false, locked: true },
    { id: 'e3', title: 'Als Nächstes', completed: false, locked: false },
  ],
};
const progressRows = { figures: [lowFigure] };

beforeEach(() => jest.clearAllMocks());

describe('insights of a trainee in two occupations', () => {
  it.each([
    ['KFBM', KFBM, FIAE],
    ['FIAE', FIAE, KFBM],
  ])(
    'tab %s: every occupation bound read carries this occupation only',
    async (code, chosen, other) => {
      const { mod, rec, loadFigures } = await load(progressRows);
      const res = await mod.GET(get(code));
      expect(res.status).toBe(200);
      const { body, titles: found } = await titles(res);
      expect(found).toEqual(
        expect.arrayContaining([
          'Fehlender Tätigkeitsnachweis',
          'Niedriger Fortschritt',
        ])
      );
      // the figures of the platform: 10 percent, and the next step is the
      // first enabler that is not completed and not locked (not the locked one)
      const messages = body.insights.map(i => i.message);
      expect(messages).toContain(
        'Dein Fortschritt in "Kurs des Berufs" ist nur 10%. Zeit, am Ball zu bleiben!'
      );
      expect(messages).toContain(
        'Bereit für den nächsten Enabler? "Als Nächstes" wartet auf dich!'
      );

      // report of the week (and the week before)
      const reports = rec.filters('select', 'activity_reports');
      expect(reports.sql).toContain(
        '"activity_reports"."training_catalog_id" = $'
      );
      expect(reports.params).toContain(chosen);
      expect(reports.params).not.toContain(other);
      // progress in the courses and the next step: ONE read, asked for this
      // occupation only
      expect(loadFigures).toHaveBeenCalledTimes(1);
      expect(loadFigures).toHaveBeenCalledWith(ME, [chosen]);
      expect(JSON.stringify(loadFigures.mock.calls)).not.toContain(other);
    }
  );

  it('the person is the session: a userId in the query changes nothing', async () => {
    const { mod, rec, loadFigures } = await load(progressRows);
    const res = await mod.GET(get('KFBM', `?userId=${VICTIM}`));
    expect(res.status).toBe(200);
    const params = allParams(rec, ['activity_reports', 'ausbildung_blocks']);
    expect(params).toContain(ME);
    expect(params).not.toContain(VICTIM);
    expect(loadFigures.mock.calls.map(c => c[0])).toEqual([ME]);
  });

  it('without a choice the default occupation (first enrollment) counts, as before', async () => {
    const { mod, rec, loadFigures } = await load(progressRows);
    const res = await mod.GET(get());
    expect(res.status).toBe(200);
    const params = allParams(rec, ['activity_reports']);
    expect(params).toContain(FIAE);
    expect(params).not.toContain(KFBM);
    expect(loadFigures).toHaveBeenCalledWith(ME, [FIAE]);
  });

  it('an occupation the person does not have: answered like without a choice, nothing of it is read', async () => {
    const { mod, rec, loadFigures } = await load({
      ...progressRows,
      tables: { traineeEnrollments: [enrollFiae] },
    });
    const res = await mod.GET(get('KFBM'));
    // the scope refuses the occupation (403), the route does not widen it and
    // keeps its open default: the own default occupation
    expect(res.status).toBe(200);
    const { titles: found } = await titles(res);
    expect(found).toContain('Fehlender Tätigkeitsnachweis');
    const params = allParams(rec, ['activity_reports']);
    expect(params).toContain(FIAE);
    expect(params).not.toContain(KFBM);
    expect(JSON.stringify(loadFigures.mock.calls)).not.toContain(KFBM);
  });

  it('a trainee with one occupation is unchanged: FIAE, no enrollment row needed', async () => {
    const { mod, rec, loadFigures } = await load({
      ...progressRows,
      tables: {
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
    const params = allParams(rec, ['activity_reports']);
    expect(params).toContain(FIAE);
    expect(params).not.toContain(KFBM);
    expect(loadFigures).toHaveBeenCalledWith(ME, [FIAE]);
  });

  it('no occupation can be determined: nothing that belongs to one is asked', async () => {
    const { mod, rec, loadFigures } = await load({
      ...progressRows,
      tables: { trainingCatalogs: [] },
    });
    const res = await mod.GET(get());
    expect(res.status).toBe(200);
    expect(rec.calls.filter(c => c.table === 'activity_reports')).toEqual([]);
    expect(loadFigures).not.toHaveBeenCalled();
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
      // a trainer gets no trainee reminders (no course figures of a trainee)
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

describe('progress of the assigned trainees, per occupation', () => {
  // The trainees of the trainer (the table mock ignores where(), the rendered
  // condition is checked) and the figure of the trainer pages per occupation.
  const trainees = [
    { id: 'a', role: 'TRAINEE', fullName: 'Anna Beispiel' },
    { id: 'b', role: 'TRAINEE', fullName: 'Ben Beispiel' },
    { id: 'c', role: 'TRAINEE', fullName: 'Cora Beispiel' },
  ];
  const trainerProfiles = [
    { id: ME, role: 'TRAINER', organizationId: ORG, fullName: 'Test Person' },
    ...trainees,
  ];
  // Anna is low in KFBM, Ben is low in FIAE, Cora is fine in both
  const progress = {
    [KFBM]: { a: [10, 20], b: [80, 20], c: [90, 20] },
    [FIAE]: { a: [75, 40], b: [20, 40], c: [60, 40] },
  } as Record<string, Record<string, [number, number]>>;

  it.each([
    ['KFBM', KFBM, FIAE, 'Anna Beispiel'],
    ['FIAE', FIAE, KFBM, 'Ben Beispiel'],
  ])(
    'tab %s: the share is the figure of the trainer pages, counted in this occupation only',
    async (code, chosen, other, expectedName) => {
      const { mod, rec, loadProgress } = await load({
        role: 'TRAINER',
        tables: { profiles: trainerProfiles },
        trainerProgress: progress,
      });
      (rec.db.execute as jest.Mock).mockImplementation(async () => [
        { id: chosen, code },
      ]);
      const res = await mod.GET(get(code));
      expect(res.status).toBe(200);
      // asked for this occupation only, narrowed to it
      expect(loadProgress).toHaveBeenCalledTimes(1);
      const [ids, scope] = loadProgress.mock.calls[0] as any[];
      expect(ids).toEqual(expect.arrayContaining(['a', 'b', 'c']));
      expect(scope).toEqual({
        allowedCatalogIds: [chosen],
        activeCatalogId: chosen,
        selected: true,
      });
      expect(JSON.stringify(loadProgress.mock.calls)).not.toContain(other);
      // the trainer is the first limit on the trainees, active ones only
      const trainee = rec.filters('select', 'profiles');
      expect(trainee.sql).toContain('"profiles"."assigned_trainer_id" = $');
      expect(trainee.sql).toContain('"profiles"."is_active" = $');
      expect(trainee.params).toContain(ME);
      const { body } = await titles(res);
      const hint = body.insights.find(
        i => i.title === 'Azubis brauchen Unterstützung'
      );
      // inside one tab the occupation is clear, the name stands alone, and only
      // the trainee who is low in THIS occupation is named
      expect(hint?.message).toContain(expectedName);
      expect(hint?.message).not.toContain('Cora');
      expect(hint?.message).not.toContain(`(${code})`);
    }
  );

  it('without a choice every occupation is checked and the name carries the code, lowest first, at most three', async () => {
    const { mod, rec, loadProgress } = await load({
      role: 'TRAINER',
      tables: { profiles: trainerProfiles },
      trainerProgress: progress,
    });
    (rec.db.execute as jest.Mock).mockImplementation(async () => [
      { id: KFBM, code: 'KFBM' },
      { id: FIAE, code: 'FIAE' },
    ]);
    const res = await mod.GET(get());
    expect(res.status).toBe(200);
    expect(
      loadProgress.mock.calls.map((c: any[]) => c[1].activeCatalogId).sort()
    ).toEqual([FIAE, KFBM].sort());
    const { body } = await titles(res);
    const hint = body.insights.find(
      i => i.title === 'Azubis brauchen Unterstützung'
    );
    expect(hint?.message).toContain('Anna Beispiel (KFBM), Ben Beispiel (FIAE)');
  });

  it('a trainee without an enabler in the occupation is not "low" (0 of 0)', async () => {
    const { mod, rec } = await load({
      role: 'TRAINER',
      tables: { profiles: trainerProfiles },
      trainerProgress: { [FIAE]: { a: [0, 0] } },
    });
    (rec.db.execute as jest.Mock).mockImplementation(async () => [
      { id: FIAE, code: 'FIAE' },
    ]);
    const res = await mod.GET(get('FIAE'));
    const { titles: found } = await titles(res);
    expect(found).not.toContain('Azubis brauchen Unterstützung');
  });

  it('no trainee with low progress: no hint', async () => {
    const { mod, rec } = await load({
      role: 'TRAINER',
      tables: { profiles: trainerProfiles },
      trainerProgress: { [FIAE]: { a: [80, 10], b: [90, 10] } },
    });
    (rec.db.execute as jest.Mock).mockImplementation(async () => [
      { id: FIAE, code: 'FIAE' },
    ]);
    const res = await mod.GET(get('FIAE'));
    const { titles: found } = await titles(res);
    expect(found).not.toContain('Azubis brauchen Unterstützung');
  });

  it('the rows of enabler_completions are no source of the hint', async () => {
    const { mod, rec } = await load({
      role: 'TRAINER',
      tables: { profiles: trainerProfiles },
      trainerProgress: { [FIAE]: { a: [80, 10] } },
    });
    (rec.db.execute as jest.Mock).mockImplementation(async () => [
      { id: FIAE, code: 'FIAE' },
    ]);
    await mod.GET(get('FIAE'));
    const sqls = (rec.db.execute as jest.Mock).mock.calls.map(
      (c: any[]) => renderCondition(c[0]).sql
    );
    expect(sqls.join('\n')).not.toContain('enabler_completions');
    expect(rec.calls.filter(c => c.table === 'enabler_completions')).toEqual([]);
  });
});

describe('the trainee reminders do not read enabler_completions', () => {
  it('progress and next step come from the figures of the platform', async () => {
    const { mod, rec } = await load(progressRows);
    await mod.GET(get('FIAE'));
    const sqls = (rec.db.execute as jest.Mock).mock.calls.map(
      (c: any[]) => renderCondition(c[0]).sql
    );
    expect(sqls.join('\n')).not.toContain('enabler_completions');
    expect(rec.calls.filter(c => c.table === 'enabler_completions')).toEqual([]);
  });

  it('a course at 30 percent or more, or with 5 enablers or fewer, is no reminder', async () => {
    const { mod } = await load({
      figures: [
        { ...lowFigure, percent: 30 },
        { ...lowFigure, courseId: 'c2', enablerTotal: 5, percent: 0 },
      ],
    });
    const res = await mod.GET(get('FIAE'));
    const { titles: found } = await titles(res);
    expect(found).not.toContain('Niedriger Fortschritt');
    // the next step is still offered
    expect(found).toContain('Nächster Schritt');
  });

  it('every enabler completed or locked: no next step', async () => {
    const { mod } = await load({
      figures: [
        {
          ...lowFigure,
          percent: 100,
          enablers: [
            { id: 'e1', title: 'Fertig', completed: true, locked: false },
            { id: 'e2', title: 'Gesperrt', completed: false, locked: true },
          ],
        },
      ],
    });
    const res = await mod.GET(get('FIAE'));
    const { titles: found } = await titles(res);
    expect(found).not.toContain('Nächster Schritt');
    expect(found).not.toContain('Niedriger Fortschritt');
  });

  it('a failed read of the figures is no insight and no error for the person', async () => {
    const { mod, loadFigures } = await load(progressRows);
    loadFigures.mockRejectedValueOnce(new Error('db down'));
    const res = await mod.GET(get('FIAE'));
    expect(res.status).toBe(200);
    const { titles: found } = await titles(res);
    expect(found).not.toContain('Niedriger Fortschritt');
    expect(found).not.toContain('Nächster Schritt');
  });
});
