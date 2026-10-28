/**
 * @jest-environment node
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  getContentStats,
  loadStatsRows,
  saveContentTargets,
  buildCatalogStats,
} from '@/lib/catalog/content-stats';

// The counting rules of the content statistics against a REAL, LOCAL,
// throwaway PostgreSQL (the schema of the migrations up to 20261030000100). It
// only runs when CONTENT_STATS_TEST_DB names such a database, for example
//
//   CONTENT_STATS_TEST_DB=postgresql://postgres:pw@127.0.0.1:54371/postgres
//
// For the Preview shape point it at a database that was rebuilt like the
// Preview and name its schema:
//
//   CONTENT_STATS_TEST_SCHEMA=public_preview
//
// CONTENT_STATS_TEST_APP_DB (optional) is a second connection as the role the app
// uses, for example app_preview, so the grants of that role are tried too.
//
// It refuses every host but the own machine: never a hosted database. The test
// only touches its own rows (catalogs with the code ST1A, ST1B, ST1C, the
// organizations and users below) and removes them again.

const url = process.env.CONTENT_STATS_TEST_DB;
const SCHEMA = process.env.CONTENT_STATS_TEST_SCHEMA ?? 'public';

function assertLocal(connection: string) {
  const host = new URL(connection).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(
      'CONTENT_STATS_TEST_DB must point at a database on this machine'
    );
  }
}

const id = (n: number) =>
  `51510000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CAT_A = id(1);
const CAT_B = id(2);
const CAT_C = id(3);
const ORG_FULL = id(10); // A enabled, B switched off, C enabled but inactive
const ORG_NONE = id(11); // does not exist
const ORG_LEGACY = id(12); // no catalog rows at all
const USER = id(20);

if (!url) {
  describe.skip('content statistics: postgres (set CONTENT_STATS_TEST_DB)', () => {
    it('is skipped without a local database', () => undefined);
  });
} else {
  assertLocal(url);
  const client = postgres(url, {
    max: 4,
    prepare: false,
    onnotice: () => undefined,
    ...(SCHEMA === 'public' ? {} : { connection: { search_path: SCHEMA } }),
  });
  // The code under test runs as the application role when one is named
  // (CONTENT_STATS_TEST_APP_DB, for example app_preview in the Preview shape),
  // the rows are seeded with the main connection.
  const appUrl = process.env.CONTENT_STATS_TEST_APP_DB;
  if (appUrl) assertLocal(appUrl);
  const appClient = appUrl
    ? postgres(appUrl, {
        max: 4,
        prepare: false,
        onnotice: () => undefined,
        ...(SCHEMA === 'public' ? {} : { connection: { search_path: SCHEMA } }),
      })
    : client;
  const db = drizzle(appClient);
  const sql = client;

  async function cleanup() {
    const catalogs = sql`(select id from training_catalogs where code like 'ST1%')`;
    await sql`delete from organization_catalogs where organization_id in (${ORG_FULL}, ${ORG_LEGACY}) or training_catalog_id in ${catalogs}`;
    await sql`delete from organizations where id in (${ORG_FULL}, ${ORG_LEGACY})`;
    await sql`delete from content_documents where id::text like '51510000-%'`;
    await sql`delete from quizzes where training_catalog_id in ${catalogs}`;
    await sql`delete from courses where training_catalog_id in ${catalogs}`;
    await sql`delete from training_components where training_catalog_id in ${catalogs}`;
    await sql`delete from training_catalogs where code like 'ST1%'`;
  }

  async function seedCatalog(
    catalogId: string,
    code: string,
    isActive: boolean
  ) {
    await sql`insert into training_catalogs (id, code, title, is_active)
              values (${catalogId}, ${code}, ${'Beruf ' + code}, ${isActive})`;
  }

  async function seed() {
    await cleanup();
    await sql`insert into auth.users (id, email) values (${USER}, 'st1@t.test') on conflict (id) do nothing`;
    await sql`insert into profiles (id, email, role, is_active)
              values (${USER}, 'st1@t.test', 'ADMIN', true) on conflict (id) do nothing`;
    await seedCatalog(CAT_A, 'ST1A', true);
    await seedCatalog(CAT_B, 'ST1B', true);
    await seedCatalog(CAT_C, 'ST1C', false);

    // ---- catalog A: the rules ------------------------------------------
    const comp = async (n: number, code: string) => {
      await sql`insert into training_components (id, training_catalog_id, code, title, total_weeks, total_hours)
                values (${id(100 + n)}, ${CAT_A}, ${code}, ${code}, 0, 0)`;
    };
    await comp(1, 'A-K1');
    await comp(2, 'A-K2');
    // Components are counted as COURSES of the catalog (courses.training_catalog_id),
    // never as training_components rows: A has 2 component rows (the second one
    // without a course) but 3 courses, two of them without a component link
    // (like FIAE, which has courses and no training_components at all)
    await sql`insert into courses (id, training_catalog_id, code, title, created_by_id, training_component_id)
              values (${id(200)}, ${CAT_A}, 'A-K1', 'Kurs A', ${USER}, ${id(101)}),
                     (${id(201)}, ${CAT_A}, 'A-K3', 'Kurs A3', ${USER}, null),
                     (${id(202)}, ${CAT_A}, 'A-K4', 'Kurs A4', ${USER}, null)`;
    const enabler = async (
      n: number,
      active: boolean | null,
      pdf: string | null
    ) => {
      await sql`insert into enablers (id, course_id, code, title, order_index, is_active, scenario_pdf_url)
                values (${id(300 + n)}, ${id(200)}, ${'A-E' + n}, ${'Enabler ' + n}, ${n}, ${active}, ${pdf})`;
    };
    await enabler(1, true, null); // three scenario rows
    await enabler(2, true, null); // an EXERCISE document
    await enabler(3, false, 'https://example.test/s.pdf'); // old single PDF
    await enabler(4, null, null); // look-alikes only, no scenario
    await enabler(5, false, '   '); // blank PDF link, no scenario

    const doc = async (
      n: number,
      enablerId: string | null,
      useCaseId: string | null,
      title: string,
      type: string,
      visibility = 'ALL'
    ) => {
      await sql`insert into content_documents (id, enabler_id, use_case_id, title, document_type, visibility, file_name, storage_url)
                values (${id(400 + n)}, ${enablerId}, ${useCaseId}, ${title}, ${type}, ${visibility}, 'f.txt', '')`;
    };
    // Enabler 1: situation plus two solution rows are ONE scenario
    await doc(
      1,
      id(301),
      null,
      'Szenario A-E1: Ausgangssituation',
      'TRAINEE_QUESTION'
    );
    await doc(
      2,
      id(301),
      null,
      'Szenario A-E1: Lösung (Trainer)',
      'TRAINER_SOLUTION',
      'TRAINER_ONLY'
    );
    await doc(
      3,
      id(301),
      null,
      'Szenario A-E1: Fachwissen (Trainer)',
      'TRAINER_SOLUTION',
      'TRAINER_ONLY'
    );
    // Enabler 2: the scenario documents of the platform
    await doc(4, id(302), null, 'Szenarien_Teil 1', 'EXERCISE');
    await doc(5, id(302), null, 'Szenarien_Teil 2', 'EXERCISE');
    // Enabler 4: not scenarios. Theory, a title of another enabler, a use
    // case solution, and a use case document of the type EXERCISE
    await doc(6, id(304), null, 'Enabler 4 Text', 'THEORY');
    await doc(
      7,
      id(304),
      null,
      'Szenario A-E1: Ausgangssituation',
      'TRAINEE_QUESTION'
    );
    await doc(
      8,
      id(304),
      null,
      'Use Case A-U1: Musterlösung (Trainer)',
      'TRAINER_SOLUTION',
      'TRAINER_ONLY'
    );
    await doc(
      9,
      null,
      null,
      'Szenario A-E4: lose Zeile ohne Enabler',
      'TRAINEE_QUESTION'
    );

    // Use cases: U1 for E1 (active), U2 for E2 (inactive), U3 without enabler
    await sql`insert into use_cases (id, course_id, enabler_id, code, title, description_text, order_index, is_active)
              values (${id(501)}, ${id(200)}, ${id(301)}, 'A-U1', 'UC 1', 'x', 1, true),
                     (${id(502)}, ${id(200)}, ${id(302)}, 'A-U2', 'UC 2', 'x', 2, false),
                     (${id(503)}, ${id(200)}, null, 'A-U3', 'UC 3', 'x', 3, true)`;
    // A use case document of the type EXERCISE that sits at an enabler too
    await doc(10, id(304), id(501), 'Use Case Übung', 'EXERCISE');

    // Quizzes: four LESSON (three active), two GLOBAL (one active)
    const quiz = async (
      n: number,
      type: 'LESSON' | 'GLOBAL',
      active: boolean | null,
      componentId: string | null
    ) => {
      await sql`insert into quizzes (id, code, title, quiz_type, created_by_id, is_active, training_catalog_id, training_component_id)
                values (${id(600 + n)}, ${'A-Q' + n}, ${'Quiz ' + n}, ${type}, ${USER}, ${active}, ${CAT_A}, ${componentId})`;
    };
    await quiz(1, 'LESSON', true, null);
    await quiz(2, 'LESSON', true, null);
    await quiz(3, 'LESSON', true, null);
    await quiz(4, 'LESSON', false, null);
    await quiz(5, 'GLOBAL', true, id(101));
    await quiz(6, 'GLOBAL', null, id(102));
    // 2 questions in quiz 1, 3 in the global quiz 5: 5 questions
    await sql`insert into questions (id, quiz_id, question_text, order_index)
              values (${id(701)}, ${id(601)}, 'Q1', 1), (${id(702)}, ${id(601)}, 'Q2', 2),
                     (${id(703)}, ${id(605)}, 'G1', 1), (${id(704)}, ${id(605)}, 'G2', 2),
                     (${id(705)}, ${id(605)}, 'G3', 3)`;
    // Lessons quiz links must not change any count
    await sql`insert into enabler_quiz_links (enabler_id, quiz_id, difficulty)
              values (${id(301)}, ${id(601)}, 'LOW'), (${id(301)}, ${id(602)}, 'MEDIUM')`;

    // Learning fields and mappings: 2 fields, 3 mappings
    await sql`insert into training_catalog_learning_fields (id, training_catalog_id, code, title, training_year, order_index)
              values (${id(801)}, ${CAT_A}, 'LF1', 'LF 1', 1, 1), (${id(802)}, ${CAT_A}, 'LF2', 'LF 2', 2, 2)`;
    await sql`insert into training_catalog_content_mappings (learning_field_id, enabler_id, use_case_id, training_catalog_id)
              values (${id(801)}, ${id(301)}, null, ${CAT_A}),
                     (${id(801)}, ${id(302)}, null, ${CAT_A}),
                     (${id(802)}, null, ${id(501)}, ${CAT_A})`;

    // ---- catalog B: other content that must never leak into A ------------
    await sql`insert into training_components (id, training_catalog_id, code, title, total_weeks, total_hours)
              values (${id(901)}, ${CAT_B}, 'B-K1', 'B-K1', 0, 0)`;
    await sql`insert into courses (id, training_catalog_id, code, title, created_by_id, training_component_id)
              values (${id(902)}, ${CAT_B}, 'B-K1', 'Kurs B', ${USER}, ${id(901)})`;
    await sql`insert into enablers (id, course_id, code, title, order_index, is_active)
              values (${id(903)}, ${id(902)}, 'B-E1', 'B Enabler', 1, true)`;
    await sql`insert into content_documents (id, enabler_id, title, document_type, visibility, file_name, storage_url)
              values (${id(904)}, ${id(903)}, 'Szenario B-E1: Ausgangssituation', 'TRAINEE_QUESTION', 'ALL', 'f.txt', '')`;
    await sql`insert into use_cases (id, course_id, enabler_id, code, title, description_text, order_index, is_active)
              values (${id(905)}, ${id(902)}, ${id(903)}, 'B-U1', 'B UC', 'x', 1, true)`;
    await sql`insert into quizzes (id, code, title, quiz_type, created_by_id, is_active, training_catalog_id)
              values (${id(906)}, 'B-Q1', 'B Quiz', 'LESSON', ${USER}, true, ${CAT_B})`;
    await sql`insert into questions (id, quiz_id, question_text, order_index)
              values (${id(907)}, ${id(906)}, 'BQ1', 1)`;

    // ---- organizations -----------------------------------------------------
    await sql`insert into organizations (id, name, slug, subscription_plan, max_trainee_seats, max_trainer_seats)
              values (${ORG_FULL}, 'ST1 Voll', 'st1-voll', 'PRO', 5, 5),
                     (${ORG_LEGACY}, 'ST1 Alt', 'st1-alt', 'PRO', 5, 5)`;
    // A scenario document of one organization is its own, not platform content
    await sql`insert into content_documents (id, enabler_id, organization_id, title, document_type, visibility, file_name, storage_url)
              values (${id(411)}, ${id(304)}, ${ORG_FULL}, 'Eigene Übung der Organisation', 'EXERCISE', 'ALL', 'f.txt', '')`;
    // A trigger may have added the FIAE row of a new organization
    await sql`delete from organization_catalogs where organization_id in (${ORG_FULL}, ${ORG_LEGACY})`;
    await sql`insert into organization_catalogs (organization_id, training_catalog_id, is_enabled)
              values (${ORG_FULL}, ${CAT_A}, true), (${ORG_FULL}, ${CAT_B}, false), (${ORG_FULL}, ${CAT_C}, true)`;
  }

  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    try {
      await cleanup();
      await sql`delete from profiles where id = ${USER}`;
      await sql`delete from auth.users where id = ${USER}`;
    } finally {
      if (appClient !== client) await appClient.end({ timeout: 5 });
      await client.end({ timeout: 5 });
    }
  });

  const metric = (row: ReturnType<typeof buildCatalogStats>, m: string) =>
    row.metrics.find(x => x.id === m)!;

  describe(`content statistics counting rules (schema ${SCHEMA})`, () => {
    it('counts every kind of content once, in one statement for all catalogs', async () => {
      const rows = await loadStatsRows(db, [CAT_A, CAT_B, CAT_C]);
      expect(rows).toHaveLength(3);
      const a = buildCatalogStats(rows.find(r => r.id === CAT_A)!, false);
      const actual = Object.fromEntries(a.metrics.map(m => [m.id, m.actual]));
      expect(actual).toEqual({
        components: 3,
        enablers: 5,
        // E1 (three rows, one scenario), E2 (EXERCISE), E3 (PDF link). Not
        // E4 (look-alikes, a use case document, an organization document),
        // not E5 (blank link): 3, never 5 document rows
        scenarios: 3,
        useCases: 3,
        lessonQuizzes: 4,
        globalQuizzes: 2,
        learningFields: 2,
      });
      expect(a.questions).toBe(5);
      expect(a.mappings).toBe(3);
      expect(a.code).toBe('ST1A');
      expect(a.isActive).toBe(true);
    });

    it('counts the active items (is_active true only)', async () => {
      const [row] = await loadStatsRows(db, [CAT_A]);
      const a = buildCatalogStats(row, false);
      expect(metric(a, 'enablers').active).toBe(2);
      expect(metric(a, 'useCases').active).toBe(2);
      expect(metric(a, 'lessonQuizzes').active).toBe(3);
      expect(metric(a, 'globalQuizzes').active).toBe(1);
      for (const m of ['components', 'scenarios', 'learningFields']) {
        expect(metric(a, m).active).toBeNull();
      }
    });

    it('keeps the catalogs apart', async () => {
      const rows = await loadStatsRows(db, [CAT_B]);
      expect(rows).toHaveLength(1);
      const b = buildCatalogStats(rows[0], false);
      expect(Object.fromEntries(b.metrics.map(m => [m.id, m.actual]))).toEqual({
        components: 1,
        enablers: 1,
        scenarios: 1,
        useCases: 1,
        lessonQuizzes: 1,
        globalQuizzes: 0,
        learningFields: 0,
      });
      expect(b.questions).toBe(1);
      expect(b.mappings).toBe(0);
    });

    it('gives a catalog without content a row of zeros', async () => {
      const [row] = await loadStatsRows(db, [CAT_C]);
      const c = buildCatalogStats(row, false);
      expect(c.metrics.every(m => m.actual === 0)).toBe(true);
      expect(c.questions).toBe(0);
      expect(c.isActive).toBe(false);
    });

    it('answers nothing for an empty list of catalogs', async () => {
      expect(await loadStatsRows(db, [])).toEqual([]);
    });

    it('reads all catalogs when no list is given', async () => {
      const rows = await loadStatsRows(db, null);
      const codes = rows.map(r => r.code);
      expect(codes).toEqual(expect.arrayContaining(['ST1A', 'ST1B', 'ST1C']));
    });
  });

  describe(`content statistics: who sees which catalog (schema ${SCHEMA})`, () => {
    const codesOf = (r: Awaited<ReturnType<typeof getContentStats>>) =>
      r.catalogs.map(c => c.code).filter(c => c.startsWith('ST1'));

    it('the platform admin sees all catalogs, inactive ones too', async () => {
      const r = await getContentStats(
        { isSuperAdmin: true, organizationId: ORG_FULL },
        db
      );
      expect(r.targetsVisible).toBe(true);
      expect(codesOf(r)).toEqual(['ST1A', 'ST1B', 'ST1C']);
    });

    it('an organization admin sees only enabled and active catalogs, no targets', async () => {
      await saveContentTargets(CAT_A, { enablers: 5 }, db);
      const r = await getContentStats(
        { isSuperAdmin: false, organizationId: ORG_FULL },
        db
      );
      // B is switched off for the organization, C is inactive
      expect(codesOf(r)).toEqual(['ST1A']);
      expect(r.targetsVisible).toBe(false);
      expect(r.canEditTargets).toBe(false);
      const a = r.catalogs.find(c => c.code === 'ST1A')!;
      expect(metric(a, 'enablers')).toMatchObject({
        actual: 5,
        target: null,
        status: 'no_target',
      });
      await saveContentTargets(CAT_A, {}, db);
    });

    it('an organization without catalog rows counts as FIAE (legacy)', async () => {
      const r = await getContentStats(
        { isSuperAdmin: false, organizationId: ORG_LEGACY },
        db
      );
      expect(r.catalogs.map(c => c.code)).toEqual(['FIAE']);
    });

    it('an organization that does not exist sees nothing (fail closed)', async () => {
      const r = await getContentStats(
        { isSuperAdmin: false, organizationId: ORG_NONE },
        db
      );
      expect(r.catalogs).toEqual([]);
    });
  });

  describe(`content targets in the settings (schema ${SCHEMA})`, () => {
    const settingsOf = async () =>
      (await sql`select settings from training_catalogs where id = ${CAT_A}`)[0]
        .settings as Record<string, unknown>;

    it('saves, compares, replaces and removes the targets, keeping other settings', async () => {
      const other = JSON.stringify({
        phase_months: [15, 21],
        hai: { occupation_name: 'Test' },
      });
      await sql`update training_catalogs set settings = ${other}::text::jsonb where id = ${CAT_A}`;

      const saved = await saveContentTargets(
        CAT_A,
        {
          components: 3,
          enablers: 6,
          scenarios: 3,
          useCases: 3,
          lessonQuizzes: null,
        },
        db
      );
      expect(saved).toEqual({
        components: 3,
        enablers: 6,
        scenarios: 3,
        useCases: 3,
      });
      expect(await settingsOf()).toEqual({
        phase_months: [15, 21],
        hai: { occupation_name: 'Test' },
        content_targets: {
          components: 3,
          enablers: 6,
          scenarios: 3,
          use_cases: 3,
        },
      });

      const r = await getContentStats(
        { isSuperAdmin: true, organizationId: ORG_FULL },
        db
      );
      const a = r.catalogs.find(c => c.code === 'ST1A')!;
      expect(metric(a, 'components')).toMatchObject({
        target: 3,
        difference: 0,
        status: 'met',
        percent: 100,
      });
      expect(metric(a, 'enablers')).toMatchObject({
        target: 6,
        difference: -1,
        status: 'missing',
        percent: 83,
      });
      expect(metric(a, 'useCases')).toMatchObject({ status: 'met' });
      expect(metric(a, 'lessonQuizzes')).toMatchObject({
        target: null,
        status: 'no_target',
      });

      // A second save replaces the whole set (a key left out is removed)
      await saveContentTargets(CAT_A, { globalQuizzes: 1 }, db);
      expect((await settingsOf()).content_targets).toEqual({
        global_quizzes: 1,
      });

      // An empty set removes the key and leaves the rest alone
      expect(await saveContentTargets(CAT_A, {}, db)).toEqual({});
      expect(await settingsOf()).toEqual({
        phase_months: [15, 21],
        hai: { occupation_name: 'Test' },
      });
    });

    it('saves into a catalog whose settings were never written', async () => {
      await sql`update training_catalogs set settings = '{}'::jsonb where id = ${CAT_A}`;
      await saveContentTargets(CAT_A, { learningFields: 13 }, db);
      expect(await settingsOf()).toEqual({
        content_targets: { learning_fields: 13 },
      });
    });

    it('answers null for a catalog that does not exist', async () => {
      expect(await saveContentTargets(id(999), { enablers: 1 }, db)).toBeNull();
    });

    it('touches only the one catalog', async () => {
      await saveContentTargets(CAT_A, { enablers: 9 }, db);
      const [b] =
        await sql`select settings from training_catalogs where id = ${CAT_B}`;
      expect(b.settings).toEqual({});
    });
  });
}
