/**
 * Content statistics of the training catalogs (occupations): how much content
 * each catalog holds (Ist), what it is meant to hold (Soll, from
 * training_catalogs.settings.content_targets) and the difference.
 *
 * Counting rules (one SQL statement counts all catalogs, no query per
 * catalog). Every count is limited to one catalog through its own catalog
 * column, never through a join that could multiply rows:
 *
 *  - components      training_components of the catalog.
 *  - enablers        enablers of the catalog.
 *  - scenarios       ENABLERS that have a scenario, never document rows. The
 *                    KfBM import writes up to three document rows per scenario
 *                    (situation, solution, knowledge, titles "Szenario <code>:
 *                    ..."), so counting rows would give three per enabler. An
 *                    enabler has a scenario when it has a document row at the
 *                    enabler (no use case) of the type EXERCISE (the scenario
 *                    documents of the platform, shown as scenarios to
 *                    trainees), or of the type TRAINEE_QUESTION or
 *                    TRAINER_SOLUTION whose title starts with "Szenario <enabler
 *                    code>: " (the import), or a scenario_pdf_url on the enabler
 *                    (old single PDF). Each enabler counts once.
 *  - useCases        use_cases of the catalog (the content use cases that are
 *                    linked to an enabler). NOT training_use_cases: those are
 *                    the time planned tasks of a training component for the
 *                    activity reports, a different thing.
 *  - lessonQuizzes   quizzes of the type LESSON (the enabler quizzes, three
 *                    per enabler: LOW, MEDIUM, HIGH) of the catalog.
 *  - globalQuizzes   quizzes of the type GLOBAL of the catalog.
 *  - learningFields  training_catalog_learning_fields of the catalog.
 *  - questions       all questions of the quizzes of the catalog (extra).
 *  - mappings        assignments of enablers and use cases to learning fields
 *                    (extra).
 *  - active          enablers, use cases and quizzes with is_active = true.
 *                    The inactive ones are the actual number minus the active
 *                    ones. Components, scenarios and learning fields have no
 *                    activation of their own.
 *
 * Who sees what: the platform admin (SUPER_ADMIN, or ADMIN of the platform
 * organization) sees every catalog with targets and differences. An admin of
 * an organization (ADMIN, TEMP_ADMIN) sees only the catalogs that are enabled
 * and active for the own organization and only the actual numbers: the targets
 * are the planning of the platform and stay with the platform admin. Targets
 * are written by the platform admin only (requireCurriculumEditor in the
 * route).
 */

import { eq, sql } from 'drizzle-orm';
import db from '@/db';
import { trainingCatalogs } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import {
  FIAE_CATALOG_ID,
  listUsableCatalogIds,
  type Executor,
} from '@/lib/catalog/admin';
import {
  CONTENT_METRICS,
  compareToTarget,
  readContentTargets,
  toStoredContentTargets,
  type CatalogContentStats,
  type ContentMetric,
  type ContentMetricId,
  type ContentStatsResponse,
  type ContentTargets,
} from '@/lib/catalog/content-targets';

/** What the statistics read from the database: only `execute`. */
export type StatsExecutor = Pick<typeof db, 'execute'>;

/** One row of the statistics statement, one row per catalog. */
export type StatsRow = {
  id: string;
  code: string;
  title: string;
  is_active: boolean | null;
  settings: unknown;
  components: number;
  enablers: number;
  enablers_active: number;
  scenarios: number;
  use_cases: number;
  use_cases_active: number;
  lesson_quizzes: number;
  lesson_quizzes_active: number;
  global_quizzes: number;
  global_quizzes_active: number;
  learning_fields: number;
  questions: number;
  mappings: number;
};

/**
 * The statement. One round trip for all requested catalogs (or all catalogs
 * when `catalogIds` is null). A catalog without content still gets a row with
 * zeros, because the catalogs are the base of the statement.
 */
export async function loadStatsRows(
  q: StatsExecutor,
  catalogIds: string[] | null
): Promise<StatsRow[]> {
  if (catalogIds !== null && catalogIds.length === 0) return [];
  const filter =
    catalogIds === null
      ? sql``
      : sql`where c.id in (${sql.join(
          catalogIds.map(id => sql`${id}::uuid`),
          sql`, `
        )})`;
  const rows = await q.execute(sql`
    select
      c.id,
      c.code,
      c.title,
      c.is_active,
      c.settings,
      (select count(*) from training_components x
        where x.training_catalog_id = c.id)::int as components,
      (select count(*) from enablers x
        where x.training_catalog_id = c.id)::int as enablers,
      (select count(*) from enablers x
        where x.training_catalog_id = c.id and x.is_active is true
      )::int as enablers_active,
      (select count(*) from enablers x
        where x.training_catalog_id = c.id
          and (
            nullif(btrim(x.scenario_pdf_url), '') is not null
            or exists (
              select 1 from content_documents d
              where d.enabler_id = x.id
                and d.use_case_id is null
                and (
                  d.document_type = 'EXERCISE'
                  or (
                    d.document_type in ('TRAINEE_QUESTION', 'TRAINER_SOLUTION')
                    and starts_with(d.title, 'Szenario ' || x.code || ': ')
                  )
                )
            )
          )
      )::int as scenarios,
      (select count(*) from use_cases x
        where x.training_catalog_id = c.id)::int as use_cases,
      (select count(*) from use_cases x
        where x.training_catalog_id = c.id and x.is_active is true
      )::int as use_cases_active,
      (select count(*) from quizzes x
        where x.training_catalog_id = c.id and x.quiz_type = 'LESSON'
      )::int as lesson_quizzes,
      (select count(*) from quizzes x
        where x.training_catalog_id = c.id and x.quiz_type = 'LESSON'
          and x.is_active is true
      )::int as lesson_quizzes_active,
      (select count(*) from quizzes x
        where x.training_catalog_id = c.id and x.quiz_type = 'GLOBAL'
      )::int as global_quizzes,
      (select count(*) from quizzes x
        where x.training_catalog_id = c.id and x.quiz_type = 'GLOBAL'
          and x.is_active is true
      )::int as global_quizzes_active,
      (select count(*) from training_catalog_learning_fields x
        where x.training_catalog_id = c.id)::int as learning_fields,
      (select count(*) from questions qu
        join quizzes z on z.id = qu.quiz_id
        where z.training_catalog_id = c.id)::int as questions,
      (select count(*) from training_catalog_content_mappings x
        where x.training_catalog_id = c.id)::int as mappings
    from training_catalogs c
    ${filter}
  `);
  return rows as unknown as StatsRow[];
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * One catalog as the API answers it. Without `withTargets` no target, no
 * difference and no status leave the server (every status is no_target).
 */
export function buildCatalogStats(
  row: StatsRow,
  withTargets: boolean
): CatalogContentStats {
  const actual: Record<ContentMetricId, number> = {
    components: num(row.components),
    enablers: num(row.enablers),
    scenarios: num(row.scenarios),
    useCases: num(row.use_cases),
    lessonQuizzes: num(row.lesson_quizzes),
    globalQuizzes: num(row.global_quizzes),
    learningFields: num(row.learning_fields),
  };
  const active: Record<ContentMetricId, number | null> = {
    components: null,
    enablers: num(row.enablers_active),
    scenarios: null,
    useCases: num(row.use_cases_active),
    lessonQuizzes: num(row.lesson_quizzes_active),
    globalQuizzes: num(row.global_quizzes_active),
    learningFields: null,
  };
  const targets: ContentTargets = withTargets
    ? readContentTargets(row.settings)
    : {};
  const metrics: ContentMetric[] = CONTENT_METRICS.map(id => {
    const target = targets[id] ?? null;
    return {
      id,
      actual: actual[id],
      active: active[id],
      target,
      ...compareToTarget(actual[id], target),
    };
  });
  return {
    catalogId: String(row.id),
    code: row.code,
    title: row.title,
    isActive: row.is_active === true,
    metrics,
    questions: num(row.questions),
    mappings: num(row.mappings),
  };
}

/** FIAE first (the default occupation), then by code. */
function sortStats(list: CatalogContentStats[]): CatalogContentStats[] {
  return [...list].sort((a, b) => {
    if (a.catalogId === FIAE_CATALOG_ID) return -1;
    if (b.catalogId === FIAE_CATALOG_ID) return 1;
    return a.code.localeCompare(b.code);
  });
}

/** The part of the session the statistics need. */
export type StatsViewer = { isSuperAdmin: boolean; organizationId: string };

/**
 * The statistics the viewer may see. The platform admin gets every catalog with
 * targets, an organization admin the catalogs usable by the own organization
 * with the actual numbers only (an organization that does not exist: none).
 */
export async function getContentStats(
  viewer: StatsViewer,
  q: Executor = db
): Promise<ContentStatsResponse> {
  return withDbRetry(async () => {
    if (viewer.isSuperAdmin) {
      const rows = await loadStatsRows(q, null);
      return {
        targetsVisible: true,
        canEditTargets: true,
        catalogs: sortStats(rows.map(r => buildCatalogStats(r, true))),
      };
    }
    const ids = await listUsableCatalogIds(viewer.organizationId, q);
    const rows = await loadStatsRows(q, ids);
    return {
      targetsVisible: false,
      canEditTargets: false,
      catalogs: sortStats(rows.map(r => buildCatalogStats(r, false))),
    };
  });
}

/**
 * Replace the content targets of a catalog (the caller checked the right and
 * validated the input). One statement, atomic on the row: the other settings
 * keys stay as they are, and an empty set removes the key. Returns the stored
 * targets, or null when the catalog does not exist.
 */
export async function saveContentTargets(
  catalogId: string,
  input: Partial<Record<ContentMetricId, number | null>>,
  q: Executor = db
): Promise<ContentTargets | null> {
  const stored = toStoredContentTargets(input);
  const next =
    Object.keys(stored).length === 0
      ? sql`${trainingCatalogs.settings} - 'content_targets'`
      : sql`jsonb_set(${trainingCatalogs.settings}, '{content_targets}', ${JSON.stringify(stored)}::jsonb, true)`;
  const updated = await withDbRetry(() =>
    q
      .update(trainingCatalogs)
      .set({ settings: next })
      .where(eq(trainingCatalogs.id, catalogId))
      .returning({ settings: trainingCatalogs.settings })
  );
  if (updated.length === 0) return null;
  return readContentTargets(updated[0].settings);
}
