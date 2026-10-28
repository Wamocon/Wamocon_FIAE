/**
 * Server side loading of the phase plan (see phase-plan.ts) of a catalog. Never
 * throws: if the settings cannot be read or are unusable, the plan of the
 * time before the catalogs (18 + 18 months, 12 + 12 shortened) applies, so a
 * failing lookup can never break a page or a report.
 *
 * A trainee can be enrolled in several trainings. The plan belongs to one of
 * them: the one the request works in (the occupation tab), otherwise the first
 * enrollment of the trainee (src/lib/catalog/enrollments.ts).
 */

import { eq, inArray } from 'drizzle-orm';
import db from '@/db';
import {
  profiles,
  traineeEnrollments,
  trainingCatalogs,
} from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import { FIAE_CATALOG_ID, getCatalogScopeForUserId } from '@/lib/catalog/scope';
import {
  effectiveEnrollmentTerms,
  sortEnrollments,
  type EnrollmentTerms,
} from '@/lib/catalog/enrollments';
import { resolvePhasePlan, type PhasePlan } from '@/lib/catalog/phase-plan';

/** Phase plan of one catalog for a trainee with the given duration. */
export async function loadPhasePlan(
  catalogId: string | null | undefined,
  durationYears: number | null | undefined
): Promise<PhasePlan> {
  if (!catalogId) return resolvePhasePlan(null, durationYears);
  try {
    const [row] = (await withDbRetry(() =>
      db
        .select({ settings: trainingCatalogs.settings })
        .from(trainingCatalogs)
        .where(eq(trainingCatalogs.id, catalogId))
        .limit(1)
    )) as { settings: unknown }[];
    return resolvePhasePlan(row?.settings, durationYears);
  } catch (err) {
    console.error('[phase-plan] settings lookup failed, using defaults:', err);
    return resolvePhasePlan(null, durationYears);
  }
}

/**
 * Phase plan of the occupation a user is in: the active catalog of the
 * user's catalog scope (a trainee: the first enrollment, without one FIAE).
 * It is the plan of the DEFAULT occupation on purpose. The callers store what
 * they compute from it (the training year of a school block or an exam), and
 * those records belong to the trainee, not to one of the trainings, so the
 * value must not depend on which tab was open when the record was saved. What
 * is only shown follows the tab in the browser (phaseOneMonthsFor of
 * useRequestCatalog).
 */
export async function loadPhasePlanForUser(
  userId: string,
  durationYears: number | null | undefined
): Promise<PhasePlan> {
  try {
    const scope = await getCatalogScopeForUserId(userId);
    return await loadPhasePlan(scope?.activeCatalogId, durationYears);
  } catch (err) {
    console.error('[phase-plan] scope lookup failed, using defaults:', err);
    return resolvePhasePlan(null, durationYears);
  }
}

/**
 * Start date and duration a trainee counts with in one catalog: the profile
 * values for the first enrollment, the own values of a further one (see
 * effectiveEnrollmentTerms). Null if the trainee has no enrollment in the
 * catalog or the lookup fails, the caller then keeps the profile values.
 * Never throws.
 */
export async function loadEnrollmentTerms(
  userId: string,
  catalogId: string,
  database: typeof db = db
): Promise<EnrollmentTerms | null> {
  try {
    const [enrollments, [profile]] = await Promise.all([
      withDbRetry(() =>
        database
          .select({
            trainingCatalogId: traineeEnrollments.trainingCatalogId,
            startDate: traineeEnrollments.startDate,
            durationYears: traineeEnrollments.durationYears,
            createdAt: traineeEnrollments.createdAt,
          })
          .from(traineeEnrollments)
          .where(eq(traineeEnrollments.traineeId, userId as any))
      ),
      withDbRetry(() =>
        database
          .select({
            startOfTrainingDate: profiles.startOfTrainingDate,
            ausbildungDurationYears: profiles.ausbildungDurationYears,
          })
          .from(profiles)
          .where(eq(profiles.id, userId as any))
          .limit(1)
      ),
    ]);
    if (!profile) return null;
    const ordered = sortEnrollments(
      enrollments.map(e => ({
        ...e,
        trainingCatalogId: String(e.trainingCatalogId),
      }))
    );
    const target = ordered.find(e => e.trainingCatalogId === catalogId);
    if (!target) return null;
    return effectiveEnrollmentTerms({
      enrollment: target,
      isPrimary: ordered[0] === target,
      profile: {
        startDate: profile.startOfTrainingDate as string | Date | null,
        durationYears: profile.ausbildungDurationYears,
      },
    });
  } catch (err) {
    console.error('[phase-plan] enrollment terms lookup failed:', err);
    return null;
  }
}

/**
 * Phase plans of many trainees at once (the trainer lists), in two queries
 * instead of one scope lookup per trainee. Same rule as the scope of one
 * trainee: the occupation of the first enrollment (or the occupation the list
 * was opened in, `preferredCatalogId`, for a trainee who is enrolled in it),
 * FIAE without an enrollment. It does not check that the occupation is enabled
 * for the organization, the plan describes the training the trainee is
 * enrolled in. Never throws, every listed trainee gets a plan (the previous
 * lengths if the lookup fails). The map is keyed by the id as a string.
 * `database` is the main database by default, HAI hands over its own (it reads
 * the trainees from there, so it reads their occupation from there too).
 */
export async function loadPhasePlansForUsers(
  users: { id: string; durationYears: number | null | undefined }[],
  database: typeof db = db,
  preferredCatalogId?: string | null
): Promise<Map<string, PhasePlan>> {
  const plans = new Map<string, PhasePlan>();
  if (users.length === 0) return plans;

  try {
    const ids = [...new Set(users.map(user => String(user.id)))];
    const enrollments = (await withDbRetry(() =>
      database
        .select({
          traineeId: traineeEnrollments.traineeId,
          trainingCatalogId: traineeEnrollments.trainingCatalogId,
          startDate: traineeEnrollments.startDate,
          createdAt: traineeEnrollments.createdAt,
        })
        .from(traineeEnrollments)
        .where(inArray(traineeEnrollments.traineeId, ids as any))
    )) as {
      traineeId: string;
      trainingCatalogId: string;
      startDate: string | null;
      createdAt?: Date | string | null;
    }[];

    // The first enrollment, like the catalog scope of one trainee. The
    // preferred occupation wins for a trainee who is enrolled in it.
    const catalogOf = new Map<string, string>();
    sortEnrollments(
      enrollments.map(row => ({
        ...row,
        trainingCatalogId: String(row.trainingCatalogId),
      }))
    ).forEach(row => {
      const traineeId = String(row.traineeId);
      if (preferredCatalogId && row.trainingCatalogId === preferredCatalogId) {
        catalogOf.set(traineeId, row.trainingCatalogId);
      } else if (!catalogOf.has(traineeId)) {
        catalogOf.set(traineeId, row.trainingCatalogId);
      }
    });

    const catalogIds = [
      ...new Set(ids.map(id => catalogOf.get(id) ?? FIAE_CATALOG_ID)),
    ];
    const rows = (await withDbRetry(() =>
      database
        .select({
          id: trainingCatalogs.id,
          settings: trainingCatalogs.settings,
        })
        .from(trainingCatalogs)
        .where(inArray(trainingCatalogs.id, catalogIds as any))
    )) as { id: string; settings: unknown }[];
    const settingsOf = new Map(rows.map(row => [String(row.id), row.settings]));

    for (const user of users) {
      const id = String(user.id);
      const catalogId = catalogOf.get(id) ?? FIAE_CATALOG_ID;
      plans.set(
        id,
        resolvePhasePlan(settingsOf.get(catalogId), user.durationYears)
      );
    }
  } catch (err) {
    console.error('[phase-plan] batch lookup failed, using defaults:', err);
    for (const user of users) {
      plans.set(String(user.id), resolvePhasePlan(null, user.durationYears));
    }
  }
  return plans;
}
