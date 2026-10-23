/**
 * Learning field access for the legacy `lernfelder` routes. The routes keep
 * their response shape (label = code of the catalog learning field), but read
 * and write training_catalog_learning_fields of the caller's catalogs instead
 * of the FIAE-only compatibility view.
 */

import { eq, max, sql } from 'drizzle-orm';
import db from '@/db';
import { trainingCatalogLearningFields as lf } from '@/db/migrations/schemas/schema';

/** Select list that maps a catalog learning field to the legacy row shape. */
export const legacyLearningFieldSelect = {
  id: lf.id,
  title: lf.title,
  description: lf.description,
  label: lf.code,
  createdAt: lf.createdAt,
  updatedAt: lf.updatedAt,
  trainingCatalogId: lf.trainingCatalogId,
};

/**
 * Training year (1 to 3) from the number in a label such as "LF-7": 1 to 5
 * year 1, 6 to 10 year 2, 11 and above year 3, no number defaults to year 1.
 * Same rule as supabase/migrations/20261024000500_learning_field_model.sql.
 */
export function labelTrainingYear(label: string): number {
  const match = /^\s*LF[\s._-]*(\d{1,3})/i.exec(label);
  if (!match) return 1;
  const n = Number(match[1]);
  if (n <= 5) return 1;
  if (n <= 10) return 2;
  return 3;
}

/** Message of the 409 answer when a label (code) already exists. */
export const LEARNING_FIELD_LABEL_CONFLICT =
  'A learning field with this label already exists in the catalog';

/**
 * True when the error is the unique violation of (training_catalog_id, code),
 * i.e. the label is already taken in the catalog. Drizzle wraps the driver
 * error, the code and constraint name are on the cause.
 */
export function isLearningFieldLabelConflict(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const pg = cause as { code?: string; constraint_name?: string } | undefined;
  return (
    pg?.code === '23505' &&
    String(pg.constraint_name ?? '').includes('catalog_code_unique')
  );
}

/** Advisory lock key that serialises order_index assignment per catalog. */
export function learningFieldLockKey(catalogId: string): string {
  return `training_catalog_learning_fields:${catalogId}`;
}

/**
 * Create a learning field in a catalog. The order_index (max + 1) is assigned
 * under a transaction level advisory lock, so two parallel creates cannot pick
 * the same index (the view trigger takes the same lock). A taken label raises
 * the unique violation, see isLearningFieldLabelConflict.
 */
export async function createLearningField(input: {
  catalogId: string;
  label: string;
  title: string;
  description?: string | null;
}) {
  return db.transaction(async tx => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${learningFieldLockKey(input.catalogId)}))`
    );
    const [last] = await tx
      .select({ maxIndex: max(lf.orderIndex) })
      .from(lf)
      .where(eq(lf.trainingCatalogId, input.catalogId));
    const [row] = await tx
      .insert(lf)
      .values({
        trainingCatalogId: input.catalogId,
        code: input.label,
        title: input.title,
        description: input.description,
        trainingYear: labelTrainingYear(input.label),
        orderIndex: Number(last?.maxIndex ?? 0) + 1,
      })
      .returning(legacyLearningFieldSelect);
    return row;
  });
}

/** Next free order_index in a catalog. */
export async function nextLearningFieldOrderIndex(
  catalogId: string
): Promise<number> {
  const [row] = await db
    .select({ maxIndex: max(lf.orderIndex) })
    .from(lf)
    .where(eq(lf.trainingCatalogId, catalogId));
  return Number(row?.maxIndex ?? 0) + 1;
}
