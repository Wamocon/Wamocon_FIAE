// The engine of the use case import (phase 4.6). It compares the plan with the
// target database and, if asked, writes what is missing. It knows no SQL and no
// connection: the Db interface of the apply step does that, and the caller owns
// the transaction (job.ts).
//
// Guarantees:
//  - only the catalog KFBM is written, and only if it exists and is active
//  - the content import comes first: a use case whose course or enabler is not
//    in the catalog is skipped and reported, a catalog without any enabler
//    stops the run
//  - idempotent: a use case is identified by course and code (component code
//    and letter), a document row by use case, type and title. What exists is
//    left as it is, a second run writes nothing
//  - nothing is deleted, nothing is overwritten. With updateExisting only the
//    named columns of tables.ts are updated (the visible texts and the
//    position of a use case, the description of a document row)
//  - a structural conflict (the use case exists for another enabler, the
//    enabler already has another use case, a document exists with another
//    visibility) stops a writing run before the first write, a comparison
//    without write only reports it
//  - solutions stay in their place: the model solution and the criteria are
//    written only with options.solutions, as TRAINER_SOLUTION documents with
//    the visibility TRAINER_ONLY. Without the switch they are not written at
//    all (the policy cd_select of content_documents lets the public key read
//    rows without an organization). guard.ts checks every row before it is
//    written
//  - new use cases are inactive unless the decisions say otherwise

import type { Db, Row } from '../apply/db';
import { ImportAbort } from '../apply/db';
import { TABLES } from '../apply/tables';
import type { TableName } from '../apply/tables';
import type {
  Conflict,
  Difference,
  ItemEvent,
  TableCount,
} from '../apply/types';
import {
  findUseCaseRowLeaks,
  leakInUseCaseText,
  solutionTextsOfUseCases,
} from './guard';
import { validateUseCasePlan } from './plan';
import type { PlanUseCase, UseCasePlan } from './types';

export interface UseCaseRunOptions {
  /** Profile entered as uploader of the document rows. */
  createdBy: string;
  /** Update the named columns of rows that exist and differ. */
  updateExisting: boolean;
  /** false = only compare, nothing is written. */
  write: boolean;
  /**
   * is_active of new use cases. Taken from the decisions file by the caller,
   * never from the plan file.
   */
  activate: boolean;
  /** Also write the model solution and the criteria (trainer only rows). */
  solutions: boolean;
  /**
   * Called for every item the comparison classifies (new, unchanged, differs,
   * conflict), with the key of the differences and conflicts. Gets no row content.
   */
  observe?: (event: ItemEvent) => void;
  /**
   * With updateExisting: asks for every row that differs whether it may be
   * updated. A refused row stays as it is and is still reported as a difference.
   */
  updateFilter?: (table: TableName, key: string) => boolean;
}

export interface UseCaseSkipInDb {
  code: string;
  useCaseCode: string;
  reason: string;
}

export interface UseCaseReport {
  catalog: string;
  tables: Record<'use_cases' | 'content_documents', TableCount>;
  /** Use cases the target cannot take: the course or the enabler is missing. */
  skipped: UseCaseSkipInDb[];
  conflicts: Conflict[];
  differences: Difference[];
  /** Solution rows that were not written because the switch is off. */
  withheldSolutionRows: number;
  /** True when rows were written (inside the transaction). */
  wrote: boolean;
}

const USE_CASES = 'use_cases' as const;
const DOCUMENTS = 'content_documents' as const;

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * The document rows of one use case: the topics for everyone and, only with
 * withSolutions, the model solution and the criteria for trainers.
 */
export function documentRowsOfUseCase(
  useCase: PlanUseCase,
  useCaseId: string,
  createdBy: string,
  withSolutions: boolean
): Row[] {
  const common = {
    enabler_id: null,
    use_case_id: useCaseId,
    course_id: null,
    organization_id: null,
    file_name: baseName(useCase.source),
    file_size: null,
    // No file is stored yet: the row holds the text, the original document is
    // uploaded by a later step (storage_url stays empty until then). The HAI
    // ingestion of use case documents does not skip an empty storage_url, see
    // docs/kfbm-import-runbook.md.
    mime_type: 'text/plain',
    storage_url: '',
    storage_path: null,
    uploaded_by_id: createdBy,
  };
  const rows: Row[] = [];
  if (useCase.topics) {
    rows.push({
      ...common,
      title: `Use Case ${useCase.code}: Behandelte Themen`,
      description: useCase.topics,
      document_type: 'THEORY',
      visibility: 'ALL',
      order_index: 1,
    });
  }
  if (withSolutions) {
    rows.push({
      ...common,
      title: `Use Case ${useCase.code}: Musterlösung (Trainer)`,
      description: useCase.solution,
      document_type: 'TRAINER_SOLUTION',
      visibility: 'TRAINER_ONLY',
      order_index: 2,
    });
    if (useCase.criteria) {
      rows.push({
        ...common,
        title: `Use Case ${useCase.code}: Bewertungskriterien (Trainer)`,
        description: useCase.criteria,
        document_type: 'TRAINER_SOLUTION',
        visibility: 'TRAINER_ONLY',
        order_index: 3,
      });
    }
  }
  return rows;
}

/** Number of solution rows of a use case that the switch would write. */
const solutionRowCount = (useCase: PlanUseCase) =>
  (useCase.solution ? 1 : 0) + (useCase.criteria ? 1 : 0);

/**
 * Compares the plan with the target and, with options.write, writes what is
 * missing. Throws ImportAbort before the first write if the plan or the target
 * do not fit.
 */
export async function executeUseCasePlan(
  db: Db,
  plan: UseCasePlan,
  options: UseCaseRunOptions
): Promise<UseCaseReport> {
  const problems = validateUseCasePlan(plan);
  if (problems.length > 0) {
    throw new ImportAbort(
      'PLAN_INVALID',
      `The plan is not valid (${problems.length} problem(s)): ${problems.slice(0, 5).join('; ')}`
    );
  }
  if (plan.catalog !== 'KFBM') {
    throw new ImportAbort(
      'CATALOG_REFUSED',
      'Only the catalog KFBM may be written.'
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
  const creator = await db.findProfile(options.createdBy);
  if (!creator) {
    throw new ImportAbort(
      'CREATOR_MISSING',
      'The profile named by --created-by does not exist in the target database.'
    );
  }
  if (
    !['SUPER_ADMIN', 'ADMIN', 'TEMP_ADMIN', 'TRAINER'].includes(creator.role)
  ) {
    throw new ImportAbort(
      'CREATOR_ROLE',
      'The profile named by --created-by must be a trainer or an admin.'
    );
  }
  const catalogId = catalog.id;
  const inCatalog = { training_catalog_id: catalogId };

  // State of the target, only the rows of this catalog ----------------------------
  const courseRows = await db.select('courses', inCatalog);
  const enablerRows = await db.select('enablers', inCatalog);
  if (enablerRows.length === 0) {
    throw new ImportAbort(
      'NO_ENABLERS',
      `The catalog ${plan.catalog} has no enablers yet. Run the content import first (enablers, learning fields, then use cases). Nothing was written.`
    );
  }
  const useCaseRows = await db.select(USE_CASES, inCatalog);
  const docRows = useCaseRows.length
    ? await db.select(DOCUMENTS, {
        use_case_id: useCaseRows.map(r => String(r.id)),
      })
    : [];

  const courseByCode = new Map(
    courseRows.filter(r => r.code).map(r => [String(r.code), r])
  );
  const enablerByKey = new Map(
    enablerRows
      .filter(r => r.code)
      .map(r => [`${String(r.course_id)}|${String(r.code)}`, r])
  );
  const useCaseByKey = new Map(
    useCaseRows
      .filter(r => r.code)
      .map(r => [`${String(r.course_id)}|${String(r.code)}`, r])
  );
  const useCaseByEnabler = new Map(
    useCaseRows.filter(r => r.enabler_id).map(r => [String(r.enabler_id), r])
  );
  const docsByUseCase = new Map<string, Row[]>();
  for (const row of docRows) {
    const list = docsByUseCase.get(String(row.use_case_id)) ?? [];
    list.push(row);
    docsByUseCase.set(String(row.use_case_id), list);
  }

  const counts: UseCaseReport['tables'] = {
    use_cases: { insert: 0, update: 0, unchanged: 0 },
    content_documents: { insert: 0, update: 0, unchanged: 0 },
  };
  const conflicts: Conflict[] = [];
  const differences: Difference[] = [];
  const skipped: UseCaseSkipInDb[] = [];
  const updates: Array<{
    table: TableName;
    id: string;
    patch: Row;
    visible: boolean;
  }> = [];
  const observe = (event: ItemEvent) => options.observe?.(event);
  const conflict = (table: string, key: string, reason: string) => {
    conflicts.push({ table, key, reason });
    observe({ table, key, status: 'conflict' });
  };

  /** Columns of the table in which the existing row differs from the desired one. */
  const diffColumns = (table: TableName, existing: Row, desired: Row) =>
    TABLES[table].updatable.filter(column => {
      if (!(column in desired) || same(existing[column], desired[column])) {
        return false;
      }
      // A missing value in the plan never erases text that exists.
      return !(
        (desired[column] ?? null) === null &&
        (existing[column] ?? null) !== null
      );
    });
  const noteExisting = (
    table: 'use_cases' | 'content_documents',
    key: string,
    existing: Row,
    desired: Row,
    visible: boolean
  ) => {
    const columns = diffColumns(table, existing, desired);
    if (columns.length === 0) {
      counts[table].unchanged += 1;
      observe({ table, key, status: 'unchanged' });
      return;
    }
    differences.push({ table, key, columns });
    observe({ table, key, status: 'differs' });
    if (
      options.updateExisting &&
      (options.updateFilter?.(table, key) ?? true)
    ) {
      counts[table].update += 1;
      updates.push({
        table,
        id: String(existing.id),
        patch: Object.fromEntries(columns.map(c => [c, desired[c] ?? null])),
        visible,
      });
    } else {
      counts[table].unchanged += 1;
    }
  };

  // Use cases and their documents --------------------------------------------------
  interface NewItem {
    useCase: PlanUseCase;
    courseId: string;
    enablerId: string;
    /** Document rows to insert (use_case_id is set when the id is known). */
    docs: Row[];
  }
  const fresh: NewItem[] = [];
  const freshDocsOfExisting: Row[] = [];
  let withheld = 0;
  for (const useCase of plan.useCases) {
    const course = courseByCode.get(useCase.componentCode);
    if (!course) {
      skipped.push({
        code: 'COURSE_NOT_IN_DATABASE',
        useCaseCode: useCase.code,
        reason:
          'The course of the component is not in the target database (run the content import first).',
      });
      continue;
    }
    const enabler = enablerByKey.get(
      `${String(course.id)}|${useCase.enablerCode}`
    );
    if (!enabler) {
      skipped.push({
        code: 'ENABLER_NOT_IN_DATABASE',
        useCaseCode: useCase.code,
        reason:
          'The enabler is not in the target database (run the content import first).',
      });
      continue;
    }
    // Only a use case that the target can take has solution rows to withhold.
    if (!options.solutions) withheld += solutionRowCount(useCase);
    const existing = useCaseByKey.get(`${String(course.id)}|${useCase.code}`);
    const desired = {
      title: useCase.title,
      description_text: useCase.description,
      order_index: useCase.orderIndex,
    };
    if (existing) {
      if (existing.enabler_id !== enabler.id) {
        conflict(
          USE_CASES,
          useCase.code,
          'The use case exists but is not linked to the enabler of the same code (linked to another enabler, or to none)'
        );
        continue;
      }
      noteExisting(USE_CASES, useCase.code, existing, desired, true);
      const wanted = documentRowsOfUseCase(
        useCase,
        String(existing.id),
        options.createdBy,
        options.solutions
      );
      const existingDocs = docsByUseCase.get(String(existing.id)) ?? [];
      for (const row of wanted) {
        const key = `${useCase.code}:${String(row.title)}`;
        const found = existingDocs.find(
          d => d.document_type === row.document_type && d.title === row.title
        );
        if (found && found.visibility !== row.visibility) {
          conflict(
            DOCUMENTS,
            key,
            'The document exists with another visibility than the plan'
          );
        } else if (found) {
          noteExisting(
            DOCUMENTS,
            key,
            found,
            row,
            row.document_type === 'THEORY'
          );
        } else {
          counts.content_documents.insert += 1;
          freshDocsOfExisting.push(row);
          observe({ table: DOCUMENTS, key, status: 'new' });
        }
      }
      continue;
    }
    const holder = useCaseByEnabler.get(String(enabler.id));
    if (holder) {
      conflict(
        USE_CASES,
        useCase.code,
        `The enabler already has the use case ${String(holder.code ?? holder.id)}`
      );
      continue;
    }
    const docs = documentRowsOfUseCase(
      useCase,
      'use case',
      options.createdBy,
      options.solutions
    );
    counts.use_cases.insert += 1;
    observe({ table: USE_CASES, key: useCase.code, status: 'new' });
    counts.content_documents.insert += docs.length;
    fresh.push({
      useCase,
      courseId: String(course.id),
      enablerId: String(enabler.id),
      docs,
    });
  }

  if (conflicts.length > 0 && options.write) {
    throw new ImportAbort(
      'CONFLICTS',
      `${conflicts.length} conflict(s) between the plan and the target database. Nothing was written.`,
      conflicts
    );
  }

  const useCaseRow = (item: NewItem): Row => ({
    course_id: item.courseId,
    training_catalog_id: catalogId,
    enabler_id: item.enablerId,
    code: item.useCase.code,
    title: item.useCase.title,
    description_text: item.useCase.description,
    order_index: item.useCase.orderIndex,
    is_active: options.activate,
  });

  // Solution protection on everything that is about to be written ------------------
  const solutionTexts = solutionTextsOfUseCases(plan.useCases);
  {
    const leaks = findUseCaseRowLeaks(
      {
        use_cases: fresh.map(useCaseRow),
        content_documents: [
          ...fresh.flatMap(item => item.docs),
          ...freshDocsOfExisting,
        ],
      },
      solutionTexts
    );
    if (leaks.length > 0) {
      throw new ImportAbort(
        'SOLUTION_LEAK',
        `A solution would reach a visible field: ${leaks.slice(0, 3).join('; ')}. Nothing was written.`
      );
    }
    // The values of updates are visible text as well.
    for (const update of updates) {
      if (!update.visible) continue;
      for (const column of ['title', 'description_text', 'description']) {
        const value = update.patch[column];
        if (
          typeof value === 'string' &&
          leakInUseCaseText(value, solutionTexts) !== null
        ) {
          throw new ImportAbort(
            'SOLUTION_LEAK',
            `An update would put a solution into ${update.table}.${column}. Nothing was written.`
          );
        }
      }
    }
  }

  const report: UseCaseReport = {
    catalog: plan.catalog,
    tables: counts,
    skipped,
    conflicts,
    differences,
    withheldSolutionRows: withheld,
    wrote: false,
  };
  if (!options.write) return report;

  // Write, parents first -------------------------------------------------------------
  const inserted = await db.insert(USE_CASES, fresh.map(useCaseRow));
  const idByCode = new Map(inserted.map(r => [String(r.code), String(r.id)]));
  await db.insert(DOCUMENTS, [
    ...fresh.flatMap(item =>
      item.docs.map(row => ({
        ...row,
        use_case_id: idByCode.get(item.useCase.code) as string,
      }))
    ),
    ...freshDocsOfExisting,
  ]);
  for (const update of updates) {
    await db.update(update.table, update.id, update.patch);
  }
  report.wrote = true;
  return report;
}
