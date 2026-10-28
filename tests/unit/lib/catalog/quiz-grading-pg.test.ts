/**
 * @jest-environment node
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { NextRequest } from 'next/server';

// Which questions are graded, against a REAL, LOCAL, throwaway PostgreSQL (the
// schema of the migrations): the real routes, the real loader of the order of
// work and the real SQL. It only runs when PROGRESSION_TEST_DB names such a
// database, for example
//
//   PROGRESSION_TEST_DB=postgresql://postgres:pw@127.0.0.1:54371/fq1_t
//
// It refuses every host but the own machine and only touches its own rows
// (catalog FQ1, the organization and users below), removed again.

const url = process.env.PROGRESSION_TEST_DB;

function assertLocal(connection: string) {
  const host = new URL(connection).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(
      'PROGRESSION_TEST_DB must point at a database on this machine'
    );
  }
}

const id = (n: number) =>
  `f6000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CAT = id(1);
const ORG = id(10);
const ADMIN = id(20);
const TRAINEE = id(31); // joined after the cut-off date: the order applies
const COURSE = id(101);
const E1 = id(201); // quiz Q1: free text without an expected answer only
const E2 = id(202); // quiz Q2: choice, free text, free text with an answer
const E3 = id(203); // quiz Q3: choice only
const Q1 = id(301);
const Q2 = id(302);
const Q3 = id(303);
const SINCE = '2026-11-01T00:00:00.000Z';
const EXPECTED = 'GEHEIME-ERWARTETE-ANTWORT';

if (!url) {
  describe.skip('quiz grading: postgres (set PROGRESSION_TEST_DB)', () => {
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

  jest.mock('@/db', () => ({
    __esModule: true,
    get default() {
      return (globalThis as { __fq1db?: unknown }).__fq1db;
    },
  }));
  jest.mock('@/lib/auth/session', () => {
    const actual = jest.requireActual('@/lib/auth/session');
    const { NextResponse } = jest.requireActual('next/server');
    const who = () =>
      (globalThis as { __fq1session?: Record<string, unknown> | null })
        .__fq1session ?? null;
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
    };
  });

  const asTrainee = () => {
    (globalThis as { __fq1session?: unknown }).__fq1session = {
      id: TRAINEE,
      email: `${TRAINEE}@t.test`,
      fullName: 'Test',
      role: 'TRAINEE',
      organizationId: ORG,
      isPlatformOwner: false,
      isSuperAdmin: false,
      isAdmin: false,
      isTrainerLevel: false,
    };
  };

  async function cleanup() {
    await sql`delete from notifications where organization_id = ${ORG}`;
    await sql`delete from quiz_submissions where trainee_id = ${TRAINEE}`;
    await sql`delete from course_members where user_id::text like 'f6000000-%'`;
    await sql`delete from trainee_enrollments where trainee_id = ${TRAINEE}`;
    await sql`delete from quizzes where training_catalog_id = ${CAT}`;
    await sql`delete from courses where training_catalog_id = ${CAT}`;
    await sql`delete from organization_catalogs where organization_id = ${ORG}`;
    await sql`delete from profiles where id::text like 'f6000000-%'`;
    await sql`delete from auth.users where id::text like 'f6000000-%'`;
    await sql`delete from organizations where id = ${ORG}`;
    await sql`delete from training_catalogs where id = ${CAT}`;
  }

  async function question(
    quizId: string,
    order: number,
    type: 'MCQ' | 'TEXT',
    expectedAnswer: string | null
  ) {
    const row = (
      await sql`insert into questions (quiz_id, question_text, question_type, expected_answer, order_index)
                values (${quizId}, ${'Frage ' + order}, ${type}, ${expectedAnswer}, ${order}) returning id`
    )[0];
    if (type === 'MCQ') {
      await sql`insert into options (question_id, option_text, is_correct, explanation, order_index)
                values (${row.id}, 'richtig', true, 'GEHEIME-BEGRUENDUNG', 1), (${row.id}, 'falsch', false, null, 2)`;
    }
    return row.id as string;
  }

  async function seed() {
    await cleanup();
    await sql`insert into organizations (id, name, slug, subscription_plan, max_trainee_seats, max_trainer_seats, is_platform_owner)
              values (${ORG}, 'FQ1 Org', 'fq1-org', 'PRO', 20, 20, false)`;
    await sql`insert into training_catalogs (id, code, title, is_active, settings)
              values (${CAT}, 'FQ1', 'FQ1 Beruf', true, ${JSON.stringify({ sequence_since: SINCE })}::jsonb)`;
    await sql`insert into organization_catalogs (organization_id, training_catalog_id, is_enabled)
              values (${ORG}, ${CAT}, true)`;
    for (const [uid, role] of [
      [ADMIN, 'SUPER_ADMIN'],
      [TRAINEE, 'TRAINEE'],
    ]) {
      await sql`insert into auth.users (id, email) values (${uid}, ${uid + '@t.test'}) on conflict (id) do nothing`;
      await sql`insert into profiles (id, email, role, organization_id, is_active, trainer_activated, start_of_training_date, ausbildung_duration_years)
                values (${uid}, ${uid + '@t.test'}, ${role}, ${ORG}, true, true, '2026-09-01', 3)`;
    }
    await sql`insert into trainee_enrollments (trainee_id, training_catalog_id, start_date, duration_years, created_at)
              values (${TRAINEE}, ${CAT}, '2026-09-01', 3, '2026-11-05T08:00:00Z')`;
    await sql`insert into courses (id, training_catalog_id, code, title, created_by_id, is_active, year)
              values (${COURSE}, ${CAT}, 'C1', 'Kurs eins', ${ADMIN}, true, 1)`;
    await sql`insert into course_members (course_id, user_id, role, organization_id)
              values (${COURSE}, ${TRAINEE}, 'TRAINEE', ${ORG})`;
    await sql`insert into enablers (id, course_id, code, title, order_index, is_active, description_text)
              values (${E1}, ${COURSE}, 'E1', 'Enabler Eins', 1, true, 'Material eins'),
                     (${E2}, ${COURSE}, 'E2', 'Enabler Zwei', 2, true, 'Material zwei'),
                     (${E3}, ${COURSE}, 'E3', 'Enabler Drei', 3, true, 'Material drei')`;
    for (const [qid, code] of [
      [Q1, 'QA'],
      [Q2, 'QB'],
      [Q3, 'QC'],
    ]) {
      await sql`insert into quizzes (id, training_catalog_id, code, title, quiz_type, created_by_id, is_active)
                values (${qid}, ${CAT}, ${code}, ${'Quiz ' + code}, 'LESSON', ${ADMIN}, true)`;
    }
    // Q1: nothing to grade (a blank and a whitespace expected answer count as none)
    await question(Q1, 1, 'TEXT', null);
    await question(Q1, 2, 'TEXT', ' \n\t ');
    // Q2: one choice, one free text without, one free text with an expected answer
    await question(Q2, 1, 'MCQ', null);
    await question(Q2, 2, 'TEXT', null);
    await question(Q2, 3, 'TEXT', EXPECTED);
    // Q3: three choice questions
    await question(Q3, 1, 'MCQ', null);
    await question(Q3, 2, 'MCQ', null);
    await question(Q3, 3, 'MCQ', null);
    await sql`insert into enabler_quiz_links (enabler_id, quiz_id, difficulty)
              values (${E1}, ${Q1}, 'LOW'), (${E2}, ${Q2}, 'LOW'), (${E3}, ${Q3}, 'LOW')`;
  }

  const call = async (
    load: () => Promise<any>,
    method: 'GET' | 'POST',
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
    quizSubmit: () => import('@/app/api/trainee/quizzes/[quizId]/submit/route'),
    list: () => import('@/app/api/trainee/enablers/[enablerId]/quizzes/route'),
  };
  const states = async () => {
    const r = await call(
      route.course,
      'GET',
      `/api/trainee/courses/${COURSE}`,
      {
        courseId: COURSE,
      }
    );
    expect(r.status).toBe(200);
    return Object.fromEntries(r.body.enablers.map((e: any) => [e.id, e.state]));
  };
  const submit = (quizId: string, answers: unknown[]) =>
    call(
      route.quizSubmit,
      'POST',
      `/api/trainee/quizzes/${quizId}/submit`,
      { quizId },
      { answers }
    );
  const questionsOf = async (quizId: string) =>
    sql`select id, question_type, expected_answer from questions where quiz_id = ${quizId} order by order_index`;
  const optionOf = async (questionId: string, correct: boolean) =>
    (
      await sql`select id from options where question_id = ${questionId} and is_correct = ${correct}`
    )[0].id as string;
  const scoresOf = async (quizId: string) =>
    (
      await sql`select score from quiz_submissions where trainee_id = ${TRAINEE} and quiz_id = ${quizId} order by attempt_number`
    ).map(r => r.score as number | null);

  describe('quiz grading against postgres', () => {
    beforeAll(async () => {
      (globalThis as { __fq1db?: unknown }).__fq1db = db;
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await seed();
      asTrainee();
    });
    afterAll(async () => {
      await cleanup();
      await client.end();
    });

    it('an enabler whose only quiz has nothing to grade counts as completed, the next one is open', async () => {
      expect(await states()).toEqual({
        [E1]: 'completed',
        [E2]: 'open',
        [E3]: 'locked',
      });
    });

    it('any text for the questions without an expected answer gives no score and is stored', async () => {
      const [a, b] = await questionsOf(Q1);
      const r = await submit(Q1, [
        { questionId: a.id, textAnswer: 'asdf' },
        { questionId: b.id, textAnswer: 'qwer' },
      ]);
      expect(r.status).toBe(200);
      expect(r.body.score).toBeNull();
      expect(r.body.autoGraded).toBe(false);
      expect(r.body.ungradedCount).toBe(2);
      expect(r.body.feedback.every((f: any) => f.graded === false)).toBe(true);
      expect(await scoresOf(Q1)).toEqual([null]);
      const stored = await sql`
        select a.text_answer from quiz_submission_answers a
        join quiz_submissions s on s.id = a.submission_id
        where s.trainee_id = ${TRAINEE} and s.quiz_id = ${Q1} order by a.text_answer`;
      expect(stored.map(r => r.text_answer)).toEqual(['asdf', 'qwer']);
      // the state of the order does not change by handing in text
      expect(await states()).toEqual({
        [E1]: 'completed',
        [E2]: 'open',
        [E3]: 'locked',
      });
    });

    it('the list of the quizzes says which quiz is not graded automatically', async () => {
      const r = await call(
        route.list,
        'GET',
        `/api/trainee/enablers/${E1}/quizzes`,
        { enablerId: E1 }
      );
      expect(r.status).toBe(200);
      expect(r.body.quizzes[0]).toMatchObject({
        quizId: Q1,
        autoGraded: false,
        passed: false,
        unlocked: true,
      });
      const r2 = await call(
        route.list,
        'GET',
        `/api/trainee/enablers/${E2}/quizzes`,
        { enablerId: E2 }
      );
      expect(r2.body.quizzes[0]).toMatchObject({
        quizId: Q2,
        autoGraded: true,
      });
    });

    it('a mixed quiz is graded on the questions with a solution only: a failed one keeps E3 locked and the key back', async () => {
      const [choice, free, withKey] = await questionsOf(Q2);
      const r = await submit(Q2, [
        {
          questionId: choice.id,
          selectedOptionId: await optionOf(choice.id, false),
        },
        { questionId: free.id, textAnswer: 'irgendwas' },
        { questionId: withKey.id, textAnswer: 'falsch' },
      ]);
      expect(r.status).toBe(200);
      // 0 of 2 graded (the free text without an answer stays out)
      expect(r.body.score).toBe(0);
      expect(r.body.ungradedCount).toBe(1);
      expect(JSON.stringify(r.body)).not.toContain(EXPECTED);
      expect(JSON.stringify(r.body)).not.toContain('GEHEIME');
      expect(await states()).toEqual({
        [E1]: 'completed',
        [E2]: 'open',
        [E3]: 'locked',
      });
    });

    it('50 percent of the graded questions pass the quiz and open E3, the expected answer comes with the pass', async () => {
      const [choice, free, withKey] = await questionsOf(Q2);
      const r = await submit(Q2, [
        {
          questionId: choice.id,
          selectedOptionId: await optionOf(choice.id, true),
        },
        { questionId: free.id, textAnswer: 'irgendwas' },
        { questionId: withKey.id, textAnswer: 'falsch' },
      ]);
      expect(r.status).toBe(200);
      // 1 of 2 graded questions
      expect(r.body.score).toBe(50);
      const fb = new Map<string, any>(
        r.body.feedback.map((f: any) => [f.questionId, f])
      );
      expect(fb.get(free.id)).toMatchObject({
        graded: false,
        correctAnswerText: null,
      });
      expect(fb.get(withKey.id)).toMatchObject({
        graded: true,
        correct: false,
        correctAnswerText: EXPECTED,
      });
      expect(await scoresOf(Q2)).toEqual([0, 50]);
      expect(await states()).toEqual({
        [E1]: 'completed',
        [E2]: 'completed',
        [E3]: 'open',
      });
    });

    it('a quiz of choice questions only is scored as before (2 of 3 is 67 percent)', async () => {
      const [a, b, c] = await questionsOf(Q3);
      const r = await submit(Q3, [
        { questionId: a.id, selectedOptionId: await optionOf(a.id, true) },
        { questionId: b.id, selectedOptionId: await optionOf(b.id, true) },
        { questionId: c.id, selectedOptionId: await optionOf(c.id, false) },
      ]);
      expect(r.status).toBe(200);
      expect(r.body.score).toBe(67);
      expect(r.body.autoGraded).toBe(true);
      expect(r.body.ungradedCount).toBe(0);
      expect(r.body.feedback.every((f: any) => f.graded === true)).toBe(true);
      expect(await scoresOf(Q3)).toEqual([67]);
      expect(await states()).toEqual({
        [E1]: 'completed',
        [E2]: 'completed',
        [E3]: 'completed',
      });
    });
  });
}
