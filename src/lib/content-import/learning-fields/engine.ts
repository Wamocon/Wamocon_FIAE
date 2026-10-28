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
//  - nothing is deleted. A description that is empty is filled from the plan
//    (the verbatim Zielformulierung), a description that has text is never
//    replaced without updateExisting. With updateExisting only the title, the
//    description and the hours (hours_budget) of a learning field are updated
//    (a title never to a placeholder, the hours and the description never to
//    empty), nothing else. Mappings that the plan does not name stay
//  - use cases: every mapping (learning field, enabler) also gets a mapping
//    (learning field, use case) for the use case of the enabler
//    (use_cases.enabler_id, read from the database, the plan does not carry
//    it). It is a row of its own with use_case_id (the table allows exactly one
//    of enabler_id and use_case_id per row). The learning field pages read the
//    text array use_cases.lernfelder, so the code of the learning field is
//    added there too (only added, never removed or reordered). Enablers
//    without a use case and use cases without an enabler are reported. A first
//    run before the use case import writes no use case rows, a second run
//    after it adds them
//  - a structural conflict (a learning field exists with another school year, a
//    position is taken by another code) stops a writing run before the first
//    write, a comparison without write only reports it

import { lengthChangesOf } from '../descriptions';
import type { Db, Row } from '../apply/db';
import { ImportAbort } from '../apply/db';
import type { Conflict, Difference, TableCount } from '../apply/types';
import { learningFieldNumber } from './model';
import { validateLearningFieldPlan } from './plan';
import type { LearningFieldPlan, PlanMapping, PlanSkip } from './types';

const FIELDS = 'training_catalog_learning_fields' as const;
const MAPPINGS = 'training_catalog_content_mappings' as const;
const USE_CASES = 'use_cases' as const;

export interface LearningFieldRunOptions {
  /**
   * Update the title, the description and the hours of learning fields that
   * exist and differ. An empty description is filled without it.
   */
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
  /**
   * Mappings (learning field, use case) in training_catalog_content_mappings,
   * counted apart from the enabler rows in tables.
   */
  useCaseMappings: TableCount;
  /**
   * use_cases.lernfelder: update = use cases that get at least one code added,
   * unchanged = use cases that carry all their codes.
   */
  useCaseCodes: TableCount;
  /** Mapped enablers (codes) that have no use case: nothing to map for them. */
  enablersWithoutUseCase: string[];
  /** Use cases of the catalog (codes) that are linked to no enabler. */
  useCasesWithoutEnabler: string[];
  /** True when rows were written (inside the transaction). */
  wrote: boolean;
}

const pair = (fieldId: unknown, contentId: unknown) =>
  `${String(fieldId)}|${String(contentId)}`;

/** The one content link of a mapping row: the enabler or the use case. */
const contentOf = (row: Row) => row.enabler_id ?? row.use_case_id;

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
  const useCaseRows = await db.select(USE_CASES, inCatalog);

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
  // Enabler rows and use case rows share the set: the ids of the two tables
  // never meet.
  const existingPairs = new Set(
    mappingRows.map(r => pair(r.learning_field_id, contentOf(r)))
  );
  const useCaseOfEnabler = new Map<string, Row>();
  const useCasesWithoutEnabler: string[] = [];
  for (const row of useCaseRows) {
    if (row.enabler_id === null || row.enabler_id === undefined) {
      useCasesWithoutEnabler.push(String(row.code ?? row.id));
    } else if (useCaseOfEnabler.has(String(row.enabler_id))) {
      // The database has a unique key on use_cases.enabler_id, this only stops
      // a copy of the data that lacks it.
      throw new ImportAbort(
        'USE_CASE_ENABLER_DUPLICATE',
        `The catalog ${plan.catalog} has two use cases linked to one enabler. Nothing was written.`
      );
    } else {
      useCaseOfEnabler.set(String(row.enabler_id), row);
    }
  }

  const counts: Record<string, TableCount> = {
    [FIELDS]: { insert: 0, update: 0, unchanged: 0 },
    [MAPPINGS]: { insert: 0, update: 0, unchanged: 0 },
  };
  const useCaseMappings: TableCount = { insert: 0, update: 0, unchanged: 0 };
  const useCaseCodes: TableCount = { insert: 0, update: 0, unchanged: 0 };
  const conflicts: Conflict[] = [];
  const differences: Difference[] = [];
  const updates: Array<{
    table: typeof FIELDS | typeof USE_CASES;
    id: string;
    patch: Row;
  }> = [];

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
    // A plan without hours never erases hours that exist.
    const hoursDiffers =
      field.hoursBudget !== null &&
      (existing.hours_budget === null ||
        existing.hours_budget === undefined ||
        Number(existing.hours_budget) !== field.hoursBudget);
    const orderDiffers = Number(existing.order_index) !== field.orderIndex;
    // A plan without a description never erases one that exists. An empty
    // description (null or only white space) is filled, a description with text
    // is only replaced with --update-existing.
    const wantedDescription = field.description ?? null;
    const hasDescription = String(existing.description ?? '').trim() !== '';
    const descriptionFills = wantedDescription !== null && !hasDescription;
    const descriptionDiffers =
      wantedDescription !== null &&
      hasDescription &&
      existing.description !== wantedDescription;
    if (
      titleDiffers ||
      hoursDiffers ||
      orderDiffers ||
      descriptionFills ||
      descriptionDiffers
    ) {
      const columns = [
        ...(titleDiffers ? ['title'] : []),
        ...(descriptionFills || descriptionDiffers ? ['description'] : []),
        ...(hoursDiffers ? ['hours_budget'] : []),
        ...(orderDiffers ? ['order_index'] : []),
      ];
      const lengths = lengthChangesOf(columns, existing, {
        description: wantedDescription,
      });
      differences.push({
        table: FIELDS,
        key: field.code,
        columns,
        ...(lengths ? { lengths } : {}),
      });
    }
    // --update-existing replaces a title only by an official title, a title of
    // the owner (titles file) or when the title is still the placeholder. A
    // provisional title of the source list is reported, it never overwrites a
    // title that was set. The hours are set from the plan. Only these two
    // columns are ever written, the school year and the order never.
    const mayUpdate =
      field.titleSource === 'json' ||
      field.titleSource === 'official' ||
      existing.title === `Lernfeld ${field.number}`;
    const patch: Row = {};
    if (titleDiffers && mayUpdate) patch.title = field.title;
    if (hoursDiffers) patch.hours_budget = field.hoursBudget;
    if (descriptionFills || descriptionDiffers) {
      patch.description = wantedDescription;
    }
    // Filling an empty description needs no --update-existing.
    const applied: Row = options.updateExisting
      ? patch
      : descriptionFills
        ? { description: wantedDescription }
        : {};
    if (Object.keys(applied).length > 0) {
      counts[FIELDS].update += 1;
      updates.push({ table: FIELDS, id: String(existing.id), patch: applied });
    } else {
      counts[FIELDS].unchanged += 1;
    }
  }

  // Mappings -------------------------------------------------------------------
  const newMappings: PlanMapping[] = [];
  const newUseCaseMappings: Array<{ mapping: PlanMapping; useCaseId: string }> =
    [];
  const codesOfUseCase = new Map<string, { row: Row; codes: string[] }>();
  const enablersWithoutUseCase = new Set<string>();
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

    // The same learning field for the use case of the enabler.
    const useCase = useCaseOfEnabler.get(eId);
    if (!useCase) {
      enablersWithoutUseCase.add(mapping.enablerCode);
      continue;
    }
    const useCaseId = String(useCase.id);
    const entry = codesOfUseCase.get(useCaseId) ?? { row: useCase, codes: [] };
    entry.codes.push(mapping.learningFieldCode);
    codesOfUseCase.set(useCaseId, entry);
    if (field) wantedPairs.add(pair(field.id, useCaseId));
    if (field && existingPairs.has(pair(field.id, useCaseId))) {
      useCaseMappings.unchanged += 1;
    } else {
      useCaseMappings.insert += 1;
      newUseCaseMappings.push({ mapping, useCaseId });
    }
  }

  // use_cases.lernfelder: add the codes that are missing, keep the others.
  const codeNumber = (code: string) => learningFieldNumber(code) ?? 99;
  for (const [useCaseId, { row, codes }] of codesOfUseCase) {
    // A NULL element of the array is not a code and is not carried over.
    const present = Array.isArray(row.lernfelder)
      ? row.lernfelder.filter((c): c is string => typeof c === 'string')
      : [];
    const missing = [...new Set(codes)]
      .filter(code => !present.includes(code))
      .sort((a, b) => codeNumber(a) - codeNumber(b));
    if (missing.length === 0) {
      useCaseCodes.unchanged += 1;
    } else {
      useCaseCodes.update += 1;
      updates.push({
        table: USE_CASES,
        id: useCaseId,
        patch: { lernfelder: [...present, ...missing] },
      });
    }
  }
  const keptMappings = mappingRows.filter(
    r => !wantedPairs.has(pair(r.learning_field_id, contentOf(r)))
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
    useCaseMappings,
    useCaseCodes,
    enablersWithoutUseCase: [...enablersWithoutUseCase],
    useCasesWithoutEnabler,
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
      description: field.description ?? null,
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
  await db.insert(
    MAPPINGS,
    newUseCaseMappings.map(({ mapping, useCaseId }) => ({
      learning_field_id: fieldId.get(mapping.learningFieldCode) as string,
      use_case_id: useCaseId,
      training_catalog_id: catalogId,
    }))
  );
  for (const update of updates) {
    await db.update(update.table, update.id, update.patch);
  }
  report.wrote = true;
  return report;
}
