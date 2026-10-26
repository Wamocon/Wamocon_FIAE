/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  FIAE,
  KFBM,
  ORG,
  OTHER_ORG,
  T1,
  T2,
  loadScoped,
  scopeReq,
  selectParams,
  superAdminSession,
  trainerSession,
} from '../../../helpers/trainerScope';
import { traineeSession } from '../../../helpers/mockNext';

// Trainer routes that LIST data of trainees (dashboard, profile counts, trainee
// lists, evaluations, annual overview, school overview, reviews, certificates).
// They only reach trainees of the caller's organization (the super admin of
// every organization) and, once an occupation is chosen, of that occupation.
// The platform-owner flag of an organization does not widen the scope. The
// mock ignores where(), so the tests read the rendered conditions.

const API = 'http://localhost/api/trainer';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

type ReadCase = {
  name: string;
  route: string;
  url: string;
  tables: Record<string, any>;
  /** The table whose select carries the scope. */
  table: string;
  /** How the scope shows up: the profiles columns or a sub-select. */
  inSelect?: boolean;
};

const traineeRow = {
  id: T1,
  fullName: 'Azubi Eins',
  firstName: 'Azubi',
  lastName: 'Eins',
  email: 'a1@example.com',
  avatarUrl: null,
  isActive: true,
  trainerActivated: true,
  ausbildungDurationYears: 3,
  assignedTrainerId: null,
  organizationId: ORG,
  birthDate: null,
  startOfTrainingDate: null,
};

const course = { id: 'c1', title: 'Kurs' };

const readCases: ReadCase[] = [
  {
    name: 'GET /trainees',
    route: 'trainer/trainees/route',
    url: `${API}/trainees`,
    tables: { profiles: [traineeRow] },
    table: 'profiles',
  },
  {
    name: 'GET /trainees/with-stats',
    route: 'trainer/trainees/with-stats/route',
    url: `${API}/trainees/with-stats`,
    tables: { profiles: [traineeRow] },
    table: 'profiles',
  },
  {
    name: 'GET /dashboard',
    route: 'trainer/dashboard/route',
    url: `${API}/dashboard`,
    tables: { profiles: [traineeRow], courses: [course] },
    table: 'profiles',
  },
  {
    name: 'GET /profile (trainees)',
    route: 'trainer/profile/route',
    url: `${API}/profile`,
    tables: { profiles: [traineeRow] },
    table: 'profiles',
  },
  {
    name: 'GET /profile (pending quizzes)',
    route: 'trainer/profile/route',
    url: `${API}/profile`,
    tables: { profiles: [traineeRow] },
    table: 'quiz_submissions',
    inSelect: true,
  },
  {
    name: 'GET /profile (pending use cases)',
    route: 'trainer/profile/route',
    url: `${API}/profile`,
    tables: { profiles: [traineeRow] },
    table: 'use_case_submissions',
    inSelect: true,
  },
  {
    name: 'GET /profile (activity)',
    route: 'trainer/profile/route',
    url: `${API}/profile`,
    tables: { profiles: [traineeRow] },
    table: 'activity_log',
    inSelect: true,
  },
  {
    name: 'GET /evaluations',
    route: 'trainer/evaluations/route',
    url: `${API}/evaluations`,
    tables: { weeklyEvaluations: [], profiles: [] },
    table: 'weekly_evaluations',
  },
  {
    name: 'GET /annual-overview',
    route: 'trainer/annual-overview/route',
    url: `${API}/annual-overview`,
    tables: { weeklyEvaluations: [] },
    table: 'weekly_evaluations',
    inSelect: true,
  },
  {
    name: 'GET /school/stats (reports)',
    route: 'trainer/school/stats/route',
    url: `${API}/school/stats`,
    tables: {
      activityReports: [{ count: 1 }],
      schoolExams: [{ count: 1 }],
      profiles: [{ count: 1 }],
    },
    table: 'activity_reports',
    inSelect: true,
  },
  {
    name: 'GET /school/stats (exams)',
    route: 'trainer/school/stats/route',
    url: `${API}/school/stats`,
    tables: {
      activityReports: [{ count: 1 }],
      schoolExams: [{ count: 1 }],
      profiles: [{ count: 1 }],
    },
    table: 'school_exams',
    inSelect: true,
  },
  {
    name: 'GET /school/stats (trainees)',
    route: 'trainer/school/stats/route',
    url: `${API}/school/stats`,
    tables: {
      activityReports: [{ count: 1 }],
      schoolExams: [{ count: 1 }],
      profiles: [{ count: 1 }],
    },
    table: 'profiles',
  },
  {
    name: 'GET /school/activity-reports',
    route: 'trainer/school/activity-reports/route',
    url: `${API}/school/activity-reports`,
    tables: { activityReports: [], activityReportEntries: [] },
    table: 'activity_reports',
    inSelect: true,
  },
  {
    name: 'GET /school/exams',
    route: 'trainer/school/exams/route',
    url: `${API}/school/exams`,
    tables: { schoolExams: [] },
    table: 'school_exams',
    inSelect: true,
  },
  {
    name: 'GET /reviews (enablers)',
    route: 'trainer/reviews/route',
    url: `${API}/reviews`,
    tables: reviewTables(),
    table: 'enabler_submissions',
    inSelect: true,
  },
  {
    name: 'GET /reviews (use cases)',
    route: 'trainer/reviews/route',
    url: `${API}/reviews`,
    tables: reviewTables(),
    table: 'use_case_submissions',
    inSelect: true,
  },
  {
    name: 'GET /activity-reports',
    route: 'trainer/activity-reports/route',
    url: `${API}/activity-reports`,
    tables: {
      profiles: [traineeRow],
      activityReports: [],
      activityReportUseCaseEntries: [],
    },
    table: 'profiles',
  },
  {
    name: 'GET /quiz-submissions',
    route: 'trainer/quiz-submissions/route',
    url: `${API}/quiz-submissions`,
    tables: { quizSubmissions: [] },
    table: 'quiz_submissions',
    inSelect: true,
  },
];

function reviewTables() {
  return {
    courses: [{ id: 'c1', trainingCatalogId: FIAE }],
    courseMembers: [],
    enablerSubmissions: [
      {
        id: 's1',
        enablerId: 'e1',
        traineeId: T1,
        status: 'PENDING',
        submittedAt: new Date(),
      },
    ],
    useCaseSubmissions: [
      {
        id: 's2',
        useCaseId: 'u1',
        traineeId: T1,
        status: 'PENDING',
        submittedAt: new Date(),
      },
    ],
    enablers: [{ id: 'e1', title: 'E' }],
    useCases: [{ id: 'u1', title: 'U' }],
    profiles: [{ id: T1, fullName: 'Azubi Eins', organizationId: ORG }],
  };
}

async function run(
  entry: ReadCase,
  options: { session?: any; header?: string; tables?: Record<string, any> } = {}
) {
  const { mod, mock } = await loadScoped(entry.route, {
    session: options.session,
    tables: { ...entry.tables, ...(options.tables ?? {}) },
  });
  const res = await mod.GET(scopeReq(entry.url, { header: options.header }));
  return { res, mock };
}

const scopeSql = (entry: ReadCase, mock: any) =>
  mock.filters('select', entry.table);

describe.each(readCases)('$name', entry => {
  it('only reaches trainees of the own organization', async () => {
    const { res, mock } = await run(entry);
    expect(res.status).toBe(200);
    const filter = scopeSql(entry, mock);
    expect(filter.sql).toContain('"profiles"."organization_id" = $');
    expect(filter.params).toContain(ORG);
    expect(filter.params).not.toContain(OTHER_ORG);
    if (entry.inSelect) expect(filter.sql).toContain('in (select');
  });

  it('only reaches trainees (the role is part of the scope)', async () => {
    const { mock } = await run(entry);
    if (entry.table === 'profiles') {
      expect(scopeSql(entry, mock).params).toContain('TRAINEE');
    } else {
      expect(scopeSql(entry, mock).sql).toContain('"profiles"."role" = $');
    }
  });

  it('the platform-owner flag of the organization is no exception', async () => {
    const { mock } = await run(entry, {
      session: trainerSession({ isPlatformOwner: true }),
    });
    expect(scopeSql(entry, mock).params).toContain(ORG);
  });

  it('the super admin sees every organization', async () => {
    const { res, mock } = await run(entry, { session: superAdminSession() });
    expect(res.status).toBe(200);
    expect(scopeSql(entry, mock).sql).not.toContain('organization_id');
  });

  it('with an occupation (x-catalog) only the trainees of that occupation', async () => {
    const { res, mock } = await run(entry, { header: 'KFBM' });
    expect(res.status).toBe(200);
    const filter = scopeSql(entry, mock);
    expect(filter.sql).toContain('exists (select 1 from "trainee_enrollments"');
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
  });

  it('FIAE regression: without a header nothing about occupations is asked', async () => {
    const { res, mock } = await run(entry);
    expect(res.status).toBe(200);
    expect(scopeSql(entry, mock).sql).not.toContain('trainee_enrollments');
    expect(
      mock.calls.filter(
        c => c.op === 'select' && c.table === 'trainee_enrollments'
      )
    ).toHaveLength(0);
  });

  it('refuses an occupation the organization has not enabled (403)', async () => {
    const { res } = await run(entry, {
      header: 'KFBM',
      tables: {
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      },
    });
    expect(res.status).toBe(403);
  });

  it('turns a trainee (403) and an anonymous caller (401) away', async () => {
    const trainee = await run(entry, { session: traineeSession('t9') });
    expect(trainee.res.status).toBe(403);
    expect(trainee.mock.db.select).not.toHaveBeenCalled();
    const anonymous = await run(entry, { session: null });
    expect(anonymous.res.status).toBe(401);
  });
});

describe('GET /api/trainer/trainers', () => {
  const route = 'trainer/trainers/route';
  const url = `${API}/trainers`;

  it('lists only trainers of the own organization', async () => {
    const { mod, mock } = await loadScoped(route, {
      tables: { profiles: [{ id: T1, fullName: 'T' }] },
    });
    const res = await mod.GET(scopeReq(url));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'profiles');
    expect(filter.sql).toContain('"profiles"."organization_id" = $');
    expect(filter.params).toContain(ORG);
  });

  it('a trainer of the platform organization is no exception', async () => {
    const { mod, mock } = await loadScoped(route, {
      session: trainerSession({ isPlatformOwner: true }),
      tables: { profiles: [] },
    });
    await mod.GET(scopeReq(url));
    expect(selectParams(mock, 'profiles')).toContain(ORG);
  });

  it('the super admin sees every organization', async () => {
    const { mod, mock } = await loadScoped(route, {
      session: superAdminSession(),
      tables: { profiles: [] },
    });
    await mod.GET(scopeReq(url));
    expect(mock.filters('select', 'profiles').sql).not.toContain(
      'organization_id'
    );
  });

  it('turns a trainee (403) and an anonymous caller (401) away', async () => {
    const trainee = await loadScoped(route, {
      session: traineeSession('t9'),
    });
    expect((await trainee.mod.GET(scopeReq(url))).status).toBe(403);
    const anonymous = await loadScoped(route, { session: null });
    expect((await anonymous.mod.GET(scopeReq(url))).status).toBe(401);
  });
});

describe('GET /api/trainer/profiles', () => {
  const route = 'trainer/profiles/route';
  const get = (query: string, header?: string) =>
    scopeReq(`${API}/profiles${query}`, { header });

  it('stays inside the own organization', async () => {
    const { mod, mock } = await loadScoped(route, { tables: { profiles: [] } });
    await mod.GET(get('?role=TRAINEE'));
    expect(selectParams(mock, 'profiles')).toContain(ORG);
  });

  it('with an occupation the trainees of that occupation are searched', async () => {
    const { mod, mock } = await loadScoped(route, { tables: { profiles: [] } });
    const res = await mod.GET(get('?role=TRAINEE', 'KFBM'));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'profiles');
    expect(filter.sql).toContain('exists (select 1 from "trainee_enrollments"');
    expect(filter.params).toContain(KFBM);
  });

  it('with an occupation, the search for trainers is not narrowed', async () => {
    const { mod, mock } = await loadScoped(route, { tables: { profiles: [] } });
    await mod.GET(get('?role=TRAINER', 'KFBM'));
    expect(mock.filters('select', 'profiles').sql).not.toContain(
      'trainee_enrollments'
    );
  });

  it('with an occupation and no role, only the trainees are narrowed', async () => {
    const { mod, mock } = await loadScoped(route, { tables: { profiles: [] } });
    await mod.GET(get('', 'KFBM'));
    const filter = mock.filters('select', 'profiles');
    expect(filter.sql).toContain('"profiles"."role" <> $');
    expect(filter.sql).toContain('trainee_enrollments');
  });

  it('FIAE regression: without a header nothing about occupations is asked', async () => {
    const { mod, mock } = await loadScoped(route, { tables: { profiles: [] } });
    await mod.GET(get('?role=TRAINEE'));
    expect(mock.filters('select', 'profiles').sql).not.toContain(
      'trainee_enrollments'
    );
  });

  it('refuses an occupation the organization has not enabled (403)', async () => {
    const { mod } = await loadScoped(route, {
      tables: {
        profiles: [],
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      },
    });
    expect((await mod.GET(get('?role=TRAINEE', 'KFBM'))).status).toBe(403);
  });
});

describe('GET /api/trainer/activity-reports with a traineeId', () => {
  const route = 'trainer/activity-reports/route';

  it('answers with an empty list for a trainee outside the scope', async () => {
    // the trainee list of the scope does not hold T2
    const { mod, mock } = await loadScoped(route, {
      tables: {
        profiles: [traineeRow],
        activityReports: [{ id: 'r1', traineeId: T2, status: 'SUBMITTED' }],
        activityReportUseCaseEntries: [],
      },
    });
    const res = await mod.GET(scopeReq(`${API}/activity-reports?traineeId=${T2}`));
    expect(res.status).toBe(200);
    expect((await res.json()).reports).toEqual([]);
    expect(mock.calls.some(c => c.table === 'activity_reports')).toBe(false);
  });
});
