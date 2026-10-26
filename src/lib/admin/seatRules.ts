/**
 * Seat rules of an organization: how many trainees and trainers it may have.
 *
 * Pure functions without database or server imports, so the organization list,
 * the enforcement (src/lib/admin/seats.ts) and the admin screens share them.
 *
 * Which role takes which seat follows what the organization list has always
 * shown (organizations.max_trainee_seats and max_trainer_seats):
 *  - TRAINEE takes a trainee seat.
 *  - TRAINER, TEMP_ADMIN, ADMIN and SUPER_ADMIN take a trainer seat. They are
 *    the trainer-level roles (isTrainerLevelRole), admins work as trainers too.
 *  - Every account of the organization counts, active or not. That keeps the
 *    shown count and the enforced count equal, and activating an account never
 *    needs a free seat because the seat was taken when the account was created.
 *
 * A seat limit is enforced per organization in total, not per occupation, and
 * without an exception for the platform admin (the platform admin raises the
 * seat count of the organization instead).
 */

import { isTrainerLevelRole, normalizeRole, ROLE } from '@/lib/auth/roles';

/** Stable error code of an organization that has no free seat. */
export const SEATS_FULL = 'SEATS_FULL' as const;

export type SeatKind = 'trainee' | 'trainer';

export type SeatUsage = {
  trainees: number;
  trainers: number;
  maxTraineeSeats: number;
  maxTrainerSeats: number;
};

export type SeatsFull = {
  ok: false;
  status: 409;
  code: typeof SEATS_FULL;
  kind: SeatKind;
  occupied: number;
  limit: number;
};

export type SeatResult = { ok: true } | SeatsFull;

/** Where a user sits: the role decides the kind, the organization the pool. */
export type SeatHolder = {
  role: string | null | undefined;
  organizationId: string | null | undefined;
};

/** The kind of seat a role takes, null for a value that is no role. */
export function seatKindOfRole(
  role: string | null | undefined
): SeatKind | null {
  if (normalizeRole(role) === ROLE.TRAINEE) return 'trainee';
  if (isTrainerLevelRole(role)) return 'trainer';
  return null;
}

/** Occupied seats from the number of accounts per role. */
export function tallySeats(
  rows: { role: string | null | undefined; count: number | string }[]
): { trainees: number; trainers: number } {
  const tally = { trainees: 0, trainers: 0 };
  for (const row of rows) {
    const kind = seatKindOfRole(row.role);
    if (kind === 'trainee') tally.trainees += Number(row.count);
    if (kind === 'trainer') tally.trainers += Number(row.count);
  }
  return tally;
}

/**
 * Occupied seats per organization from the number of accounts per
 * organization and role (the organization list). Accounts without an
 * organization are collected under the empty key.
 */
export function tallySeatsByOrganization(
  rows: {
    organizationId: string | null | undefined;
    role: string | null | undefined;
    count: number | string;
  }[]
): Record<string, { trainees: number; trainers: number }> {
  const result: Record<string, { trainees: number; trainers: number }> = {};
  for (const row of rows) {
    const key = row.organizationId ?? '';
    const tally = tallySeats([row]);
    const current = (result[key] ??= { trainees: 0, trainers: 0 });
    current.trainees += tally.trainees;
    current.trainers += tally.trainers;
  }
  return result;
}

/**
 * May one more seat of this kind be taken? An organization that is already
 * over its limit (limits can be lowered later) only blocks new seats, nothing
 * that exists is touched.
 */
export function checkSeatAvailable(
  usage: SeatUsage,
  kind: SeatKind
): SeatResult {
  const occupied = kind === 'trainee' ? usage.trainees : usage.trainers;
  const limit =
    kind === 'trainee' ? usage.maxTraineeSeats : usage.maxTrainerSeats;
  if (occupied < limit) return { ok: true };
  return { ok: false, status: 409, code: SEATS_FULL, kind, occupied, limit };
}

/**
 * The seat a change of a user takes in addition to the one it has, or null if
 * it needs none. A new user (before is null) needs one. An existing user needs
 * one when the organization or the kind of seat changes, a change inside one
 * kind (TRAINER to TEMP_ADMIN) keeps the seat it has. A user without an
 * organization takes no seat.
 */
export function seatNeededFor(
  before: SeatHolder | null,
  after: SeatHolder
): { organizationId: string; kind: SeatKind } | null {
  const kind = seatKindOfRole(after.role);
  if (!kind || !after.organizationId) return null;
  const organizationId = String(after.organizationId);
  if (
    before &&
    before.organizationId &&
    String(before.organizationId) === organizationId &&
    seatKindOfRole(before.role) === kind
  ) {
    return null;
  }
  return { organizationId, kind };
}

/** JSON body of the 409 answer: readable text, stable code, kind and numbers. */
export function seatsFullBody(failure: SeatsFull): {
  error: string;
  code: typeof SEATS_FULL;
  kind: SeatKind;
  occupied: number;
  limit: number;
} {
  const { kind, occupied, limit } = failure;
  const what =
    kind === 'trainee'
      ? 'All trainee seats of the organization are taken'
      : 'All trainer seats of the organization are taken (admins and temp admins count as trainers)';
  return {
    error: `${what} (${occupied} of ${limit}). The platform admin can raise the seat count.`,
    code: SEATS_FULL,
    kind,
    occupied,
    limit,
  };
}
