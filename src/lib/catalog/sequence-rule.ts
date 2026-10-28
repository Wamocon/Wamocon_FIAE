/**
 * The cut-off date of the order of work of a training catalog
 * (training_catalogs.settings.sequence_since, see progression.ts for what it
 * means). The platform admin sets it, never an automatic job: from this moment
 * on, a trainee who joins the catalog works through the enablers one after the
 * other, everybody who joined before keeps working as before.
 *
 * Without a migration: the value is one more key of the settings object. The
 * save is one statement, atomic on the row, the other keys stay as they are,
 * and the change is written to the activity log in the same transaction.
 */

import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import db from '@/db';
import { activityLog, trainingCatalogs } from '@/db/migrations/schemas/schema';
import { readSequenceSince } from '@/lib/catalog/progression';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The body of the save request: { since: "2026-11-01" | an ISO timestamp |
 * null }. A date without a time means the start of that day in UTC. null
 * removes the cut-off date (the order is not in force for the catalog).
 */
export const sequenceRuleBodySchema = z
  .object({
    since: z
      .string()
      .trim()
      .refine(
        value =>
          (DATE_ONLY.test(value) || /^\d{4}-\d{2}-\d{2}T/.test(value)) &&
          !Number.isNaN(Date.parse(value)),
        'invalid date'
      )
      .nullable(),
  })
  .strict();

/** The stored form: always a full UTC timestamp. */
export function normalizeSince(value: string): string {
  return new Date(
    DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value
  ).toISOString();
}

/** The cut-off date of a catalog as an ISO string, null when none is set, undefined for an unknown catalog. */
export async function getSequenceSince(
  catalogId: string
): Promise<string | null | undefined> {
  const [row] = await db
    .select({ settings: trainingCatalogs.settings })
    .from(trainingCatalogs)
    .where(eq(trainingCatalogs.id, catalogId));
  if (!row) return undefined;
  return readSequenceSince(row.settings)?.toISOString() ?? null;
}

/**
 * Set or remove the cut-off date (the caller checked the right and validated
 * the input). Returns the stored value, or undefined for an unknown catalog.
 */
export async function saveSequenceSince(
  catalogId: string,
  since: string | null,
  actor: { id: string; organizationId: string | null }
): Promise<string | null | undefined> {
  const stored = since === null ? null : normalizeSince(since);
  return db.transaction(async tx => {
    const [before] = await tx
      .select({
        settings: trainingCatalogs.settings,
        code: trainingCatalogs.code,
      })
      .from(trainingCatalogs)
      .where(eq(trainingCatalogs.id, catalogId));
    if (!before) return undefined;
    const next =
      stored === null
        ? sql`${trainingCatalogs.settings} - 'sequence_since'`
        : sql`jsonb_set(${trainingCatalogs.settings}, '{sequence_since}', ${JSON.stringify(stored)}::jsonb, true)`;
    await tx
      .update(trainingCatalogs)
      .set({ settings: next })
      .where(eq(trainingCatalogs.id, catalogId));
    if (actor.organizationId) {
      await tx.insert(activityLog).values({
        userId: actor.id,
        organizationId: actor.organizationId,
        activityType: 'CATALOG_SEQUENCE_RULE',
        relatedItemId: catalogId,
        relatedItemTable: 'training_catalogs',
        context: {
          catalogCode: before.code,
          previous: readSequenceSince(before.settings)?.toISOString() ?? null,
          value: stored,
        },
      });
    }
    return stored;
  });
}
