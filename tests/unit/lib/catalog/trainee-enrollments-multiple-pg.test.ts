/**
 * @jest-environment node
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { NextRequest } from 'next/server';

// A trainee can be enrolled in several trainings. This test runs the real
// library code and the real routes against a REAL, LOCAL, throwaway PostgreSQL
// with all migrations up to and including 20261030000300. It only runs when
// ME1_TEST_DB names such a database, for example
//
//   ME1_TEST_DB=postgresql://postgres:pw@127.0.0.1:54351/me1_t
//
// It refuses every host but the own machine and only touches its own rows
// (catalogs ME1K and ME1F, the organizations and users below), removed again.
// What it proves, with real rows and real routes:
//  - the database allows a second enrollment and still refuses the same catalog
//    twice
//  - the platform admin adds a training (the others stay, the content of the
//    phase plan is assigned per enrollment) and removes one only with the
//    confirmation, never the last one, and only the enrollment goes
//  - the catalog scope of a trainee with two trainings: the header decides,
//    without it the first enrollment, nothing outside the own enrollments
//  - the roles: only the platform admin writes, solutions stay hidden
//  - a trainee in two trainings takes one seat and is counted once per training
//  - the hand-over of the enrollments at the first login (merge of profiles)

const url = process.env.ME1_TEST_DB;

function assertLocal(connection: string) {
  const host = new URL(connection).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error('ME1_TEST_DB must point at a database on this machine');
  }
}

const id = (n: number) =>
  `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// The default occupation of the platform (the merge of profiles treats it as the weaker statement)
const FIAE_DEFAULT = '00000000-0000-4000-8000-000000000001';
const CAT_K = id(1); // KfBM-like: courses linked to components, phase plan 15 + 21
const CAT_F = id(2); // FIAE-like: courses without a component
const ORG_A = id(10);
const ORG_B = id(11);
const ORG_PLATFORM = id(12);
const SA = id(20); // super admin of the platform organization
const TM = id(21); // org A: FIAE first, KfBM second
const TK = id(22); // org A: KfBM only
const TF = id(23); // org A: FIAE only, KfBM is added in the test
const TB = id(24); // org B: KfBM only
const TRAINER_A = id(30);
const ADMIN_A = id(31);

const COMP = { p1: id(101), p2: id(102), w1: id(103) };
const COURSE = { k1: id(201), k2: id(202), w1: id(203), f: id(204) };
const QUIZ = { k1: id(301), k2: id(302), f: id(303) };
const ENROLL = { tmF: id(401), tmK: id(402), tkK: id(403), tfF: id(404) };

if (!url) {
  describe.skip('trainee enrollments (several trainings): postgres (set ME1_TEST_DB)', () => {
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
  const superAdmin = () =>
    sessionOf(SA, ORG_PLATFORM, {
      role: 'SUPER_ADMIN',
      isPlatformOwner: true,
      isSuperAdmin: true,
      isAdmin: true,
      isTrainerLevel: true,
    });
  const orgAdmin = () =>
    sessionOf(ADMIN_A, ORG_A, {
      role: 'ADMIN',
      isAdmin: true,
      isTrainerLevel: true,
    });
  const trainer = () =>
    sessionOf(TRAINER_A, ORG_A, { role: 'TRAINER', isTrainerLevel: true });
  const trainee = (userId: string, org = ORG_A) => sessionOf(userId, org);

  jest.mock('@/db', () => ({
    __esModule: true,
    get default() {
      return (globalThis as { __me1db?: unknown }).__me1db;
    },
  }));
  jest.mock('@/lib/auth/session', () => {
    const actual = jest.requireActual('@/lib/auth/session');
    const { NextResponse } = jest.requireActual('next/server');
    const who = () =>
      (globalThis as { __me1session?: Record<string, unknown> | null })
        .__me1session ?? null;
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
    (globalThis as { __me1session?: unknown }).__me1session = s;
  };

  async function cleanup() {
    const catalogs = sql`(select id from training_catalogs where code like 'ME1%')`;
    await sql`delete from activity_log where organization_id::text like 'e1000000-%'`;
    await sql`delete from quiz_assignments where trainee_id::text like 'e1000000-%'`;
    await sql`delete from course_members where user_id::text like 'e1000000-%'`;
    await sql`delete from trainee_enrollments where trainee_id::text like 'e1000000-%'`;
    await sql`delete from options where question_id in (select id from questions where quiz_id::text like 'e1000000-%')`;
    await sql`delete from questions where quiz_id::text like 'e1000000-%'`;
    await sql`delete from quizzes where training_catalog_id in ${catalogs}`;
    await sql`delete from courses where training_catalog_id in ${catalogs}`;
    await sql`delete from training_components where training_catalog_id in ${catalogs}`;
    await sql`delete from organization_catalogs where organization_id::text like 'e1000000-%'`;
    await sql`delete from profiles where id::text like 'e1000000-%'`;
    await sql`delete from auth.users where id::text like 'e1000000-%'`;
    await sql`delete from organizations where id::text like 'e1000000-%'`;
    await sql`delete from training_catalogs where code like 'ME1%'`;
  }

  const monthsAgo = (months: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  };

  async function enroll(
    enrollmentId: string,
    trainee: string,
    catalog: string,
    createdAt: string,
    startDate: string | null = null,
    durationYears = 3
  ) {
    await sql`insert into trainee_enrollments (id, trainee_id, training_catalog_id, start_date, duration_years, created_at)
              values (${enrollmentId}, ${trainee}, ${catalog}, ${startDate}, ${durationYears}, ${createdAt})`;
  }

  async function seed() {
    await cleanup();
    for (const [orgId, name] of [
      [ORG_A, 'ME1 Org A'],
      [ORG_B, 'ME1 Org B'],
      [ORG_PLATFORM, 'ME1 Plattform'],
    ]) {
      await sql`insert into organizations (id, name, slug, subscription_plan, max_trainee_seats, max_trainer_seats, is_platform_owner)
                values (${orgId}, ${name}, ${'me1-' + orgId.slice(-2)}, 'PRO', 20, 20, ${orgId === ORG_PLATFORM})`;
    }
    await sql`insert into training_catalogs (id, code, title, is_active, elective_pick_count, settings)
              values (${CAT_K}, 'ME1K', 'ME1 KfBM-like', true, 2, ${JSON.stringify({ phase_months: [15, 21] })}::jsonb)`;
    await sql`insert into training_catalogs (id, code, title, is_active)
              values (${CAT_F}, 'ME1F', 'ME1 FIAE-like', true)`;
    await sql`insert into organization_catalogs (organization_id, training_catalog_id, is_enabled)
              values (${ORG_A}, ${CAT_K}, true), (${ORG_A}, ${CAT_F}, true),
                     (${ORG_B}, ${CAT_K}, true),
                     (${ORG_PLATFORM}, ${CAT_K}, true), (${ORG_PLATFORM}, ${CAT_F}, true)`;

    // profile start 3 years ago: phase 2 of KfBM, if the profile counts
    const people: [string, string, string | null][] = [
      [SA, 'SUPER_ADMIN', ORG_PLATFORM],
      [TM, 'TRAINEE', ORG_A],
      [TK, 'TRAINEE', ORG_A],
      [TF, 'TRAINEE', ORG_A],
      [TB, 'TRAINEE', ORG_B],
      [TRAINER_A, 'TRAINER', ORG_A],
      [ADMIN_A, 'ADMIN', ORG_A],
    ];
    for (const [uid, role, org] of people) {
      await sql`insert into auth.users (id, email) values (${uid}, ${uid + '@t.test'}) on conflict (id) do nothing`;
      await sql`insert into profiles (id, email, role, organization_id, is_active, trainer_activated, start_of_training_date, ausbildung_duration_years)
                values (${uid}, ${uid + '@t.test'}, ${role}, ${org}, true, true, ${monthsAgo(36)}, 3)`;
    }

    // KfBM-like content: two compulsory components (phase 1, phase 2) and one
    // elective component, a course and a global quiz each
    const comps: [keyof typeof COMP, string, string, number | null, number][] = [
      ['p1', 'pflicht', 'K1', 1, 1],
      ['p2', 'pflicht', 'K2', 2, 13],
      ['w1', 'wahl', 'K3', null, 30],
    ];
    for (const [key, kind, code, phase, order] of comps) {
      await sql`insert into training_components (id, training_catalog_id, code, title, total_weeks, total_hours, phase, kind, order_index)
                values (${COMP[key]}, ${CAT_K}, ${code}, ${'Komponente ' + code}, 1, 40, ${phase}, ${kind}, ${order})`;
    }
    await sql`insert into courses (id, training_catalog_id, code, title, created_by_id, training_component_id, is_active, year)
              values (${COURSE.k1}, ${CAT_K}, 'K1', 'Kurs KfBM Phase 1', ${SA}, ${COMP.p1}, true, 1),
                     (${COURSE.k2}, ${CAT_K}, 'K2', 'Kurs KfBM Phase 2', ${SA}, ${COMP.p2}, true, 2),
                     (${COURSE.w1}, ${CAT_K}, 'K3', 'Kurs KfBM Wahl', ${SA}, ${COMP.w1}, true, 1)`;
    await sql`insert into courses (id, training_catalog_id, title, created_by_id, is_active, year)
              values (${COURSE.f}, ${CAT_F}, 'Kurs FIAE', ${SA}, true, 1)`;
    await sql`insert into quizzes (id, training_catalog_id, code, title, quiz_type, created_by_id, training_component_id, is_active)
              values (${QUIZ.k1}, ${CAT_K}, 'K1-g', 'Quiz KfBM 1', 'GLOBAL', ${SA}, ${COMP.p1}, true),
                     (${QUIZ.k2}, ${CAT_K}, 'K2-g', 'Quiz KfBM 2', 'GLOBAL', ${SA}, ${COMP.p2}, true)`;
    await sql`insert into quizzes (id, training_catalog_id, title, quiz_type, created_by_id, is_active)
              values (${QUIZ.f}, ${CAT_F}, 'Quiz FIAE', 'GLOBAL', ${SA}, true)`;
    const q = (
      await sql`insert into questions (quiz_id, question_text, order_index)
                values (${QUIZ.k1}, 'Frage KfBM 1', 1) returning id`
    )[0].id as string;
    await sql`insert into options (question_id, option_text, is_correct, explanation, order_index)
              values (${q}, 'richtig', true, 'GEHEIME-BEGRUENDUNG', 1), (${q}, 'falsch', false, null, 2)`;

    // TM: FIAE first (September), KfBM second (October) with a start of its own
    // one month ago, so phase 1 of KfBM although the profile says phase 2
    await enroll(ENROLL.tmF, TM, CAT_F, '2026-09-01T08:00:00Z', monthsAgo(36));
    await enroll(ENROLL.tmK, TM, CAT_K, '2026-10-01T08:00:00Z', monthsAgo(1));
    await enroll(ENROLL.tkK, TK, CAT_K, '2026-09-01T08:00:00Z');
    await enroll(ENROLL.tfF, TF, CAT_F, '2026-09-01T08:00:00Z');
    await enroll(id(405), TB, CAT_K, '2026-09-01T08:00:00Z');
    // what the trainer gave by hand: TM and TF are members of the FIAE course
    await sql`insert into course_members (course_id, user_id, role, organization_id)
              values (${COURSE.f}, ${TM}, 'TRAINEE', ${ORG_A}), (${COURSE.f}, ${TF}, 'TRAINEE', ${ORG_A})`;
    await sql`insert into quiz_assignments (quiz_id, trainee_id, assigned_by_id, organization_id)
              values (${QUIZ.f}, ${TM}, ${SA}, ${ORG_A}), (${QUIZ.f}, ${TF}, ${SA}, ${ORG_A})`;
    // an elective choice of TM for the KfBM enrollment
    await sql`insert into trainee_elective_choices (enrollment_id, component_id, training_catalog_id)
              values (${ENROLL.tmK}, ${COMP.w1}, ${CAT_K})`;
  }

  type Opts = {
    header?: string;
    method?: string;
    body?: unknown;
    ctx?: Record<string, string>;
  };
  async function call(
    load: () => Promise<any>,
    path: string,
    opts: Opts = {}
  ): Promise<{ status: number; body: any }> {
    const mod = await load();
    const method = opts.method ?? 'GET';
    const headers: Record<string, string> = {
      authorization: 'Bearer t',
      'content-type': 'application/json',
    };
    if (opts.header) headers['x-catalog'] = opts.header;
    const req = new NextRequest(`http://localhost${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const res = await mod[method](
      req,
      opts.ctx ? { params: Promise.resolve(opts.ctx) } : undefined
    );
    return { status: res.status as number, body: await res.json() };
  }

  const route = {
    courses: () => import('@/app/api/trainee/courses/route'),
    quizzes: () => import('@/app/api/trainee/quizzes/route'),
    quiz: () => import('@/app/api/trainee/quizzes/[quizId]/route'),
    dashboard: () => import('@/app/api/trainee/dashboard/route'),
    enrollment: () => import('@/app/api/admin/users/[userId]/enrollment/route'),
    users: () => import('@/app/api/admin/users/route'),
    meCatalogs: () => import('@/app/api/me/catalogs/route'),
  };
  const enrollmentUrl = (userId: string) =>
    `/api/admin/users/${userId}/enrollment`;
  const enrollmentsOf = async (traineeId: string) =>
    (
      await sql`select e.id, c.code from trainee_enrollments e join training_catalogs c on c.id = e.training_catalog_id
                where e.trainee_id = ${traineeId} order by e.created_at, c.code`
    ).map(r => `${r.code}`);

  describe('trainee enrollments with several trainings, against postgres', () => {
    beforeAll(async () => {
      process.env.RESEND_API_KEY = 're_test_key';
      (globalThis as { __me1db?: unknown }).__me1db = db;
      await seed();
    });
    afterAll(async () => {
      await cleanup();
      await client.end();
    });

    describe('the database', () => {
      it('has no unique index on trainee_id alone any more', async () => {
        const rows =
          await sql`select indexname from pg_indexes where schemaname = 'public' and tablename = 'trainee_enrollments'`;
        expect(rows.map(r => r.indexname)).not.toContain(
          'trainee_enrollments_trainee_unique'
        );
      });

      it('allows a second enrollment and refuses the same catalog twice', async () => {
        expect(await enrollmentsOf(TM)).toEqual(['ME1F', 'ME1K']);
        await expect(
          sql`insert into trainee_enrollments (trainee_id, training_catalog_id) values (${TM}, ${CAT_K})`
        ).rejects.toMatchObject({ code: '23505' });
        expect(await enrollmentsOf(TM)).toEqual(['ME1F', 'ME1K']);
      });
    });

    describe('the catalog scope of a trainee with two trainings', () => {
      it('GET /api/me/catalogs lists exactly the own enrollments, the first one is the default', async () => {
        asUser(trainee(TM));
        const res = await call(route.meCatalogs, '/api/me/catalogs');
        expect(res.status).toBe(200);
        expect(res.body.catalogs.map((c: any) => c.code)).toEqual([
          'ME1F',
          'ME1K',
        ]);
        expect(res.body.activeCode).toBe('ME1F');
        // a trainee with one training sees one
        asUser(trainee(TK));
        const single = await call(route.meCatalogs, '/api/me/catalogs');
        expect(single.body.catalogs.map((c: any) => c.code)).toEqual(['ME1K']);
        expect(single.body.activeCode).toBe('ME1K');
      });

      it('without a choice the courses of the first enrollment only, never a mix', async () => {
        asUser(trainee(TM));
        const none = await call(route.courses, '/api/trainee/courses');
        expect(none.status).toBe(200);
        expect(none.body.courses.map((c: any) => c.id)).toEqual([COURSE.f]);
      });

      it('the header chooses the training, and each tab shows only its content', async () => {
        // TM is a member of the KfBM courses of the phase plan as well
        await sql`insert into course_members (course_id, user_id, role, organization_id)
                  values (${COURSE.k1}, ${TM}, 'TRAINEE', ${ORG_A}) on conflict do nothing`;
        await sql`insert into quiz_assignments (quiz_id, trainee_id, assigned_by_id, organization_id)
                  values (${QUIZ.k1}, ${TM}, ${SA}, ${ORG_A}) on conflict do nothing`;
        asUser(trainee(TM));
        const k = await call(route.courses, '/api/trainee/courses', {
          header: 'ME1K',
        });
        expect(k.body.courses.map((c: any) => c.id)).toEqual([COURSE.k1]);
        const f = await call(route.courses, '/api/trainee/courses', {
          header: 'ME1F',
        });
        expect(f.body.courses.map((c: any) => c.id)).toEqual([COURSE.f]);
        // the query parameter works like the header
        const q = await call(route.courses, '/api/trainee/courses?catalog=me1k');
        expect(q.body.courses.map((c: any) => c.id)).toEqual([COURSE.k1]);
        expect(JSON.stringify(f.body)).not.toContain('KfBM');
        expect(JSON.stringify(k.body)).not.toContain('FIAE');

        // quizzes per tab (released: the quizzes are active)
        const quizK = await call(route.quizzes, '/api/trainee/quizzes', {
          header: 'ME1K',
        });
        expect(quizK.body.map((x: any) => x.id)).toEqual([QUIZ.k1]);
        const quizF = await call(route.quizzes, '/api/trainee/quizzes', {
          header: 'ME1F',
        });
        expect(quizF.body.map((x: any) => x.id)).toEqual([QUIZ.f]);
        const quizNone = await call(route.quizzes, '/api/trainee/quizzes');
        expect(quizNone.body.map((x: any) => x.id)).toEqual([QUIZ.f]);
      });

      it('a header for a training the trainee is not in is 403, an unknown one too', async () => {
        asUser(trainee(TK));
        for (const header of ['ME1F', 'NOPE', 'ME1K,ME1F', "ME1F'--"]) {
          const res = await call(route.courses, '/api/trainee/courses', {
            header,
          });
          expect(res.status).toBe(403);
        }
        // and nobody reads the trainings of somebody else: TB (org B) has no FIAE
        asUser(trainee(TB, ORG_B));
        expect(
          (
            await call(route.courses, '/api/trainee/courses', {
              header: 'ME1F',
            })
          ).status
        ).toBe(403);
        // the enrollments of TM are not visible to TK through a lookup either
        asUser(trainee(TK));
        const me = await call(route.meCatalogs, '/api/me/catalogs');
        expect(me.body.catalogs.map((c: any) => c.code)).toEqual(['ME1K']);
      });

      it('the solution protection is unchanged in every tab', async () => {
        asUser(trainee(TM));
        const quiz = await call(route.quiz, `/api/trainee/quizzes/${QUIZ.k1}`, {
          header: 'ME1K',
          ctx: { quizId: QUIZ.k1 },
        });
        expect(quiz.status).toBe(200);
        const text = JSON.stringify(quiz.body);
        expect(text).toContain('Frage KfBM 1');
        expect(text).not.toMatch(
          /isCorrect|is_correct|explanation|GEHEIME-BEGRUENDUNG|expectedAnswer/
        );
        // a quiz of a training the trainee does not have is not found
        asUser(trainee(TK));
        const foreign = await call(route.quiz, `/api/trainee/quizzes/${QUIZ.f}`, {
          header: 'ME1K',
          ctx: { quizId: QUIZ.f },
        });
        expect(foreign.status).toBe(404);
      });

      it('the dashboard counts every training with its own start date and plan', async () => {
        asUser(trainee(TM));
        const f = await call(route.dashboard, '/api/trainee/dashboard', {
          header: 'ME1F',
        });
        const k = await call(route.dashboard, '/api/trainee/dashboard', {
          header: 'ME1K',
        });
        expect(f.status).toBe(200);
        expect(k.status).toBe(200);
        // KfBM started a month ago (its own start date), so phase 1 of 15
        // months is still ahead; the 3 year old profile start would be over
        const kLabels = k.body.deadlines.map((d: any) => d.label);
        expect(kLabels[0]).toBe('Phase 1 (1. bis 15. Ausbildungsmonat)');
        expect(new Date(k.body.deadlines[0].dueDate).getTime()).toBeGreaterThan(
          Date.now()
        );
        // FIAE follows the profile (3 years ago): phase 1 is over, phase 2 is current
        expect(f.body.deadlines.map((d: any) => d.label)).not.toContain(
          'Phase 1 (1. bis 18. Ausbildungsmonat)'
        );
        // the content of the dashboard follows the tab too
        expect(JSON.stringify(k.body)).not.toContain('Kurs FIAE');
        expect(JSON.stringify(f.body)).not.toContain('Kurs KfBM');
      });
    });

    describe('the platform admin adds and removes a training', () => {
      it('adds KfBM to a FIAE trainee: the FIAE enrollment stays, the phase plan content follows', async () => {
        asUser(superAdmin());
        const before = (
          await sql`select id from trainee_enrollments where trainee_id = ${TF}`
        ).map(r => r.id);
        const res = await call(route.enrollment, enrollmentUrl(TF), {
          method: 'PUT',
          body: { catalogId: CAT_K },
          ctx: { userId: TF },
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          changed: true,
          enrollmentCount: 2,
          effectiveCatalogId: CAT_F,
        });
        expect(res.body.enrollments.map((e: any) => e.code)).toEqual([
          'ME1F',
          'ME1K',
        ]);
        // the first enrollment is the same row as before
        expect(before).toEqual([ENROLL.tfF]);
        expect(await enrollmentsOf(TF)).toEqual(['ME1F', 'ME1K']);
        // the second enrollment copied the profile start (36 months ago): it
        // counts with its own terms, which are the same here, so phase 2 of
        // KfBM: the course of phase 2 and its quiz, nothing of phase 1
        const members = await sql`select course_id from course_members where user_id = ${TF} order by course_id`;
        expect(members.map(m => m.course_id).sort()).toEqual(
          [COURSE.f, COURSE.k2].sort()
        );
        expect(res.body.contentSync).toMatchObject({
          courseMembersAdded: 1,
          quizAssignmentsAdded: 1,
        });
      });

      it('a trainee without any row works in FIAE: adding KfBM keeps that FIAE as a real enrollment', async () => {
        const TN = id(26);
        await sql`insert into auth.users (id, email) values (${TN}, ${TN + '@t.test'}) on conflict (id) do nothing`;
        await sql`insert into profiles (id, email, role, organization_id, is_active, start_of_training_date, ausbildung_duration_years)
                  values (${TN}, ${TN + '@t.test'}, 'TRAINEE', ${ORG_A}, true, ${monthsAgo(2)}, 2)`;
        await sql`insert into organization_catalogs (organization_id, training_catalog_id, is_enabled)
                  values (${ORG_A}, ${FIAE_DEFAULT}, true) on conflict do nothing`;
        try {
          asUser(superAdmin());
          const before = await call(route.enrollment, enrollmentUrl(TN), {
            ctx: { userId: TN },
          });
          expect(before.body).toMatchObject({
            enrollments: [],
            isImplicit: true,
            effectiveCatalogId: FIAE_DEFAULT,
          });
          const res = await call(route.enrollment, enrollmentUrl(TN), {
            method: 'PUT',
            // a start date long before the profile start must not make KfBM the first
            body: { catalogId: CAT_K, startDate: '2000-01-01' },
            ctx: { userId: TN },
          });
          expect(res.status).toBe(200);
          expect(res.body).toMatchObject({ changed: true, enrollmentCount: 2 });
          // FIAE stays the first, KfBM comes second, both with the profile terms
          expect(res.body.enrollments.map((e: any) => e.code)).toEqual([
            'FIAE',
            'ME1K',
          ]);
          expect(res.body.effectiveCatalogId).toBe(FIAE_DEFAULT);
          expect(res.body.enrollments.map((e: any) => e.durationYears)).toEqual([
            2, 2,
          ]);
          expect(res.body.isImplicit).toBe(false);
        } finally {
          await sql`delete from trainee_enrollments where trainee_id = ${TN}`;
          await sql`delete from course_members where user_id = ${TN}`;
          await sql`delete from quiz_assignments where trainee_id = ${TN}`;
          await sql`delete from profiles where id = ${TN}`;
          await sql`delete from auth.users where id = ${TN}`;
          await sql`delete from organization_catalogs where organization_id = ${ORG_A} and training_catalog_id = ${FIAE_DEFAULT}`;
        }
      });

      it('adding the same training again changes nothing', async () => {
        asUser(superAdmin());
        const rowsBefore = await sql`select count(*)::int as n from course_members where user_id = ${TF}`;
        const res = await call(route.enrollment, enrollmentUrl(TF), {
          method: 'PUT',
          body: { catalogId: CAT_K },
          ctx: { userId: TF },
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ changed: false, enrollmentCount: 2 });
        expect(res.body.contentSync).toBeUndefined();
        const rowsAfter = await sql`select count(*)::int as n from course_members where user_id = ${TF}`;
        expect(rowsAfter[0].n).toBe(rowsBefore[0].n);
      });

      it('a second training with its own start date is assigned by ITS phase', async () => {
        // TB is in KfBM only (profile start 3 years ago). Its FIAE enrollment
        // is the second one, KfBM stays the first. Adding FIAE with a start
        // date of one month ago changes nothing for KfBM, FIAE gets nothing to
        // assign (its courses are not linked to components)
        asUser(superAdmin());
        const res = await call(route.enrollment, enrollmentUrl(TB), {
          method: 'PUT',
          body: { catalogId: CAT_F, startDate: monthsAgo(1), durationYears: 2 },
          ctx: { userId: TB },
        });
        // FIAE is not enabled for org B: refused, nothing written
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('CATALOG_NOT_ENABLED');
        expect(await enrollmentsOf(TB)).toEqual(['ME1K']);

        // enable it and add it with its own terms
        await sql`insert into organization_catalogs (organization_id, training_catalog_id, is_enabled) values (${ORG_B}, ${CAT_F}, true)`;
        const ok = await call(route.enrollment, enrollmentUrl(TB), {
          method: 'PUT',
          body: { catalogId: CAT_F, startDate: monthsAgo(1), durationYears: 2 },
          ctx: { userId: TB },
        });
        expect(ok.status).toBe(200);
        const row = (
          await sql`select start_date::text as s, duration_years from trainee_enrollments where trainee_id = ${TB} and training_catalog_id = ${CAT_F}`
        )[0];
        expect(row).toMatchObject({ s: monthsAgo(1), duration_years: 2 });
        await sql`delete from trainee_enrollments where trainee_id = ${TB} and training_catalog_id = ${CAT_F}`;
        await sql`delete from organization_catalogs where organization_id = ${ORG_B} and training_catalog_id = ${CAT_F}`;
      });

      it('per enrollment: the phase of each training comes from its own start date', async () => {
        const { syncCatalogTraineeContent } =
          await import('@/lib/catalog/trainee-content');
        // TM: profile start 36 months ago, KfBM start one month ago. TM is the
        // second enrollment of KfBM, so its own start counts: phase 1. Take
        // the KfBM rows of TM away first, so the plan has something to add.
        await sql`delete from course_members where user_id = ${TM} and course_id in (${COURSE.k1}, ${COURSE.k2}, ${COURSE.w1})`;
        await sql`delete from quiz_assignments where trainee_id = ${TM} and quiz_id in (${QUIZ.k1}, ${QUIZ.k2})`;
        const dry = await syncCatalogTraineeContent(db, {
          catalogId: CAT_K,
          actorId: SA,
          execute: false,
          traineeId: TM,
        });
        expect(dry?.details[0]?.phase).toBe(1);
        // phase 1 course, the elective course TM chose, the quiz of phase 1
        expect(dry).toMatchObject({
          courseMembersMissing: 2,
          quizAssignmentsMissing: 1,
        });
        // TK has only KfBM, the profile counts (36 months ago): phase 2
        const dryTk = await syncCatalogTraineeContent(db, {
          catalogId: CAT_K,
          actorId: SA,
          execute: false,
          traineeId: TK,
        });
        expect(dryTk?.details[0]?.phase).toBe(2);
        expect(dryTk).toMatchObject({
          courseMembersMissing: 1,
          quizAssignmentsMissing: 1,
        });
        // a trial run writes nothing
        expect(
          await sql`select 1 from course_members where user_id = ${TM} and course_id = ${COURSE.k1}`
        ).toHaveLength(0);
      });

      it('removing needs the confirmation, removes only the enrollment, never the last one', async () => {
        asUser(superAdmin());
        const members = async () =>
          Number(
            (
              await sql`select count(*)::int as n from course_members where user_id = ${TM}`
            )[0].n
          );
        const assignments = async () =>
          Number(
            (
              await sql`select count(*)::int as n from quiz_assignments where trainee_id = ${TM}`
            )[0].n
          );
        const choices = async () =>
          Number(
            (
              await sql`select count(*)::int as n from trainee_elective_choices where enrollment_id = ${ENROLL.tmK}`
            )[0].n
          );
        const before = {
          members: await members(),
          assignments: await assignments(),
          choices: await choices(),
        };
        expect(before.choices).toBe(1);

        const refused = await call(route.enrollment, enrollmentUrl(TM), {
          method: 'DELETE',
          body: { catalogId: CAT_K },
          ctx: { userId: TM },
        });
        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('CONFIRMATION_REQUIRED');
        expect(await enrollmentsOf(TM)).toEqual(['ME1F', 'ME1K']);

        const removed = await call(route.enrollment, enrollmentUrl(TM), {
          method: 'DELETE',
          body: { catalogId: CAT_K, confirm: true },
          ctx: { userId: TM },
        });
        expect(removed.status).toBe(200);
        expect(removed.body).toMatchObject({ removed: CAT_K, remaining: 1 });
        expect(await enrollmentsOf(TM)).toEqual(['ME1F']);
        // memberships and assignments stay, the elective choices of the
        // enrollment lapse with it
        expect(await members()).toBe(before.members);
        expect(await assignments()).toBe(before.assignments);
        expect(await choices()).toBe(0);
        // the profile is untouched
        expect(
          (await sql`select role from profiles where id = ${TM}`)[0].role
        ).toBe('TRAINEE');

        // the content of the removed training is no longer shown, a choice of
        // it is refused
        asUser(trainee(TM));
        const gone = await call(route.courses, '/api/trainee/courses', {
          header: 'ME1K',
        });
        expect(gone.status).toBe(403);
        const left = await call(route.courses, '/api/trainee/courses');
        expect(left.body.courses.map((c: any) => c.id)).toEqual([COURSE.f]);

        // the last enrollment cannot go
        asUser(superAdmin());
        const last = await call(route.enrollment, enrollmentUrl(TM), {
          method: 'DELETE',
          body: { catalogId: CAT_F, confirm: true },
          ctx: { userId: TM },
        });
        expect(last.status).toBe(409);
        expect(last.body.code).toBe('LAST_ENROLLMENT');
        expect(await enrollmentsOf(TM)).toEqual(['ME1F']);

        // bring KfBM back: the memberships are still there, nothing doubles
        const again = await call(route.enrollment, enrollmentUrl(TM), {
          method: 'PUT',
          body: { catalogId: CAT_K },
          ctx: { userId: TM },
        });
        expect(again.status).toBe(200);
        expect(await enrollmentsOf(TM)).toEqual(['ME1F', 'ME1K']);
        expect(await members()).toBeGreaterThanOrEqual(before.members);
      });

      it('removing the FIRST training lets the profile take over the dates of the next one', async () => {
        const TX = id(27);
        await sql`insert into auth.users (id, email) values (${TX}, ${TX + '@t.test'}) on conflict (id) do nothing`;
        await sql`insert into profiles (id, email, role, organization_id, is_active, start_of_training_date, ausbildung_duration_years)
                  values (${TX}, ${TX + '@t.test'}, 'TRAINEE', ${ORG_A}, true, ${monthsAgo(36)}, 3)`;
        await enroll(id(406), TX, CAT_F, '2026-09-01T08:00:00Z', monthsAgo(36), 3);
        await enroll(id(407), TX, CAT_K, '2026-10-01T08:00:00Z', monthsAgo(1), 2);
        try {
          asUser(superAdmin());
          // removing the second one leaves the profile alone
          const keep = await call(route.enrollment, enrollmentUrl(TX), {
            method: 'DELETE',
            body: { catalogId: CAT_K, confirm: true },
            ctx: { userId: TX },
          });
          expect(keep.status).toBe(200);
          expect(
            (await sql`select start_of_training_date::date::text as s, ausbildung_duration_years as d from profiles where id = ${TX}`)[0]
          ).toMatchObject({ s: monthsAgo(36), d: 3 });
          // back to two, then remove the first
          await enroll(id(408), TX, CAT_K, '2026-10-02T08:00:00Z', monthsAgo(1), 2);
          const res = await call(route.enrollment, enrollmentUrl(TX), {
            method: 'DELETE',
            body: { catalogId: CAT_F, confirm: true },
            ctx: { userId: TX },
          });
          expect(res.status).toBe(200);
          expect(await enrollmentsOf(TX)).toEqual(['ME1K']);
          expect(
            (await sql`select start_of_training_date::date::text as s, ausbildung_duration_years as d from profiles where id = ${TX}`)[0]
          ).toMatchObject({ s: monthsAgo(1), d: 2 });
        } finally {
          await sql`delete from trainee_enrollments where trainee_id = ${TX}`;
          await sql`delete from profiles where id = ${TX}`;
          await sql`delete from auth.users where id = ${TX}`;
        }
      });

      it('only the platform admin writes: org admin, trainer, trainee get 403, anonymous 401', async () => {
        const writes = [
          { method: 'PUT', body: { catalogId: CAT_K } },
          { method: 'DELETE', body: { catalogId: CAT_K, confirm: true } },
        ];
        const snapshot = await enrollmentsOf(TK);
        for (const [who, session] of [
          ['org admin', orgAdmin()],
          ['trainer', trainer()],
          ['trainee (self)', trainee(TK)],
        ] as const) {
          asUser(session);
          for (const w of writes) {
            const res = await call(route.enrollment, enrollmentUrl(TK), {
              ...w,
              ctx: { userId: TK },
            });
            expect([who, res.status]).toEqual([who, 403]);
          }
        }
        asUser(null);
        for (const w of writes) {
          const res = await call(route.enrollment, enrollmentUrl(TK), {
            ...w,
            ctx: { userId: TK },
          });
          expect(res.status).toBe(401);
        }
        expect(await enrollmentsOf(TK)).toEqual(snapshot);
      });

      it('an org admin reads the trainings of a trainee of the own organization only', async () => {
        asUser(orgAdmin());
        const own = await call(route.enrollment, enrollmentUrl(TK), {
          ctx: { userId: TK },
        });
        expect(own.status).toBe(200);
        expect(own.body.enrollments.map((e: any) => e.code)).toEqual(['ME1K']);
        const foreign = await call(route.enrollment, enrollmentUrl(TB), {
          ctx: { userId: TB },
        });
        expect(foreign.status).toBe(404);
      });
    });

    describe('numbers', () => {
      it('the user list shows every training of a trainee', async () => {
        asUser(superAdmin());
        const res = await call(route.users, '/api/admin/users');
        expect(res.status).toBe(200);
        const byId = Object.fromEntries(
          res.body.users.map((u: any) => [u.id, u])
        );
        expect(byId[TM].trainingCatalogCodes).toEqual(['ME1F', 'ME1K']);
        expect(byId[TM].trainingCatalogCode).toBe('ME1F');
        expect(byId[TK].trainingCatalogCodes).toEqual(['ME1K']);
        expect(byId[TRAINER_A].trainingCatalogCodes).toBeNull();
      });

      it('counts a trainee once per training and takes one seat', async () => {
        const { listOrganizationCatalogs } = await import('@/lib/catalog/admin');
        const { loadSeatUsage } = await import('@/lib/admin/seats');
        const catalogs = await listOrganizationCatalogs(ORG_A, {
          includeInactive: true,
        });
        const count = (code: string) =>
          catalogs.find(c => c.code === code)?.traineeCount;
        // org A trainees: TM (FIAE + KfBM), TK (KfBM), TF (FIAE + KfBM)
        expect(count('ME1F')).toBe(2);
        expect(count('ME1K')).toBe(3);
        const seats = await loadSeatUsage(db as never, ORG_A);
        // three trainee accounts, whatever the number of enrollments (5)
        expect(seats?.trainees).toBe(3);
        const enrollments = await sql`select count(*)::int as n from trainee_enrollments e join profiles p on p.id = e.trainee_id where p.organization_id = ${ORG_A}`;
        expect(enrollments[0].n).toBe(5);
      });
    });

    describe('the hand-over of the enrollments at the first login (merge of profiles)', () => {
      const cases: {
        name: string;
        old: ('F' | 'K')[];
        next: ('F' | 'K')[];
        expected: ('F' | 'K')[];
        /** The catalogs whose row on the new profile must be the row of the old profile. */
        fromOld?: ('F' | 'K')[];
      }[] = [
        { name: 'old KfBM replaces the default FIAE', old: ['K'], next: ['F'], expected: ['K'], fromOld: ['K'] },
        { name: 'old FIAE alone never joins a deliberate KfBM', old: ['F'], next: ['K'], expected: ['K'] },
        { name: 'two old enrollments move to a profile without any', old: ['F', 'K'], next: [], expected: ['F', 'K'], fromOld: ['F', 'K'] },
        { name: 'two old enrollments replace the same catalog and bring the other', old: ['F', 'K'], next: ['F'], expected: ['F', 'K'], fromOld: ['F', 'K'] },
        { name: 'the same catalog: the old row wins as a whole', old: ['K'], next: ['K'], expected: ['K'], fromOld: ['K'] },
        { name: 'old FIAE moves to a profile without any', old: ['F'], next: [], expected: ['F'], fromOld: ['F'] },
        { name: 'old FIAE replaces the new FIAE', old: ['F'], next: ['F'], expected: ['F'], fromOld: ['F'] },
        { name: 'old KfBM wins over FIAE and KfBM of the new profile', old: ['K'], next: ['F', 'K'], expected: ['K'], fromOld: ['K'] },
        { name: 'nothing to hand over keeps the new profile as it is', old: [], next: ['K'], expected: ['K'] },
        { name: 'both old enrollments, new has KfBM only', old: ['F', 'K'], next: ['K'], expected: ['F', 'K'], fromOld: ['F', 'K'] },
      ];

      it.each(cases.map((c, index) => [c.name, c, index] as const))(
        '%s',
        async (_name, c, index) => {
          const { mergeProfileReferences } = await import('@/lib/profile-identity');
          // the merge treats the REAL FIAE catalog as the default, so F is it
          const catalogOf = { F: FIAE_DEFAULT, K: CAT_K } as const;
          const oldId = id(900 + index * 2);
          const newId = id(901 + index * 2);
          for (const uid of [oldId, newId]) {
            await sql`insert into auth.users (id, email) values (${uid}, ${uid + '@t.test'}) on conflict (id) do nothing`;
            await sql`insert into profiles (id, email, role, organization_id, is_active)
                      values (${uid}, ${uid + '@t.test'}, 'TRAINEE', ${ORG_A}, true)`;
          }
          const oldRows: Record<string, string> = {};
          const newRows: Record<string, string> = {};
          let n = 0;
          for (const code of c.old) {
            const rowId = id(5000 + index * 10 + n++);
            oldRows[code] = rowId;
            await enroll(rowId, oldId, catalogOf[code], '2026-08-01T08:00:00Z');
          }
          for (const code of c.next) {
            const rowId = id(5000 + index * 10 + n++);
            newRows[code] = rowId;
            await enroll(rowId, newId, catalogOf[code], '2026-10-01T08:00:00Z');
          }
          // an elective choice on the old KfBM row follows the row
          if (oldRows.K) {
            await sql`insert into trainee_elective_choices (enrollment_id, component_id, training_catalog_id)
                      values (${oldRows.K}, ${COMP.w1}, ${CAT_K})`;
          }

          await db.transaction(async tx => {
            await mergeProfileReferences(tx as never, oldId, newId);
          });

          const rows = await sql`select e.id, c.code from trainee_enrollments e join training_catalogs c on c.id = e.training_catalog_id
                                 where e.trainee_id = ${newId}`;
          const short = (code: string) => (code === 'FIAE' ? 'F' : 'K');
          expect(rows.map(r => short(r.code)).sort()).toEqual([...c.expected].sort());
          for (const code of c.fromOld ?? []) {
            const row = rows.find(r => short(r.code) === code);
            expect(row?.id).toBe(oldRows[code]);
          }
          if (oldRows.K && c.fromOld?.includes('K')) {
            const choices = await sql`select count(*)::int as n from trainee_elective_choices where enrollment_id = ${oldRows.K}`;
            expect(choices[0].n).toBe(1);
          }
          // a trainee has at most one row per catalog on both profiles
          const dup = await sql`select training_catalog_id from trainee_enrollments where trainee_id in (${oldId}, ${newId}) group by trainee_id, training_catalog_id having count(*) > 1`;
          expect(dup).toHaveLength(0);
        }
      );
    });
  });
}
