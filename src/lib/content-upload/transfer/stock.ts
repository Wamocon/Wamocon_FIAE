// The status of a supply of content per file (docs/ki-upload-konzept.md 8.9): what the
// engines found out when they compared the plan with the database, mapped from the
// items of the plan to the files they came from.
//
//   new        the document does not exist yet and would be inserted
//   unchanged  the document exists and equals the file
//   extended   the document exists and the file brings parts it lacks (questions of a
//              quiz, a scenario or use case row that is missing)
//   differs    the document exists and its text differs from the file. Never written
//              by default, only by the decision of a person for exactly this file
//   conflict   the key exists with another meaning, nothing can be written
//
// Pure: no database, no clock, no text of a file. Only codes and counts leave here.

import type {
  ImportPlan,
  ItemEvent,
  ItemStatus,
  TableCount,
} from '@/lib/content-import/apply/types';
import type { UseCasePlan } from '@/lib/content-import/use-cases/types';

export type StockStatus = ItemStatus;

/** Order of the statuses in lists and counters: what needs a decision first. */
export const STOCK_STATUSES: readonly StockStatus[] = [
  'conflict',
  'differs',
  'extended',
  'new',
  'unchanged',
];

export function isStockStatus(value: unknown): value is StockStatus {
  return (
    typeof value === 'string' &&
    (STOCK_STATUSES as readonly string[]).includes(value)
  );
}

/** What the comparison says about one file. */
export interface FileStock {
  status: StockStatus;
  /** Questions that an existing quiz gets (0 for every other kind of file). */
  added: number;
  /** Existing questions whose position moves on because of them. */
  moved: number;
}

export type StockCounts = Record<StockStatus, number>;

export const emptyStockCounts = (): StockCounts => ({
  conflict: 0,
  differs: 0,
  extended: 0,
  new: 0,
  unchanged: 0,
});

/** What maps an item of a plan to its file. */
export interface PlanRefs {
  importPlan: ImportPlan;
  useCasePlan: UseCasePlan;
  /** Source path of a plan item to the id of its file. */
  fileOfSource: ReadonlyMap<string, string>;
  /** The Excel file of the learning field plan, when there is one. */
  learningFileId?: string | null;
  /** Use cases the target could not take (the enabler is missing in the database). */
  useCasesSkippedInDb?: ReadonlyArray<{ useCaseCode: string }>;
}

export interface StockInput extends PlanRefs {
  events: readonly ItemEvent[];
}

const DIFFICULTY: Record<string, string> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
};

/** The id of the file that an item of the engines belongs to, or null (shared rows). */
export function fileOfEvent(
  event: ItemEvent,
  input: PlanRefs,
  index = indexOfPlans(input)
): string | null {
  const { table, key } = event;
  switch (table) {
    case 'enablers':
      return index.enabler.get(key) ?? null;
    case 'quizzes':
      return index.quiz.get(key) ?? null;
    case 'questions':
    case 'options':
      return index.quiz.get(key.split('#')[0]) ?? null;
    case 'enabler_quiz_links':
      return index.link.get(key) ?? index.quiz.get(key) ?? null;
    case 'use_cases':
      return index.useCase.get(key) ?? null;
    // the rows of the learning field import all belong to the one Excel file
    case 'training_catalog_learning_fields':
    case 'training_catalog_content_mappings':
      return input.learningFileId ?? null;
    case 'content_documents': {
      const colon = key.indexOf(':');
      if (colon < 1) return null;
      const code = key.slice(0, colon);
      const title = key.slice(colon + 1);
      if (title.startsWith('Szenario '))
        return index.scenario.get(code) ?? null;
      if (title.startsWith('Use Case ')) return index.useCase.get(code) ?? null;
      return null;
    }
    default:
      return null;
  }
}

interface PlanIndex {
  enabler: Map<string, string>;
  quiz: Map<string, string>;
  scenario: Map<string, string>;
  useCase: Map<string, string>;
  /** `K1-a/LOW` to the file of the quiz of that enabler and level. */
  link: Map<string, string>;
}

function indexOfPlans(input: PlanRefs): PlanIndex {
  const file = (source: string) => input.fileOfSource.get(source);
  const index: PlanIndex = {
    enabler: new Map(),
    quiz: new Map(),
    scenario: new Map(),
    useCase: new Map(),
    link: new Map(),
  };
  const put = (map: Map<string, string>, key: string, source: string) => {
    const id = file(source);
    if (id !== undefined) map.set(key, id);
  };
  for (const e of input.importPlan.enablers)
    put(index.enabler, e.code, e.source);
  for (const s of input.importPlan.scenarios) {
    put(index.scenario, s.enablerCode, s.source);
  }
  for (const q of input.importPlan.quizzes) {
    put(index.quiz, q.code, q.source);
    if (q.kind === 'lesson' && q.enablerCode && q.level) {
      put(index.link, `${q.enablerCode}/${DIFFICULTY[q.level]}`, q.source);
    }
  }
  for (const u of input.useCasePlan.useCases)
    put(index.useCase, u.code, u.source);
  return index;
}

/**
 * The status of every file that has items in the comparison. A file without an item
 * (it became no row of a plan) is not in the answer.
 *
 *   conflict   if any item is a conflict
 *   differs    if any item differs
 *   extended   if an item is extended, or if new items come next to unchanged ones
 *   new        if every item is new
 *   unchanged  if every item is unchanged
 */
export function stockOfFiles(input: StockInput): Map<string, FileStock> {
  const index = indexOfPlans(input);
  const seen = new Map<
    string,
    { statuses: Set<StockStatus>; added: number; moved: number }
  >();
  const entry = (fileId: string) => {
    let value = seen.get(fileId);
    if (!value) {
      value = { statuses: new Set(), added: 0, moved: 0 };
      seen.set(fileId, value);
    }
    return value;
  };
  for (const event of input.events) {
    const fileId = fileOfEvent(event, input, index);
    if (!fileId) continue;
    const value = entry(fileId);
    value.statuses.add(event.status);
    value.added += event.added ?? 0;
    value.moved += event.moved ?? 0;
  }
  // A use case the target cannot take: when its enabler is new in the same plan the
  // comparison (which writes nothing) just cannot see it yet, so the use case is new
  // too. Otherwise the enabler is missing for good and the file conflicts (the content
  // import has to bring the enabler first).
  const newEnablers = new Set(
    input.events
      .filter(e => e.table === 'enablers' && e.status === 'new')
      .map(e => e.key)
  );
  const enablerOfUseCase = new Map(
    input.useCasePlan.useCases.map(u => [u.code, u.enablerCode])
  );
  for (const skipped of input.useCasesSkippedInDb ?? []) {
    const fileId = index.useCase.get(skipped.useCaseCode);
    if (!fileId) continue;
    const enabler = enablerOfUseCase.get(skipped.useCaseCode);
    entry(fileId).statuses.add(
      enabler !== undefined && newEnablers.has(enabler) ? 'new' : 'conflict'
    );
  }
  const result = new Map<string, FileStock>();
  for (const [fileId, value] of seen) {
    const has = (status: StockStatus) => value.statuses.has(status);
    let status: StockStatus;
    if (has('conflict')) status = 'conflict';
    else if (has('differs')) status = 'differs';
    else if (has('extended') || (has('new') && has('unchanged'))) {
      status = 'extended';
    } else if (has('new')) status = 'new';
    else status = 'unchanged';
    result.set(fileId, { status, added: value.added, moved: value.moved });
  }
  return result;
}

/**
 * What the learning field engine found, as an item of the comparison (the engine has no
 * observer of its own). The whole table is one item:
 *   new        rows are inserted and none exists yet (the codes a first run adds to the
 *              use cases belong to it)
 *   extended   the table brings something that is missing next to what exists (new
 *              mappings of enablers that came later, a code for a use case, an empty
 *              description)
 *   unchanged  everything exists
 * and every conflict is a conflict. The file of the Excel mapping never gets `differs`:
 * the run only adds, it never replaces what exists.
 */
export function learningEvents(report: {
  tables: Record<string, TableCount>;
  useCaseMappings: TableCount;
  useCaseCodes: TableCount;
  conflicts: ReadonlyArray<{ table: string; key: string }>;
  /**
   * Mappings the database cannot take yet (their enabler is not there). In a comparison the
   * enablers this transfer adds are not written, so such a table still brings something new.
   */
  skipped?: ReadonlyArray<unknown>;
}): ItemEvent[] {
  const fields = 'training_catalog_learning_fields';
  const mappings = 'training_catalog_content_mappings';
  const counts = [
    report.tables[fields],
    report.tables[mappings],
    report.useCaseMappings,
    report.useCaseCodes,
  ].filter((c): c is TableCount => c !== undefined);
  const sum = (key: keyof TableCount) => counts.reduce((n, c) => n + c[key], 0);
  const inserted = sum('insert');
  const updated = sum('update');
  const unchanged = sum('unchanged');
  const events: ItemEvent[] = [];
  let status: ItemEvent['status'] | null = null;
  if (inserted > 0 && unchanged === 0) status = 'new';
  else if (inserted > 0 || updated > 0) status = 'extended';
  else if (unchanged > 0) status = 'unchanged';
  // nothing to count yet, but mappings wait for enablers that this transfer brings
  if (status === null && (report.skipped?.length ?? 0) > 0) status = 'new';
  if (status === 'unchanged' && (report.skipped?.length ?? 0) > 0) {
    status = 'extended';
  }
  if (status) events.push({ table: fields, key: 'mapping', status });
  for (const c of report.conflicts) {
    events.push({ table: c.table, key: c.key, status: 'conflict' });
  }
  return events;
}

export function countStock(stock: ReadonlyMap<string, FileStock>): StockCounts {
  const counts = emptyStockCounts();
  for (const value of stock.values()) counts[value.status] += 1;
  return counts;
}

/**
 * The rows that an apply may update for the files a person chose to replace: the
 * test of the engines' updateFilter. A row belongs to a file when its item maps to it.
 */
export function updateFilterFor(
  input: PlanRefs,
  fileIds: ReadonlySet<string>
): (table: string, key: string) => boolean {
  const index = indexOfPlans(input);
  return (table, key) => {
    const fileId = fileOfEvent({ table, key, status: 'differs' }, input, index);
    return fileId !== null && fileIds.has(fileId);
  };
}

// ---------------------------------------------------------------------------
// What is stored with a file (content_upload_files.parse_summary.stock)
// ---------------------------------------------------------------------------

/** The assignment a comparison was made for. A later change of it makes the result stale. */
export function assignmentFingerprint(a: {
  docType: string | null;
  componentCode: string | null;
  enablerCode: string | null;
  quizLevel: string | null;
}): string {
  return [a.docType, a.componentCode, a.enablerCode, a.quizLevel]
    .map(part => part ?? '')
    .join('|');
}

/**
 * What is stored for the files of a comparison. A file the caller does not know (no
 * assignment) is left out instead of being stored with a guessed one.
 */
export function toStockWrites(
  stock: ReadonlyMap<string, FileStock>,
  assignmentOf: (fileId: string) => string | undefined,
  at: string
): Array<{ fileId: string; stock: StoredStock }> {
  return [...stock].flatMap(([fileId, value]) => {
    const assign = assignmentOf(fileId);
    return assign === undefined
      ? []
      : [{ fileId, stock: { ...value, assign, at } }];
  });
}

/** The status per file for a report, by file id, with the name of the file. */
export function toStockReport(
  stock: ReadonlyMap<string, FileStock>,
  nameOf: (fileId: string) => string | undefined
): {
  counts: StockCounts;
  files: Array<FileStock & { fileId: string; fileName: string }>;
} {
  return {
    counts: countStock(stock),
    files: [...stock]
      .map(([fileId, value]) => ({
        fileId,
        fileName: nameOf(fileId) ?? '',
        ...value,
      }))
      .sort((a, b) => (a.fileId < b.fileId ? -1 : 1)),
  };
}

/** The record in parse_summary: codes and counts only. */
export interface StoredStock extends FileStock {
  /** assignmentFingerprint of the assignment the comparison used. */
  assign: string;
  /** ISO time of the comparison. */
  at: string;
}

/** The stored record of a parse summary, or null when there is none or it is malformed. */
export function readStoredStock(
  summary: Record<string, unknown> | null | undefined
): StoredStock | null {
  const raw = summary?.stock;
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (
    !isStockStatus(v.status) ||
    typeof v.assign !== 'string' ||
    typeof v.at !== 'string' ||
    !Number.isFinite(Date.parse(v.at))
  ) {
    return null;
  }
  const count = (n: unknown) =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0;
  return {
    status: v.status,
    added: count(v.added),
    moved: count(v.moved),
    assign: v.assign,
    at: v.at,
  };
}
