/**
 * Server side loading of the phase plan (see phase-plan.ts) of a catalog. Never
 * throws: if the settings cannot be read or are unusable, the plan of the
 * time before the catalogs (18 + 18 months, 12 + 12 shortened) applies, so a
 * failing lookup can never break a page or a report.
 */

import { eq } from 'drizzle-orm';
import db from '@/db';
import { trainingCatalogs } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import { getCatalogScopeForUserId } from '@/lib/catalog/scope';
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
 * user's catalog scope (a trainee: the latest enrollment, without one FIAE).
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
