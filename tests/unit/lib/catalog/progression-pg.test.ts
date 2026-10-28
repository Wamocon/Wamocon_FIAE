/**
 * @jest-environment node
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { NextRequest } from 'next/server';

// The order of work against a REAL, LOCAL, throwaway PostgreSQL (the schema of
// the migrations up to 20261030000200): the real routes, the real loader and
// the real SQL. It only runs when PROGRESSION_TEST_DB names such a database,
// for example
//
//   PROGRESSION_TEST_DB=postgresql://postgres:pw@127.0.0.1:54361/sq2_t
//
// It refuses every host but the own machine and only touches its own rows
// (catalog SQ2, the organizations and users below), removed again.

const url = process.env.PROGRESSION_TEST_DB;

function assertLocal(connection: string) {
  const host = new URL(connection).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error('PROGRESSION_TEST_DB must point at a database on this machine');
  }
}

const id = (n: number) =>
  `f5000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CAT = id(1);
const ORG_A = id(10);
const ORG_B = id(11);
const ORG_PLATFORM = id(12);
const ADMIN = id(20);
const TRAINER_A = id(21);
const TRAINER_B = id(22);
const TNEW = id(31); // joined after the cut-off date: the order applies
const TNEW2 = id(32); // the same, for the exception
const TOLD = id(33); // joined before the cut-off date: grandfathered
const COURSE = id(101);
const COURSE_INACTIVE = id(102);
const E1 = id(201);
const E2 = id(202);
const E3 = id(203); // inactive
const Q1 = id(301); // LOW of E1
const Q2 = id(302); // LOW of E2
const Q3 = id(303); // MEDIUM of E2
const UC = id(401); // use case of E2
const SINCE = '2026-11-01T00:00:00.000Z';

if (!url) {
  describe.skip('order of work: postgres (set PROGRESSION_TEST_DB)', () => {
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
  const trainerSession = (userId: string, org: string) =>
    sessionOf(userId, org, { role: 'TRAINER', isTrainerLevel: true });
  const adminSession = () =>
    sessionOf(ADMIN, ORG_PLATFORM, {
      role: 'SUPER_ADMIN',
      isSuperAdmin: true,
      isAdmin: true,
      isTrainerLevel: true,
      isPlatformOwner: true,
    });

  jest.mock('@/db', () => ({
    __esModule: true,
    get default() {
      return (globalThis as { __sq2db?: unknown }).__sq2db;
    },
  }));
  jest.mock('@/lib/auth/session', () => {
    const actual = jest.requireActual('@/lib/auth/session');
    const { NextResponse } = jest.requireActual('next/server');
    const who = () =>
      (globalThis as { __sq2session?: Record<string, unknown> | null })
        .__sq2session ?? null;
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
  jest.mock('@/lib/auth/activity-report-access', () => {
    const actual = jest.requireActual('@/lib/auth/activity-report-access');
    const { NextResponse } = jest.requireActual('next/server');
    return {
      ...actual,
      requireTraineeSession: async () => {
        const s = (globalThis as { __sq2session?: any }).__sq2session ?? null;
        return s
          ? s
          : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      },
    };
  });

  const asUser = (s: Record<string, unknown> | null) => {
    (globalThis as { __sq2session?: unknown }).__sq2session = s;
  };

  async function cleanup() {
    await sql`delete from activity_log where organization_id::text like 'f5000000-%'`;
    await sql`delete from notifications where organization_id::text like 'f5000000-%'`;
    await sql`delete from quiz_submissions where trainee_id::text like 'f5000000-%'`;
    await sql`delete from enabler_submissions where trainee_id::text like 'f5000000-%'`;
    await sql`delete from use_case_submissions where trainee_id::text like 'f5000000-%'`;
    await sql`delete from trainee_enabler_overrides where trainee_id::text like 'f5000000-%'`;
    await sql`delete from course_members where user_id::text like 'f5000000-%'`;
    await sql`delete from trainee_enrollments where trainee_id::text like 'f5000000-%'`;
    await sql`delete from quizzes where training_catalog_id = ${CAT}`;
    await sql`delete from courses where training_catalog_id = ${CAT}`;
    await sql`delete from organization_catalogs where organization_id::text like 'f5000000-%'`;
    await sql`delete from profiles where id::text like 'f5000000-%'`;
    await sql`delete from auth.users where id::text like 'f5000000-%'`;
    await sql`delete from organizations where id::text like 'f5000000-%'`;
    await sql`delete from training_catalogs where id = ${CAT}`;
  }

  async function seed() {
    await cleanup();
    for (const [orgId, name] of [
      [ORG_A, 'SQ2 Org A'],
      [ORG_B, 'SQ2 Org B'],
      [ORG_PLATFORM, 'SQ2 Plattform'],
    ]) {
      await sql`insert into organizations (id, name, slug, subscription_plan, max_trainee_seats, max_trainer_seats, is_platform_owner)
                values (${orgId}, ${name}, ${'sq2-' + orgId.slice(-2)}, 'PRO', 20, 20, ${orgId === ORG_PLATFORM})`;
    }
    // The settings carry another key too: the save of the cut-off date must keep it
    await sql`insert into training_catalogs (id, code, title, is_active, settings)
              values (${CAT}, 'SQ2', 'SQ2 Beruf', true, ${JSON.stringify({ content_targets: { enablers: 3 } })}::jsonb)`;
    await sql`insert into organization_catalogs (organization_id, training_catalog_id, is_enabled)
              values (${ORG_A}, ${CAT}, true), (${ORG_B}, ${CAT}, true), (${ORG_PLATFORM}, ${CAT}, true)`;
    const people: [string, string, string][] = [
      [ADMIN, 'SUPER_ADMIN', ORG_PLATFORM],
      [TRAINER_A, 'TRAINER', ORG_A],
      [TRAINER_B, 'TRAINER', ORG_B],
      [TNEW, 'TRAINEE', ORG_A],
      [TNEW2, 'TRAINEE', ORG_A],
      [TOLD, 'TRAINEE', ORG_A],
    ];
    for (const [uid, role, org] of people) {
      await sql`insert into auth.users (id, email) values (${uid}, ${uid + '@t.test'}) on conflict (id) do nothing`;
      await sql`insert into profiles (id, email, role, organization_id, is_active, trainer_activated, start_of_training_date, ausbildung_duration_years)
                values (${uid}, ${uid + '@t.test'}, ${role}, ${org}, true, true, '2026-09-01', 3)`;
    }
    await sql`insert into trainee_enrollments (trainee_id, training_catalog_id, start_date, duration_years, created_at)
              values (${TNEW}, ${CAT}, '2026-09-01', 3, '2026-11-05T08:00:00Z'),
                     (${TNEW2}, ${CAT}, '2026-09-01', 3, '2026-11-06T08:00:00Z'),
                     (${TOLD}, ${CAT}, '2026-09-01', 3, '2026-10-05T08:00:00Z')`;
    await sql`insert into courses (id, training_catalog_id, code, title, created_by_id, is_active, year)
              values (${COURSE}, ${CAT}, 'C1', 'Kurs eins', ${ADMIN}, true, 1),
                     (${COURSE_INACTIVE}, ${CAT}, 'C2', 'Kurs inaktiv', ${ADMIN}, false, 1)`;
    await sql`insert into course_members (course_id, user_id, role, organization_id)
              select c, u, 'TRAINEE', ${ORG_A} from (values (${COURSE}::uuid), (${COURSE_INACTIVE}::uuid)) a(c),
                (values (${TNEW}::uuid), (${TNEW2}::uuid), (${TOLD}::uuid)) b(u)`;
    await sql`insert into enablers (id, course_id, code, title, order_index, is_active, description_text)
              values (${E1}, ${COURSE}, 'E1', 'Enabler Eins', 1, true, 'Material eins'),
                     (${E2}, ${COURSE}, 'E2', 'Enabler Zwei', 2, true, 'Material zwei'),
                     (${E3}, ${COURSE}, 'E3', 'Enabler Drei', 3, false, 'inaktiv')`;
    await sql`insert into use_cases (id, course_id, enabler_id, code, title, description_text, order_index, is_active)
              values (${UC}, ${COURSE}, ${E2}, 'U1', 'Use Case zwei', 'Aufgabe', 1, true)`;
    for (const [qid, code] of [
      [Q1, 'QA'],
      [Q2, 'QB'],
      [Q3, 'QC'],
    ]) {
      await sql`insert into quizzes (id, training_catalog_id, code, title, quiz_type, created_by_id, is_active)
                values (${qid}, ${CAT}, ${code}, ${'Quiz ' + code}, 'LESSON', ${ADMIN}, true)`;
      const q = (
        await sql`insert into questions (quiz_id, question_text, order_index)
                  values (${qid}, ${'Frage ' + code}, 1) returning id`
      )[0].id as string;
      await sql`insert into options (question_id, option_text, is_correct, explanation, order_index)
                values (${q}, 'richtig', true, 'GEHEIME-BEGRUENDUNG', 1), (${q}, 'falsch', false, null, 2)`;
    }
    await sql`insert into enabler_quiz_links (enabler_id, quiz_id, difficulty)
              values (${E1}, ${Q1}, 'LOW'), (${E2}, ${Q2}, 'LOW'), (${E2}, ${Q3}, 'MEDIUM')`;
    await asCatalog(SINCE);
  }

  async function asCatalog(since: string | null) {
    if (since === null)
      await sql`update training_catalogs set settings = settings - 'sequence_since' where id = ${CAT}`;
    else
      await sql`update training_catalogs set settings = jsonb_set(settings, '{sequence_since}', ${JSON.stringify(since)}::jsonb, true) where id = ${CAT}`;
  }

  const answersOf = async (quizId: string, right: boolean) => {
    const rows = await sql`
      select q.id as qid, o.id as oid from questions q
      join options o on o.question_id = q.id
      where q.quiz_id = ${quizId} and o.is_correct = ${right}`;
    return rows.map(r => ({ questionId: r.qid, selectedOptionId: r.oid }));
  };

  const call = async (
    load: () => Promise<any>,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    path: string,
    ctx?: Record<string, string>,
    body?: unknown
  ) => {
    const mod = await load();
    const request = new NextRequest(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await mod[method](
      request,
      ctx ? { params: Promise.resolve(ctx) } : undefined
    );
    return { status: res.status as number, body: await res.json() };
  };
  const route = {
    course: () => import('@/app/api/trainee/courses/[courseId]/route'),
    courses: () => import('@/app/api/trainee/courses/route'),
    enabler: () => import('@/app/api/trainee/enablers/[enablerId]/route'),
    enablerSubmit: () =>
      import('@/app/api/trainee/enablers/[enablerId]/submit/route'),
    difficulty: () =>
      import('@/app/api/trainee/enablers/[enablerId]/quizzes/[difficulty]/route'),
    list: () => import('@/app/api/trainee/enablers/[enablerId]/quizzes/route'),
    quizSubmit: () => import('@/app/api/trainee/quizzes/[quizId]/submit/route'),
    useCaseSubmit: () =>
      import('@/app/api/trainee/use-cases/[useCaseId]/submit/route'),
    activate: () =>
      import('@/app/api/trainer/trainees/[traineeId]/activate/route'),
    overview: () =>
      import('@/app/api/trainer/trainees/[traineeId]/overview/route'),
    rule: () => import('@/app/api/admin/catalogs/[catalogId]/sequence-rule/route'),
  };

  const stateMap = (body: any) =>
    Object.fromEntries(body.enablers.map((e: any) => [e.id, e.state]));
  const count = async (query: Promise<any[]>) => Number((await query)[0].n);

  describe('order of work against postgres', () => {
    beforeAll(async () => {
      (globalThis as { __sq2db?: unknown }).__sq2db = db;
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await seed();
    });
    afterAll(async () => {
      await cleanup();
      await client.end();
    });

    it('the list of the course shows everything: the first enabler open, the next ones locked (the inactive one is not there)', async () => {
      asUser(sessionOf(TNEW, ORG_A));
      const r = await call(route.course, 'GET', `/api/trainee/courses/${COURSE}`, {
        courseId: COURSE,
      });
      expect(r.status).toBe(200);
      expect(r.body.enablers.map((e: any) => e.id)).toEqual([E1, E2]);
      expect(stateMap(r.body)).toEqual({ [E1]: 'open', [E2]: 'locked' });
      expect(r.body.enablers[1]).toMatchObject({
        lockReason: 'SEQUENCE',
        lockedBy: { id: E1, title: 'Enabler Eins' },
      });
    });

    it('Lernen does not list an inactive course', async () => {
      asUser(sessionOf(TNEW, ORG_A));
      const r = await call(route.courses, 'GET', '/api/trainee/courses');
      expect(r.body.courses.map((c: any) => c.id)).toEqual([COURSE]);
    });

    it('a locked enabler gives title and material, but no questions and no submission', async () => {
      asUser(sessionOf(TNEW, ORG_A));
      const detail = await call(route.enabler, 'GET', `/api/trainee/enablers/${E2}`, {
        enablerId: E2,
      });
      expect(detail.status).toBe(200);
      expect(detail.body.enabler).toMatchObject({
        title: 'Enabler Zwei',
        descriptionText: 'Material zwei',
      });
      expect(detail.body.progression).toMatchObject({ state: 'locked' });

      const questions = await call(
        route.difficulty,
        'GET',
        `/api/trainee/enablers/${E2}/quizzes/LOW`,
        { enablerId: E2, difficulty: 'LOW' }
      );
      expect(questions.status).toBe(403);
      expect(questions.body.code).toBe('ENABLER_LOCKED');
      expect(JSON.stringify(questions.body)).not.toContain('Frage');

      const list = await call(route.list, 'GET', `/api/trainee/enablers/${E2}/quizzes`, {
        enablerId: E2,
      });
      expect(list.body.enablerLocked).toBe(true);
      expect(list.body.quizzes.every((q: any) => !q.unlocked)).toBe(true);

      const submit = await call(
        route.enablerSubmit,
        'POST',
        `/api/trainee/enablers/${E2}/submit`,
        { enablerId: E2 },
        { solutionText: 'meine Loesung' }
      );
      expect(submit.status).toBe(403);
      expect(submit.body).toMatchObject({
        code: 'ENABLER_LOCKED',
        lockedBy: { id: E1 },
      });

      const attempt = await call(
        route.quizSubmit,
        'POST',
        `/api/trainee/quizzes/${Q2}/submit`,
        { quizId: Q2 },
        { answers: await answersOf(Q2, true) }
      );
      expect(attempt.status).toBe(403);
      expect(JSON.stringify(attempt.body)).not.toContain('GEHEIME');

      const useCase = await call(
        route.useCaseSubmit,
        'POST',
        `/api/trainee/use-cases/${UC}/submit`,
        { useCaseId: UC },
        { submissionText: 'x' }
      );
      expect(useCase.status).toBe(403);

      expect(
        await count(sql`select count(*)::int as n from enabler_submissions where trainee_id = ${TNEW}`)
      ).toBe(0);
      expect(
        await count(sql`select count(*)::int as n from quiz_submissions where trainee_id = ${TNEW}`)
      ).toBe(0);
      expect(
        await count(sql`select count(*)::int as n from use_case_submissions where trainee_id = ${TNEW}`)
      ).toBe(0);
    });

    it('a failed quiz is repeated, a pass opens the next enabler, a passed quiz stays', async () => {
      asUser(sessionOf(TNEW, ORG_A));
      const post = (right: boolean) => async () =>
        call(
          route.quizSubmit,
          'POST',
          `/api/trainee/quizzes/${Q1}/submit`,
          { quizId: Q1 },
          { answers: await answersOf(Q1, right) }
        );
      const first = await post(false)();
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ score: 0, locked: false });
      let course = await call(route.course, 'GET', `/api/trainee/courses/${COURSE}`, {
        courseId: COURSE,
      });
      expect(stateMap(course.body)).toEqual({ [E1]: 'open', [E2]: 'locked' });

      const second = await post(true)();
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ score: 100, locked: false });
      course = await call(route.course, 'GET', `/api/trainee/courses/${COURSE}`, {
        courseId: COURSE,
      });
      expect(stateMap(course.body)).toEqual({ [E1]: 'completed', [E2]: 'open' });
      expect(
        await count(sql`select count(*)::int as n from quiz_submissions where trainee_id = ${TNEW} and quiz_id = ${Q1}`)
      ).toBe(2);

      // after the pass: no further attempt, the stored answers come back
      const third = await post(false)();
      expect(third.body.locked).toBe(true);
      expect(third.body.score).toBe(100);
      expect(
        await count(sql`select count(*)::int as n from quiz_submissions where trainee_id = ${TNEW} and quiz_id = ${Q1}`)
      ).toBe(2);

      // the enabler is open now: questions come, the scenario can be submitted
      const questions = await call(
        route.difficulty,
        'GET',
        `/api/trainee/enablers/${E2}/quizzes/LOW`,
        { enablerId: E2, difficulty: 'LOW' }
      );
      expect(questions.status).toBe(200);
      expect(JSON.stringify(questions.body)).not.toContain('GEHEIME');
      const submit = await call(
        route.enablerSubmit,
        'POST',
        `/api/trainee/enablers/${E2}/submit`,
        { enablerId: E2 },
        { solutionText: 'meine Loesung' }
      );
      expect(submit.status).toBe(200);
    });

    it('the chain LOW, MEDIUM is enforced on the server', async () => {
      asUser(sessionOf(TNEW, ORG_A));
      const medium = await call(
        route.difficulty,
        'GET',
        `/api/trainee/enablers/${E2}/quizzes/MEDIUM`,
        { enablerId: E2, difficulty: 'MEDIUM' }
      );
      expect(medium.status).toBe(403);
      expect(medium.body).toMatchObject({ code: 'QUIZ_LOCKED', after: 'LOW' });
      const attemptMedium = await call(
        route.quizSubmit,
        'POST',
        `/api/trainee/quizzes/${Q3}/submit`,
        { quizId: Q3 },
        { answers: await answersOf(Q3, true) }
      );
      expect(attemptMedium.status).toBe(403);
      expect(attemptMedium.body.code).toBe('QUIZ_LOCKED');

      // an attempt at LOW (wrong) opens MEDIUM
      const low = await call(
        route.quizSubmit,
        'POST',
        `/api/trainee/quizzes/${Q2}/submit`,
        { quizId: Q2 },
        { answers: await answersOf(Q2, false) }
      );
      expect(low.status).toBe(200);
      const mediumNow = await call(
        route.difficulty,
        'GET',
        `/api/trainee/enablers/${E2}/quizzes/MEDIUM`,
        { enablerId: E2, difficulty: 'MEDIUM' }
      );
      expect(mediumNow.status).toBe(200);
      const list = await call(route.list, 'GET', `/api/trainee/enablers/${E2}/quizzes`, {
        enablerId: E2,
      });
      const byDifficulty = Object.fromEntries(
        list.body.quizzes.map((q: any) => [q.difficulty, q])
      );
      expect(byDifficulty.LOW).toMatchObject({ completed: true, passed: false });
      expect(byDifficulty.MEDIUM).toMatchObject({ unlocked: true });
    });

    it('a trainee who joined before the cut-off date works as before (grandfathered)', async () => {
      asUser(sessionOf(TOLD, ORG_A));
      const course = await call(route.course, 'GET', `/api/trainee/courses/${COURSE}`, {
        courseId: COURSE,
      });
      expect(stateMap(course.body)).toEqual({ [E1]: 'open', [E2]: 'open' });
      const submit = await call(
        route.enablerSubmit,
        'POST',
        `/api/trainee/enablers/${E2}/submit`,
        { enablerId: E2 },
        { solutionText: 'vorab' }
      );
      expect(submit.status).toBe(200);
    });

    it('the exception of the trainer: release out of turn, lock, remove, with the log', async () => {
      const asTrainee = () => asUser(sessionOf(TNEW2, ORG_A));
      const patch = (isActive: boolean | null) => {
        asUser(trainerSession(TRAINER_A, ORG_A));
        return call(
          route.activate,
          'PATCH',
          `/api/trainer/trainees/${TNEW2}/activate`,
          { traineeId: TNEW2 },
          { itemType: 'ENABLER', itemId: E2, isActive }
        );
      };
      asTrainee();
      let course = await call(route.course, 'GET', `/api/trainee/courses/${COURSE}`, {
        courseId: COURSE,
      });
      expect(stateMap(course.body)[E2]).toBe('locked');

      expect((await patch(true)).status).toBe(200);
      asTrainee();
      course = await call(route.course, 'GET', `/api/trainee/courses/${COURSE}`, {
        courseId: COURSE,
      });
      expect(stateMap(course.body)).toEqual({ [E1]: 'open', [E2]: 'open' });

      // the trainer sees it in the overview
      asUser(trainerSession(TRAINER_A, ORG_A));
      const overview = await call(
        route.overview,
        'GET',
        `/api/trainer/trainees/${TNEW2}/overview`,
        { traineeId: TNEW2 }
      );
      const e2 = overview.body.enablers.find((e: any) => e.id === E2);
      expect(e2).toMatchObject({ override: true, state: 'open', sequenceEnforced: true });

      expect((await patch(false)).status).toBe(200);
      asTrainee();
      course = await call(route.course, 'GET', `/api/trainee/courses/${COURSE}`, {
        courseId: COURSE,
      });
      expect(course.body.enablers.find((e: any) => e.id === E2)).toMatchObject({
        state: 'locked',
        lockReason: 'MANUAL',
      });

      expect((await patch(null)).status).toBe(200);
      expect(
        await count(sql`select count(*)::int as n from trainee_enabler_overrides where trainee_id = ${TNEW2}`)
      ).toBe(0);
      const log = await sql`select user_id, organization_id, context from activity_log
                            where activity_type = 'TRAINEE_ENABLER_OVERRIDE' order by created_at`;
      expect(log).toHaveLength(3);
      expect(log.map(l => l.context.value)).toEqual([true, false, null]);
      expect(log.every(l => l.user_id === TRAINER_A && l.organization_id === ORG_A)).toBe(true);
    });

    it('a trainer of another organization changes nothing (404)', async () => {
      asUser(trainerSession(TRAINER_B, ORG_B));
      const r = await call(
        route.activate,
        'PATCH',
        `/api/trainer/trainees/${TNEW2}/activate`,
        { traineeId: TNEW2 },
        { itemType: 'ENABLER', itemId: E2, isActive: true }
      );
      expect(r.status).toBe(404);
      expect(
        await count(sql`select count(*)::int as n from trainee_enabler_overrides where trainee_id = ${TNEW2}`)
      ).toBe(0);
    });

    it('an enabler of a course the trainee does not work in is refused, a trainee without an organization too', async () => {
      await sql`delete from course_members where user_id = ${TNEW2} and course_id = ${COURSE}`;
      asUser(trainerSession(TRAINER_A, ORG_A));
      const notMember = await call(
        route.activate,
        'PATCH',
        `/api/trainer/trainees/${TNEW2}/activate`,
        { traineeId: TNEW2 },
        { itemType: 'ENABLER', itemId: E2, isActive: true }
      );
      expect(notMember.status).toBe(404);
      await sql`insert into course_members (course_id, user_id, role, organization_id) values (${COURSE}, ${TNEW2}, 'TRAINEE', ${ORG_A})`;

      // the super admin reaches a trainee without an organization, the write is refused
      await sql`update profiles set organization_id = null where id = ${TNEW2}`;
      asUser(adminSession());
      const noOrg = await call(
        route.activate,
        'PATCH',
        `/api/trainer/trainees/${TNEW2}/activate`,
        { traineeId: TNEW2 },
        { itemType: 'ENABLER', itemId: E2, isActive: true }
      );
      expect([404, 409]).toContain(noOrg.status);
      await sql`update profiles set organization_id = ${ORG_A} where id = ${TNEW2}`;
      expect(
        await count(sql`select count(*)::int as n from trainee_enabler_overrides where trainee_id = ${TNEW2}`)
      ).toBe(0);
    });

    it('the cut-off date is set by the platform admin only, keeps the other settings and is logged; without it the order is not in force', async () => {
      asUser(trainerSession(TRAINER_A, ORG_A));
      const denied = await call(
        route.rule,
        'PUT',
        `/api/admin/catalogs/${CAT}/sequence-rule`,
        { catalogId: CAT },
        { since: null }
      );
      expect(denied.status).toBe(403);

      asUser(adminSession());
      const off = await call(
        route.rule,
        'PUT',
        `/api/admin/catalogs/${CAT}/sequence-rule`,
        { catalogId: CAT },
        { since: null }
      );
      expect(off.body.since).toBeNull();
      const kept = await sql`select settings from training_catalogs where id = ${CAT}`;
      expect(kept[0].settings).toEqual({ content_targets: { enablers: 3 } });

      // not in force: even a trainee who joined late works as before
      asUser(sessionOf(TNEW, ORG_A));
      let course = await call(route.course, 'GET', `/api/trainee/courses/${COURSE}`, {
        courseId: COURSE,
      });
      expect(course.body.enablers.every((e: any) => e.state !== 'locked')).toBe(true);

      asUser(adminSession());
      const on = await call(
        route.rule,
        'PUT',
        `/api/admin/catalogs/${CAT}/sequence-rule`,
        { catalogId: CAT },
        { since: '2026-12-01' }
      );
      expect(on.body.since).toBe('2026-12-01T00:00:00.000Z');
      const stored = await sql`select settings from training_catalogs where id = ${CAT}`;
      expect(stored[0].settings).toEqual({
        content_targets: { enablers: 3 },
        sequence_since: '2026-12-01T00:00:00.000Z',
      });
      // a cut-off date after the join of TNEW: grandfathered now
      asUser(sessionOf(TNEW, ORG_A));
      course = await call(route.course, 'GET', `/api/trainee/courses/${COURSE}`, {
        courseId: COURSE,
      });
      expect(course.body.enablers.every((e: any) => e.state !== 'locked')).toBe(true);

      const log = await sql`select context from activity_log where activity_type = 'CATALOG_SEQUENCE_RULE' order by created_at`;
      expect(log.map(l => l.context.value)).toEqual([
        null,
        '2026-12-01T00:00:00.000Z',
      ]);
      await asCatalog(SINCE);
    });

    it('the progress of a course follows the quizzes alone, never a scenario', async () => {
      // TOLD passed no quiz but submitted a scenario: still nothing completed
      asUser(sessionOf(TOLD, ORG_A));
      const courses = await call(route.courses, 'GET', '/api/trainee/courses');
      expect(courses.body.courses[0]).toMatchObject({
        enablerCount: 2,
        completedCount: 0,
      });
    });
  });
}
