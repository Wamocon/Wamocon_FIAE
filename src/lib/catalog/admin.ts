/**
 * Administration of training catalogs (occupations): which catalogs are
 * active on the platform, which ones an organization may use, and which one a
 * trainee is enrolled in.
 *
 * Only SUPER_ADMIN writes (the routes check that), ADMIN and TEMP_ADMIN read
 * their own organization. All writes run on the server with Drizzle, one
 * transaction per change, and take one advisory lock, so the checks below and
 * the write that follows cannot be overtaken by another change.
 *
 * Rules (they answer 409 instead of locking users out):
 *  - FIAE is the default occupation and can never be deactivated.
 *  - A catalog with enrolled trainees cannot be deactivated or switched off for
 *    their organization. A trainee without an enrollment row counts as FIAE.
 *  - An organization keeps at least one enabled, active catalog. An organization
 *    without any row counts as FIAE enabled (legacy), see effectiveOrganizationRows.
 *  - A trainee can have several occupations, also at the same time, one
 *    enrollment per catalog (unique on trainee_id plus training_catalog_id).
 *    addTraineeEnrollment adds one and never replaces another,
 *    removeTraineeEnrollment removes one only on purpose (confirmed) and never
 *    the last one. Until 20261030000300 a unique index on trainee_id alone
 *    allowed only one.
 *
 * The rules are pure functions (check*), they get the data as arguments and
 * return { ok: true, value } or { ok: false, status, code, count? }. The codes
 * are English and stable, the UI shows the German texts.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import db from '@/db';
import {
  TRAINING_CATALOG_IDS,
  organizationCatalogs,
  organizations,
  profiles,
  traineeEnrollments,
  trainingCatalogs,
} from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import { normalizeRole, ROLE } from '@/lib/auth/roles';
import {
  isDateOnly,
  sortEnrollments,
  toDateOnly,
} from '@/lib/catalog/enrollments';

export const FIAE_CATALOG_ID: string = TRAINING_CATALOG_IDS.FIAE;
const FIAE_CATALOG_CODE = 'FIAE';

/** Advisory lock key of every catalog administration write. */
const CATALOG_ADMIN_LOCK = 'catalog_admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CatalogInfo = {
  id: string;
  code: string;
  title: string;
  isActive: boolean;
};

export type CatalogDetails = CatalogInfo & {
  description: string | null;
  durationYears: number;
  electivePickCount: number;
};

export type OrgCatalogRow = {
  trainingCatalogId: string;
  isEnabled: boolean | null;
};

/** Trainees per catalog, plus the trainees that have no enrollment row. */
export type CatalogUsage = {
  enrollmentCounts: Record<string, number>;
  unenrolledTrainees: number;
};

export type RuleCode =
  | 'CATALOG_NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'NOT_A_TRAINEE'
  | 'CATALOG_INACTIVE'
  | 'CATALOG_NOT_ENABLED'
  | 'CATALOG_IN_USE'
  | 'LAST_ENABLED_CATALOG'
  | 'DEFAULT_CATALOG'
  | 'CATALOG_REQUIRED'
  | 'ENROLLMENT_NOT_FOUND'
  | 'LAST_ENROLLMENT'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_ENROLLMENT_TERMS';

export type RuleFailure = {
  ok: false;
  status: 400 | 404 | 409;
  code: RuleCode;
  count?: number;
};

export type RuleResult<T> = { ok: true; value: T } | RuleFailure;

export type CatalogWithUsage = CatalogDetails & {
  /** Enrolled trainees, including trainees without a row for FIAE. */
  traineeCount: number;
  /** Organizations that have the catalog enabled. */
  organizationCount: number;
};

export type OrganizationCatalogEntry = {
  trainingCatalogId: string;
  code: string;
  title: string;
  isActive: boolean;
  isEnabled: boolean;
  /** Trainees of the organization in this catalog (FIAE includes unenrolled). */
  traineeCount: number;
};

export type TraineeEnrollmentItem = {
  id: string;
  trainingCatalogId: string;
  code: string;
  title: string;
  startDate: string | null;
  durationYears: number;
};

export type TraineeEnrollmentView = {
  /** Every enrollment of the trainee, the training started with first. */
  enrollments: TraineeEnrollmentItem[];
  /** The first enrollment (the default occupation), null without a row. */
  enrollment: TraineeEnrollmentItem | null;
  /** The default catalog of the trainee: the first enrollment, otherwise FIAE. */
  effectiveCatalogId: string;
  /** True when there is no enrollment row and FIAE applies by default. */
  isImplicit: boolean;
};

export type EnrollmentAddition = {
  trainingCatalogId: string;
  /** False when the trainee already was enrolled in exactly this catalog. */
  changed: boolean;
  /** Number of enrollments of the trainee after the call. */
  enrollmentCount: number;
};

export type EnrollmentRemoval = {
  trainingCatalogId: string;
  /** Number of enrollments the trainee still has. */
  remaining: number;
};

/** Start date and duration of an enrollment that is added (both optional). */
export type EnrollmentTermsInput = {
  /** yyyy-mm-dd, or null for "unknown". Without it the profile start counts. */
  startDate?: string | null;
  /** 2 or 3. Without it the duration of the profile counts. */
  durationYears?: number;
};

export type Executor = Pick<
  typeof db,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

const NO_USAGE: CatalogUsage = { enrollmentCounts: {}, unenrolledTrainees: 0 };

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

function fail(
  status: RuleFailure['status'],
  code: RuleCode,
  count?: number
): RuleFailure {
  return count === undefined
    ? { ok: false, status, code }
    : { ok: false, status, code, count };
}

/**
 * The rows that decide what an organization may use. An organization without
 * any row is a legacy organization and counts as FIAE enabled, like in the
 * catalog scope.
 */
export function effectiveOrganizationRows(
  rows: OrgCatalogRow[]
): OrgCatalogRow[] {
  return rows.length > 0
    ? rows
    : [{ trainingCatalogId: FIAE_CATALOG_ID, isEnabled: true }];
}

/** Whether the organization has the catalog enabled (active or not). */
export function isCatalogEnabled(
  orgRows: OrgCatalogRow[],
  catalogId: string
): boolean {
  return effectiveOrganizationRows(orgRows).some(
    r => String(r.trainingCatalogId) === catalogId && r.isEnabled !== false
  );
}

/** Catalogs an organization can really use: enabled and active. */
export function usableCatalogIds(
  orgRows: OrgCatalogRow[],
  catalogs: CatalogInfo[]
): string[] {
  const active = new Set(catalogs.filter(c => c.isActive).map(c => c.id));
  return effectiveOrganizationRows(orgRows)
    .filter(
      r => r.isEnabled !== false && active.has(String(r.trainingCatalogId))
    )
    .map(r => String(r.trainingCatalogId));
}

/** Trainees in a catalog. A trainee without an enrollment row counts as FIAE. */
export function countTraineesInCatalog(
  catalogId: string,
  usage: CatalogUsage
): number {
  const enrolled = usage.enrollmentCounts[catalogId] ?? 0;
  return catalogId === FIAE_CATALOG_ID
    ? enrolled + usage.unenrolledTrainees
    : enrolled;
}

/**
 * Organizations for which the catalog is the only usable one. Deactivating it
 * would leave them without any catalog.
 */
export function countDependentOrganizations(
  catalogId: string,
  catalogs: CatalogInfo[],
  organizationIds: string[],
  rowsByOrganization: Map<string, OrgCatalogRow[]>
): number {
  return organizationIds.filter(orgId => {
    const usable = usableCatalogIds(
      rowsByOrganization.get(orgId) ?? [],
      catalogs
    );
    return usable.length === 1 && usable[0] === catalogId;
  }).length;
}

/** May a catalog be switched on or off for the whole platform? */
export function checkCatalogDeactivation(input: {
  catalog: CatalogInfo | null;
  /** The wanted state. */
  isActive: boolean;
  usage: CatalogUsage;
  dependentOrganizations: number;
}): RuleResult<CatalogInfo> {
  const { catalog, isActive, usage, dependentOrganizations } = input;
  if (!catalog) return fail(404, 'CATALOG_NOT_FOUND');
  if (isActive) return { ok: true, value: catalog };
  if (catalog.id === FIAE_CATALOG_ID) return fail(409, 'DEFAULT_CATALOG');
  // Already inactive: nothing changes, nobody is locked out by it
  if (!catalog.isActive) return { ok: true, value: catalog };
  const trainees = countTraineesInCatalog(catalog.id, usage);
  if (trainees > 0) return fail(409, 'CATALOG_IN_USE', trainees);
  if (dependentOrganizations > 0) {
    return fail(409, 'LAST_ENABLED_CATALOG', dependentOrganizations);
  }
  return { ok: true, value: catalog };
}

/** May a catalog be enabled or disabled for one organization? */
export function checkOrganizationCatalogChange(input: {
  catalogId: string;
  isEnabled: boolean;
  catalogs: CatalogInfo[];
  /** Rows of the organization as stored (no row means legacy FIAE). */
  orgRows: OrgCatalogRow[];
  /** Trainees of this organization. */
  usage: CatalogUsage;
}): RuleResult<CatalogInfo> {
  const { catalogId, isEnabled, catalogs, orgRows, usage } = input;
  const catalog = catalogs.find(c => c.id === catalogId);
  if (!catalog) return fail(404, 'CATALOG_NOT_FOUND');
  if (isEnabled) return { ok: true, value: catalog };
  // Switching off what is not enabled changes nothing
  if (!isCatalogEnabled(orgRows, catalogId)) {
    return { ok: true, value: catalog };
  }
  const usable = usableCatalogIds(orgRows, catalogs);
  if (usable.includes(catalogId) && usable.length === 1) {
    return fail(409, 'LAST_ENABLED_CATALOG');
  }
  const trainees = countTraineesInCatalog(catalogId, usage);
  if (trainees > 0) return fail(409, 'CATALOG_IN_USE', trainees);
  return { ok: true, value: catalog };
}

/**
 * May a trainee be enrolled in a catalog? The user must be a trainee, the
 * catalog must be active and enabled for the organization of the trainee.
 */
export function checkEnrollmentTarget(input: {
  trainee: { role: string | null | undefined };
  catalog: CatalogInfo | null;
  orgRows: OrgCatalogRow[];
}): RuleResult<CatalogInfo> {
  const { trainee, catalog, orgRows } = input;
  if (normalizeRole(trainee.role) !== ROLE.TRAINEE) {
    return fail(400, 'NOT_A_TRAINEE');
  }
  if (!catalog) return fail(404, 'CATALOG_NOT_FOUND');
  if (!catalog.isActive) return fail(400, 'CATALOG_INACTIVE');
  if (!isCatalogEnabled(orgRows, catalog.id)) {
    return fail(400, 'CATALOG_NOT_ENABLED');
  }
  return { ok: true, value: catalog };
}

/**
 * The catalog of a trainee that is created now. A requested catalog has to pass
 * the same rules as an enrollment (active, enabled for the organization).
 * Without a request the default applies: the only usable catalog of the
 * organization, or FIAE when there are several (so an organization that only
 * knows FIAE behaves as before). Several usable catalogs without FIAE among
 * them cannot be decided, the choice is required (400).
 */
export function resolveNewTraineeCatalog(input: {
  requestedCatalogId: string | null;
  catalogs: CatalogInfo[];
  orgRows: OrgCatalogRow[];
}): RuleResult<CatalogInfo> {
  const { requestedCatalogId, catalogs, orgRows } = input;
  if (requestedCatalogId) {
    return checkEnrollmentTarget({
      trainee: { role: ROLE.TRAINEE },
      catalog: catalogs.find(c => c.id === requestedCatalogId) ?? null,
      orgRows,
    });
  }
  const usable = usableCatalogIds(orgRows, catalogs);
  const pickId =
    usable.length === 1
      ? usable[0]
      : usable.includes(FIAE_CATALOG_ID)
        ? FIAE_CATALOG_ID
        : null;
  if (pickId) {
    const catalog = catalogs.find(c => c.id === pickId);
    if (catalog) return { ok: true, value: catalog };
  }
  return usable.length === 0
    ? fail(400, 'CATALOG_NOT_ENABLED')
    : fail(400, 'CATALOG_REQUIRED');
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

const RULE_MESSAGES: Record<RuleCode, string> = {
  CATALOG_NOT_FOUND: 'Training catalog not found',
  USER_NOT_FOUND: 'User not found',
  NOT_A_TRAINEE: 'Only trainees can be enrolled in a training catalog',
  CATALOG_INACTIVE: 'The training catalog is not active',
  CATALOG_NOT_ENABLED:
    'The training catalog is not enabled for the organization of the trainee',
  CATALOG_IN_USE:
    'The training catalog cannot be switched off while trainees are enrolled in it',
  LAST_ENABLED_CATALOG:
    'An organization must keep at least one enabled and active training catalog',
  DEFAULT_CATALOG: 'The default training catalog (FIAE) cannot be deactivated',
  CATALOG_REQUIRED:
    'The organization offers several training catalogs, choose one for the trainee',
  ENROLLMENT_NOT_FOUND: 'The trainee is not enrolled in this training catalog',
  LAST_ENROLLMENT:
    'The last enrollment of a trainee cannot be removed, add the other training first',
  CONFIRMATION_REQUIRED:
    'Removing an enrollment has to be confirmed explicitly (confirm: true)',
  INVALID_ENROLLMENT_TERMS:
    'startDate must be a date (yyyy-mm-dd) or null and durationYears 2 or 3',
};

/** JSON body of an error answer: readable text, stable code, optional count. */
export function ruleFailureBody(failure: RuleFailure): {
  error: string;
  code: RuleCode;
  count?: number;
} {
  return failure.count === undefined
    ? { error: RULE_MESSAGES[failure.code], code: failure.code }
    : {
        error: RULE_MESSAGES[failure.code],
        code: failure.code,
        count: failure.count,
      };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value has the shape of a uuid (the database rejects others). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** The JSON object of a request body, or null if it is none (or not JSON). */
export async function readJsonObject(request: {
  json(): Promise<unknown>;
}): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Database reads (shared by reads and by the checks of the writes)
// ---------------------------------------------------------------------------

function sortCatalogs<T extends { id: string; code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.id === FIAE_CATALOG_ID) return -1;
    if (b.id === FIAE_CATALOG_ID) return 1;
    return a.code.localeCompare(b.code);
  });
}

async function loadCatalogs(q: Executor): Promise<CatalogInfo[]> {
  const rows = await q
    .select({
      id: trainingCatalogs.id,
      code: trainingCatalogs.code,
      title: trainingCatalogs.title,
      isActive: trainingCatalogs.isActive,
    })
    .from(trainingCatalogs);
  return sortCatalogs(
    rows.map(r => ({
      id: String(r.id),
      code: r.code,
      title: r.title,
      isActive: r.isActive === true,
    }))
  );
}

async function loadCatalogDetails(q: Executor): Promise<CatalogDetails[]> {
  const rows = await q
    .select({
      id: trainingCatalogs.id,
      code: trainingCatalogs.code,
      title: trainingCatalogs.title,
      description: trainingCatalogs.description,
      isActive: trainingCatalogs.isActive,
      durationYears: trainingCatalogs.durationYears,
      electivePickCount: trainingCatalogs.electivePickCount,
    })
    .from(trainingCatalogs);
  return sortCatalogs(
    rows.map(r => ({
      id: String(r.id),
      code: r.code,
      title: r.title,
      description: r.description ?? null,
      isActive: r.isActive === true,
      durationYears: Number(r.durationYears),
      electivePickCount: Number(r.electivePickCount),
    }))
  );
}

async function loadOrganizationRows(
  q: Executor,
  organizationId: string
): Promise<OrgCatalogRow[]> {
  const rows = await q
    .select({
      trainingCatalogId: organizationCatalogs.trainingCatalogId,
      isEnabled: organizationCatalogs.isEnabled,
    })
    .from(organizationCatalogs)
    .where(eq(organizationCatalogs.organizationId, organizationId));
  return rows.map(r => ({
    trainingCatalogId: String(r.trainingCatalogId),
    isEnabled: r.isEnabled,
  }));
}

/** Organization ids and their catalog rows, for the platform-wide checks. */
async function loadAllOrganizationRows(q: Executor) {
  const [orgs, rows] = await Promise.all([
    q.select({ id: organizations.id }).from(organizations),
    q
      .select({
        organizationId: organizationCatalogs.organizationId,
        trainingCatalogId: organizationCatalogs.trainingCatalogId,
        isEnabled: organizationCatalogs.isEnabled,
      })
      .from(organizationCatalogs),
  ]);
  const byOrganization = new Map<string, OrgCatalogRow[]>();
  for (const r of rows) {
    const key = String(r.organizationId);
    const list = byOrganization.get(key) ?? [];
    list.push({
      trainingCatalogId: String(r.trainingCatalogId),
      isEnabled: r.isEnabled,
    });
    byOrganization.set(key, list);
  }
  return { organizationIds: orgs.map(o => String(o.id)), byOrganization };
}

/**
 * Trainees per catalog, for one organization or (without id) the platform.
 * Only users with the role TRAINEE count. Those without any enrollment row
 * are counted separately, they work in FIAE.
 */
async function loadUsage(
  q: Executor,
  organizationId: string | null
): Promise<CatalogUsage> {
  const inOrganization = organizationId
    ? eq(profiles.organizationId, organizationId)
    : undefined;

  const [grouped, unenrolled] = await Promise.all([
    q
      .select({
        catalogId: traineeEnrollments.trainingCatalogId,
        count: sql<number>`count(distinct ${traineeEnrollments.traineeId})::int`,
      })
      .from(traineeEnrollments)
      .innerJoin(profiles, eq(profiles.id, traineeEnrollments.traineeId))
      .where(and(eq(profiles.role, ROLE.TRAINEE), inOrganization))
      .groupBy(traineeEnrollments.trainingCatalogId),
    q
      .select({ count: sql<number>`count(*)::int` })
      .from(profiles)
      .leftJoin(
        traineeEnrollments,
        eq(traineeEnrollments.traineeId, profiles.id)
      )
      .where(
        and(
          eq(profiles.role, ROLE.TRAINEE),
          isNull(traineeEnrollments.id),
          inOrganization
        )
      ),
  ]);

  const enrollmentCounts: Record<string, number> = {};
  for (const row of grouped) {
    enrollmentCounts[String(row.catalogId)] = Number(row.count);
  }
  return {
    enrollmentCounts,
    unenrolledTrainees: Number(unenrolled[0]?.count ?? 0),
  };
}

/**
 * Reads what decides the catalog of a new trainee and decides it
 * (resolveNewTraineeCatalog). Writes nothing, so it also serves as an early
 * check before anything is created. Run it with the executor of the
 * transaction (after takeCatalogAdminLock) for the check that counts.
 */
export async function loadNewTraineeCatalog(
  q: Executor,
  organizationId: string,
  requestedCatalogId: string | null
): Promise<RuleResult<CatalogInfo>> {
  const catalogs = await loadCatalogs(q);
  const orgRows = await loadOrganizationRows(q, organizationId);
  return resolveNewTraineeCatalog({ requestedCatalogId, catalogs, orgRows });
}

/**
 * The enrollment of a trainee that was created just now, in the transaction of
 * the caller. A new profile has no start date yet and the default duration of
 * three years, the same values setTraineeEnrollment takes from such a profile.
 */
export async function insertTraineeEnrollment(
  q: Executor,
  traineeId: string,
  catalogId: string
): Promise<void> {
  await q.insert(traineeEnrollments).values({
    traineeId,
    trainingCatalogId: catalogId,
    startDate: null,
    durationYears: 3,
  });
}

/**
 * Lock of every catalog administration write (held until the transaction
 * ends). A flow that also takes the seat lock of an organization takes that
 * one first, see src/lib/admin/userWrites.ts.
 */
export async function takeCatalogAdminLock(tx: Executor) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${CATALOG_ADMIN_LOCK}))`
  );
}

// ---------------------------------------------------------------------------
// Platform level: which catalogs are active
// ---------------------------------------------------------------------------

/** All catalogs with the number of trainees and organizations that use them. */
export async function listCatalogsWithUsage(): Promise<CatalogWithUsage[]> {
  return withDbRetry(async () => {
    const catalogs = await loadCatalogDetails(db);
    const usage = await loadUsage(db, null);
    const { organizationIds, byOrganization } =
      await loadAllOrganizationRows(db);
    return catalogs.map(catalog => ({
      ...catalog,
      traineeCount: countTraineesInCatalog(catalog.id, usage),
      organizationCount: organizationIds.filter(orgId =>
        isCatalogEnabled(byOrganization.get(orgId) ?? [], catalog.id)
      ).length,
    }));
  });
}

/** Switch a catalog on or off for the whole platform. */
export async function setCatalogActive(
  catalogId: string,
  isActive: boolean
): Promise<RuleResult<CatalogInfo>> {
  return db.transaction(async tx => {
    await takeCatalogAdminLock(tx);
    const catalogs = await loadCatalogs(tx);
    const catalog = catalogs.find(c => c.id === catalogId) ?? null;
    // The platform-wide counts are only needed to switch a catalog off
    const needsUsage = !isActive && !!catalog && catalog.isActive;
    const usage = needsUsage ? await loadUsage(tx, null) : NO_USAGE;
    const { organizationIds, byOrganization } = needsUsage
      ? await loadAllOrganizationRows(tx)
      : { organizationIds: [], byOrganization: new Map() };

    const check = checkCatalogDeactivation({
      catalog,
      isActive,
      usage,
      dependentOrganizations: countDependentOrganizations(
        catalogId,
        catalogs,
        organizationIds,
        byOrganization
      ),
    });
    if (!check.ok) return check;

    const updated = await tx
      .update(trainingCatalogs)
      .set({ isActive })
      .where(eq(trainingCatalogs.id, catalogId))
      .returning({ id: trainingCatalogs.id });
    if (updated.length === 0) return fail(404, 'CATALOG_NOT_FOUND');
    return { ok: true, value: { ...check.value, isActive } };
  });
}

// ---------------------------------------------------------------------------
// Organization level: which catalogs an organization may use
// ---------------------------------------------------------------------------

/**
 * The catalogs of an organization with their state. Organization admins only
 * get active catalogs (includeInactive false), the platform admin gets all.
 */
export async function listOrganizationCatalogs(
  organizationId: string,
  options: { includeInactive: boolean }
): Promise<OrganizationCatalogEntry[]> {
  return withDbRetry(async () => {
    const catalogs = await loadCatalogs(db);
    const orgRows = await loadOrganizationRows(db, organizationId);
    const usage = await loadUsage(db, organizationId);
    return catalogs
      .filter(c => options.includeInactive || c.isActive)
      .map(c => ({
        trainingCatalogId: c.id,
        code: c.code,
        title: c.title,
        isActive: c.isActive,
        isEnabled: isCatalogEnabled(orgRows, c.id),
        traineeCount: countTraineesInCatalog(c.id, usage),
      }));
  });
}

/**
 * The ids of the catalogs an organization can use right now (enabled and
 * active, an organization without any row counts as FIAE enabled). Fail closed:
 * an organization that does not exist gets none, so a session that points at a
 * missing organization sees nothing of the catalogs. Used by the content
 * statistics of an organization admin.
 */
export async function listUsableCatalogIds(
  organizationId: string,
  q: Executor = db
): Promise<string[]> {
  return withDbRetry(async () => {
    const [organization] = await q
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) return [];
    const catalogs = await loadCatalogs(q);
    const orgRows = await loadOrganizationRows(q, organizationId);
    return usableCatalogIds(orgRows, catalogs);
  });
}

/**
 * Enable or disable a catalog for an organization (upsert on the primary
 * key). An organization that has no row yet gets the FIAE row as well, so its
 * existing users keep what they had.
 */
export async function setOrganizationCatalog(
  organizationId: string,
  catalogId: string,
  isEnabled: boolean
): Promise<RuleResult<CatalogInfo>> {
  return db.transaction(async tx => {
    await takeCatalogAdminLock(tx);
    const catalogs = await loadCatalogs(tx);
    const orgRows = await loadOrganizationRows(tx, organizationId);
    // The trainee counts are only needed to switch a catalog off
    const usage = isEnabled ? NO_USAGE : await loadUsage(tx, organizationId);

    const check = checkOrganizationCatalogChange({
      catalogId,
      isEnabled,
      catalogs,
      orgRows,
      usage,
    });
    if (!check.ok) return check;

    if (orgRows.length === 0 && catalogId !== FIAE_CATALOG_ID) {
      await tx
        .insert(organizationCatalogs)
        .values({
          organizationId,
          trainingCatalogId: FIAE_CATALOG_ID,
          isEnabled: true,
        })
        .onConflictDoNothing();
    }
    await tx
      .insert(organizationCatalogs)
      .values({ organizationId, trainingCatalogId: catalogId, isEnabled })
      .onConflictDoUpdate({
        target: [
          organizationCatalogs.organizationId,
          organizationCatalogs.trainingCatalogId,
        ],
        set: { isEnabled, updatedAt: new Date() },
      });
    return check;
  });
}

// ---------------------------------------------------------------------------
// Trainee level: the occupation of a trainee
// ---------------------------------------------------------------------------

/** The enrollments of a trainee, the training started with first. */
async function loadEnrollmentRows(traineeId: string) {
  const rows = await withDbRetry(() =>
    db
      .select({
        id: traineeEnrollments.id,
        trainingCatalogId: traineeEnrollments.trainingCatalogId,
        startDate: traineeEnrollments.startDate,
        durationYears: traineeEnrollments.durationYears,
        createdAt: traineeEnrollments.createdAt,
        code: trainingCatalogs.code,
        title: trainingCatalogs.title,
      })
      .from(traineeEnrollments)
      .innerJoin(
        trainingCatalogs,
        eq(trainingCatalogs.id, traineeEnrollments.trainingCatalogId)
      )
      .where(eq(traineeEnrollments.traineeId, traineeId))
  );
  return sortEnrollments(
    rows.map(r => ({ ...r, trainingCatalogId: String(r.trainingCatalogId) }))
  );
}

/**
 * The enrollments of a trainee. Without a row the trainee counts as FIAE. The
 * first enrollment (the training the trainee started with) is the default
 * occupation, the others follow in the order of their enrollment.
 */
export async function getTraineeEnrollment(
  traineeId: string
): Promise<TraineeEnrollmentView> {
  const rows = await loadEnrollmentRows(traineeId);
  const enrollments: TraineeEnrollmentItem[] = rows.map(r => ({
    id: String(r.id),
    trainingCatalogId: r.trainingCatalogId,
    code: r.code,
    title: r.title,
    startDate: r.startDate ?? null,
    durationYears: Number(r.durationYears),
  }));
  const [first] = enrollments;
  if (!first) {
    return {
      enrollments: [],
      enrollment: null,
      effectiveCatalogId: FIAE_CATALOG_ID,
      isImplicit: true,
    };
  }
  return {
    enrollments,
    enrollment: first,
    effectiveCatalogId: first.trainingCatalogId,
    isImplicit: false,
  };
}

/**
 * Catalog codes per trainee id, every enrollment of the trainee in the order
 * of the enrollment (one query for the enrollments, one for the codes, no
 * join). A trainee without an enrollment gets the FIAE code.
 */
export async function getTrainingCatalogCodeLists(
  traineeIds: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (traineeIds.length === 0) return result;

  const [enrollments, catalogs] = await Promise.all([
    withDbRetry(() =>
      db
        .select({
          traineeId: traineeEnrollments.traineeId,
          trainingCatalogId: traineeEnrollments.trainingCatalogId,
          startDate: traineeEnrollments.startDate,
          createdAt: traineeEnrollments.createdAt,
        })
        .from(traineeEnrollments)
        .where(inArray(traineeEnrollments.traineeId, traineeIds))
    ),
    withDbRetry(() =>
      db
        .select({ id: trainingCatalogs.id, code: trainingCatalogs.code })
        .from(trainingCatalogs)
    ),
  ]);
  const codeById = new Map(catalogs.map(c => [String(c.id), c.code]));
  const defaultCode = codeById.get(FIAE_CATALOG_ID) ?? FIAE_CATALOG_CODE;

  const byTrainee = new Map<string, typeof enrollments>();
  for (const e of enrollments) {
    const key = String(e.traineeId);
    byTrainee.set(key, [...(byTrainee.get(key) ?? []), e]);
  }
  for (const id of traineeIds) {
    const codes = sortEnrollments(
      (byTrainee.get(id) ?? []).map(e => ({
        ...e,
        trainingCatalogId: String(e.trainingCatalogId),
      }))
    )
      .map(e => codeById.get(e.trainingCatalogId))
      .filter((code): code is string => !!code);
    result.set(id, codes.length > 0 ? codes : [defaultCode]);
  }
  return result;
}

/**
 * Catalog code per trainee id: the code of the first enrollment, FIAE for a
 * trainee without one (see getTrainingCatalogCodeLists for all of them).
 */
export async function getTrainingCatalogCodes(
  traineeIds: string[]
): Promise<Map<string, string>> {
  const lists = await getTrainingCatalogCodeLists(traineeIds);
  return new Map(
    [...lists].map(([id, codes]) => [id, codes[0] ?? FIAE_CATALOG_CODE])
  );
}

/** The start date and duration of an added enrollment, or the failure. */
function checkEnrollmentTerms(
  terms: EnrollmentTermsInput
): RuleResult<EnrollmentTermsInput> {
  const { startDate, durationYears } = terms;
  if (startDate !== undefined && startDate !== null && !isDateOnly(startDate)) {
    return fail(400, 'INVALID_ENROLLMENT_TERMS');
  }
  if (
    durationYears !== undefined &&
    durationYears !== 2 &&
    durationYears !== 3
  ) {
    return fail(400, 'INVALID_ENROLLMENT_TERMS');
  }
  return { ok: true, value: terms };
}

/**
 * Enroll a trainee in one more catalog. In one transaction: the enrollment is
 * created with the start date and duration the admin gave, or with those of the
 * profile. Other enrollments of the trainee stay as they are (with their
 * elective choices), an enrollment that already exists for the catalog is kept
 * as it is.
 */
export async function addTraineeEnrollment(
  traineeId: string,
  catalogId: string,
  terms: EnrollmentTermsInput = {}
): Promise<RuleResult<EnrollmentAddition>> {
  const termsCheck = checkEnrollmentTerms(terms);
  if (!termsCheck.ok) return termsCheck;

  return db.transaction(async tx => {
    await takeCatalogAdminLock(tx);

    const [trainee] = await tx
      .select({
        id: profiles.id,
        role: profiles.role,
        organizationId: profiles.organizationId,
        startOfTrainingDate: profiles.startOfTrainingDate,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
      })
      .from(profiles)
      .where(eq(profiles.id, traineeId))
      .limit(1);
    if (!trainee) return fail(404, 'USER_NOT_FOUND');

    const catalogs = await loadCatalogs(tx);
    const orgRows = trainee.organizationId
      ? await loadOrganizationRows(tx, String(trainee.organizationId))
      : [];
    const check = checkEnrollmentTarget({
      trainee,
      catalog: catalogs.find(c => c.id === catalogId) ?? null,
      orgRows,
    });
    if (!check.ok) return check;

    const current = await tx
      .select({
        id: traineeEnrollments.id,
        trainingCatalogId: traineeEnrollments.trainingCatalogId,
      })
      .from(traineeEnrollments)
      .where(eq(traineeEnrollments.traineeId, traineeId));
    if (current.some(e => String(e.trainingCatalogId) === catalogId)) {
      return {
        ok: true,
        value: {
          trainingCatalogId: catalogId,
          changed: false,
          enrollmentCount: current.length,
        },
      };
    }

    const profileStart = toDateOnly(trainee.startOfTrainingDate);
    const profileDuration = trainee.ausbildungDurationYears === 2 ? 2 : 3;

    // A trainee without any row works in FIAE (the default). Adding another
    // training must not take that away, so the FIAE becomes a real enrollment
    // first, with the terms of the profile (when the organization offers it).
    // It is created before the new one: it stays the first enrollment.
    const makeDefaultReal =
      current.length === 0 &&
      catalogId !== FIAE_CATALOG_ID &&
      usableCatalogIds(orgRows, catalogs).includes(FIAE_CATALOG_ID);
    if (makeDefaultReal) {
      await tx.insert(traineeEnrollments).values({
        traineeId,
        trainingCatalogId: FIAE_CATALOG_ID,
        startDate: profileStart,
        durationYears: profileDuration,
        // Both rows are written in this transaction (same now()): the default
        // is older by a second, so it stays the first whatever start date the
        // admin gives the new training
        createdAt: sql`now() - interval '1 second'`,
      });
    }

    await tx.insert(traineeEnrollments).values({
      traineeId,
      trainingCatalogId: catalogId,
      startDate: terms.startDate !== undefined ? terms.startDate : profileStart,
      durationYears: terms.durationYears ?? profileDuration,
    });

    return {
      ok: true,
      value: {
        trainingCatalogId: catalogId,
        changed: true,
        enrollmentCount: current.length + (makeDefaultReal ? 2 : 1),
      },
    };
  });
}

/**
 * The old name of addTraineeEnrollment. It used to replace the other
 * enrollments of the trainee, it only adds now.
 *
 * @deprecated use addTraineeEnrollment
 */
export const setTraineeEnrollment = addTraineeEnrollment;

/**
 * Remove one enrollment of a trainee, only on purpose (`confirmed` has to be
 * true) and never the last one (the trainee would silently count as FIAE).
 *
 * It deletes the one row of this trainee and catalog, nothing else. The elective
 * choices of the enrollment follow by cascade. Course memberships, quiz
 * assignments and every submission of the trainee stay as they are: they hold
 * what the trainee did, and the catalog filters of the trainee area no longer
 * show the content of the removed training. Enrolling in the catalog again
 * brings it back. When the FIRST training is removed, the profile takes over
 * the start date and duration of the next one (see the comment in the body).
 */
export async function removeTraineeEnrollment(
  traineeId: string,
  catalogId: string,
  options: { confirmed: boolean }
): Promise<RuleResult<EnrollmentRemoval>> {
  if (options?.confirmed !== true) return fail(400, 'CONFIRMATION_REQUIRED');

  return db.transaction(async tx => {
    await takeCatalogAdminLock(tx);

    const [trainee] = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, traineeId))
      .limit(1);
    if (!trainee) return fail(404, 'USER_NOT_FOUND');

    const current = await tx
      .select({
        id: traineeEnrollments.id,
        trainingCatalogId: traineeEnrollments.trainingCatalogId,
        startDate: traineeEnrollments.startDate,
        durationYears: traineeEnrollments.durationYears,
        createdAt: traineeEnrollments.createdAt,
      })
      .from(traineeEnrollments)
      .where(eq(traineeEnrollments.traineeId, traineeId));
    const target = current.find(e => String(e.trainingCatalogId) === catalogId);
    if (!target) return fail(404, 'ENROLLMENT_NOT_FOUND');
    if (current.length < 2) return fail(409, 'LAST_ENROLLMENT');

    // The profile (start date, duration) describes the FIRST training. If that
    // one goes, the next one becomes the first and the profile takes over its
    // own dates, otherwise it would be counted with the dates of the training
    // that is gone. Without a start date of its own the profile stays.
    const ordered = sortEnrollments(
      current.map(e => ({ ...e, trainingCatalogId: String(e.trainingCatalogId) }))
    );
    if (ordered[0].id === target.id && ordered[1].startDate) {
      await tx
        .update(profiles)
        .set({
          startOfTrainingDate: new Date(`${ordered[1].startDate}T00:00:00.000Z`),
          ausbildungDurationYears: ordered[1].durationYears,
        })
        .where(eq(profiles.id, traineeId));
    }

    await tx
      .delete(traineeEnrollments)
      .where(
        and(
          eq(traineeEnrollments.id, target.id),
          eq(traineeEnrollments.traineeId, traineeId)
        )
      );

    return {
      ok: true,
      value: { trainingCatalogId: catalogId, remaining: current.length - 1 },
    };
  });
}
