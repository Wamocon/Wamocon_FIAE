/**
 * @jest-environment node
 */
import { PgDialect } from 'drizzle-orm/pg-core';

// The own progress of a trainee in the HAI (the "progress_query" answer and the
// "Gesamtfortschritt" of the snapshot) comes from the figures of the platform,
// not from the rows of enabler_completions (the quiz based completion does not
// write them: 0 % and always the first enabler as "next", found on the real
// Preview). The loaders are doubles, the database only answers the small
// queries around them.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const USER = '10000000-0000-4000-8000-000000000001';

const dialect = new PgDialect();

jest.mock('@/db', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/auth-helpers', () => ({
  toHaiRole: jest.fn(() => 'TRAINEE'),
}));
jest.mock('@/lib/catalog/scope', () => ({
  getCatalogScopeForUserId: jest.fn(),
}));
jest.mock('@/lib/catalog/phase-plan-db', () => ({ loadPhasePlan: jest.fn() }));
jest.mock('@/lib/hai/progressFigures', () => ({
  loadTraineeCourseFigures: jest.fn(),
}));
jest.mock('@/lib/trainer/trainee-progress', () => ({
  loadTraineeProgress: jest.fn(),
}));

import db from '@/db';
import { getCatalogScopeForUserId } from '@/lib/catalog/scope';
import { loadTraineeCourseFigures } from '@/lib/hai/progressFigures';
import { loadTraineeProgress } from '@/lib/trainer/trainee-progress';
import {
  OVERALL_PROGRESS_TTL_MS,
  clearOverallProgressCache,
  fetchTraineeProgress,
  fetchUserSnapshot,
} from '@/lib/hai/dataContext';

const figure = (over: Record<string, unknown> = {}) => ({
  courseId: 'c1',
  title: 'Datenbanken',
  catalogId: FIAE,
  enablerTotal: 4,
  enablerDone: 3,
  useCaseTotal: 0,
  useCaseDone: 0,
  percent: 75,
  enablers: [
    { id: 'e1', title: 'Fertig', completed: true, locked: false },
    { id: 'e2', title: 'Gesperrt', completed: false, locked: true },
    { id: 'e3', title: 'Das ist es', completed: false, locked: false },
  ],
  ...over,
});

let executed: Array<{ sql: string; params: unknown[] }>;
let latestRows: unknown[];

function installDb(selects: unknown[][] = []) {
  executed = [];
  const queue = [...selects];
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit']) c[m] = () => c;
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
    return c;
  };
  const mock = db as unknown as Record<string, unknown>;
  mock.select = jest.fn(() => chain(queue.shift() ?? []));
  mock.execute = jest.fn(async (query: unknown) => {
    const built = dialect.sqlToQuery(query as never);
    executed.push({ sql: built.sql, params: built.params });
    return latestRows;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearOverallProgressCache();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  latestRows = [];
  (getCatalogScopeForUserId as jest.Mock).mockResolvedValue({
    allowedCatalogIds: [FIAE],
    activeCatalogId: FIAE,
    selected: false,
  });
});

describe('fetchTraineeProgress', () => {
  it('shows the figures of the platform and the first enabler that may be worked on', async () => {
    installDb();
    (loadTraineeCourseFigures as jest.Mock).mockResolvedValue([figure()]);
    latestRows = [{ course_id: 'c1', score: '82.5' }];
    const result = await fetchTraineeProgress(USER);
    expect(result).toEqual([
      {
        courseTitle: 'Datenbanken',
        totalEnablers: 4,
        completedEnablers: 3,
        progressPercent: 75,
        latestQuizScore: 82.5,
        // not the locked enabler, not the completed one
        nextEnablerTitle: 'Das ist es',
      },
    ]);
  });

  it('asks the loader for the occupations of the person only', async () => {
    installDb();
    (getCatalogScopeForUserId as jest.Mock).mockResolvedValue({
      allowedCatalogIds: [KFBM],
      activeCatalogId: KFBM,
      selected: false,
    });
    (loadTraineeCourseFigures as jest.Mock).mockResolvedValue([figure()]);
    await fetchTraineeProgress(USER);
    expect(loadTraineeCourseFigures).toHaveBeenCalledWith(USER, [KFBM]);
    // the quiz score is read for these courses and this person only
    expect(executed).toHaveLength(1);
    expect(executed[0].params).toEqual(expect.arrayContaining([USER, 'c1']));
    expect(executed[0].params).not.toContain(FIAE);
  });

  it('reads the latest quiz score of all courses in ONE query, not one per course', async () => {
    installDb();
    (loadTraineeCourseFigures as jest.Mock).mockResolvedValue([
      figure({ courseId: 'c1' }),
      figure({ courseId: 'c2', title: 'Netzwerke' }),
      figure({ courseId: 'c3', title: 'Sicherheit' }),
    ]);
    latestRows = [
      { course_id: 'c1', score: 90 },
      { course_id: 'c3', score: null },
    ];
    const result = await fetchTraineeProgress(USER);
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toContain('DISTINCT ON (e.course_id)');
    expect(result.map(r => r.latestQuizScore)).toEqual([90, null, null]);
  });

  it('never reads the rows of enabler_completions', async () => {
    installDb();
    (loadTraineeCourseFigures as jest.Mock).mockResolvedValue([figure()]);
    await fetchTraineeProgress(USER);
    expect(executed.map(e => e.sql).join('\n')).not.toContain(
      'enabler_completions'
    );
    expect(
      (db as unknown as { select: jest.Mock }).select
    ).not.toHaveBeenCalled();
  });

  it('has no next enabler when everything is completed or locked', async () => {
    installDb();
    (loadTraineeCourseFigures as jest.Mock).mockResolvedValue([
      figure({
        enablers: [
          { id: 'e1', title: 'Fertig', completed: true, locked: false },
          { id: 'e2', title: 'Gesperrt', completed: false, locked: true },
        ],
      }),
    ]);
    const [course] = await fetchTraineeProgress(USER);
    expect(course.nextEnablerTitle).toBeNull();
  });

  it('is empty without a catalog scope (fail closed) and without courses', async () => {
    installDb();
    (getCatalogScopeForUserId as jest.Mock).mockResolvedValueOnce(null);
    await expect(fetchTraineeProgress(USER)).resolves.toEqual([]);
    expect(loadTraineeCourseFigures).not.toHaveBeenCalled();
    (loadTraineeCourseFigures as jest.Mock).mockResolvedValue([]);
    await expect(fetchTraineeProgress(USER)).resolves.toEqual([]);
    expect(executed).toHaveLength(0);
  });

  it('a failed read is logged and gives an empty list, as before', async () => {
    installDb();
    (loadTraineeCourseFigures as jest.Mock).mockRejectedValue(
      new Error('down')
    );
    await expect(fetchTraineeProgress(USER)).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('the Gesamtfortschritt of the snapshot', () => {
  const profile = [
    {
      fullName: 'Test Person',
      firstName: 'Test',
      role: 'TRAINEE',
      startOfTrainingDate: null,
      ausbildungDurationYears: 3,
    },
  ];
  const scope = {
    allowedCatalogIds: [FIAE, KFBM],
    activeCatalogId: FIAE,
    selected: false,
  };

  it('is the figure of the platform over the occupations of the person', async () => {
    installDb([profile, [{ cnt: 2 }], []]);
    (getCatalogScopeForUserId as jest.Mock).mockResolvedValue(scope);
    (loadTraineeProgress as jest.Mock).mockResolvedValue({
      byTrainee: new Map([[USER, { pct: 87, completed: 361, total: 414 }]]),
      courses: new Map(),
    });
    const snapshot = await fetchUserSnapshot(USER);
    expect(snapshot?.overallProgressPercent).toBe(87);
    expect(snapshot?.unreadNotifications).toBe(2);
    expect(loadTraineeProgress).toHaveBeenCalledWith([USER], scope);
    expect(executed).toHaveLength(0);
  });

  it('a failed figure is logged and the snapshot goes on (0 as before, no failure of the chat)', async () => {
    installDb([profile, [{ cnt: 0 }], []]);
    (getCatalogScopeForUserId as jest.Mock).mockResolvedValue(scope);
    (loadTraineeProgress as jest.Mock).mockRejectedValue(new Error('down'));
    const snapshot = await fetchUserSnapshot(USER);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.overallProgressPercent).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it('without a catalog scope no progress is read (fail closed)', async () => {
    installDb([profile, [{ cnt: 0 }], []]);
    (getCatalogScopeForUserId as jest.Mock).mockResolvedValue(null);
    const snapshot = await fetchUserSnapshot(USER);
    expect(snapshot?.overallProgressPercent).toBe(0);
    expect(loadTraineeProgress).not.toHaveBeenCalled();
  });

  it('keeps the figure for a short time (the snapshot is read with every message), then reads it again', async () => {
    (getCatalogScopeForUserId as jest.Mock).mockResolvedValue(scope);
    (loadTraineeProgress as jest.Mock).mockResolvedValue({
      byTrainee: new Map([[USER, { pct: 40, completed: 4, total: 10 }]]),
      courses: new Map(),
    });
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    installDb([profile, [{ cnt: 0 }], []]);
    expect((await fetchUserSnapshot(USER))?.overallProgressPercent).toBe(40);
    installDb([profile, [{ cnt: 0 }], []]);
    now.mockReturnValue(1_000_000 + OVERALL_PROGRESS_TTL_MS - 1);
    expect((await fetchUserSnapshot(USER))?.overallProgressPercent).toBe(40);
    expect(loadTraineeProgress).toHaveBeenCalledTimes(1);
    // a quiz was passed in the meantime: after the time the new figure counts
    (loadTraineeProgress as jest.Mock).mockResolvedValue({
      byTrainee: new Map([[USER, { pct: 50, completed: 5, total: 10 }]]),
      courses: new Map(),
    });
    installDb([profile, [{ cnt: 0 }], []]);
    now.mockReturnValue(1_000_000 + OVERALL_PROGRESS_TTL_MS + 1);
    expect((await fetchUserSnapshot(USER))?.overallProgressPercent).toBe(50);
    expect(loadTraineeProgress).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('does not share the figure between persons or occupations, and never keeps a failure', async () => {
    (getCatalogScopeForUserId as jest.Mock).mockResolvedValue(scope);
    (loadTraineeProgress as jest.Mock).mockRejectedValueOnce(new Error('down'));
    installDb([profile, [{ cnt: 0 }], []]);
    await fetchUserSnapshot(USER);
    // the failure is not kept: the next message asks again
    (loadTraineeProgress as jest.Mock).mockResolvedValue({
      byTrainee: new Map([[USER, { pct: 60, completed: 6, total: 10 }]]),
      courses: new Map(),
    });
    installDb([profile, [{ cnt: 0 }], []]);
    expect((await fetchUserSnapshot(USER))?.overallProgressPercent).toBe(60);
    // another person asks for his own figure
    (loadTraineeProgress as jest.Mock).mockResolvedValue({
      byTrainee: new Map([['other', { pct: 5, completed: 1, total: 20 }]]),
      courses: new Map(),
    });
    installDb([profile, [{ cnt: 0 }], []]);
    expect((await fetchUserSnapshot('other'))?.overallProgressPercent).toBe(5);
    // the same person in another occupation scope
    (getCatalogScopeForUserId as jest.Mock).mockResolvedValue({
      allowedCatalogIds: [KFBM],
      activeCatalogId: KFBM,
      selected: false,
    });
    (loadTraineeProgress as jest.Mock).mockResolvedValue({
      byTrainee: new Map([[USER, { pct: 7, completed: 1, total: 14 }]]),
      courses: new Map(),
    });
    installDb([profile, [{ cnt: 0 }], []]);
    expect((await fetchUserSnapshot(USER))?.overallProgressPercent).toBe(7);
  });
});
