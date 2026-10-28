/**
 * @jest-environment node
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { NextRequest } from 'next/server';

// Content of an occupation reaches a trainee in three steps: the trainee is
// enrolled (course_members, quiz_assignments follow from the phase plan), the
// platform admin releases the content (is_active), and the trainee routes show
// it, with the solution protection untouched. This test runs the real library
// code and the real trainee routes against a REAL, LOCAL, throwaway PostgreSQL
// (the schema of the migrations up to 20261030000200). It only runs when
// TRAINEE_CONTENT_TEST_DB names such a database, for example
//
//   TRAINEE_CONTENT_TEST_DB=postgresql://postgres:pw@127.0.0.1:54381/postgres
//
// It refuses every host but the own machine and only touches its own rows
// (catalogs FX1K and FX1F, the organizations and users below), removed again.

const url = process.env.TRAINEE_CONTENT_TEST_DB;

function assertLocal(connection: string) {
  const host = new URL(connection).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(
      'TRAINEE_CONTENT_TEST_DB must point at a database on this machine'
    );
  }
}

const id = (n: number) =>
  `f1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CAT_K = id(1); // KfBM-like: courses linked to components
const CAT_F = id(2); // FIAE-like: courses without a component
const ORG_A = id(10);
const ORG_B = id(11);
const ORG_PLATFORM = id(12);
const ADMIN = id(20);
const TK1 = id(21); // org A, phase 1, elective w2
const TK2 = id(22); // org B, phase 2, no elective
const TK3 = id(23); // org A, phase 1, already member of c_p1a
const TF = id(24); // org A, FIAE-like catalog
const TN = id(25); // no organization, KfBM-like catalog
const TRAINER_A = id(30);
const ORG_ADMIN_A = id(31);

const COMP = {
  p1a: id(101),
  p1b: id(102),
  p2a: id(103),
  int: id(104),
  w1: id(105),
  w2: id(106),
  w3: id(107),
};
const COURSE = {
  p1a: id(201),
  p1b: id(202),
  p2a: id(203),
  int: id(204),
  w1: id(205),
  w2: id(206),
  w3: id(207),
  fiae: id(208),
};
const ENABLER = { p1a: id(301), p2a: id(302), int: id(303), fiae: id(304) };
const USE_CASE = { p1a: id(401), p2a: id(402), fiae: id(403) };
const QUIZ = {
  p1a: id(501),
  p1b: id(502),
  p2a: id(503),
  int: id(504),
  w1: id(505),
  w2: id(506),
  w3: id(507),
  fiae: id(508),
  lessonLow: id(509),
};
const LF_K = id(601);
const DOC_THEORY = id(701);
const DOC_TRAINER_ONLY = id(702);
const DOC_SOLUTION = id(703);

if (!url) {
  describe.skip('trainee content: postgres (set TRAINEE_CONTENT_TEST_DB)', () => {
    it('is skipped without a local database', () => undefined);
  });
} else {
  assertLocal(url);
  const client = postgres(url, {
    max: 4,
    prepare: false,
    onnotice: () => undefined,
  });
  const sql = client;
  const db = drizzle(client);

  // The session the mocked guards answer with (null = anonymous)
  let current: Record<string, unknown> | null = null;
  const sessionOf = (userId: string, org: string, extra = {}) => ({
    id: userId,
    email: `${userId}@t.test`,
    fullName: 'Test',
    role: 'TRAINEE',
    organizationId: org,
    isPlatformOwner: false,
    isSuperAdmin: false,
    isAdmin: false,
    isTrainerLevel: false,
    ...extra,
  });

  jest.mock('@/db', () => ({
    __esModule: true,
    get default() {
      return (globalThis as { __fx1db?: unknown }).__fx1db;
    },
  }));
  jest.mock('@/lib/auth/session', () => {
    const actual = jest.requireActual('@/lib/auth/session');
    const { NextResponse } = jest.requireActual('next/server');
    const who = () =>
      (globalThis as { __fx1session?: Record<string, unknown> | null })
        .__fx1session ?? null;
    const guard = (ok: (s: any) => boolean) => async () => {
      const s = who();
      if (!s)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return ok(s)
        ? s
        : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    };
    return {
      ...actual,
      getSessionUser: async () => who(),
      authenticate: async () => {
        const s = who();
        return s ? { ok: true, session: s } : { ok: false, status: 401 };
      },
      requireUser: guard(() => true),
      requireTrainer: guard(s => s.isTrainerLevel),
      requireAdmin: guard(s => s.isAdmin),
      requireSuperAdmin: guard(s => s.isSuperAdmin),
      requireCurriculumEditor: guard(s => s.isSuperAdmin),
    };
  });

  const asUser = (s: Record<string, unknown> | null) => {
    current = s;
    (globalThis as { __fx1session?: unknown }).__fx1session = s;
  };

  async function cleanup() {
    const catalogs = sql`(select id from training_catalogs where code like 'FX1%')`;
    await sql`delete from activity_log where organization_id = ${ORG_PLATFORM}`;
    await sql`delete from content_documents where id::text like 'f1000000-%'`;
    await sql`delete from quiz_assignments where trainee_id::text like 'f1000000-%'`;
    await sql`delete from course_members where user_id::text like 'f1000000-%'`;
    await sql`delete from trainee_enrollments where trainee_id::text like 'f1000000-%'`;
    await sql`delete from quizzes where training_catalog_id in ${catalogs}`;
    await sql`delete from training_catalog_learning_fields where training_catalog_id in ${catalogs}`;
    await sql`delete from courses where training_catalog_id in ${catalogs}`;
    await sql`delete from training_components where training_catalog_id in ${catalogs}`;
    await sql`delete from organization_catalogs where organization_id::text like 'f1000000-%'`;
    await sql`delete from profiles where id::text like 'f1000000-%'`;
    await sql`delete from auth.users where id::text like 'f1000000-%'`;
    await sql`delete from organizations where id::text like 'f1000000-%'`;
    await sql`delete from training_catalogs where code like 'FX1%'`;
  }

  async function seed() {
    await cleanup();
    for (const [orgId, name] of [
      [ORG_A, 'FX1 Org A'],
      [ORG_B, 'FX1 Org B'],
      [ORG_PLATFORM, 'FX1 Plattform'],
    ]) {
      await sql`insert into organizations (id, name, slug, subscription_plan, max_trainee_seats, max_trainer_seats, is_platform_owner)
                values (${orgId}, ${name}, ${'fx1-' + orgId.slice(-2)}, 'PRO', 20, 20, ${orgId === ORG_PLATFORM})`;
    }
    // A catalog with the KfBM phase plan: 15 months of phase 1
    await sql`insert into training_catalogs (id, code, title, is_active, elective_pick_count, settings)
              values (${CAT_K}, 'FX1K', 'FX1 KfBM-like', true, 2, ${JSON.stringify({ phase_months: [15, 21] })}::jsonb)`;
    await sql`insert into training_catalogs (id, code, title, is_active)
              values (${CAT_F}, 'FX1F', 'FX1 FIAE-like', true)`;
    await sql`insert into organization_catalogs (organization_id, training_catalog_id, is_enabled)
              values (${ORG_A}, ${CAT_K}, true), (${ORG_A}, ${CAT_F}, true), (${ORG_B}, ${CAT_K}, true),
                     (${ORG_PLATFORM}, ${CAT_K}, true), (${ORG_PLATFORM}, ${CAT_F}, true)`;

    const people: [string, string, string | null, string | null][] = [
      [ADMIN, 'SUPER_ADMIN', ORG_PLATFORM, null],
      [TK1, 'TRAINEE', ORG_A, '2026-09-01'],
      [TK2, 'TRAINEE', ORG_B, '2024-01-01'],
      [TK3, 'TRAINEE', ORG_A, '2026-09-01'],
      [TF, 'TRAINEE', ORG_A, '2026-09-01'],
      [TN, 'TRAINEE', null, null],
      [ORG_ADMIN_A, 'ADMIN', ORG_A, null],
      [TRAINER_A, 'TRAINER', ORG_A, null],
    ];
    for (const [uid, role, org, start] of people) {
      await sql`insert into auth.users (id, email) values (${uid}, ${uid + '@t.test'}) on conflict (id) do nothing`;
      await sql`insert into profiles (id, email, role, organization_id, is_active, trainer_activated, start_of_training_date, ausbildung_duration_years)
                values (${uid}, ${uid + '@t.test'}, ${role}, ${org}, true, true, ${start}, 3)`;
    }
    const enroll = async (trainee: string, catalog: string) =>
      (
        await sql`insert into trainee_enrollments (trainee_id, training_catalog_id, start_date, duration_years)
                  values (${trainee}, ${catalog}, null, 3) returning id`
      )[0].id as string;
    const eTK1 = await enroll(TK1, CAT_K);
    await enroll(TK2, CAT_K);
    await enroll(TK3, CAT_K);
    await enroll(TF, CAT_F);
    await enroll(TN, CAT_K);

    const comps: [string, string, string, number | null, number][] = [
      ['p1a', 'pflicht', 'K1', 1, 1],
      ['p1b', 'pflicht', 'K2', 1, 2],
      ['p2a', 'pflicht', 'K3', 2, 13],
      ['int', 'integrativ', 'K4', null, 23],
      ['w1', 'wahl', 'K5', null, 30],
      ['w2', 'wahl', 'K6', null, 31],
      ['w3', 'wahl', 'K7', null, 32],
    ];
    for (const [key, kind, code, phase, order] of comps) {
      const cid = COMP[key as keyof typeof COMP];
      await sql`insert into training_components (id, training_catalog_id, code, title, total_weeks, total_hours, phase, kind, order_index)
                values (${cid}, ${CAT_K}, ${code}, ${'Komponente ' + code}, 1, 40, ${phase}, ${kind}, ${order})`;
      await sql`insert into courses (id, training_catalog_id, code, title, created_by_id, training_component_id)
                values (${COURSE[key as keyof typeof COURSE]}, ${CAT_K}, ${code}, ${'Kurs ' + code}, ${ADMIN}, ${cid})`;
      await sql`insert into quizzes (id, training_catalog_id, code, title, quiz_type, created_by_id, training_component_id)
                values (${QUIZ[key as keyof typeof QUIZ]}, ${CAT_K}, ${code + '-g'}, ${'Global ' + code}, 'GLOBAL', ${ADMIN}, ${cid})`;
    }
    await sql`insert into trainee_elective_choices (enrollment_id, component_id, training_catalog_id)
              values (${eTK1}, ${COMP.w2}, ${CAT_K})`;
    // FIAE-like: course and quiz without a component
    await sql`insert into courses (id, training_catalog_id, title, created_by_id)
              values (${COURSE.fiae}, ${CAT_F}, 'FIAE Kurs', ${ADMIN})`;
    await sql`insert into quizzes (id, training_catalog_id, title, quiz_type, created_by_id)
              values (${QUIZ.fiae}, ${CAT_F}, 'FIAE Global', 'GLOBAL', ${ADMIN})`;

    // Enablers, use cases, lesson quiz, learning field with a mapping
    for (const [key, courseKey, n] of [
      ['p1a', 'p1a', 1],
      ['p2a', 'p2a', 2],
      ['int', 'int', 3],
      ['fiae', 'fiae', 4],
    ] as const) {
      await sql`insert into enablers (id, course_id, code, title, order_index)
                values (${ENABLER[key]}, ${COURSE[courseKey]}, ${'E' + n}, ${'Enabler ' + key}, ${n})`;
    }
    await sql`insert into use_cases (id, course_id, enabler_id, code, title, description_text, order_index, lernfelder)
              values (${USE_CASE.p1a}, ${COURSE.p1a}, ${ENABLER.p1a}, 'U1', 'Use Case p1a', 'Aufgabe', 1, '{LFX1}'::text[]),
                     (${USE_CASE.p2a}, ${COURSE.p2a}, ${ENABLER.p2a}, 'U2', 'Use Case p2a', 'Aufgabe', 1, '{LFX1}'::text[]),
                     (${USE_CASE.fiae}, ${COURSE.fiae}, ${ENABLER.fiae}, 'U3', 'Use Case fiae', 'Aufgabe', 1, '{LFX1}'::text[])`;
    await sql`insert into quizzes (id, training_catalog_id, title, quiz_type, created_by_id)
              values (${QUIZ.lessonLow}, ${CAT_K}, 'Lesson low', 'LESSON', ${ADMIN})`;
    await sql`insert into enabler_quiz_links (enabler_id, quiz_id, difficulty)
              values (${ENABLER.p1a}, ${QUIZ.lessonLow}, 'LOW')`;
    await sql`insert into training_catalog_learning_fields (id, training_catalog_id, code, title, description, training_year, hours_budget, order_index)
              values (${LF_K}, ${CAT_K}, 'LFX1', 'Lernfeld X1', 'Beschreibung X1', 1, 40, 1)`;
    await sql`insert into training_catalog_content_mappings (learning_field_id, enabler_id, training_catalog_id)
              values (${LF_K}, ${ENABLER.p1a}, ${CAT_K}), (${LF_K}, ${ENABLER.p2a}, ${CAT_K})`;
    // A question with a correct option and an explanation for each quiz
    for (const key of ['p1a', 'int', 'w2'] as const) {
      const q = (
        await sql`insert into questions (quiz_id, question_text, order_index)
                  values (${QUIZ[key]}, ${'Frage ' + key}, 1) returning id`
      )[0].id as string;
      await sql`insert into options (question_id, option_text, is_correct, explanation, order_index)
                values (${q}, 'richtig', true, 'GEHEIME-BEGRUENDUNG', 1), (${q}, 'falsch', false, null, 2)`;
    }
    // Documents of the enabler: one for trainees, two that must stay hidden
    await sql`insert into content_documents (id, enabler_id, title, file_name, storage_url, document_type, visibility)
              values (${DOC_THEORY}, ${ENABLER.p1a}, 'Lehrtext', 'lehrtext.pdf', 'https://example.test/lehrtext.pdf', 'THEORY', 'ALL'),
                     (${DOC_TRAINER_ONLY}, ${ENABLER.p1a}, 'Nur Trainer', 'trainer.pdf', 'https://example.test/trainer.pdf', 'THEORY', 'TRAINER_ONLY'),
                     (${DOC_SOLUTION}, ${ENABLER.p1a}, 'Loesung', 'loesung.pdf', 'https://example.test/loesung.pdf', 'TRAINER_SOLUTION', 'ALL')`;
    // A trainer gave TK3 the course c_p1a by hand before, and TK1 one that the
    // plan does not name: both must stay
    await sql`insert into course_members (course_id, user_id, role, organization_id)
              values (${COURSE.p1a}, ${TK3}, 'TRAINEE', ${ORG_A}), (${COURSE.p2a}, ${TK1}, 'TRAINEE', ${ORG_A})`;
  }

  const count = async (table: 'course_members' | 'quiz_assignments') =>
    Number(
      (
        await (table === 'course_members'
          ? sql`select count(*)::int as n from course_members where user_id::text like 'f1000000-%'`
          : sql`select count(*)::int as n from quiz_assignments where trainee_id::text like 'f1000000-%'`)
      )[0].n
    );

  const GET = async (
    load: () => Promise<any>,
    path: string,
    ctx?: Record<string, string>
  ) => {
    const mod = await load();
    const res = await mod.GET(
      new NextRequest(`http://localhost${path}`),
      ctx ? { params: Promise.resolve(ctx) } : undefined
    );
    return { status: res.status as number, body: await res.json() };
  };
  const route = {
    courses: () => import('@/app/api/trainee/courses/route'),
    quizzes: () => import('@/app/api/trainee/quizzes/route'),
    quiz: () => import('@/app/api/trainee/quizzes/[quizId]/route'),
    lernfeld: () => import('@/app/api/trainee/lernfelder/[id]/route'),
    enabler: () => import('@/app/api/trainee/enablers/[enablerId]/route'),
    docs: () =>
      import('@/app/api/trainee/enablers/[enablerId]/documents/route'),
  };

  describe('trainee content against postgres', () => {
    beforeAll(async () => {
      (globalThis as { __fx1db?: unknown }).__fx1db = db;
      await seed();
    });
    afterAll(async () => {
      await cleanup();
      await client.end();
    });

    it('a trial run counts and writes nothing', async () => {
      const { syncCatalogTraineeContent } =
        await import('@/lib/catalog/trainee-content');
      const before = {
        m: await count('course_members'),
        q: await count('quiz_assignments'),
      };
      const r = await syncCatalogTraineeContent(db, {
        catalogId: CAT_K,
        actorId: ADMIN,
        execute: false,
      });
      expect(r).toMatchObject({
        dryRun: true,
        trainees: 4,
        skippedNoOrganization: 1,
        // TK1 phase 1: p1a p1b int w2 (4), TK2 phase 2: p2a int (2),
        // TK3 phase 1: p1a (already a member) p1b int (2), TN has no
        // organization and is skipped
        courseMembersMissing: 8,
        // global quizzes follow the courses: TK1 4, TK2 2, TK3 3
        quizAssignmentsMissing: 9,
        courseMembersAdded: 0,
        quizAssignmentsAdded: 0,
      });
      expect(await count('course_members')).toBe(before.m);
      expect(await count('quiz_assignments')).toBe(before.q);
    });

    it('an organization admin run is limited to the own organization', async () => {
      const { syncCatalogTraineeContent } =
        await import('@/lib/catalog/trainee-content');
      const b = await syncCatalogTraineeContent(db, {
        catalogId: CAT_K,
        actorId: ADMIN,
        execute: false,
        organizationId: ORG_B,
      });
      expect(b).toMatchObject({
        trainees: 1,
        courseMembersMissing: 2,
        quizAssignmentsMissing: 2,
        skippedNoOrganization: 0,
      });
      // a trainee without an organization never matches an organization
      const none = await syncCatalogTraineeContent(db, {
        catalogId: CAT_K,
        actorId: ADMIN,
        execute: false,
        organizationId: id(99),
      });
      expect(none).toMatchObject({ trainees: 0, courseMembersMissing: 0 });
    });

    it('a catalog without linked courses gives its trainees nothing (FIAE)', async () => {
      const { syncCatalogTraineeContent } =
        await import('@/lib/catalog/trainee-content');
      const f = await syncCatalogTraineeContent(db, {
        catalogId: CAT_F,
        actorId: ADMIN,
        execute: true,
      });
      expect(f).toMatchObject({
        trainees: 1,
        traineesChanged: 0,
        courseMembersAdded: 0,
        quizAssignmentsAdded: 0,
      });
    });

    it('before the sync and the release the trainee sees no content', async () => {
      asUser(sessionOf(TK1, ORG_A));
      const courses = await GET(route.courses, '/api/trainee/courses');
      expect(courses.body.courses.map((c: any) => c.id)).toEqual([COURSE.p2a]);
      const quizzes = await GET(route.quizzes, '/api/trainee/quizzes');
      expect(quizzes.body).toEqual([]);
    });

    it('the sync inserts, never deletes, and a second run adds nothing', async () => {
      const { syncCatalogTraineeContent } =
        await import('@/lib/catalog/trainee-content');
      const run = () =>
        syncCatalogTraineeContent(db, {
          catalogId: CAT_K,
          actorId: ADMIN,
          execute: true,
        });
      const first = await run();
      expect(first).toMatchObject({
        courseMembersAdded: 8,
        quizAssignmentsAdded: 9,
        skippedNoOrganization: 1,
      });
      // 2 by hand + 8 new, 9 assignments
      expect(await count('course_members')).toBe(10);
      expect(await count('quiz_assignments')).toBe(9);
      const second = await run();
      expect(second).toMatchObject({
        courseMembersMissing: 0,
        quizAssignmentsMissing: 0,
        courseMembersAdded: 0,
        quizAssignmentsAdded: 0,
      });
      expect(await count('course_members')).toBe(10);
      // the plan does not name c_p2a for TK1, the trainer's row is still there
      const kept =
        await sql`select 1 from course_members where user_id = ${TK1} and course_id = ${COURSE.p2a}`;
      expect(kept).toHaveLength(1);
      // the rows are what a trainer writes: role TRAINEE, the organization of the trainee
      const row = (
        await sql`select role, organization_id from course_members where user_id = ${TK2} and course_id = ${COURSE.p2a}`
      )[0];
      expect(row).toMatchObject({ role: 'TRAINEE', organization_id: ORG_B });
      // nothing for the trainee without an organization
      expect(
        await sql`select 1 from course_members where user_id = ${TN}`
      ).toHaveLength(0);
    });

    it('assigned but not released: courses show empty, quizzes and Lernfeld stay hidden', async () => {
      asUser(sessionOf(TK1, ORG_A));
      const courses = await GET(route.courses, '/api/trainee/courses');
      expect(courses.body.courses).toHaveLength(5);
      expect(courses.body.courses.every((c: any) => c.enablerCount === 0)).toBe(
        true
      );
      const quizzes = await GET(route.quizzes, '/api/trainee/quizzes');
      expect(quizzes.body).toEqual([]);
      const lf = await GET(route.lernfeld, `/api/trainee/lernfelder/${LF_K}`, {
        id: LF_K,
      });
      expect(lf.status).toBe(200);
      expect(lf.body.enablers).toEqual([]);
      expect(lf.body.useCases).toEqual([]);
    });

    it('the release tool counts, is confirmed by the route, and is idempotent', async () => {
      const { runContentRelease, loadReleaseOverview } =
        await import('@/lib/catalog/content-release');
      const actor = { id: ADMIN, organizationId: ORG_PLATFORM };
      const overview = await loadReleaseOverview(db, CAT_K);
      expect(overview).toMatchObject({
        code: 'FX1K',
        total: {
          courses: 7,
          enablers: 3,
          useCases: 2,
          lessonQuizzes: 1,
          globalQuizzes: 7,
        },
        active: {
          courses: 0,
          enablers: 0,
          useCases: 0,
          lessonQuizzes: 0,
          globalQuizzes: 0,
        },
      });
      // a pre-activated enabler keeps its activated_at
      await sql`update enablers set is_active = true, activated_at = '2026-01-02T03:04:05Z' where id = ${ENABLER.int}`;

      const trial = await runContentRelease({
        catalogId: CAT_K,
        mode: 'release',
        execute: false,
        actor,
      });
      expect(trial).toMatchObject({
        dryRun: true,
        changes: {
          courses: 7,
          enablers: 2,
          useCases: 2,
          lessonQuizzes: 1,
          globalQuizzes: 7,
        },
        logged: false,
      });
      expect(
        await sql`select 1 from courses where training_catalog_id = ${CAT_K} and is_active is true`
      ).toHaveLength(0);

      // the route: a wrong code writes nothing, the right code runs
      const mod =
        await import('@/app/api/admin/catalogs/[catalogId]/content-release/route');
      const post = async (body: unknown) => {
        const res = await mod.POST(
          new NextRequest(
            'http://localhost/api/admin/catalogs/x/content-release',
            {
              method: 'POST',
              body: JSON.stringify(body),
              headers: { 'content-type': 'application/json' },
            }
          ),
          { params: Promise.resolve({ catalogId: CAT_K }) }
        );
        return { status: res.status, body: await res.json() };
      };
      asUser(sessionOf(TK1, ORG_A));
      expect(
        (await post({ mode: 'release', execute: true, confirmCode: 'FX1K' }))
          .status
      ).toBe(403);
      asUser(
        sessionOf(ADMIN, ORG_PLATFORM, {
          role: 'SUPER_ADMIN',
          isSuperAdmin: true,
          isAdmin: true,
          isTrainerLevel: true,
        })
      );
      const wrong = await post({
        mode: 'release',
        execute: true,
        confirmCode: 'fx1k',
      });
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('CONFIRMATION_MISMATCH');
      expect(
        await sql`select 1 from courses where training_catalog_id = ${CAT_K} and is_active is true`
      ).toHaveLength(0);
      expect((await post({ mode: 'nope' })).status).toBe(400);

      const done = await post({
        mode: 'release',
        execute: true,
        confirmCode: 'FX1K',
      });
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ dryRun: false, logged: true });

      const after = await loadReleaseOverview(db, CAT_K);
      expect(after?.active).toEqual(after?.total);
      expect(
        Number(
          (
            await sql`select count(*)::int n from courses where training_catalog_id = ${CAT_K} and is_published is true`
          )[0].n
        )
      ).toBe(7);
      // activated_at: set where it was empty, kept where it was set
      const stamps =
        await sql`select id, to_char(activated_at, 'YYYY-MM-DD HH24:MI:SS') as at from enablers where training_catalog_id = ${CAT_K}`;
      expect(stamps.every(s => s.at !== null)).toBe(true);
      expect(stamps.find(s => s.id === ENABLER.int)!.at).toBe(
        '2026-01-02 03:04:05'
      );
      // the other catalog is untouched
      expect(
        await sql`select 1 from courses where training_catalog_id = ${CAT_F} and is_active is true`
      ).toHaveLength(0);
      expect(
        await sql`select 1 from quizzes where training_catalog_id = ${CAT_F} and is_active is true`
      ).toHaveLength(0);
      // the protocol row
      const log =
        await sql`select activity_type, context from activity_log where organization_id = ${ORG_PLATFORM}`;
      expect(log).toHaveLength(1);
      expect(log[0].activity_type).toBe('CONTENT_RELEASE');

      // idempotent: the same call again changes nothing (a second trial shows 0)
      const again = await runContentRelease({
        catalogId: CAT_K,
        mode: 'release',
        execute: false,
        actor,
      });
      expect(again?.changes).toEqual({
        courses: 0,
        enablers: 0,
        useCases: 0,
        lessonQuizzes: 0,
        globalQuizzes: 0,
      });
    });

    it('released and assigned: the trainee sees courses, quizzes and the Lernfeld page', async () => {
      asUser(sessionOf(TK1, ORG_A));
      const courses = await GET(route.courses, '/api/trainee/courses');
      expect(courses.body.courses.map((c: any) => c.id).sort()).toEqual(
        [COURSE.p1a, COURSE.p1b, COURSE.int, COURSE.w2, COURSE.p2a].sort()
      );
      const withEnabler = courses.body.courses.find(
        (c: any) => c.id === COURSE.p1a
      );
      expect(withEnabler.enablerCount).toBe(1);

      const quizzes = await GET(route.quizzes, '/api/trainee/quizzes');
      expect(quizzes.body.map((q: any) => q.id).sort()).toEqual(
        [QUIZ.p1a, QUIZ.p1b, QUIZ.int, QUIZ.w2].sort()
      );

      const lf = await GET(route.lernfeld, `/api/trainee/lernfelder/${LF_K}`, {
        id: LF_K,
      });
      expect(lf.status).toBe(200);
      expect(lf.body.lernfeld).toMatchObject({
        label: 'LFX1',
        hoursBudget: 40,
        trainingYear: 1,
      });
      // TK1 is a member of c_p1a (plan) and of c_p2a (by hand): both open
      expect(
        lf.body.enablers.map((e: any) => [e.id, e.accessible]).sort()
      ).toEqual(
        [
          [ENABLER.p1a, true],
          [ENABLER.p2a, true],
        ].sort()
      );
      expect(
        lf.body.useCases.map((u: any) => [u.id, u.accessible]).sort()
      ).toEqual(
        [
          [USE_CASE.p1a, true],
          [USE_CASE.p2a, true],
        ].sort()
      );
      // the use case of the other catalog is not in the answer
      expect(JSON.stringify(lf.body)).not.toContain(USE_CASE.fiae);

      // TK2 (phase 2, org B) is only a member of c_p2a and c_int: the enabler
      // of c_p1a is listed but not linked
      asUser(sessionOf(TK2, ORG_B));
      const lf2 = await GET(route.lernfeld, `/api/trainee/lernfelder/${LF_K}`, {
        id: LF_K,
      });
      expect(
        lf2.body.enablers.find((e: any) => e.id === ENABLER.p1a).accessible
      ).toBe(false);
      expect(
        lf2.body.enablers.find((e: any) => e.id === ENABLER.p2a).accessible
      ).toBe(true);
      const denied = await GET(
        route.enabler,
        `/api/trainee/enablers/${ENABLER.p1a}`,
        { enablerId: ENABLER.p1a }
      );
      expect(denied.status).toBe(403);
    });

    it('catalog and tenant protection: other occupations and anonymous callers see nothing of it', async () => {
      asUser(sessionOf(TF, ORG_A));
      expect(
        (
          await GET(route.lernfeld, `/api/trainee/lernfelder/${LF_K}`, {
            id: LF_K,
          })
        ).status
      ).toBe(404);
      expect(
        (
          await GET(route.enabler, `/api/trainee/enablers/${ENABLER.p1a}`, {
            enablerId: ENABLER.p1a,
          })
        ).status
      ).toBe(404);
      expect(
        (await GET(route.courses, '/api/trainee/courses')).body.courses
      ).toEqual([]);
      // anonymous: only the public catalog (FIAE default), never FX1K
      asUser(null);
      expect(
        (
          await GET(route.lernfeld, `/api/trainee/lernfelder/${LF_K}`, {
            id: LF_K,
          })
        ).status
      ).toBe(404);
      // a malformed id is a 404, not a 500
      asUser(sessionOf(TK1, ORG_A));
      expect(
        (
          await GET(route.lernfeld, '/api/trainee/lernfelder/not-a-uuid', {
            id: 'not-a-uuid',
          })
        ).status
      ).toBe(404);
    });

    it('solution protection after the release: no trainer documents, no answers before the submit', async () => {
      asUser(sessionOf(TK1, ORG_A));
      const docs = await GET(
        route.docs,
        `/api/trainee/enablers/${ENABLER.p1a}/documents`,
        { enablerId: ENABLER.p1a }
      );
      expect(docs.status).toBe(200);
      const ids = (docs.body.documents ?? docs.body).map((d: any) => d.id);
      expect(ids).toEqual([DOC_THEORY]);
      expect(JSON.stringify(docs.body)).not.toContain('loesung.pdf');
      expect(JSON.stringify(docs.body)).not.toContain('trainer.pdf');

      const quiz = await GET(route.quiz, `/api/trainee/quizzes/${QUIZ.p1a}`, {
        quizId: QUIZ.p1a,
      });
      expect(quiz.status).toBe(200);
      const text = JSON.stringify(quiz.body);
      expect(text).toContain('Frage p1a');
      expect(text).not.toMatch(
        /isCorrect|is_correct|explanation|GEHEIME-BEGRUENDUNG|expectedAnswer/
      );
      // a quiz that is not assigned to the trainee is not found
      const other = await GET(route.quiz, `/api/trainee/quizzes/${QUIZ.p2a}`, {
        quizId: QUIZ.p2a,
      });
      expect(other.status).toBe(404);
    });

    it('lock is the counterpart and hides everything again', async () => {
      const { runContentRelease, loadReleaseOverview } =
        await import('@/lib/catalog/content-release');
      const actor = { id: ADMIN, organizationId: ORG_PLATFORM };
      const locked = await runContentRelease({
        catalogId: CAT_K,
        mode: 'lock',
        execute: true,
        actor,
      });
      expect(locked).toMatchObject({
        dryRun: false,
        changes: {
          courses: 7,
          enablers: 3,
          useCases: 2,
          lessonQuizzes: 1,
          globalQuizzes: 7,
        },
      });
      const o = await loadReleaseOverview(db, CAT_K);
      expect(o?.active).toEqual({
        courses: 0,
        enablers: 0,
        useCases: 0,
        lessonQuizzes: 0,
        globalQuizzes: 0,
      });
      // the numbers of the release are in the protocol, the lock too
      const log =
        await sql`select activity_type from activity_log where organization_id = ${ORG_PLATFORM} order by created_at`;
      expect(log.map(l => l.activity_type)).toEqual([
        'CONTENT_RELEASE',
        'CONTENT_LOCK',
      ]);

      asUser(sessionOf(TK1, ORG_A));
      expect((await GET(route.quizzes, '/api/trainee/quizzes')).body).toEqual(
        []
      );
      expect(
        (
          await GET(route.enabler, `/api/trainee/enablers/${ENABLER.p1a}`, {
            enablerId: ENABLER.p1a,
          })
        ).status
      ).toBe(404);
      const lf = await GET(route.lernfeld, `/api/trainee/lernfelder/${LF_K}`, {
        id: LF_K,
      });
      expect(lf.body.enablers).toEqual([]);
    });

    it('the sync route: roles, own organization only, and the trial default', async () => {
      const mod =
        await import('@/app/api/admin/catalogs/[catalogId]/trainee-content/route');
      const post = async (catalogId: string, body: unknown) => {
        const res = await mod.POST(
          new NextRequest(
            'http://localhost/api/admin/catalogs/x/trainee-content',
            {
              method: 'POST',
              body: JSON.stringify(body),
              headers: { 'content-type': 'application/json' },
            }
          ),
          { params: Promise.resolve({ catalogId }) }
        );
        return { status: res.status, body: await res.json() };
      };
      await sql`delete from course_members where user_id::text like 'f1000000-%'`;
      await sql`delete from quiz_assignments where trainee_id::text like 'f1000000-%'`;

      asUser(null);
      expect((await post(CAT_K, {})).status).toBe(401);
      asUser(
        sessionOf(TRAINER_A, ORG_A, { role: 'TRAINER', isTrainerLevel: true })
      );
      expect((await post(CAT_K, {})).status).toBe(403);
      asUser(sessionOf(TK1, ORG_A));
      expect((await post(CAT_K, {})).status).toBe(403);

      // an ADMIN of org A: own trainees only, a given organizationId is ignored
      asUser(
        sessionOf(ORG_ADMIN_A, ORG_A, {
          role: 'ADMIN',
          isAdmin: true,
          isTrainerLevel: true,
        })
      );
      const trial = await post(CAT_K, { organizationId: ORG_B });
      expect(trial.status).toBe(200);
      expect(trial.body).toMatchObject({ dryRun: true, trainees: 2 }); // TK1, TK3 (TN has no org)
      expect(trial.body.details).toBeUndefined();
      expect(await count('course_members')).toBe(0);
      const run = await post(CAT_K, { execute: true });
      expect(run.body).toMatchObject({
        dryRun: false,
        courseMembersAdded: 7,
        quizAssignmentsAdded: 7,
      });
      // org B stays untouched by the admin of org A
      expect(
        await sql`select 1 from course_members where user_id = ${TK2}`
      ).toHaveLength(0);
      // a catalog that is not enabled for the organization answers like a missing one
      expect((await post(id(77), {})).status).toBe(404);
      await sql`update organization_catalogs set is_enabled = false where organization_id = ${ORG_A} and training_catalog_id = ${CAT_K}`;
      expect((await post(CAT_K, {})).status).toBe(404);
      await sql`update organization_catalogs set is_enabled = true where organization_id = ${ORG_A} and training_catalog_id = ${CAT_K}`;

      // the platform admin: all organizations
      asUser(
        sessionOf(ADMIN, ORG_PLATFORM, {
          role: 'SUPER_ADMIN',
          isSuperAdmin: true,
          isAdmin: true,
          isTrainerLevel: true,
        })
      );
      const all = await post(CAT_K, { execute: true });
      expect(all.body).toMatchObject({
        courseMembersAdded: 2,
        quizAssignmentsAdded: 2,
        skippedNoOrganization: 1,
      });
    });
  });
}
