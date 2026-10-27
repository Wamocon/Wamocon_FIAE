/**
 * Catalog scope: which training catalogs (occupations) a caller may see and
 * change, and which one is active for new records.
 *
 * Rules (always derived from the session and the database, never from client
 * input alone):
 *  - TRAINEE: catalogs of the trainee's rows in trainee_enrollments (latest
 *    start first), otherwise the FIAE default catalog.
 *  - TRAINER, ADMIN, TEMP_ADMIN: catalogs enabled for the organization in
 *    organization_catalogs (is_enabled, catalog is_active). An organization
 *    without any row (legacy) gets FIAE.
 *  - SUPER_ADMIN: all catalogs, including inactive ones.
 *
 * The active catalog can be chosen with the header `x-catalog` or the query
 * parameter `catalog` (catalog code, for example KFBM), this is what the tabs
 * of the pages send. It is validated against the allowed catalogs, an unknown
 * or foreign value is rejected with 403 (never widened), a missing value
 * selects the default. Only a super admin has inactive catalogs among the
 * allowed ones, so only they can view one (to check content before the
 * activation). Every other role never gets an inactive catalog. Fail closed:
 * if the scope cannot be determined, the caller gets no access (never all
 * catalogs).
 *
 * Usage in a route handler:
 *
 *   const scope = await requireCatalogScope(session, req);
 *   if (isErrorResponse(scope)) return scope;
 *   rows = await db.select().from(courses)
 *     .where(catalogCondition(courses.trainingCatalogId, scope));
 */

import { NextResponse } from 'next/server';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import db from '@/db';
import {
  TRAINING_CATALOG_IDS,
  courses,
  enablers,
  organizationCatalogs,
  profiles,
  organizations,
  quizzes,
  traineeEnrollments,
  trainingCatalogs,
  trainingComponents,
  useCases,
} from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import { isSuperAdmin, normalizeRole, ROLE } from '@/lib/auth/roles';
import { isUuid } from '@/lib/uuid';

export const FIAE_CATALOG_ID: string = TRAINING_CATALOG_IDS.FIAE;
export const CATALOG_HEADER = 'x-catalog';
export const CATALOG_QUERY_PARAM = 'catalog';

/** The only session members the scope needs. */
export type CatalogSubject = {
  id: string;
  role: string | null | undefined;
  organizationId: string | null | undefined;
  isSuperAdmin?: boolean;
};

/** The request members read here, so tests can pass plain objects. */
export type CatalogRequestLike = {
  url?: string;
  headers?: { get(name: string): string | null };
};

export type CatalogScope = {
  /** Catalogs the caller may read and change. Never empty. */
  allowedCatalogIds: string[];
  /** Catalog for new records and the default view. Always allowed. */
  activeCatalogId: string;
  /** True when the caller chose a catalog with x-catalog or ?catalog. */
  selected: boolean;
};

export class CatalogScopeError extends Error {
  constructor(
    public readonly status: 403 | 503,
    message: string
  ) {
    super(message);
    this.name = 'CatalogScopeError';
  }
}

type CatalogRow = { id: string; code: string; isActive: boolean };

function sortCatalogs(rows: CatalogRow[]): CatalogRow[] {
  return [...rows].sort((a, b) => {
    if (a.id === FIAE_CATALOG_ID) return -1;
    if (b.id === FIAE_CATALOG_ID) return 1;
    return a.code.localeCompare(b.code);
  });
}

/** Catalog code requested by the caller (header first, then query), or null. */
export function requestedCatalogCode(
  request?: CatalogRequestLike | null
): string | null {
  if (!request) return null;
  const fromHeader = request.headers?.get?.(CATALOG_HEADER)?.trim();
  if (fromHeader) return fromHeader;
  if (request.url) {
    try {
      const fromQuery = new URL(request.url, 'http://localhost').searchParams
        .get(CATALOG_QUERY_PARAM)
        ?.trim();
      if (fromQuery) return fromQuery;
    } catch {
      // unparsable url: no catalog requested
    }
  }
  return null;
}

async function loadScopeData(subject: CatalogSubject) {
  const catalogs = (await withDbRetry(() =>
    db
      .select({
        id: trainingCatalogs.id,
        code: trainingCatalogs.code,
        isActive: trainingCatalogs.isActive,
      })
      .from(trainingCatalogs)
  )) as CatalogRow[];

  const orgRows = subject.organizationId
    ? ((await withDbRetry(() =>
        db
          .select({
            trainingCatalogId: organizationCatalogs.trainingCatalogId,
            isEnabled: organizationCatalogs.isEnabled,
          })
          .from(organizationCatalogs)
          .where(
            eq(organizationCatalogs.organizationId, subject.organizationId!)
          )
      )) as { trainingCatalogId: string; isEnabled: boolean | null }[])
    : [];

  const enrollments =
    normalizeRole(subject.role) === ROLE.TRAINEE
      ? ((await withDbRetry(() =>
          db
            .select({
              trainingCatalogId: traineeEnrollments.trainingCatalogId,
              startDate: traineeEnrollments.startDate,
            })
            .from(traineeEnrollments)
            .where(eq(traineeEnrollments.traineeId, subject.id))
        )) as { trainingCatalogId: string; startDate: string | null }[])
      : [];

  return { catalogs, orgRows, enrollments };
}

/**
 * Resolve the catalog scope of a caller. Throws CatalogScopeError (403 for a
 * rejected or empty scope, 503 if it cannot be determined).
 */
export async function getCatalogScope(
  subject: CatalogSubject,
  request?: CatalogRequestLike | null
): Promise<CatalogScope> {
  let data;
  try {
    data = await loadScopeData(subject);
  } catch (err) {
    console.error('[catalog-scope] lookup failed:', err);
    throw new CatalogScopeError(503, 'Catalog scope unavailable');
  }
  const { catalogs, orgRows, enrollments } = data;
  const byId = new Map(catalogs.map(c => [String(c.id), c]));

  const superAdmin =
    subject.isSuperAdmin ??
    isSuperAdmin({ role: subject.role, isPlatformOwner: false });

  let allowed: CatalogRow[];
  let defaultId: string | null = null;

  if (superAdmin) {
    allowed = sortCatalogs(catalogs);
  } else {
    const orgEnabled = new Set(
      orgRows
        .filter(r => r.isEnabled !== false)
        .map(r => String(r.trainingCatalogId))
    );
    // Legacy organization without any row: FIAE, as before the catalogs.
    if (orgRows.length === 0) orgEnabled.add(FIAE_CATALOG_ID);
    const usable = (id: string) => {
      const catalog = byId.get(id);
      return !!catalog && catalog.isActive && orgEnabled.has(id);
    };

    if (normalizeRole(subject.role) === ROLE.TRAINEE) {
      if (enrollments.length === 0) {
        const fiae = byId.get(FIAE_CATALOG_ID);
        allowed = fiae ? [fiae] : [];
      } else {
        const ordered = [...enrollments].sort((a, b) =>
          String(b.startDate ?? '').localeCompare(String(a.startDate ?? ''))
        );
        const ids = ordered
          .map(e => String(e.trainingCatalogId))
          .filter(id => usable(id));
        allowed = ids.map(id => byId.get(id)!);
        defaultId = ids[0] ?? null;
      }
    } else {
      allowed = sortCatalogs(catalogs.filter(c => usable(String(c.id))));
    }
  }

  if (allowed.length === 0) {
    throw new CatalogScopeError(403, 'No training catalog available');
  }

  const allowedIds = allowed.map(c => String(c.id));
  let activeId =
    defaultId && allowedIds.includes(defaultId)
      ? defaultId
      : allowedIds.includes(FIAE_CATALOG_ID)
        ? FIAE_CATALOG_ID
        : allowedIds[0];

  const requestedCode = requestedCatalogCode(request);
  let selected = false;
  if (requestedCode) {
    const match = allowed.find(
      c => c.code.toLowerCase() === requestedCode.toLowerCase()
    );
    if (!match) {
      throw new CatalogScopeError(403, 'Training catalog not allowed');
    }
    activeId = String(match.id);
    selected = true;
  }

  return { allowedCatalogIds: allowedIds, activeCatalogId: activeId, selected };
}

function scopeFailure(err: unknown): NextResponse {
  if (err instanceof CatalogScopeError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error('[catalog-scope] unexpected error:', err);
  return NextResponse.json(
    { error: 'Catalog scope unavailable' },
    { status: 503 }
  );
}

/** Like getCatalogScope, but returns a ready-made error response. */
export async function requireCatalogScope(
  subject: CatalogSubject,
  request?: CatalogRequestLike | null
): Promise<CatalogScope | NextResponse> {
  try {
    return await getCatalogScope(subject, request);
  } catch (err) {
    return scopeFailure(err);
  }
}

/**
 * Scope for routes that identify the user by an id parameter instead of a
 * session (trainee routes). The role and organization come from the profile in
 * the database; the catalog itself never comes from the client except as a
 * validated selection. An unknown user is rejected (fail closed).
 */
export async function requireCatalogScopeForUser(
  userId: string,
  request?: CatalogRequestLike | null
): Promise<CatalogScope | NextResponse> {
  let row;
  try {
    [row] = await withDbRetry(() =>
      db
        .select({
          id: profiles.id,
          role: profiles.role,
          organizationId: profiles.organizationId,
          isPlatformOwner: organizations.isPlatformOwner,
        })
        .from(profiles)
        .leftJoin(organizations, eq(profiles.organizationId, organizations.id))
        .where(eq(profiles.id, userId as any))
        .limit(1)
    );
  } catch (err) {
    console.error('[catalog-scope] profile lookup failed:', err);
    return scopeFailure(
      new CatalogScopeError(503, 'Catalog scope unavailable')
    );
  }
  if (!row) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return requireCatalogScope(
    {
      id: String(row.id),
      role: row.role,
      organizationId: row.organizationId ? String(row.organizationId) : null,
      isSuperAdmin: isSuperAdmin({
        role: row.role,
        isPlatformOwner: row.isPlatformOwner === true,
      }),
    },
    request
  );
}

/**
 * Scope of a user id for server-internal readers (HAI data context): the scope
 * or null if it cannot be determined. Callers must treat null as "no access"
 * and return no content (fail closed).
 */
export async function getCatalogScopeForUserId(
  userId: string,
  request?: CatalogRequestLike | null
): Promise<CatalogScope | null> {
  const scope = await requireCatalogScopeForUser(userId, request);
  return scope instanceof Response ? null : scope;
}

/**
 * Catalogs to filter a read by: the chosen one if the caller picked a catalog,
 * otherwise everything the caller may see.
 */
export function readCatalogIds(scope: CatalogScope): string[] {
  return scope.selected ? [scope.activeCatalogId] : scope.allowedCatalogIds;
}

/** Drizzle condition limiting a training_catalog_id column to the read scope. */
export function catalogCondition(column: PgColumn, scope: CatalogScope): SQL {
  const ids = readCatalogIds(scope);
  return (
    ids.length === 1 ? eq(column, ids[0] as any) : inArray(column, ids as any[])
  ) as SQL;
}

/**
 * Condition limiting a column to everything the caller may access, ignoring a
 * narrowing selection. Use it for writes and for lookups of a single record.
 */
export function allowedCatalogCondition(
  column: PgColumn,
  scope: CatalogScope
): SQL {
  const ids = scope.allowedCatalogIds;
  return (
    ids.length === 1 ? eq(column, ids[0] as any) : inArray(column, ids as any[])
  ) as SQL;
}

/**
 * Cache key part for the read scope, so cached data of one catalog is never
 * served to a caller with another catalog (use in apiCache keys).
 */
export function catalogCacheKey(scope: CatalogScope): string {
  return [...readCatalogIds(scope)].sort().join('+');
}

/** Combine an optional condition with the catalog condition. */
export function withCatalog(
  column: PgColumn,
  scope: CatalogScope,
  condition?: SQL
): SQL {
  const catalog = catalogCondition(column, scope);
  return (condition ? and(condition, catalog) : catalog) as SQL;
}

/** Whether a record of `catalogId` may be read or changed by the caller. */
export function isCatalogAllowed(
  scope: CatalogScope,
  catalogId: string | null | undefined
): boolean {
  return !!catalogId && scope.allowedCatalogIds.includes(String(catalogId));
}

export type CatalogContentKind =
  | 'course'
  | 'enabler'
  | 'useCase'
  | 'quiz'
  | 'trainingComponent';

const CONTENT_TABLES = {
  course: courses,
  enabler: enablers,
  useCase: useCases,
  quiz: quizzes,
  trainingComponent: trainingComponents,
} as const;

/**
 * Catalog of a content record, or null if the record does not exist. Used by
 * write routes: the parent object must lie inside the allowed catalogs.
 */
export async function getContentCatalogId(
  kind: CatalogContentKind,
  id: string
): Promise<string | null> {
  const table = CONTENT_TABLES[kind];
  const [row] = await withDbRetry(() =>
    db
      .select({ trainingCatalogId: table.trainingCatalogId })
      .from(table as any)
      .where(eq(table.id as any, id as any))
      .limit(1)
  );
  return row?.trainingCatalogId ? String(row.trainingCatalogId) : null;
}

/**
 * Scope of the caller plus the check that one content record lies inside it.
 * Returns the scope, or a ready-made error response (403 for a rejected
 * catalog selection, 404 for a record outside the scope, 503 fail closed).
 */
export async function requireContentScope(
  subject: CatalogSubject,
  request: CatalogRequestLike | null | undefined,
  kind: CatalogContentKind,
  id: string
): Promise<CatalogScope | NextResponse> {
  const scope = await requireCatalogScope(subject, request);
  if (scope instanceof Response) return scope;
  const denied = await ensureContentInScope(scope, kind, id);
  return denied ?? scope;
}

/**
 * Like requireContentScope for routes that identify the user by an id
 * parameter (trainee routes): the scope comes from the profile of `userId`.
 */
export async function requireContentScopeForUser(
  userId: string,
  request: CatalogRequestLike | null | undefined,
  kind: CatalogContentKind,
  id: string
): Promise<CatalogScope | NextResponse> {
  const scope = await requireCatalogScopeForUser(userId, request);
  if (scope instanceof Response) return scope;
  const denied = await ensureContentInScope(scope, kind, id);
  return denied ?? scope;
}

/**
 * 404 response if the content record does not exist or lies outside the
 * caller's catalogs (the same answer for both, so existence is not leaked),
 * otherwise null. A lookup failure fails closed with 503.
 */
export async function ensureContentInScope(
  scope: CatalogScope,
  kind: CatalogContentKind,
  id: string
): Promise<NextResponse | null> {
  // An id that is no uuid cannot be a record: the same 404 as for a missing
  // one, without a query the database would reject (503 or 500 otherwise)
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  let catalogId: string | null;
  try {
    catalogId = await getContentCatalogId(kind, id);
  } catch (err) {
    console.error('[catalog-scope] content lookup failed:', err);
    return NextResponse.json(
      { error: 'Catalog scope unavailable' },
      { status: 503 }
    );
  }
  if (!isCatalogAllowed(scope, catalogId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return null;
}
