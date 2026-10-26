/**
 * Seats of an organization, database side: count the occupied seats and check
 * that one more may be taken.
 *
 * The rules themselves are pure and live in seatRules.ts (this module
 * re-exports them). A write that takes a seat (creating a user, a role change
 * to the other kind of seat, moving a user into the organization) runs in one
 * transaction: lockOrganizationSeats first, then assertSeatAvailable with the
 * executor of the transaction, then the write. The advisory lock is held until
 * the transaction ends, so two writes of the same organization queue up and
 * the second one counts the seat the first one took. Without it two parallel
 * requests could both read "one seat left" and overtake the limit.
 */

import { eq, sql } from 'drizzle-orm';
import db from '@/db';
import { organizations, profiles } from '@/db/migrations/schemas/schema';
import {
  checkSeatAvailable,
  seatKindOfRole,
  tallySeats,
  type SeatResult,
  type SeatUsage,
} from '@/lib/admin/seatRules';

export * from '@/lib/admin/seatRules';

type Executor = Pick<typeof db, 'select' | 'execute'>;

/** Namespace of the seat locks, the second key is the organization. */
const SEAT_LOCK_NAMESPACE = 'org_seats';

export type OrganizationMissing = {
  ok: false;
  status: 404;
  code: 'ORGANIZATION_NOT_FOUND';
};

/**
 * Take the seat lock of one organization for the running transaction. It uses
 * the two-key form of the advisory lock, a separate key space from the catalog
 * administration lock (one key), and different organizations never wait for
 * each other. A flow that needs both takes this one first.
 */
export async function lockOrganizationSeats(
  tx: Executor,
  organizationId: string
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${SEAT_LOCK_NAMESPACE}), hashtext(${organizationId}))`
  );
}

/**
 * The occupied seats and the limits of an organization, null if it does not
 * exist. Counts the profiles of the organization per role, every account
 * (active or not), exactly like the organization list.
 */
export async function loadSeatUsage(
  q: Executor,
  organizationId: string
): Promise<SeatUsage | null> {
  const [org] = await q
    .select({
      maxTraineeSeats: organizations.maxTraineeSeats,
      maxTrainerSeats: organizations.maxTrainerSeats,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return null;

  const rows = await q
    .select({
      role: profiles.role,
      count: sql<number>`count(*)::int`,
    })
    .from(profiles)
    .where(eq(profiles.organizationId, organizationId))
    .groupBy(profiles.role);

  return {
    ...tallySeats(rows),
    maxTraineeSeats: Number(org.maxTraineeSeats),
    maxTrainerSeats: Number(org.maxTrainerSeats),
  };
}

/**
 * Is a seat free for one more account with this role in the organization?
 * Answers { ok: true }, SEATS_FULL (409, with kind, occupied and limit), or 404
 * when the organization is gone. A role that takes no seat is always ok. Call
 * it with the executor of the transaction after lockOrganizationSeats, an
 * early call with the plain database is only a hint.
 */
export async function assertSeatAvailable(
  q: Executor,
  organizationId: string,
  role: string | null | undefined
): Promise<SeatResult | OrganizationMissing> {
  const kind = seatKindOfRole(role);
  if (!kind) return { ok: true };
  const usage = await loadSeatUsage(q, organizationId);
  if (!usage) {
    return { ok: false, status: 404, code: 'ORGANIZATION_NOT_FOUND' };
  }
  return checkSeatAvailable(usage, kind);
}
