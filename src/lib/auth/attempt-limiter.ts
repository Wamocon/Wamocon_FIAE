/**
 * Database backed counter for failed secret checks (the admin PIN of HAI).
 *
 * Why the database: on serverless hosting every request may run on another
 * instance, so a counter in memory (src/lib/rate-limit.ts) does not hold an
 * attacker back. The table is auth_attempts, see
 * supabase/migrations/20261029000200_auth_attempts.sql.
 *
 * One row per (scope, subject). An attempt is RESERVED before the secret is
 * compared: a single INSERT .. ON CONFLICT DO UPDATE counts the attempt, decides
 * whether it is let through and sets the lock, all under the row lock of the
 * database. Parallel requests are therefore counted one by one, there is no gap
 * between a check and a write in which a burst of guesses could slip through.
 * After a correct secret the rows are deleted (clearAttempts).
 *
 * Rules, per policy:
 *  - the first `threshold` attempts are free
 *  - the attempt that reaches the threshold starts a lock, every further
 *    attempt after the lock expired starts the next, longer step of
 *    `lockSeconds` (the last step repeats)
 *  - an attempt that is refused because of a lock changes nothing, so hammering
 *    a locked person does not extend the lock
 *  - after `quietHours` without a counted attempt the counter starts again
 *
 * The time comes from now() of the database. Nothing here sees the secret.
 */

import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import db from '@/db';

export type AttemptPolicy = {
  /** Number of counted attempts after which the lock starts (at least 2). */
  threshold: number;
  /** Lock steps in seconds, the last one repeats. */
  lockSeconds: readonly number[];
  /** Hours without an attempt after which the counter starts again. */
  quietHours: number;
};

export type AttemptDecision = {
  /** False while a lock is active: do not even compare the secret. */
  allowed: boolean;
  /** Seconds until the lock ends, 0 if there is none. */
  retryAfterSec: number;
  /** Counted attempts of this subject. */
  failures: number;
};

/** The check of the HAI admin PIN. */
export const HAI_PIN_SCOPE = 'hai-admin-pin';

/** Per person: 5 attempts, then locks of 1, 5 and 15 minutes. */
export const PIN_USER_POLICY: AttemptPolicy = {
  threshold: 5,
  lockSeconds: [60, 300, 900],
  quietHours: 24,
};

/**
 * Per address: more room than a person, so colleagues behind one office address
 * are not locked by the typing mistakes of one of them. It still stops one
 * address that tries many accounts.
 */
export const PIN_IP_POLICY: AttemptPolicy = {
  threshold: 15,
  lockSeconds: [60, 300, 900],
  quietHours: 24,
};

/** Counter key of a person (the profile id of the session). */
export function userSubject(profileId: string): string {
  return `user:${profileId}`;
}

/**
 * Counter key of a client address, or null if the address is unknown (all
 * unknown callers would share one counter). The address is hashed: it is not
 * stored, and a header of any length ends in a key of fixed length.
 */
export function ipSubject(address: string): string | null {
  const value = address.trim();
  if (!value || value === 'unknown') return null;
  return `ip:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function assertPolicy(policy: AttemptPolicy) {
  const steps = policy.lockSeconds;
  if (
    !Number.isInteger(policy.threshold) ||
    policy.threshold < 2 ||
    steps.length === 0 ||
    !steps.every(s => Number.isInteger(s) && s > 0) ||
    !Number.isInteger(policy.quietHours) ||
    policy.quietHours < 1
  ) {
    throw new Error('Invalid attempt policy');
  }
}

/**
 * Count one attempt of `subject` and say whether it may go on. Throws if the
 * database cannot decide: a security gate must not open on an error.
 */
export async function reserveAttempt(
  scope: string,
  subject: string,
  policy: AttemptPolicy
): Promise<AttemptDecision> {
  assertPolicy(policy);

  // Numbers of the policy are validated integers, so they are safe to inline.
  // sql.raw keeps them out of the parameter list (the database cannot infer the
  // type of a parameter inside array[...] and make_interval).
  const threshold = sql.raw(String(policy.threshold));
  const steps = sql.raw(policy.lockSeconds.join(', '));
  const lastStep = sql.raw(String(policy.lockSeconds.length - 1));
  const quietHours = sql.raw(String(policy.quietHours));

  // The row as it was before this statement (a.*): a lock that is still running
  const locked = sql`(a.locked_until is not null and a.locked_until > now())`;
  // Counted attempts after this one: unchanged while locked, reset after a
  // quiet window, otherwise one more
  const next = sql`(case
        when ${locked} then a.failures
        when a.last_attempt_at < now() - make_interval(hours => ${quietHours}) then 1
        else a.failures + 1
      end)`;

  const rows = (await db.execute(sql`
    insert into auth_attempts as a
      (scope, subject, failures, locked_until, last_attempt_at, last_allowed)
    values (${scope}, ${subject}, 1, null, now(), true)
    on conflict (scope, subject) do update set
      last_allowed = not ${locked},
      failures = case
        when ${locked} then a.failures
        when a.last_attempt_at < now() - make_interval(hours => ${quietHours}) then 1
        else a.failures + 1
      end,
      locked_until = case
        when ${locked} then a.locked_until
        when ${next} >= ${threshold}
          then now() + make_interval(
            secs => (array[${steps}])[least(${next} - ${threshold}, ${lastStep}) + 1]
          )
        else null
      end,
      last_attempt_at = case
        when ${locked} then a.last_attempt_at
        else now()
      end
    returning
      failures,
      last_allowed,
      greatest(0, ceil(extract(epoch from (locked_until - now()))))::int
        as retry_after
  `)) as unknown as Array<Record<string, unknown>>;

  const row = rows[0];
  if (!row) throw new Error('Attempt counter gave no answer');

  const allowed = row.last_allowed === true;
  const retryAfter = Number(row.retry_after ?? 0);
  return {
    allowed,
    // A refused attempt always carries a wait of at least one second
    retryAfterSec: allowed
      ? Math.max(0, retryAfter)
      : Math.max(1, retryAfter || 0),
    failures: Number(row.failures ?? 0),
  };
}

/**
 * Forget the counters of `subjects` (after a correct secret). Rows of this scope
 * that have been quiet for a week are removed on the way, so the table does not
 * grow without bound.
 */
export async function clearAttempts(
  scope: string,
  subjects: readonly string[]
): Promise<void> {
  if (subjects.length === 0) return;
  const list = sql.join(
    subjects.map(subject => sql`${subject}`),
    sql`, `
  );
  await db.execute(sql`
    delete from auth_attempts
    where scope = ${scope}
      and (subject in (${list}) or last_attempt_at < now() - interval '7 days')
  `);
}
