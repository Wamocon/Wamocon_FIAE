/**
 * Release ("freigeben") and lock ("sperren") of the content of an occupation.
 *
 * What a trainee can open is decided by the visibility columns:
 *  - courses.is_active and courses.is_published
 *  - enablers.is_active (and activated_at, the start of the working time)
 *  - use_cases.is_active (and activated_at)
 *  - quizzes.is_active (lesson quizzes and global quizzes)
 *
 * The import writes all of them as inactive, nothing is activated by an import.
 * This tool switches them for ONE catalog in one step instead of one click per
 * element: one UPDATE per table inside one transaction under the catalog
 * administration lock. It writes only these columns, never titles, texts,
 * questions, answers or any other column, and never touches another catalog.
 *
 *  - release: is_active = true (courses also is_published = true). activated_at
 *    is set to now() where it is empty, like the trainer route does on the first
 *    activation, an existing value stays.
 *  - lock: is_active = false (courses also is_published = false). activated_at
 *    stays, like the trainer route on a deactivation.
 *
 * The two are counterparts: lock undoes a release. A row that was active before
 * the release is locked too, the tool works on the whole catalog.
 */

import { and, eq, sql } from 'drizzle-orm';
import db from '@/db';
import {
  activityLog,
  courses,
  enablers,
  quizzes,
  trainingCatalogs,
  useCases,
} from '@/db/migrations/schemas/schema';
import { takeCatalogAdminLock, type Executor } from '@/lib/catalog/admin';

export type ReleaseMode = 'release' | 'lock';

export const RELEASE_MODES: readonly ReleaseMode[] = ['release', 'lock'];

export function isReleaseMode(value: unknown): value is ReleaseMode {
  return value === 'release' || value === 'lock';
}

/** Rows per kind of content. */
export type ReleaseCounts = {
  courses: number;
  enablers: number;
  useCases: number;
  lessonQuizzes: number;
  globalQuizzes: number;
};

export type ReleaseOverview = {
  catalogId: string;
  code: string;
  title: string;
  /** The catalog itself is active (trainees can only see an active one). */
  catalogActive: boolean;
  total: ReleaseCounts;
  /** Rows that are visible to trainees now. */
  active: ReleaseCounts;
  /** Courses that are published (extra column of courses). */
  publishedCourses: number;
};

export type ReleaseResult = {
  catalogId: string;
  code: string;
  mode: ReleaseMode;
  /** True when nothing was written. */
  dryRun: boolean;
  /** Rows that change (or changed, after an execute). */
  changes: ReleaseCounts;
  total: ReleaseCounts;
  /** Rows visible to trainees before this run. */
  active: ReleaseCounts;
  /** The catalog itself is active (trainees only see an active one). */
  catalogActive: boolean;
  /** True when the protocol row was written (execute only). */
  logged: boolean;
};

/**
 * The typed confirmation: the code of the catalog as it is written in the
 * database, nothing else. A trimmed match only, no case folding, so a paste of
 * the wrong word does not pass.
 */
export function isConfirmedCode(input: unknown, catalogCode: string): boolean {
  return typeof input === 'string' && input.trim() === catalogCode;
}

type CountRow = { total: number; active: number; published?: number };

async function counts(q: Executor, catalogId: string) {
  const [course] = (await q
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${courses.isActive} is true)::int`,
      published: sql<number>`count(*) filter (where ${courses.isPublished} is true)::int`,
    })
    .from(courses)
    .where(eq(courses.trainingCatalogId, catalogId))) as CountRow[];
  const [enabler] = (await q
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${enablers.isActive} is true)::int`,
    })
    .from(enablers)
    .where(eq(enablers.trainingCatalogId, catalogId))) as CountRow[];
  const [useCase] = (await q
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${useCases.isActive} is true)::int`,
    })
    .from(useCases)
    .where(eq(useCases.trainingCatalogId, catalogId))) as CountRow[];
  const quizRows = (await q
    .select({
      type: quizzes.quizType,
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${quizzes.isActive} is true)::int`,
    })
    .from(quizzes)
    .where(eq(quizzes.trainingCatalogId, catalogId))
    .groupBy(quizzes.quizType)) as (CountRow & { type: string })[];
  const quiz = (type: string) =>
    quizRows.find(r => String(r.type) === type) ?? { total: 0, active: 0 };
  return {
    total: {
      courses: Number(course?.total ?? 0),
      enablers: Number(enabler?.total ?? 0),
      useCases: Number(useCase?.total ?? 0),
      lessonQuizzes: Number(quiz('LESSON').total),
      globalQuizzes: Number(quiz('GLOBAL').total),
    } satisfies ReleaseCounts,
    active: {
      courses: Number(course?.active ?? 0),
      enablers: Number(enabler?.active ?? 0),
      useCases: Number(useCase?.active ?? 0),
      lessonQuizzes: Number(quiz('LESSON').active),
      globalQuizzes: Number(quiz('GLOBAL').active),
    } satisfies ReleaseCounts,
    publishedCourses: Number(course?.published ?? 0),
  };
}

/** The numbers the tool shows before anything is changed. */
export async function loadReleaseOverview(
  q: Executor,
  catalogId: string
): Promise<ReleaseOverview | null> {
  const [catalog] = await q
    .select({
      id: trainingCatalogs.id,
      code: trainingCatalogs.code,
      title: trainingCatalogs.title,
      isActive: trainingCatalogs.isActive,
    })
    .from(trainingCatalogs)
    .where(eq(trainingCatalogs.id, catalogId))
    .limit(1);
  if (!catalog) return null;
  const c = await counts(q, catalogId);
  return {
    catalogId: String(catalog.id),
    code: catalog.code,
    title: catalog.title,
    catalogActive: catalog.isActive === true,
    total: c.total,
    active: c.active,
    publishedCourses: c.publishedCourses,
  };
}

/** Rows that would change for a mode, from the counts alone is not enough
 *  (courses also carry is_published), so it is counted in the database. */
async function countChanges(
  q: Executor,
  catalogId: string,
  mode: ReleaseMode
): Promise<ReleaseCounts> {
  const want = mode === 'release';
  const [course] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(courses)
    .where(
      and(
        eq(courses.trainingCatalogId, catalogId),
        sql`(${courses.isActive} is distinct from ${want} or ${courses.isPublished} is distinct from ${want})`
      )
    );
  const [enabler] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(enablers)
    .where(
      and(
        eq(enablers.trainingCatalogId, catalogId),
        sql`${enablers.isActive} is distinct from ${want}`
      )
    );
  const [useCase] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(useCases)
    .where(
      and(
        eq(useCases.trainingCatalogId, catalogId),
        sql`${useCases.isActive} is distinct from ${want}`
      )
    );
  const quizRows = await q
    .select({ type: quizzes.quizType, n: sql<number>`count(*)::int` })
    .from(quizzes)
    .where(
      and(
        eq(quizzes.trainingCatalogId, catalogId),
        sql`${quizzes.isActive} is distinct from ${want}`
      )
    )
    .groupBy(quizzes.quizType);
  const quiz = (type: string) =>
    Number(quizRows.find(r => String(r.type) === type)?.n ?? 0);
  return {
    courses: Number(course?.n ?? 0),
    enablers: Number(enabler?.n ?? 0),
    useCases: Number(useCase?.n ?? 0),
    lessonQuizzes: quiz('LESSON'),
    globalQuizzes: quiz('GLOBAL'),
  };
}

/**
 * Trial run or real change, in one transaction under the catalog lock. The
 * counts of a real run are the rows the writing statements returned. `actor`
 * is written to the protocol (activity_log) on execute.
 */
export async function runContentRelease(input: {
  catalogId: string;
  mode: ReleaseMode;
  execute: boolean;
  actor: { id: string; organizationId: string };
}): Promise<ReleaseResult | null> {
  return db.transaction(async tx => {
    await takeCatalogAdminLock(tx);
    const overview = await loadReleaseOverview(tx, input.catalogId);
    if (!overview) return null;

    const before = await countChanges(tx, input.catalogId, input.mode);
    if (!input.execute) {
      return {
        catalogId: overview.catalogId,
        code: overview.code,
        mode: input.mode,
        dryRun: true,
        changes: before,
        total: overview.total,
        active: overview.active,
        catalogActive: overview.catalogActive,
        logged: false,
      };
    }

    const want = input.mode === 'release';
    // The numbers of the answer are the rows these statements really changed
    // (returning), so a toggle by a trainer in between cannot make them wrong
    const changedCourses = await tx
      .update(courses)
      .set({ isActive: want, isPublished: want })
      .where(
        and(
          eq(courses.trainingCatalogId, input.catalogId),
          sql`(${courses.isActive} is distinct from ${want} or ${courses.isPublished} is distinct from ${want})`
        )
      )
      .returning({ id: courses.id });
    const changedEnablers = await tx
      .update(enablers)
      .set(
        want
          ? {
              isActive: true,
              // timestamp without time zone, written in UTC like the routes
              activatedAt: sql`coalesce(${enablers.activatedAt}, (now() at time zone 'utc'))`,
            }
          : { isActive: false }
      )
      .where(
        and(
          eq(enablers.trainingCatalogId, input.catalogId),
          sql`${enablers.isActive} is distinct from ${want}`
        )
      )
      .returning({ id: enablers.id });
    const changedUseCases = await tx
      .update(useCases)
      .set(
        want
          ? {
              isActive: true,
              activatedAt: sql`coalesce(${useCases.activatedAt}, (now() at time zone 'utc'))`,
            }
          : { isActive: false }
      )
      .where(
        and(
          eq(useCases.trainingCatalogId, input.catalogId),
          sql`${useCases.isActive} is distinct from ${want}`
        )
      )
      .returning({ id: useCases.id });
    const changedQuizzes = await tx
      .update(quizzes)
      .set({ isActive: want })
      .where(
        and(
          eq(quizzes.trainingCatalogId, input.catalogId),
          sql`${quizzes.isActive} is distinct from ${want}`
        )
      )
      .returning({ id: quizzes.id, type: quizzes.quizType });
    const changes: ReleaseCounts = {
      courses: changedCourses.length,
      enablers: changedEnablers.length,
      useCases: changedUseCases.length,
      lessonQuizzes: changedQuizzes.filter(q => String(q.type) === 'LESSON')
        .length,
      globalQuizzes: changedQuizzes.filter(q => String(q.type) === 'GLOBAL')
        .length,
    };

    // Protocol: who switched which catalog, with the numbers. A failing
    // protocol write (for example a refused permission) must not undo the change, it is reported as not logged. A foreign key violation is checked at commit and then fails the whole release, which is the safe way round.
    let logged = false;
    await tx.execute(sql`savepoint content_release_log`);
    try {
      await tx.insert(activityLog).values({
        userId: input.actor.id,
        organizationId: input.actor.organizationId,
        activityType:
          input.mode === 'release' ? 'CONTENT_RELEASE' : 'CONTENT_LOCK',
        relatedItemId: overview.catalogId,
        relatedItemTable: 'training_catalogs',
        context: { catalogCode: overview.code, changes },
      });
      logged = true;
    } catch (err) {
      console.error('[content-release] protocol row not written:', err);
      await tx.execute(sql`rollback to savepoint content_release_log`);
    }
    console.info(
      '[content-release]',
      JSON.stringify({
        mode: input.mode,
        catalog: overview.code,
        actor: input.actor.id,
        changes,
      })
    );

    return {
      catalogId: overview.catalogId,
      code: overview.code,
      mode: input.mode,
      dryRun: false,
      changes,
      total: overview.total,
      active: overview.active,
      catalogActive: overview.catalogActive,
      logged,
    };
  });
}
