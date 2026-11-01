/**
 * Test progress for the accounts of the Preview (schema public_preview).
 *
 * Two jobs share this file:
 *   seed   gives every active trainee a different, realistic state of work
 *          (finished enablers, quiz results, hand-ins in all three states, weekly
 *          activity reports), so each role can test each function without first
 *          building prerequisites
 *   reset  removes everything a test created for those trainees (progress tables
 *          and uploaded files) and seeds the baseline again
 *
 * Nothing here touches Production: every statement names public_preview, the
 * entry scripts refuse any database role but app_preview_migrator, and a real run
 * needs --apply and --confirm-host. The accounts are not listed here (the
 * repository is public): the levels are handed out by the order of the e-mail
 * addresses, see LEVEL_CYCLE.
 */

export const SCHEMA = 'public_preview';
export const BUCKET = 'submission-files';
export const STORAGE_PREFIX = 'preview/';

/** The only database role a run may use (owns public_preview, no rights on public). */
export const ROLE_PATTERN = /^app_preview_migrator(\.|$)/;

export type Level = 'weit' | 'mittel' | 'bereit' | 'anfang';

/**
 * How far a trainee is in every course he or she belongs to:
 *   weit    all enablers but the last are finished
 *   mittel  the first half
 *   bereit  all but the last two (one open, one still locked by the order of work)
 *   anfang  only the first
 */
export const LEVEL_CYCLE: readonly Level[] = [
  'weit',
  'mittel',
  'bereit',
  'bereit',
  'anfang',
];

export const levelFor = (index: number): Level =>
  LEVEL_CYCLE[index % LEVEL_CYCLE.length];

export const LEVELS: readonly Level[] = ['weit', 'mittel', 'bereit', 'anfang'];

/**
 * What a test can create for a trainee. A reset empties exactly these tables for
 * the chosen trainees. Child tables go with their parent (ON DELETE CASCADE:
 * quiz answers, links of a hand-in, entries of a report, weekly evaluations, chat
 * messages).
 *
 * Kept on purpose (setup, not progress): profiles, trainee_enrollments,
 * course_members, quiz_assignments (made when a trainee is enrolled or released),
 * the calendar (ausbildung_blocks, school_exams, school_exam_results) and
 * activity_log.
 */
export const PROGRESS_TABLES: ReadonlyArray<{
  table: string;
  column: 'trainee_id' | 'user_id';
}> = [
  { table: 'quiz_submissions', column: 'trainee_id' },
  { table: 'use_case_submissions', column: 'trainee_id' },
  { table: 'enabler_submissions', column: 'trainee_id' },
  { table: 'enabler_completions', column: 'trainee_id' },
  { table: 'progress', column: 'user_id' },
  { table: 'trainee_enabler_overrides', column: 'trainee_id' },
  { table: 'trainee_use_case_overrides', column: 'trainee_id' },
  { table: 'activity_reports', column: 'trainee_id' },
  { table: 'work_certificates', column: 'trainee_id' },
  { table: 'annual_performance_summaries', column: 'trainee_id' },
  { table: 'acceptance_protocols', column: 'trainee_id' },
  { table: 'trainee_achieved_skills', column: 'trainee_id' },
  { table: 'knowledge_notes', column: 'trainee_id' },
  { table: 'reflections', column: 'trainee_id' },
  { table: 'hai_chat_sessions', column: 'user_id' },
  { table: 'notifications', column: 'user_id' },
];

export interface Options {
  command: 'seed' | 'reset';
  apply: boolean;
  confirmHost: string | null;
  dbUrlEnv: string;
  emails: string[];
  /** Level for the chosen accounts instead of the one of their position (needs --email). */
  level: Level | null;
  clearOnly: boolean;
  keepFiles: boolean;
}

export type ParsedArgs =
  | { ok: true; options: Options }
  | { ok: false; error: string };

export function parseArgs(
  argv: readonly string[],
  command: Options['command']
): ParsedArgs {
  const known = new Set([
    '--target',
    '--apply',
    '--confirm-host',
    '--db-url-env',
    '--email',
    '--level',
    '--clear-only',
    '--keep-files',
  ]);
  const valueOf = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const value = argv[i + 1];
    return value && !value.startsWith('--') ? value : '';
  };
  for (const a of argv) {
    if (a.startsWith('--') && !known.has(a)) {
      return { ok: false, error: `Unknown option ${a}.` };
    }
  }
  if (valueOf('--target') !== 'preview') {
    return {
      ok: false,
      error: 'Every run needs --target preview. Production is not possible.',
    };
  }
  const confirmHost = valueOf('--confirm-host');
  if (confirmHost === '') {
    return { ok: false, error: '--confirm-host needs a value.' };
  }
  const dbUrlEnv = valueOf('--db-url-env') ?? 'PREVIEW_IMPORT_DB_URL';
  if (!/^[A-Z][A-Z0-9_]*$/.test(dbUrlEnv)) {
    return { ok: false, error: '--db-url-env must be a variable name.' };
  }
  const emailRaw = valueOf('--email');
  if (emailRaw === '') return { ok: false, error: '--email needs a value.' };
  const emails = (emailRaw ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  const levelRaw = valueOf('--level');
  if (levelRaw === '') return { ok: false, error: '--level needs a value.' };
  if (levelRaw !== null && !LEVELS.includes(levelRaw as Level)) {
    return {
      ok: false,
      error: `--level is one of ${LEVELS.join(', ')}.`,
    };
  }
  if (levelRaw !== null && emails.length === 0) {
    return {
      ok: false,
      error:
        '--level needs --email: it sets the level of the chosen accounts only.',
    };
  }
  const clearOnly = argv.includes('--clear-only');
  const keepFiles = argv.includes('--keep-files');
  if (command === 'seed' && (clearOnly || keepFiles)) {
    return {
      ok: false,
      error: '--clear-only and --keep-files belong to the reset script.',
    };
  }
  return {
    ok: true,
    options: {
      command,
      apply: argv.includes('--apply'),
      confirmHost,
      dbUrlEnv,
      emails,
      level: levelRaw as Level | null,
      clearOnly,
      keepFiles,
    },
  };
}

export const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/** An error text when the run must not go on, null when the target fits. */
export function checkTarget(facts: {
  role: string;
  dbHost: string | null;
  options: Pick<Options, 'apply' | 'confirmHost'>;
}): string | null {
  if (!ROLE_PATTERN.test(facts.role)) {
    return 'The database role is not app_preview_migrator. Nothing was done.';
  }
  if (facts.options.apply) {
    if (!facts.options.confirmHost) {
      return 'A real run needs --confirm-host <host of the database>. Nothing was done.';
    }
    if (facts.options.confirmHost !== facts.dbHost) {
      return '--confirm-host does not match the host of the connection. Nothing was done.';
    }
  }
  return null;
}

/** The storage folder of one trainee in the bucket (Preview writes under preview/). */
export const traineeFolder = (organizationId: string, traineeId: string) =>
  `${STORAGE_PREFIX}${organizationId}/${traineeId}`;

export interface Db {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unsafe: (query: string, params?: any[]) => PromiseLike<any>;
}

export interface Trainee {
  id: string;
  email: string;
  organization_id: string;
  level: Level;
}

/** Active trainees in the order of their e-mail address, each with a level. */
export async function loadTrainees(
  db: Db,
  emails: readonly string[],
  level: Level | null = null
): Promise<Trainee[]> {
  const rows = await db.unsafe(
    `select id, lower(email) as email, organization_id
       from ${SCHEMA}.profiles
      where role = 'TRAINEE' and is_active
      order by lower(email)`
  );
  const all: Trainee[] = rows.map((r: any, i: number) => ({
    id: r.id,
    email: r.email,
    organization_id: r.organization_id,
    level: levelFor(i),
  }));
  // the level belongs to the position among all trainees, a filter keeps it, --level replaces it
  const chosen = emails.length
    ? all.filter(t => emails.includes(t.email))
    : all;
  return level ? chosen.map(t => ({ ...t, level })) : chosen;
}

export async function findTrainer(db: Db): Promise<string | null> {
  const rows = await db.unsafe(
    `select id from ${SCHEMA}.profiles where role = 'TRAINER' and is_active order by id limit 1`
  );
  return rows[0]?.id ?? null;
}

export async function missingTables(db: Db): Promise<string[]> {
  const names = PROGRESS_TABLES.map(t => t.table);
  const rows = await db.unsafe(
    `select table_name from information_schema.tables
      where table_schema = '${SCHEMA}' and table_name = any($1::text[])`,
    [names]
  );
  const found = new Set(rows.map((r: any) => r.table_name));
  return names.filter(n => !found.has(n));
}

/** Deletes the progress of the trainees. Returns the number of rows per table. */
export async function clearProgress(
  db: Db,
  traineeIds: readonly string[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (traineeIds.length === 0) return counts;
  for (const { table, column } of PROGRESS_TABLES) {
    const res = await db.unsafe(
      `delete from ${SCHEMA}.${table} where ${column} = any($1::uuid[])`,
      [traineeIds]
    );
    counts[table] = Number(res.count ?? 0);
  }
  return counts;
}

// The finished enablers of a trainee. $1 trainee, $2 organization, $3 level.
const DONE_CTE = `
  my_org as (select $2::uuid as org),
  my_courses as (select m.course_id from ${SCHEMA}.course_members m where m.user_id = $1),
  ranked as (
    select e.id, e.course_id,
           row_number() over (partition by e.course_id order by e.order_index, e.id) as rn,
           count(*) over (partition by e.course_id) as n
    from ${SCHEMA}.enablers e
    where e.is_active and e.course_id in (select course_id from my_courses)
  ),
  done as (
    select id, course_id from ranked
    where rn <= case $3::text
      when 'weit' then case when n >= 2 then n - 1 else 0 end
      when 'mittel' then n / 2
      when 'anfang' then case when n >= 2 then 1 else 0 end
      else case when n >= 3 then n - 2 when n = 2 then 1 else 0 end end
  )`;

const STATES = ['PENDING', 'REJECTED', 'APPROVED'] as const;

/** Weeks of the seeded activity reports: ISO week, Monday, state. */
export const REPORT_WEEKS: ReadonlyArray<readonly [number, string, string]> = [
  [41, '2026-10-05', 'APPROVED'],
  [42, '2026-10-12', 'SUBMITTED'],
  [43, '2026-10-19', 'DRAFT'],
];

export interface SeedSummary {
  level: Level;
  quiz: number;
  useCase: number;
  enabler: number;
  reports: number;
}

/**
 * Seeds one trainee. Rows that exist stay, nothing is created twice, so a second
 * run after a partial state only fills the gaps.
 */
export async function seedTrainee(
  db: Db,
  trainee: Trainee,
  trainerId: string | null
): Promise<SeedSummary> {
  const base = [trainee.id, trainee.organization_id, trainee.level];

  const quiz = await db.unsafe(
    `with ${DONE_CTE},
     todo as (
       select distinct l.quiz_id from ${SCHEMA}.enabler_quiz_links l
       join done d on d.id = l.enabler_id
       join ${SCHEMA}.quizzes qz on qz.id = l.quiz_id and qz.is_active
       where not exists (select 1 from ${SCHEMA}.quiz_submissions s where s.trainee_id = $1 and s.quiz_id = l.quiz_id)
     )
     insert into ${SCHEMA}.quiz_submissions
       (trainee_id, quiz_id, score, submitted_at, is_reviewed, attempt_number, organization_id)
     select $1, quiz_id, 60 + (abs(hashtext(quiz_id::text)) % 41),
            now() - ((abs(hashtext(quiz_id::text || 't')) % 4000) || ' minutes')::interval, false, 1, $2
     from todo`,
    base
  );

  // hand-ins of use cases: three per occupation, one in each state
  const haveUc = Number(
    (
      await db.unsafe(
        `select count(*) as n from ${SCHEMA}.use_case_submissions where trainee_id = $1`,
        [trainee.id]
      )
    )[0].n
  );
  let useCase = 0;
  if (haveUc < 3) {
    const cands = await db.unsafe(
      `with ${DONE_CTE},
       cand as (
         select u.id as use_case_id,
                row_number() over (partition by u.training_catalog_id order by u.course_id, u.id) as k
         from ${SCHEMA}.use_cases u
         left join done d on d.id = u.enabler_id
         where u.is_active and (d.id is not null or u.enabler_id is null)
           and u.course_id in (select course_id from my_courses)
           and not exists (select 1 from ${SCHEMA}.use_case_submissions s where s.trainee_id = $1 and s.use_case_id = u.id)
       )
       select use_case_id, k from cand where k <= 3`,
      base
    );
    for (const row of cands) {
      const status = STATES[Number(row.k) - 1];
      await db.unsafe(
        `insert into ${SCHEMA}.use_case_submissions
           (trainee_id, use_case_id, submission_text, status, trainer_feedback, reviewed_by_id, reviewed_at, submitted_at, attempt_number, organization_id)
         values ($1,$2,$3,$4::${SCHEMA}.review_status,$5,$6,$7, now() - interval '1 day', 1, $8)`,
        [
          trainee.id,
          row.use_case_id,
          'Testabgabe: Bearbeitung der Aufgabe mit den Schritten Analyse, Umsetzung und Kontrolle.',
          status,
          status === 'REJECTED'
            ? 'Bitte die Umsetzung genauer beschreiben und ein Beispiel ergänzen.'
            : status === 'APPROVED'
              ? 'Sauber gelöst, weiter so.'
              : null,
          status === 'PENDING' ? null : trainerId,
          status === 'PENDING' ? null : new Date(),
          trainee.organization_id,
        ]
      );
      useCase += 1;
    }
  }

  // scenario answers of finished enablers, again one in each state (a trainee who
  // already has three or more gets none, so a second run adds nothing)
  const haveEnabler = Number(
    (
      await db.unsafe(
        `select count(*) as n from ${SCHEMA}.enabler_submissions where trainee_id = $1`,
        [trainee.id]
      )
    )[0].n
  );
  const enablers =
    haveEnabler >= 3
      ? []
      : await db.unsafe(
          `with ${DONE_CTE},
     cand as (
       select d.id as enabler_id, row_number() over (order by d.course_id, d.id) as k
       from done d
       where not exists (select 1 from ${SCHEMA}.enabler_submissions s where s.trainee_id = $1 and s.enabler_id = d.id)
     )
     select enabler_id, k from cand where k <= 3`,
          base
        );
  let enabler = 0;
  for (const row of enablers) {
    const status = STATES[Number(row.k) - 1];
    await db.unsafe(
      `insert into ${SCHEMA}.enabler_submissions
         (trainee_id, enabler_id, solution_text, status, trainer_feedback, reviewed_by_id, reviewed_at, submitted_at, attempt_number, organization_id)
       values ($1,$2,$3,$4::${SCHEMA}.review_status,$5,$6,$7, now() - interval '2 days', 1, $8)`,
      [
        trainee.id,
        row.enabler_id,
        'Testantwort zum Szenario: Vorgehen in drei Schritten beschrieben und begründet.',
        status,
        status === 'REJECTED'
          ? 'Die Begründung fehlt noch, bitte ergänzen.'
          : status === 'APPROVED'
            ? 'Gut nachvollziehbar.'
            : null,
        status === 'PENDING' ? null : trainerId,
        status === 'PENDING' ? null : new Date(),
        trainee.organization_id,
      ]
    );
    enabler += 1;
  }

  // weekly activity reports: approved, handed in, draft
  let reports = 0;
  for (const [week, start, status] of REPORT_WEEKS) {
    const exists = await db.unsafe(
      `select 1 from ${SCHEMA}.activity_reports where trainee_id = $1 and year = 2026 and week_number = $2`,
      [trainee.id, week]
    );
    if (exists.length) continue;
    const [report] = await db.unsafe(
      `insert into ${SCHEMA}.activity_reports
         (trainee_id, ausbildungsjahr, week_number, year, period_start, period_end, abteilung, status,
          submitted_at, reviewer_id, reviewed_at, reviewer_feedback, organization_id)
       values ($1, 1, $2, 2026, $3::timestamp, $3::timestamp + interval '6 days 23 hours 59 minutes 59 seconds',
               'IT-Abteilung', $4::${SCHEMA}.activity_report_status, $5, $6, $7, $8, $9)
       returning id`,
      [
        trainee.id,
        week,
        start,
        status,
        status === 'DRAFT' ? null : new Date(`${start}T17:00:00Z`),
        status === 'APPROVED' ? trainerId : null,
        status === 'APPROVED' ? new Date(`${start}T18:00:00Z`) : null,
        status === 'APPROVED' ? 'Vollständig und nachvollziehbar.' : null,
        trainee.organization_id,
      ]
    );
    await db.unsafe(
      `insert into ${SCHEMA}.activity_report_entries
         (report_id, betriebliche_taetigkeit, betriebliche_stunden, unterweisungen_themen, unterweisungen_stunden, berufsschul_themen, berufsschul_stunden)
       values ($1, $2, 32, 'Datenschutz und Datensicherheit', 4, 'Netzwerktechnik', 4)`,
      [
        report.id,
        'Testeintrag: Arbeiten an Aufgaben der Abteilung, Dokumentation der Ergebnisse.',
      ]
    );
    reports += 1;
  }

  return {
    level: trainee.level,
    quiz: Number(quiz.count ?? 0),
    useCase,
    enabler,
    reports,
  };
}
