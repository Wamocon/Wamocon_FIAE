/**
 * Whose data does a trainee route work on?
 *
 * The routes under /api/trainee used to take the person from the query or the
 * body (userId, traineeId), so the id of another person was enough to read or
 * change their data. The session is the only source of identity now:
 *
 *  - A trainee always works on their own data. An id in the query or body is
 *    ignored (older clients still send it), it is neither used nor compared.
 *  - A trainer-level caller (trainer, admin, super admin) only reaches a
 *    trainee's data through resolveTraineeForRead, and only for a trainee who
 *    lies inside their organization scope (scopeOrg / isInOrgScope) and, if
 *    they chose an occupation with x-catalog, inside that occupation
 *    (ensureTraineeInCatalog). Everything else is answered with 404, the same
 *    answer as for a person that does not exist, so nothing is leaked.
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import db from '@/db';
import { profiles } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import { isInOrgScope, scopeOrg, type SessionUser } from '@/lib/auth/session';
import { normalizeRole, ROLE } from '@/lib/auth/roles';
import { ensureTraineeInCatalog } from '@/lib/catalog/trainee-scope';
import type { CatalogRequestLike } from '@/lib/catalog/scope';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () =>
  NextResponse.json({ error: 'Not found' }, { status: 404 });

/**
 * The trainee whose data a read route returns: the caller for a trainee, the
 * trainee named by `requestedId` for a trainer-level caller inside their scope.
 * Returns the trainee id or a ready-made error response (400 without an id for
 * a trainer, 404 outside the scope, 403 or 503 from the occupation check).
 */
export async function resolveTraineeForRead(
  session: SessionUser,
  request: CatalogRequestLike,
  requestedId: string | null | undefined
): Promise<string | NextResponse> {
  if (!session.isTrainerLevel) return session.id;

  if (!requestedId) {
    return NextResponse.json(
      { error: 'traineeId is required' },
      { status: 400 }
    );
  }

  // Not an id at all: the same answer as for a person that does not exist
  if (!UUID.test(requestedId)) return notFound();

  let row;
  try {
    [row] = await withDbRetry(() =>
      db
        .select({
          id: profiles.id,
          role: profiles.role,
          organizationId: profiles.organizationId,
        })
        .from(profiles)
        .where(eq(profiles.id, requestedId as any))
        .limit(1)
    );
  } catch (err) {
    console.error('[trainee-data-access] profile lookup failed:', err);
    return NextResponse.json({ error: 'Lookup unavailable' }, { status: 503 });
  }

  if (!row || normalizeRole(row.role) !== ROLE.TRAINEE) return notFound();
  const organizationId = row.organizationId ? String(row.organizationId) : null;
  if (!isInOrgScope(scopeOrg(session), organizationId)) return notFound();

  const outOfCatalog = await ensureTraineeInCatalog(
    session,
    request,
    String(row.id)
  );
  if (outOfCatalog) return outOfCatalog;

  return String(row.id);
}
