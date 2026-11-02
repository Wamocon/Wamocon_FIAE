/**
 * Responsibility checks for the HAI actions. Every check fails closed: a
 * missing record, a foreign organization, a foreign occupation and a lookup
 * that cannot be answered all stop the action. A foreign record answers like a
 * missing one ("not found"), so nothing is leaked.
 *
 * The checks reuse the rules of the rest of the app: the organization scope of
 * the session (scopeOrg / isInOrgScope), the catalog scope of the person and
 * the occupation filter of the trainee lists (ensureTraineeInCatalog).
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import db from '@/db';
import { profiles } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import { normalizeRole, ROLE } from '@/lib/auth/roles';
import { isInOrgScope, scopeOrg, type SessionUser } from '@/lib/auth/session';
import {
  ensureContentInScope,
  requireCatalogScope,
  type CatalogContentKind,
  type CatalogRequestLike,
} from '@/lib/catalog/scope';
import { ensureTraineeInCatalog } from '@/lib/catalog/trainee-scope';
import { ensureReportInChosenCatalog } from '@/lib/auth/activity-report-access';
import type { ActionFailureCode, ActionResult } from './actions';
import {
  DENIAL_ACTION_NOT_FOUND_TEXT,
  DENIAL_ACTION_OCCUPATION_TEXT,
  DENIAL_ACTION_UNAVAILABLE_TEXT,
  type DenialCategory,
} from './denial';

/**
 * A failed result. `denial` is the category of the reason when the failure
 * hangs on access (denial.ts), the route sends it so the interface can name the
 * reason. A technical failure carries none.
 */
export function fail(
  code: ActionFailureCode,
  message: string,
  error: string,
  denial?: DenialCategory
): ActionResult {
  return {
    success: false,
    message,
    error,
    code,
    ...(denial ? { denial } : {}),
  };
}

// A foreign record answers like a missing one, so the reason is the coarse
// "not in your released content and responsibility", never "it exists elsewhere"
export const notFound = (): ActionResult =>
  fail('not_found', DENIAL_ACTION_NOT_FOUND_TEXT, 'Not found', 'UMFANG');

// A technical failure, said as such: no denial category
export const unavailable = (): ActionResult =>
  fail('unavailable', DENIAL_ACTION_UNAVAILABLE_TEXT, 'Scope unavailable');

/** Map the ready-made error response of a scope helper to an action result. */
function fromResponse(response: NextResponse): ActionResult {
  if (response.status === 404) return notFound();
  if (response.status === 403) {
    return fail(
      'forbidden',
      DENIAL_ACTION_OCCUPATION_TEXT,
      'Occupation not allowed',
      'BERUF'
    );
  }
  return unavailable();
}

/**
 * The occupation the person works in (the chosen one, x-catalog, otherwise the
 * default of the scope): the occupation a new record belongs to, and the one a
 * lookup by week or by status asks in. Returns the catalog id, or the failed
 * result (403 foreign occupation, unavailable when the scope cannot be read).
 */
export async function requireActionCatalog(
  actor: SessionUser,
  request: CatalogRequestLike | null | undefined
): Promise<{ catalogId: string } | ActionResult> {
  const scope = await requireCatalogScope(actor, request);
  if (scope instanceof Response) return fromResponse(scope as NextResponse);
  return { catalogId: scope.activeCatalogId };
}

/**
 * An activity report belongs to one occupation. With an occupation chosen
 * (x-catalog) trainer level may only act on a report of that occupation. Returns
 * null when the report lies inside, otherwise the failed result (a foreign
 * report answers like a missing one).
 */
export async function requireReportInChosenCatalog(
  actor: SessionUser,
  request: CatalogRequestLike | null | undefined,
  report: { trainingCatalogId: unknown }
): Promise<ActionResult | null> {
  const denied = await ensureReportInChosenCatalog(
    actor,
    request ?? {},
    report,
    () => NextResponse.json({ error: 'Not found' }, { status: 404 })
  );
  return denied ? fromResponse(denied) : null;
}

/**
 * The content record (enabler, quiz, ...) must lie inside the catalogs of the
 * person. Returns null when it does, otherwise the failed result.
 */
export async function ensureContentAllowed(
  actor: SessionUser,
  request: CatalogRequestLike | null | undefined,
  kind: CatalogContentKind,
  id: string
): Promise<ActionResult | null> {
  const scope = await requireCatalogScope(actor, request);
  if (scope instanceof Response) return fromResponse(scope as NextResponse);
  const denied = await ensureContentInScope(scope, kind, id);
  return denied ? fromResponse(denied) : null;
}

/**
 * A trainer-level person may only act for trainees of their organization
 * (a super admin for any) and, when an occupation is chosen, only for trainees
 * of that occupation. Returns null when the trainee is in the scope.
 */
export async function requireResponsibleTrainer(
  actor: SessionUser,
  request: CatalogRequestLike | null | undefined,
  traineeId: string
): Promise<ActionResult | null> {
  let row: { role: string | null; organizationId: string | null } | undefined;
  try {
    [row] = await withDbRetry(() =>
      db
        .select({
          role: profiles.role,
          organizationId: profiles.organizationId,
        })
        .from(profiles)
        .where(eq(profiles.id, traineeId as any))
        .limit(1)
    );
  } catch (err) {
    console.error('[hai-action] trainee lookup failed:', err);
    return unavailable();
  }
  if (!row || normalizeRole(row.role) !== ROLE.TRAINEE) return notFound();

  const organizationId = row.organizationId ? String(row.organizationId) : null;
  if (!isInOrgScope(scopeOrg(actor), organizationId)) return notFound();

  const outOfCatalog = await ensureTraineeInCatalog(
    actor,
    request ?? {},
    traineeId
  );
  return outOfCatalog ? fromResponse(outOfCatalog) : null;
}
