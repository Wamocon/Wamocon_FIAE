/**
 * Learning field access for the legacy `lernfelder` routes. The routes keep
 * their response shape (label = code of the catalog learning field), but read
 * and write training_catalog_learning_fields of the caller's catalogs instead
 * of the FIAE-only compatibility view.
 */

import { eq, max } from 'drizzle-orm';
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
 * Same rule as supabase/migrations/20261020000500_learning_field_model.sql.
 */
export function labelTrainingYear(label: string): number {
  const match = /^\s*LF[\s._-]*(\d{1,3})/i.exec(label);
  if (!match) return 1;
  const n = Number(match[1]);
  if (n <= 5) return 1;
  if (n <= 10) return 2;
  return 3;
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
