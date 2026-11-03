import { eq, sql } from 'drizzle-orm';
import db from '@/db';
import { trainingCatalogs } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import {
  contentPlanSchema,
  countPlanFields,
  planSourceSchema,
  readStoredContentPlan,
  safeFileName,
  storedContentPlanSchema,
  type ContentPlan,
  type PlanMethod,
  type StoredContentPlan,
} from '@/lib/catalog/content-plan/types';

/**
 * Storage of the confirmed plan: training_catalogs.settings.content_plan (jsonb,
 * no migration). One statement per change, atomic on the row, the other
 * settings keys (content_targets and the rest) stay as they are. Only the
 * plan and its source are stored, never the file.
 */

/** The stored plan of a catalog, null when none, undefined for an unknown catalog. */
export async function getContentPlan(
  catalogId: string
): Promise<StoredContentPlan | null | undefined> {
  const [row] = await withDbRetry(() =>
    db
      .select({ settings: trainingCatalogs.settings })
      .from(trainingCatalogs)
      .where(eq(trainingCatalogs.id, catalogId))
  );
  if (!row) return undefined;
  return readStoredContentPlan(row.settings);
}

export type SavePlanResult =
  | { ok: true; stored: StoredContentPlan }
  | {
      ok: false;
      code: 'CATALOG_NOT_FOUND' | 'EMPTY_PLAN' | 'INVALID_PLAN' | 'TOO_LARGE';
    };

/**
 * Saves a confirmed plan (the caller checked the right). The time and the number
 * of fields are set here, the file name is cut to a plain name. An empty plan is
 * refused: nothing would be stored, the plan is removed with delete.
 */
export async function saveContentPlan(
  catalogId: string,
  input: { plan: ContentPlan; fileName: string; method: PlanMethod },
  now: Date = new Date()
): Promise<SavePlanResult> {
  const plan = contentPlanSchema.safeParse(input.plan);
  if (!plan.success) return { ok: false, code: 'INVALID_PLAN' };
  const fieldCount = countPlanFields(plan.data);
  if (fieldCount === 0) return { ok: false, code: 'EMPTY_PLAN' };
  const source = planSourceSchema.safeParse({
    fileName: safeFileName(input.fileName),
    savedAt: now.toISOString(),
    fieldCount,
    method: input.method,
  });
  if (!source.success) return { ok: false, code: 'INVALID_PLAN' };
  const stored = storedContentPlanSchema.safeParse({
    plan: plan.data,
    source: source.data,
  });
  if (!stored.success) {
    const tooLarge = stored.error.issues.some(i =>
      i.message.includes('too large')
    );
    return { ok: false, code: tooLarge ? 'TOO_LARGE' : 'INVALID_PLAN' };
  }

  const [row] = await withDbRetry(() =>
    db
      .select({ id: trainingCatalogs.id })
      .from(trainingCatalogs)
      .where(eq(trainingCatalogs.id, catalogId))
  );
  if (!row) return { ok: false, code: 'CATALOG_NOT_FOUND' };
  await withDbRetry(() =>
    db
      .update(trainingCatalogs)
      .set({
        settings: sql`jsonb_set(${trainingCatalogs.settings}, '{content_plan}', ${JSON.stringify(stored.data)}::jsonb, true)`,
      })
      .where(eq(trainingCatalogs.id, catalogId))
  );
  return { ok: true, stored: stored.data };
}

/** Removes the plan. False for an unknown catalog. Idempotent. */
export async function deleteContentPlan(catalogId: string): Promise<boolean> {
  const [row] = await withDbRetry(() =>
    db
      .select({ id: trainingCatalogs.id })
      .from(trainingCatalogs)
      .where(eq(trainingCatalogs.id, catalogId))
  );
  if (!row) return false;
  await withDbRetry(() =>
    db
      .update(trainingCatalogs)
      .set({ settings: sql`${trainingCatalogs.settings} - 'content_plan'` })
      .where(eq(trainingCatalogs.id, catalogId))
  );
  return true;
}
