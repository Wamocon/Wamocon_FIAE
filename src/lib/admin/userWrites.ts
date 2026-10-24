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
 *  - updateUserChecked: row lock of the user, then (if the change takes a seat)
 *    the seat lock of the target organization and the seat check, then the
 *    update.
 *
 * The auth account is created by the route before createUserRecords and is
 * deleted again by the route when this returns a failure or throws. Rule
 * failures come back as results (nothing was written), database errors are
 * thrown (the transaction rolls back).
 */

import { eq } from 'drizzle-orm';
import db from '@/db';
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
import { ROLE, type Role } from '@/lib/auth/roles';

export type UserWriteFailure = SeatsFull | OrganizationMissing | RuleFailure;

/** Status and JSON body of the answer for a failed rule of a user write. */
export function userWriteFailureBody(failure: UserWriteFailure): {
  status: number;
  body: Record<string, unknown>;
} {
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

/**
 * Update a profile. When the change needs a seat the user does not have yet (a
 * role of the other kind, another organization) the seat of the target
 * organization is checked under its lock in the same transaction. Changes that
 * keep the seat (name, activation, a role of the same kind) only update.
 */
export async function updateUserChecked(
  userId: string,
  updates: Record<string, unknown>
): Promise<UserUpdateResult> {
  return db.transaction(async tx => {
    // The row lock keeps a second change of the same user from interleaving
    const [before] = await tx
      .select({
        role: profiles.role,
        organizationId: profiles.organizationId,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1)
      .for('update');
    if (!before) return { ok: false, status: 404, code: 'USER_NOT_FOUND' };

    const role =
      typeof updates.role === 'string' ? updates.role : String(before.role);
    const organizationId =
      'organizationId' in updates
        ? (updates.organizationId as string | null)
        : before.organizationId;
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
