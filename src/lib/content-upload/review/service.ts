// The reads of the review list: the list with counts and filters, the options of
// the selects, the duplicate groups and the overview of the runs (package U6,
// docs/ki-upload-konzept.md 7.1). The routes call these after they have checked the
// session, the switch of the environment and the run.
//
// What the answers hold: metadata of the files, the type and assignment of a
// proposal or decision, the reasons (code and fixed German text) and the
// confidence. Never a storage path, an excerpt, the text of a document or a part of
// a solution.

import { parseDecisions } from '@/lib/content-import/apply/decisions';
import type { Decisions } from '@/lib/content-import/apply/types';
import {
  buildPositiveList,
  positiveListFromPaths,
  type PositiveListInput,
} from '@/lib/content-upload/classify/positive-list';
import type { SourceGroup } from '@/lib/content-upload/classify/types';
import {
  analyzeRun,
  buildDuplicateGroups,
  buildRows,
  countRows,
  type ReviewContext,
} from '@/lib/content-upload/review/build';
import { facetsOf, pageRows } from '@/lib/content-upload/review/filter';
import type { ReviewRepo } from '@/lib/content-upload/review/repo';
import {
  ASSIGNABLE_DOC_TYPES,
  QUIZ_LEVELS,
  type CatalogComponentRow,
  type DuplicateGroupDto,
  type ReviewCounts,
  type ReviewFacets,
  type ReviewFilter,
  type ReviewOptions,
  type ReviewPage,
} from '@/lib/content-upload/review/types';
import type { Caller, UploadDeps } from '@/lib/content-upload/staging/result';
import {
  listRuns,
  runDto,
  type RunDto,
} from '@/lib/content-upload/staging/runs';
import type { RunRow } from '@/lib/content-upload/staging/types';
import presets from '../../../../scripts/import/kfbm-decisions.json';

/** What the review services run on. */
export interface ReviewDeps extends UploadDeps {
  review: ReviewRepo;
}

let presetCache: Decisions | undefined;

/** The presets of the import (scripts/import/kfbm-decisions.json), checked once. */
export function decisionsPreset(): Decisions {
  if (!presetCache) {
    const parsed = parseDecisions(presets);
    if (!parsed.ok) {
      throw new Error(`kfbm-decisions.json is not valid: ${parsed.errors[0]}`);
    }
    presetCache = parsed.decisions;
  }
  return presetCache;
}

/**
 * The group of a component of the database, which has no group column: the part
 * of the training it belongs to (a mandatory component of phase 1 lies in part
 * one), the electives and the components of the whole training.
 */
export function groupOfComponent(row: CatalogComponentRow): SourceGroup | null {
  if (row.kind === 'wahl') return 'wahl';
  if (row.kind === 'integrativ') return 'ganze';
  if (row.phase === 1) return 'teil1';
  if (row.phase === 2) return 'teil2';
  return null;
}

/** The components of the database as input of the positive list. */
export function databaseInput(
  components: readonly CatalogComponentRow[]
): PositiveListInput {
  return {
    components: components.map(c => ({
      code: c.code,
      title: c.title,
      group: groupOfComponent(c),
      origin: 'database' as const,
      enablers: c.enablers.map(e => ({
        code: e.code,
        title: e.title,
        origin: 'database' as const,
      })),
    })),
  };
}

/** The positive list of a run: the database of its catalog plus the plan of its folder tree. */
export async function loadReviewContext(
  deps: ReviewDeps,
  run: RunRow,
  relPaths: readonly string[]
): Promise<ReviewContext & { components: CatalogComponentRow[] }> {
  const components = await deps.review.catalogComponents(run.trainingCatalogId);
  const list = buildPositiveList(
    databaseInput(components),
    positiveListFromPaths(relPaths)
  );
  return {
    list,
    components,
    decisions: decisionsPreset(),
    now: (deps.clock ?? Date.now)(),
  };
}

export interface ReviewListResult extends ReviewPage {
  run: RunDto;
  counts: ReviewCounts;
  facets: ReviewFacets;
  /** decisions_version to send back with the next decision. */
  version: number;
}

export async function reviewList(
  deps: ReviewDeps,
  run: RunRow,
  filter: ReviewFilter
): Promise<ReviewListResult> {
  const records = await deps.review.listRecords(run.id);
  const context = await loadReviewContext(
    deps,
    run,
    records.map(r => r.file.relPath)
  );
  const rows = buildRows(records, context);
  return {
    run: runDto(run),
    counts: countRows(rows),
    facets: facetsOf(rows),
    version: run.decisionsVersion,
    ...pageRows(rows, filter),
  };
}

export async function reviewDuplicates(
  deps: ReviewDeps,
  run: RunRow
): Promise<{ groups: DuplicateGroupDto[]; version: number }> {
  const records = await deps.review.listRecords(run.id);
  const context = await loadReviewContext(
    deps,
    run,
    records.map(r => r.file.relPath)
  );
  return {
    groups: buildDuplicateGroups(records, analyzeRun(records, context)),
    version: run.decisionsVersion,
  };
}

export interface RunOverviewItem extends RunDto {
  fileCount: number;
  decidedCount: number;
  createdByName: string | null;
}

/** The runs of the caller (a SUPER_ADMIN sees all) with their counts, for the list of runs. */
export async function runOverview(
  deps: ReviewDeps,
  caller: Caller
): Promise<RunOverviewItem[]> {
  const runs = await listRuns(deps, caller);
  const stats = await deps.review.runStats(runs.map(r => r.id));
  const byRun = new Map(stats.map(s => [s.runId, s]));
  return runs.map(run => {
    const stat = byRun.get(run.id);
    return {
      ...runDto(run),
      fileCount: stat?.files ?? 0,
      decidedCount: stat?.decided ?? 0,
      createdByName: stat?.createdByName ?? null,
    };
  });
}

/** The values of the selects: the database plus what the folder tree of the run would create. */
export async function reviewOptions(
  deps: ReviewDeps,
  run: RunRow
): Promise<ReviewOptions> {
  const files = await deps.repo.listFiles(run.id, { offset: 0, limit: 5000 });
  const components = await deps.review.catalogComponents(run.trainingCatalogId);
  return optionsOf(
    components,
    positiveListFromPaths(files.map(f => f.relPath))
  );
}

const componentOrder = (code: string) => {
  const m = /^K(\d+)(?:\.(\d+))?$/.exec(code);
  return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : Number.MAX_SAFE_INTEGER;
};

/** Merges the database and the plan, the database wins, the plan marks what is new. */
export function optionsOf(
  database: readonly CatalogComponentRow[],
  plan: PositiveListInput
): ReviewOptions {
  const byCode = new Map<
    string,
    {
      code: string;
      title: string | null;
      isNew: boolean;
      enablers: Map<
        string,
        { code: string; title: string | null; isNew: boolean }
      >;
    }
  >();
  for (const c of database) {
    byCode.set(c.code, {
      code: c.code,
      title: c.title,
      isNew: false,
      enablers: new Map(
        c.enablers.map(e => [
          e.code,
          { code: e.code, title: e.title, isNew: false },
        ])
      ),
    });
  }
  for (const c of plan.components ?? []) {
    const entry = byCode.get(c.code) ?? {
      code: c.code,
      title: c.title ?? null,
      isNew: true,
      enablers: new Map(),
    };
    for (const e of c.enablers ?? []) {
      if (!entry.enablers.has(e.code)) {
        entry.enablers.set(e.code, {
          code: e.code,
          title: e.title ?? null,
          isNew: true,
        });
      }
    }
    byCode.set(c.code, entry);
  }
  return {
    docTypes: [...ASSIGNABLE_DOC_TYPES],
    quizLevels: [...QUIZ_LEVELS],
    components: [...byCode.values()]
      .sort((a, b) => componentOrder(a.code) - componentOrder(b.code))
      .map(c => ({
        code: c.code,
        title: c.title,
        isNew: c.isNew,
        enablers: [...c.enablers.values()].sort((a, b) =>
          a.code < b.code ? -1 : a.code > b.code ? 1 : 0
        ),
      })),
  };
}
