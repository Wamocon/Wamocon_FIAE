// The engine of the learning field import (phase 4.5). It compares the plan with
// the target database and, if asked, writes what is missing. It knows no SQL and
// no connection: the Db interface of the apply step does that, and the caller
// owns the transaction (job.ts).
//
// Guarantees:
//  - only the catalog KFBM is written, and only if it exists and is active
//  - the content import comes first: without enablers in the catalog nothing is
//    written, and a mapping whose enabler is missing is reported as skipped
//  - idempotent: a learning field is identified by catalog and code, a mapping by
//    learning field and enabler. What exists is left as it is, a second run
//    writes nothing
//  - nothing is deleted. With updateExisting only the title of a learning field is
//    updated (never to a placeholder), nothing else. Mappings that the plan does
//    not name stay
//  - a structural conflict (a learning field exists with another school year, a
//    position is taken by another code) stops a writing run before the first
//    write, a comparison without write only reports it

import type { Db, Row } from '../apply/db';
import { ImportAbort } from '../apply/db';
import type { Conflict, Difference, TableCount } from '../apply/types';
import { validateLearningFieldPlan } from './plan';
import type { LearningFieldPlan, PlanMapping, PlanSkip } from './types';

const FIELDS = 'training_catalog_learning_fields' as const;
const MAPPINGS = 'training_catalog_content_mappings' as const;

export interface LearningFieldRunOptions {
  /** Update the title of learning fields that exist and differ. */
  updateExisting: boolean;
  /** false = only compare, nothing is written. */
  write: boolean;
}

export interface LearningFieldReport {
  catalog: string;
  tables: Record<string, TableCount>;
  /** Mappings the target cannot take: the enabler is not in the database. */
  skipped: PlanSkip[];
  conflicts: Conflict[];
  differences: Difference[];
  /** Mappings of the catalog that the plan does not name (kept as they are). */
  keptMappings: number;
  /** True when rows were written (inside the transaction). */
  wrote: boolean;
}

const pair = (fieldId: unknown, enablerId: unknown) =>
  `${String(fieldId)}|${String(enablerId)}`;

/**
 * Compares the plan with the target and, with options.write, writes what is
 * missing. Throws ImportAbort before the first write if the plan or the target
 * do not fit.
 */
export async function executeLearningFieldPlan(
  db: Db,
  plan: LearningFieldPlan,
  options: LearningFieldRunOptions
): Promise<LearningFieldReport> {
  const problems = validateLearningFieldPlan(plan);
  if (problems.length > 0) {
    throw new ImportAbort(
      'PLAN_INVALID',
      `The plan is not valid (${problems.length} problem(s)): ${problems.slice(0, 5).join('; ')}`
    );
  }
  const catalog = await db.findCatalog(plan.catalog);
  if (!catalog) {
    throw new ImportAbort(
      'CATALOG_MISSING',
      `The catalog ${plan.catalog} does not exist in the target database. Nothing was written.`
    );
  }
  if (!catalog.is_active) {
    throw new ImportAbort(
      'CATALOG_INACTIVE',
      `The catalog ${plan.catalog} is not active in the target database. Nothing was written.`
    );
  }
  const catalogId = catalog.id;
  const inCatalog = { training_catalog_id: catalogId };

  // State of the target, only the rows of this catalog ---------------------------
  const fieldRows = await db.select(FIELDS, inCatalog);
  const enablerRows = await db.select('enablers', inCatalog);
  if (enablerRows.length === 0) {
    throw new ImportAbort(
      'NO_ENABLERS',
      `The catalog ${plan.catalog} has no enablers yet. Run the content import first (enablers, then learning fields). Nothing was written.`
    );
  }
  const mappingRows = await db.select(MAPPINGS, inCatalog);

  const fieldByCode = new Map(fieldRows.map(r => [String(r.code), r]));
  const fieldByOrder = new Map(fieldRows.map(r => [Number(r.order_index), r]));
  // Only (course, code) is unique in the database. Two enablers of the catalog
  // with one code would make a mapping point at an arbitrary one: stop.
  const duplicateCodes = enablerRows
    .map(r => String(r.code))
    .filter((code, i, all) => all.indexOf(code) !== i);
  if (duplicateCodes.length > 0) {
    throw new ImportAbort(
      'ENABLER_CODE_DUPLICATE',
      `The catalog ${plan.catalog} has enablers with the same code in different courses (${[...new Set(duplicateCodes)].slice(0, 5).join(', ')}). Nothing was written.`
    );
  }
  const enablerId = new Map(
    enablerRows.map(r => [String(r.code), String(r.id)])
  );
  const existingPairs = new Set(
    mappingRows.map(r => pair(r.learning_field_id, r.enabler_id))
  );

  const counts: Record<string, TableCount> = {
    [FIELDS]: { insert: 0, update: 0, unchanged: 0 },
    [MAPPINGS]: { insert: 0, update: 0, unchanged: 0 },
  };
  const conflicts: Conflict[] = [];
  const differences: Difference[] = [];
  const updates: Array<{ id: string; patch: Row }> = [];

  // Learning fields ------------------------------------------------------------
  const newFields: typeof plan.learningFields = [];
  for (const field of plan.learningFields) {
    const existing = fieldByCode.get(field.code);
    if (!existing) {
      const holder = fieldByOrder.get(field.orderIndex);
      if (holder) {
        conflicts.push({
          table: FIELDS,
          key: field.code,
          reason: `The position ${field.orderIndex} is taken by the learning field ${String(holder.code)}.`,
        });
      }
      newFields.push(field);
      counts[FIELDS].insert += 1;
      continue;
    }
    if (Number(existing.training_year) !== field.trainingYear) {
      conflicts.push({
        table: FIELDS,
        key: field.code,
        reason: `The learning field exists with school year ${String(existing.training_year)}, the plan says ${field.trainingYear}.`,
      });
      continue;
    }
    // A placeholder never replaces a title that exists.
    const titleDiffers =
      field.titleSource !== 'placeholder' && existing.title !== field.title;
    const orderDiffers = Number(existing.order_index) !== field.orderIndex;
    if (titleDiffers || orderDiffers) {
      differences.push({
        table: FIELDS,
        key: field.code,
        columns: [
          ...(titleDiffers ? ['title'] : []),
          ...(orderDiffers ? ['order_index'] : []),
        ],
      });
    }
    // --update-existing replaces a title only by a title of the owner (titles
    // file) or when the title is still the placeholder. A provisional title of
    // the source list is reported, it never overwrites a title that was set.
    const mayUpdate =
      field.titleSource === 'json' ||
      existing.title === `Lernfeld ${field.number}`;
    if (titleDiffers && options.updateExisting && mayUpdate) {
      counts[FIELDS].update += 1;
      updates.push({ id: String(existing.id), patch: { title: field.title } });
    } else {
      counts[FIELDS].unchanged += 1;
    }
  }

  // Mappings -------------------------------------------------------------------
  const newMappings: PlanMapping[] = [];
  const skippedByEnabler = new Map<string, PlanSkip>();
  const wantedPairs = new Set<string>();
  for (const mapping of plan.mappings) {
    const eId = enablerId.get(mapping.enablerCode);
    if (!eId) {
      const skip = skippedByEnabler.get(mapping.enablerCode);
      if (skip) {
        skip.pairs += 1;
      } else {
        skippedByEnabler.set(mapping.enablerCode, {
          row: mapping.row,
          column: null,
          code: 'ENABLER_NOT_IN_DATABASE',
          enablerCode: mapping.enablerCode,
          componentCode: mapping.componentCode,
          learningField: null,
          pairs: 1,
          reason:
            'The enabler is not in the target database (run the content import first).',
        });
      }
      continue;
    }
    const field = fieldByCode.get(mapping.learningFieldCode);
    if (field) wantedPairs.add(pair(field.id, eId));
    if (field && existingPairs.has(pair(field.id, eId))) {
      counts[MAPPINGS].unchanged += 1;
    } else {
      counts[MAPPINGS].insert += 1;
      newMappings.push(mapping);
    }
  }
  const keptMappings = mappingRows.filter(
    r => !wantedPairs.has(pair(r.learning_field_id, r.enabler_id))
  ).length;

  if (conflicts.length > 0 && options.write) {
    throw new ImportAbort(
      'CONFLICTS',
      `${conflicts.length} conflict(s) between the plan and the target database. Nothing was written.`,
      conflicts
    );
  }

  const report: LearningFieldReport = {
    catalog: plan.catalog,
    tables: counts,
    skipped: [...skippedByEnabler.values()],
    conflicts,
    differences,
    keptMappings,
    wrote: false,
  };
  if (!options.write) return report;

  // Write, parents first -------------------------------------------------------
  const fieldId = new Map<string, string>(
    fieldRows.map(r => [String(r.code), String(r.id)])
  );
  for (const row of await db.insert(
    FIELDS,
    newFields.map(field => ({
      training_catalog_id: catalogId,
      code: field.code,
      title: field.title,
      description: null,
      training_year: field.trainingYear,
      hours_budget: field.hoursBudget,
      order_index: field.orderIndex,
    }))
  )) {
    fieldId.set(String(row.code), String(row.id));
  }
  await db.insert(
    MAPPINGS,
    newMappings.map(mapping => ({
      learning_field_id: fieldId.get(mapping.learningFieldCode) as string,
      enabler_id: enablerId.get(mapping.enablerCode) as string,
      training_catalog_id: catalogId,
    }))
  );
  for (const update of updates) {
    await db.update(FIELDS, update.id, update.patch);
  }
  report.wrote = true;
  return report;
}
