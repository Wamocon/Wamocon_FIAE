// The cleanup run of the private bucket `submission-files`
// (scripts/storage/cleanup-submission-files.mjs).
//
// Decision of the owner (29.10.2026): the file of a submission is kept until the training
// of the trainee has ended, no fixed period beyond that. A file is removed for one of
// three reasons, nothing else is ever removed:
//
//   orphan   (a) an unfinished upload: an object in `incoming/` that is at least 24
//                hours old (a running upload is younger and stays)
//   deleted  (b) the trainee or the use case does not exist any more (the submission rows
//                went with them, the file stayed behind)
//   ended    (c) the training of the trainee has ended. The data model has no end date and
//                no status, so "ended" is derived (see docs/abgabe-datei.md): the trainee has
//                no enrollment in the occupation (training catalog) of the use case any more
//                (removing an enrollment is a deliberate, confirmed admin action). A trainee
//                without any enrollment counts as enrolled in FIAE, exactly as the catalog
//                scope of the app does. A deactivated profile (profiles.is_active = false)
//                counts only with the explicit switch --include-deactivated, because a
//                deactivation can be temporary.
//
// A file in `file/` without a submission row is a draft (the trainee attached it and has
// not submitted yet, the app allows that), so it is NOT removed for the missing row alone.
// It goes under (b) or (c) once the trainee or use case is gone or the training has ended.
//
// The code here has no import of the app except the path rules, on purpose: the script loads
// it with Node's type stripping. Nothing here talks to a database or to a network itself,
// the database and the storage come in as parameters (tests replace them).
//
// The run reports numbers only. Neither a path nor an id nor a name is ever printed.

import type { DbSchema } from '@/lib/db-schema';
import {
  SUBMISSION_BUCKET,
  isUuidFolderName,
  parseSubmissionPath,
} from '@/lib/submission-file/rules';

/** The occupation FIAE (training_catalogs). A trainee without an enrollment works in it. */
export const FIAE_CATALOG_ID = '00000000-0000-4000-8000-000000000001';

/** An unfinished upload is removed when it is at least this old. */
export const ORPHAN_UPLOAD_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Paths per call of the removal. */
export const CLEANUP_BATCH = 100;

export type CleanupReason = 'orphan' | 'deleted' | 'ended';

// ---------------------------------------------------------------------------
// The plan (pure)
// ---------------------------------------------------------------------------

export interface CleanupEntry {
  path: string;
  /** Creation time in milliseconds, or null if the storage did not tell. */
  createdAt: number | null;
}

export interface CleanupFacts {
  /** The profiles that exist (by id). isActive null means "not known", never a deactivation. */
  profiles: Map<string, { isActive: boolean | null }>;
  /** The use cases that exist (by id) with the occupation they belong to. */
  useCases: Map<string, { catalogId: string }>;
  /** `<trainee id>:<use case id>` of every submission row. */
  submissions: Set<string>;
  /** The occupations a trainee is enrolled in (by trainee id). */
  enrollments: Map<string, string[]>;
}

export interface PlanCounts {
  found: number;
  orphan: number;
  deleted: number;
  ended: number;
  keptActive: number;
  keptDraft: number;
  keptRunningUpload: number;
  keptAgeUnknown: number;
  invalidPath: number;
}

export interface CleanupPlan {
  deletions: Array<{ path: string; reason: CleanupReason }>;
  counts: PlanCounts;
}

export interface PlanOptions {
  schema: DbSchema;
  now: number;
  /**
   * Count a deactivated profile as the end of the training. Off by default: a deactivation
   * can be temporary, so deactivated trainees keep their files unless this is asked for.
   */
  includeDeactivated: boolean;
}

export function planCleanup(
  entries: readonly CleanupEntry[],
  facts: CleanupFacts,
  options: PlanOptions
): CleanupPlan {
  const counts: PlanCounts = {
    found: entries.length,
    orphan: 0,
    deleted: 0,
    ended: 0,
    keptActive: 0,
    keptDraft: 0,
    keptRunningUpload: 0,
    keptAgeUnknown: 0,
    invalidPath: 0,
  };
  const deletions: CleanupPlan['deletions'] = [];
  const remove = (path: string, reason: CleanupReason) => {
    counts[reason] += 1;
    deletions.push({ path, reason });
  };

  for (const entry of entries) {
    // anything that is not exactly one of the two path forms is left alone
    const parsed = parseSubmissionPath(entry.path, options.schema);
    if (!parsed) {
      counts.invalidPath += 1;
      continue;
    }
    const { traineeId, useCaseId } = parsed.scope;
    const profile = facts.profiles.get(traineeId);
    const useCase = facts.useCases.get(useCaseId);

    // (b) the trainee or the use case is gone
    if (!profile || !useCase) {
      remove(entry.path, 'deleted');
      continue;
    }

    // (c) the training has ended
    const enrolled = facts.enrollments.get(traineeId) ?? [];
    const catalogs = enrolled.length > 0 ? enrolled : [FIAE_CATALOG_ID];
    const deactivated = profile.isActive === false && options.includeDeactivated;
    if (deactivated || !catalogs.includes(useCase.catalogId)) {
      remove(entry.path, 'ended');
      continue;
    }

    if (parsed.kind === 'incoming') {
      // (a) an unfinished upload, once it can not be a running one any more
      if (entry.createdAt === null || !Number.isFinite(entry.createdAt)) {
        counts.keptAgeUnknown += 1;
      } else if (options.now - entry.createdAt >= ORPHAN_UPLOAD_MIN_AGE_MS) {
        remove(entry.path, 'orphan');
      } else {
        counts.keptRunningUpload += 1;
      }
      continue;
    }

    if (facts.submissions.has(`${traineeId}:${useCaseId}`)) {
      counts.keptActive += 1;
    } else {
      counts.keptDraft += 1;
    }
  }
  return { deletions, counts };
}

// ---------------------------------------------------------------------------
// The storage
// ---------------------------------------------------------------------------

export interface CleanupListEntry {
  name: string;
  isFolder: boolean;
  createdAt: number | null;
}

/** The storage as far as the cleanup uses it. Tests replace it with a fake. */
export interface CleanupStorage {
  /** Everything directly inside one folder (`''` is the root of the bucket). */
  listFolder(prefix: string): Promise<CleanupListEntry[]>;
  /** Removes objects. A path that does not exist is not an error. */
  remove(paths: readonly string[]): Promise<void>;
}

export class CleanupStorageError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CleanupStorageError';
    this.code = code;
  }
}

const LIST_PAGE = 100;
/** A folder with more than 100 pages (10000 entries) is not a folder of this bucket. */
const MAX_PAGES = 100;
const CONCURRENCY = 8;

export interface CleanupStorageDeps {
  url: string;
  /** The secret key of the project, only from the environment of the script. */
  key: string;
  /** The schema whose path form `remove` accepts. */
  schema?: DbSchema;
  fetchImpl?: typeof fetch;
}

const encodePath = (path: string) =>
  path.split('/').map(encodeURIComponent).join('/');

/**
 * The storage API of Supabase over fetch, bound to the bucket `submission-files` (the
 * bucket is no parameter). It never follows a redirect, never logs and never puts the key
 * or the address into an error. `remove` takes only paths of the exact form.
 */
export function createCleanupStorage(deps: CleanupStorageDeps): CleanupStorage {
  const origin = new URL(deps.url).origin;
  const doFetch = deps.fetchImpl ?? fetch;
  const schema = deps.schema ?? 'public';
  const headers = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${deps.key}`,
    apikey: deps.key,
    ...extra,
  });
  const call = (url: string, init: RequestInit) =>
    doFetch(url, { ...init, redirect: 'error' });
  const bad = (what: string, status: number) =>
    new CleanupStorageError(
      `HTTP_${status}`,
      `The storage refused ${what} (${status}).`
    );

  return {
    async listFolder(prefix) {
      const entries: CleanupListEntry[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await call(
          `${origin}/storage/v1/object/list/${SUBMISSION_BUCKET}`,
          {
            method: 'POST',
            headers: headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              prefix,
              limit: LIST_PAGE,
              offset: page * LIST_PAGE,
              sortBy: { column: 'name', order: 'asc' },
            }),
          }
        );
        if (!response.ok) throw bad('the listing of a folder', response.status);
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) {
          throw new CleanupStorageError(
            'BAD_ANSWER',
            'The storage answered a listing in an unknown form.'
          );
        }
        for (const row of rows as Array<Record<string, unknown>>) {
          const created =
            typeof row.created_at === 'string'
              ? Date.parse(row.created_at)
              : Number.NaN;
          entries.push({
            name: String(row.name),
            // a folder has no id
            isFolder: row.id === null || row.id === undefined,
            createdAt: Number.isFinite(created) ? created : null,
          });
        }
        if (rows.length < LIST_PAGE) return entries;
      }
      throw new CleanupStorageError(
        'TOO_MANY_ENTRIES',
        'A folder of the bucket has more entries than expected.'
      );
    },
    async remove(paths) {
      if (paths.length === 0) return;
      for (const path of paths) {
        if (parseSubmissionPath(path, schema) === null) {
          throw new CleanupStorageError(
            'INVALID_PATH',
            'The storage path is not one of the submission bucket.'
          );
        }
      }
      const response = await call(
        `${origin}/storage/v1/object/${SUBMISSION_BUCKET}`,
        {
          method: 'DELETE',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prefixes: paths }),
        }
      );
      if (!response.ok) throw bad('the removal of objects', response.status);
    },
  };
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

const join = (parent: string, name: string) =>
  parent === '' ? name : `${parent}/${name}`;

/**
 * Every object of the two folders (`incoming`, `file`) below
 * `[preview/]<org>/<trainee>/<use case>`. What does not fit this tree is never read:
 * a name that is no uuid is skipped, and so is every other folder.
 */
export async function collectEntries(
  storage: CleanupStorage,
  schema: DbSchema
): Promise<CleanupEntry[]> {
  const folders = async (parent: string) =>
    (await storage.listFolder(parent))
      .filter(e => e.isFolder && isUuidFolderName(e.name))
      .map(e => join(parent, e.name));
  const root = schema === 'public_preview' ? 'preview' : '';
  const entries: CleanupEntry[] = [];
  const orgs = await folders(root);
  const trainees = (await mapLimit(orgs, CONCURRENCY, folders)).flat();
  const useCases = (await mapLimit(trainees, CONCURRENCY, folders)).flat();
  const places = useCases.flatMap(uc => [`${uc}/incoming`, `${uc}/file`]);
  const listed = await mapLimit(places, CONCURRENCY, async place =>
    (await storage.listFolder(place))
      .filter(e => !e.isFolder)
      .map(e => ({ path: join(place, e.name), createdAt: e.createdAt }))
  );
  for (const list of listed) entries.push(...list);
  return entries;
}

// ---------------------------------------------------------------------------
// The facts from the database (read only)
// ---------------------------------------------------------------------------

export type CleanupQuery = (
  sql: string,
  params: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>> }>;

export interface CleanupIds {
  traineeIds: string[];
  useCaseIds: string[];
}

/**
 * The rows that decide, for the trainees and use cases that occur in the storage. Four
 * select statements with the ids as parameters, nothing is written.
 */
export async function loadCleanupFacts(
  query: CleanupQuery,
  ids: CleanupIds
): Promise<CleanupFacts> {
  const facts: CleanupFacts = {
    profiles: new Map(),
    useCases: new Map(),
    submissions: new Set(),
    enrollments: new Map(),
  };
  if (ids.traineeIds.length === 0 || ids.useCaseIds.length === 0) return facts;

  const profiles = await query(
    'select id::text as id, is_active from profiles where id = any($1::uuid[])',
    [ids.traineeIds]
  );
  for (const row of profiles.rows) {
    facts.profiles.set(String(row.id), {
      isActive: typeof row.is_active === 'boolean' ? row.is_active : null,
    });
  }
  const useCases = await query(
    'select id::text as id, training_catalog_id::text as catalog_id from use_cases where id = any($1::uuid[])',
    [ids.useCaseIds]
  );
  for (const row of useCases.rows) {
    facts.useCases.set(String(row.id), { catalogId: String(row.catalog_id) });
  }
  const submissions = await query(
    'select trainee_id::text as trainee_id, use_case_id::text as use_case_id from use_case_submissions where trainee_id = any($1::uuid[]) and use_case_id = any($2::uuid[])',
    [ids.traineeIds, ids.useCaseIds]
  );
  for (const row of submissions.rows) {
    facts.submissions.add(`${row.trainee_id}:${row.use_case_id}`);
  }
  const enrollments = await query(
    'select trainee_id::text as trainee_id, training_catalog_id::text as catalog_id from trainee_enrollments where trainee_id = any($1::uuid[])',
    [ids.traineeIds]
  );
  for (const row of enrollments.rows) {
    const trainee = String(row.trainee_id);
    facts.enrollments.set(trainee, [
      ...(facts.enrollments.get(trainee) ?? []),
      String(row.catalog_id),
    ]);
  }
  return facts;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface RunCounts extends PlanCounts {
  removed: number;
  failed: number;
}

export interface RunOptions {
  storage: CleanupStorage;
  loadFacts: (ids: CleanupIds) => Promise<CleanupFacts>;
  schema: DbSchema;
  /** false = dry run: count only, remove nothing. */
  apply: boolean;
  includeDeactivated: boolean;
  now?: () => number;
}

export async function runCleanup(options: RunOptions): Promise<RunCounts> {
  const entries = await collectEntries(options.storage, options.schema);
  const traineeIds = new Set<string>();
  const useCaseIds = new Set<string>();
  for (const entry of entries) {
    const parsed = parseSubmissionPath(entry.path, options.schema);
    if (!parsed) continue;
    traineeIds.add(parsed.scope.traineeId);
    useCaseIds.add(parsed.scope.useCaseId);
  }
  // an empty bucket needs no database
  const facts: CleanupFacts =
    entries.length === 0
      ? {
          profiles: new Map(),
          useCases: new Map(),
          submissions: new Set(),
          enrollments: new Map(),
        }
      : await options.loadFacts({
          traineeIds: [...traineeIds],
          useCaseIds: [...useCaseIds],
        });
  const { deletions, counts } = planCleanup(entries, facts, {
    schema: options.schema,
    now: (options.now ?? Date.now)(),
    includeDeactivated: options.includeDeactivated,
  });

  // A database that knows none of the trainees found in the storage is most likely the wrong
  // one (empty, other project): a real run would then remove every object. Refuse it.
  if (
    options.apply &&
    counts.found > 0 &&
    facts.profiles.size === 0 &&
    deletions.length === counts.found - counts.invalidPath
  ) {
    throw new CleanupStorageError(
      'DATABASE_UNKNOWN',
      'The database knows none of the trainees found in the bucket. Nothing was removed.'
    );
  }

  let removed = 0;
  let failed = 0;
  if (options.apply) {
    const paths = deletions.map(d => d.path);
    for (let i = 0; i < paths.length; i += CLEANUP_BATCH) {
      const batch = paths.slice(i, i + CLEANUP_BATCH);
      try {
        await options.storage.remove(batch);
        removed += batch.length;
      } catch {
        // the next run tries again, the report says how many were left
        failed += batch.length;
      }
    }
  }
  return { ...counts, removed, failed };
}

export interface ReportInfo {
  mode: 'dry-run' | 'apply';
  target: string;
  schema: string;
}

/** The protocol: numbers only. */
export function renderCleanupReport(
  counts: RunCounts,
  info: ReportInfo
): string {
  const lines = [
    `Cleanup of the bucket ${SUBMISSION_BUCKET}`,
    `Mode: ${info.mode}, target: ${info.target}, schema: ${info.schema}`,
    `Objects found : ${counts.found}`,
    'Reasons to remove:',
    `  orphan  : ${counts.orphan}  (unfinished upload, at least 24 hours old)`,
    `  deleted : ${counts.deleted}  (trainee or use case does not exist any more)`,
    `  ended   : ${counts.ended}  (training of the trainee has ended)`,
    'Kept:',
    `  active  : ${counts.keptActive}  (submission exists, training runs)`,
    `  draft   : ${counts.keptDraft}  (no submission yet, training runs)`,
    `  running : ${counts.keptRunningUpload}  (upload younger than 24 hours)`,
    `  unknown age : ${counts.keptAgeUnknown}`,
    `  not a submission path : ${counts.invalidPath}  (never touched)`,
  ];
  if (info.mode === 'apply') {
    lines.push(`removed : ${counts.removed}`, `failed  : ${counts.failed}`);
  } else {
    lines.push('Dry run: nothing was removed.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The arguments
// ---------------------------------------------------------------------------

export type CleanupTarget = 'local' | 'preview';

export interface CleanupArgs {
  target: CleanupTarget;
  /** Real run. false = dry run (the default). */
  apply: boolean;
  /** Host of the database connection (--apply with --target preview). */
  confirmHost: string | null;
  /** Host of the storage address (--apply, always). */
  confirmStorageHost: string | null;
  /** A deactivated profile counts as the end of the training (off by default). */
  includeDeactivated: boolean;
}

export type ParsedCleanupArgs =
  | { ok: true; args: CleanupArgs }
  | { ok: false; errors: string[] };

const PRODUCTION_MESSAGE =
  'Production is not supported by this script (no target, no switch). A run against Production needs a decision of the owner and a change of this file.';

/**
 * --target local|preview (required), --apply, --confirm-storage-host <host> (with --apply),
 * --confirm-host <host> (with --apply and --target preview), --include-deactivated. Without
 * --apply nothing is removed. Production is refused in every form.
 */
export function parseCleanupArgs(argv: string[]): ParsedCleanupArgs {
  const errors: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const VALUE_OPTIONS = new Set([
    '--target',
    '--confirm-host',
    '--confirm-storage-host',
  ]);
  const FLAGS = new Set(['--apply', '--include-deactivated']);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const eq = token.startsWith('--') ? token.indexOf('=') : -1;
    const name = eq > 0 ? token.slice(0, eq) : token;
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;
    if (/production/i.test(name)) {
      errors.push(PRODUCTION_MESSAGE);
    } else if (FLAGS.has(name) && inline === undefined) {
      flags.add(name);
    } else if (VALUE_OPTIONS.has(name)) {
      const value = inline ?? argv[(i += 1)];
      if (value === undefined || value === '' || value.startsWith('--')) {
        errors.push(`${name} needs a value`);
      } else if (values.has(name)) {
        errors.push(`${name} is given twice`);
      } else if (/production/i.test(value)) {
        errors.push(PRODUCTION_MESSAGE);
      } else {
        values.set(name, value);
      }
    } else if (name.startsWith('--')) {
      errors.push(`Unknown argument: ${token}`);
    } else {
      errors.push(`Unexpected argument: ${token}`);
    }
  }

  const rawTarget = values.get('--target');
  let target: CleanupTarget | null = null;
  if (rawTarget === undefined) {
    if (!errors.some(e => e.startsWith('--target'))) {
      if (!errors.includes(PRODUCTION_MESSAGE)) {
        errors.push('--target local|preview is required');
      }
    }
  } else if (rawTarget === 'local' || rawTarget === 'preview') {
    target = rawTarget;
  } else {
    errors.push('--target must be local or preview');
  }

  const apply = flags.has('--apply');
  const confirmHost = values.get('--confirm-host')?.toLowerCase() ?? null;
  const confirmStorageHost =
    values.get('--confirm-storage-host')?.toLowerCase() ?? null;
  if (confirmStorageHost !== null && !apply) {
    errors.push('--confirm-storage-host belongs to --apply');
  }
  if (confirmHost !== null && !(apply && target === 'preview')) {
    errors.push('--confirm-host only belongs to --apply with --target preview');
  }
  if (apply && confirmStorageHost === null) {
    errors.push(
      'A real run needs --confirm-storage-host <host of the storage address>'
    );
  }
  if (apply && target === 'preview' && confirmHost === null) {
    errors.push(
      'A real run against the Preview needs --confirm-host <host of the connection>'
    );
  }

  if (errors.length > 0 || target === null) {
    return { ok: false, errors: [...new Set(errors)] };
  }
  return {
    ok: true,
    args: {
      target,
      apply,
      confirmHost,
      confirmStorageHost,
      includeDeactivated: flags.has('--include-deactivated'),
    },
  };
}
