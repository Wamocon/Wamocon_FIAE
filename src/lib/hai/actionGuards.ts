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

import type { NextResponse } from 'next/server';
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
import type { ActionFailureCode, ActionResult } from './actions';

export function fail(
  code: ActionFailureCode,
  message: string,
  error: string
): ActionResult {
  return { success: false, message, error, code };
}

export const notFound = (): ActionResult =>
  fail('not_found', 'Datensatz nicht gefunden.', 'Not found');

export const unavailable = (): ActionResult =>
  fail(
    'unavailable',
    'Die Berechtigung kann gerade nicht geprüft werden. Bitte versuche es später erneut.',
    'Scope unavailable'
  );

/** Map the ready-made error response of a scope helper to an action result. */
function fromResponse(response: NextResponse): ActionResult {
  if (response.status === 404) return notFound();
  if (response.status === 403) {
    return fail(
      'forbidden',
      'Für diesen Beruf ist die Aktion nicht erlaubt.',
      'Occupation not allowed'
    );
  }
  return unavailable();
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
