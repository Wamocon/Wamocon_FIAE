/**
 * Database writes behind POST and PATCH /api/admin/users.
 *
 * Both run in one transaction that takes its locks first, checks the rules
 * and only then writes, so a failed rule leaves nothing behind and two
 * requests cannot overtake a limit:
 *
 *  - createUserRecords: seat lock of the organization, then (for a trainee)
 *    the catalog administration lock, then the seat check and the catalog
 *    check, then the profile and the enrollment. The lock order is always seat
 *    lock first, every other flow takes at most one of the two.
 *  - updateUserChecked: row lock of the user (FOR NO KEY UPDATE, see there),
 *    then the rules that depend on the user as it is under the lock (scope,
 *    role of the user, role handed out, organization), then (if the change
 *    takes a seat) the seat lock of the target organization and the seat
 *    check, then the update.
 *
 * The auth account is created by the route before createUserRecords and is
 * deleted again by the route when this returns a failure or throws. Rule
 * failures come back as results (nothing was written), database errors are
 * thrown (the transaction rolls back).
 */

import { eq } from 'drizzle-orm';
import db from '@/db';
import { checkRoleForUpdate } from '@/lib/admin/roleAssignment';
import {
  isInOrgScope,
  scopeOrg,
  type SessionUser,
} from '@/lib/auth/session';
import { profiles } from '@/db/migrations/schemas/schema';
import {
  insertTraineeEnrollment,
  loadNewTraineeCatalog,
  ruleFailureBody,
  takeCatalogAdminLock,
  type CatalogInfo,
  type Executor as CatalogExecutor,
  type RuleFailure,
} from '@/lib/catalog/admin';
import {
  assertSeatAvailable,
  lockOrganizationSeats,
  seatNeededFor,
  seatsFullBody,
  type OrganizationMissing,
  type SeatsFull,
} from '@/lib/admin/seats';
import {
  ROLE,
  canModifyRole,
  isTrainerLevelRole,
  normalizeRole,
  type Role,
} from '@/lib/auth/roles';

/**
 * A change the caller may not make, or that cannot be made as asked. Carries
 * its own English text and the stable code the screens translate.
 */
export type UserWriteDenied = {
  ok: false;
  denied: true;
  status: 400 | 403;
  error: string;
  code?: 'ROLE_NOT_ASSIGNABLE' | 'ORGANIZATION_REQUIRED';
};

export type UserWriteFailure =
  | SeatsFull
  | OrganizationMissing
  | RuleFailure
  | UserWriteDenied;

/** Status and JSON body of the answer for a failed rule of a user write. */
export function userWriteFailureBody(failure: UserWriteFailure): {
  status: number;
  body: Record<string, unknown>;
} {
  if ('denied' in failure) {
    return {
      status: failure.status,
      body: failure.code
        ? { error: failure.error, code: failure.code }
        : { error: failure.error },
    };
  }
  if (failure.code === 'SEATS_FULL') {
    return { status: 409, body: seatsFullBody(failure) };
  }
  if (failure.code === 'ORGANIZATION_NOT_FOUND') {
    return { status: 404, body: { error: 'Organization not found' } };
  }
  return { status: failure.status, body: ruleFailureBody(failure) };
}

export type NewUserCheck =
  | { ok: true; catalog: CatalogInfo | null }
  | UserWriteFailure;

export type NewUserInput = {
  /** Id of the auth account, equals the profile id. */
  id: string;
  email: string;
  fullName: string;
  firstName: string;
  lastName: string;
  role: Role;
  organizationId: string;
  /** The wanted catalog of a trainee, null for the default. */
  requestedCatalogId: string | null;
};

/**
 * The decision for a new user: is a seat free and (trainee) which catalog does
 * it get. Reads only. With the plain database it is the early check before the
 * auth account is created, with the executor of the transaction it is the
 * check that counts.
 */
export async function checkNewUser(
  q: CatalogExecutor,
  input: Pick<NewUserInput, 'organizationId' | 'role' | 'requestedCatalogId'>
): Promise<NewUserCheck> {
  const seat = await assertSeatAvailable(q, input.organizationId, input.role);
  if (!seat.ok) return seat;
  if (input.role !== ROLE.TRAINEE) return { ok: true, catalog: null };
  const catalog = await loadNewTraineeCatalog(
    q,
    input.organizationId,
    input.requestedCatalogId
  );
  return catalog.ok ? { ok: true, catalog: catalog.value } : catalog;
}

/**
 * Create the profile of a new user (and the enrollment of a trainee) in one
 * transaction with the seat check. The profile insert does nothing when the
 * profile already exists, as before.
 */
export async function createUserRecords(
  input: NewUserInput
): Promise<NewUserCheck> {
  return db.transaction(async tx => {
    await lockOrganizationSeats(tx, input.organizationId);
    if (input.role === ROLE.TRAINEE) await takeCatalogAdminLock(tx);

    const check = await checkNewUser(tx, input);
    if (!check.ok) return check;

    await tx
      .insert(profiles)
      .values({
        id: input.id,
        email: input.email,
        fullName: input.fullName,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        organizationId: input.organizationId,
        isActive: true,
        trainerActivated: input.role !== ROLE.TRAINEE,
      })
      .onConflictDoNothing();
    if (check.catalog) {
      await insertTraineeEnrollment(tx, input.id, check.catalog.id);
    }
    return check;
  });
}

export type UpdatedUser = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: string;
  isActive: boolean | null;
  trainerActivated: boolean;
  organizationId: string | null;
};

export type UserUpdateResult =
  | { ok: true; row: UpdatedUser }
  | UserWriteFailure;

/** Who asks for an update, so the rules can be checked under the row lock. */
export type UpdateGuard = {
  session: SessionUser;
  /** The role the request asks for, if it asks for one. */
  requestedRole?: string;
};

/**
 * The rules that depend on the user as it is NOW, under the row lock. The route
 * checks the same rules first on an older read, but another request may have
 * changed the user in between (moved it to another organization, promoted it to
 * ADMIN), and the write must not act on the old picture. A null result means
 * the change is allowed.
 */
function checkUserUnderLock(
  guard: UpdateGuard,
  before: { role: unknown; organizationId: string | null }
): UserWriteFailure | null {
  // Users of other organizations are invisible to org admins
  if (!isInOrgScope(scopeOrg(guard.session), before.organizationId)) {
    return { ok: false, status: 404, code: 'USER_NOT_FOUND' };
  }
  if (!canModifyRole(guard.session, String(before.role))) {
    return {
      ok: false,
      denied: true,
      status: 403,
      error: 'Only ADMIN can modify another ADMIN',
    };
  }
  if (guard.requestedRole) {
    const decision = checkRoleForUpdate(
      guard.session,
      guard.requestedRole,
      String(before.role)
    );
    if (!decision.ok) {
      return {
        ok: false,
        denied: true,
        status: decision.status,
        error: decision.error,
        ...(decision.code ? { code: decision.code } : {}),
      };
    }
  }
  return null;
}

/**
 * Update a profile. When the change needs a seat the user does not have yet (a
 * role of the other kind, another organization) the seat of the target
 * organization is checked under its lock in the same transaction. Changes that
 * keep the seat (name, activation, a role of the same kind) only update.
 */
export async function updateUserChecked(
  userId: string,
  updates: Record<string, unknown>,
  guard?: UpdateGuard
): Promise<UserUpdateResult> {
  return db.transaction(async tx => {
    // The row lock keeps a second change of the same user from interleaving.
    // FOR NO KEY UPDATE and not FOR UPDATE: inserting an enrollment takes a KEY
    // SHARE lock on the profile row (foreign key check) while it holds the
    // catalog lock, and this transaction takes the seat lock after the row lock.
    // FOR UPDATE conflicts with KEY SHARE and closed a cycle between the three
    // (deadlock); FOR NO KEY UPDATE does not, and still blocks a second change
    // of the same row. The update below changes no key column.
    const [before] = await tx
      .select({
        role: profiles.role,
        organizationId: profiles.organizationId,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1)
      .for('no key update');
    if (!before) return { ok: false, status: 404, code: 'USER_NOT_FOUND' };

    if (guard) {
      const denied = checkUserUnderLock(guard, before);
      if (denied) return denied;
    }

    const role =
      typeof updates.role === 'string' ? updates.role : String(before.role);
    const organizationId =
      'organizationId' in updates
        ? (updates.organizationId as string | null)
        : before.organizationId;

    // A role from trainer level up belongs to an organization. A user without
    // one counts as a member of the default organization for the scope, but
    // not for the seats, so an admin of that organization would hand out
    // trainer and admin roles without any seat check. The platform admin gives
    // the organization and the role in one change.
    if (
      normalizeRole(role) !== normalizeRole(String(before.role)) &&
      isTrainerLevelRole(role) &&
      !organizationId
    ) {
      return {
        ok: false,
        denied: true,
        status: 400,
        code: 'ORGANIZATION_REQUIRED',
        error:
          'A role from trainer level up needs an organization. Assign the user to an organization first.',
      };
    }
    const needed = seatNeededFor(before, { role, organizationId });
    if (needed) {
      await lockOrganizationSeats(tx, needed.organizationId);
      const seat = await assertSeatAvailable(tx, needed.organizationId, role);
      if (!seat.ok) return seat;
    }

    const [row] = await tx
      .update(profiles)
      .set(updates)
      .where(eq(profiles.id, userId))
      .returning({
        id: profiles.id,
        fullName: profiles.fullName,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
        role: profiles.role,
        isActive: profiles.isActive,
        trainerActivated: profiles.trainerActivated,
        organizationId: profiles.organizationId,
      });
    return { ok: true, row };
  });
}
