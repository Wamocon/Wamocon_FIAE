/**
 * Which trainees a trainer-level caller (trainer, admin, super admin) may see
 * and change, as SQL for lists and as checks for single records.
 *
 * Three rules apply together, every one of them derived from the session and
 * the database, never from a client value:
 *
 *  - Organization: everybody but the super admin only reaches trainees of their
 *    own organization (scopeOrg / isInOrgScope in src/lib/auth/session.ts). The
 *    platform-owner flag of an organization does not widen this, only the role
 *    of the person does.
 *  - Occupation: once the caller has chosen an occupation (header `x-catalog`),
 *    only trainees of that occupation count (src/lib/catalog/trainee-scope.ts).
 *    Without a choice nothing is filtered, so a FIAE trainer sees the trainees
 *    of the organization exactly as before.
 *  - Role: only profiles with the role TRAINEE are trainees.
 *
 * A record outside the scope is answered with 404, the same answer as for a
 * record that does not exist, so nothing is leaked.
 */

import type { NextResponse } from 'next/server';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import db from '@/db';
import { profiles } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import { isTrainerLevelRole, ROLE } from '@/lib/auth/roles';
import {
  isInOrgScope,
  orgScopeCondition,
  scopeOrg,
  type SessionUser,
} from '@/lib/auth/session';
import type { CatalogRequestLike } from '@/lib/catalog/scope';
import { requireTraineeCatalogFilter } from '@/lib/catalog/trainee-scope';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value has the shape of a uuid (the database rejects others). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Condition on `profiles` for the trainees the caller may see. */
export async function requireTraineeScopeCondition(
  session: SessionUser,
  request: CatalogRequestLike
): Promise<{ condition: SQL } | NextResponse> {
  const catalogFilter = await requireTraineeCatalogFilter(session, request);
  if (catalogFilter instanceof Response) return catalogFilter as NextResponse;
  const condition = and(
    eq(profiles.role, ROLE.TRAINEE as any),
    orgScopeCondition(profiles.organizationId, scopeOrg(session)),
    catalogFilter.condition ?? undefined
  ) as SQL;
  return { condition };
}

/**
 * where() for a write on one trainee profile: the id, the role TRAINEE and the
 * organization of the session. The occupation is checked before (see
 * requireTraineeAccess), this keeps the change itself inside the organization.
 */
export function traineeRecordCondition(
  session: SessionUser,
  traineeId: string
): SQL {
  return and(
    eq(profiles.id, traineeId as any),
    eq(profiles.role, ROLE.TRAINEE as any),
    orgScopeCondition(profiles.organizationId, scopeOrg(session))
  ) as SQL;
}

/**
 * Condition for a column that holds the id of any person (quiz_members.trainer_id
 * and so on): the person has to belong to the organization scope of the session.
 * undefined for the super admin, who sees every organization.
 */
export function profileIdInOrgScope(
  column: PgColumn,
  session: SessionUser
): SQL | undefined {
  const org = orgScopeCondition(profiles.organizationId, scopeOrg(session));
  if (!org) return undefined;
  return sql`${column} in (select ${profiles.id} from ${profiles} where ${org})`;
}

/**
 * Condition for a column that holds a trainee id (quiz_submissions.trainee_id
 * and so on): the trainee has to be one of the trainees of `condition`. Use it
 * in the where() of reads and, above all, of writes, so a change can never
 * reach the data of a trainee outside the scope.
 */
export function traineeIdInScope(column: PgColumn, condition: SQL): SQL {
  return sql`${column} in (select ${profiles.id} from ${profiles} where ${condition})`;
}

/**
 * Whether `trainerId` is a trainer-level person (trainer, admin) of the
 * organization scope of the session. Use it before a person is assigned to
 * something, so nobody can be given access to data of another organization.
 */
export async function isTrainerInOrgScope(
  session: SessionUser,
  trainerId: unknown
): Promise<boolean> {
  if (!isUuid(trainerId)) return false;
  const [row] = await withDbRetry(() =>
    db
      .select({
        role: profiles.role,
        organizationId: profiles.organizationId,
      })
      .from(profiles)
      .where(eq(profiles.id, trainerId as any))
      .limit(1)
  );
  return (
    !!row &&
    isTrainerLevelRole(String(row.role)) &&
    isInOrgScope(
      scopeOrg(session),
      row.organizationId ? String(row.organizationId) : null
    )
  );
}

/**
 * The ids out of `ids` that belong to a trainee inside the scope. Ids that are
 * no UUID are never inside the scope. Returns the set or the ready-made error
 * response of the occupation check (403 for a foreign occupation).
 */
export async function traineeIdsInScope(
  session: SessionUser,
  request: CatalogRequestLike,
  ids: readonly string[]
): Promise<Set<string> | NextResponse> {
  const wanted = Array.from(new Set(ids.map(String))).filter(id =>
    UUID.test(id)
  );
  if (wanted.length === 0) return new Set();

  const scope = await requireTraineeScopeCondition(session, request);
  if (scope instanceof Response) return scope as NextResponse;

  const rows = await withDbRetry(() =>
    db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(inArray(profiles.id, wanted as any), scope.condition))
  );
  return new Set(rows.map(r => String(r.id)));
}
