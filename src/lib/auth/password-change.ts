/**
 * Shared vocabulary of the change of the own password (POST
 * /api/auth/change-password): the codes the route answers with, the error the
 * browser code throws for them, and the limits of the attempt counter.
 *
 * The route never sends a text of Supabase Auth to the browser, only one of
 * these codes. The profile page turns the code into a text of the translation
 * system (profile.passwordError.<CODE>).
 */

import type { AttemptPolicy } from '@/lib/auth/attempt-limiter';

export const PASSWORD_CHANGE_CODES = [
  /** The field of the current password is missing or empty. */
  'CURRENT_PASSWORD_REQUIRED',
  /** The current password is not the password of the account. */
  'CURRENT_PASSWORD_WRONG',
  /** The new password is missing, too short or not accepted. */
  'PASSWORD_INVALID',
  /** The new password equals the current one. */
  'PASSWORD_UNCHANGED',
  /** Too many attempts, the caller has to wait (retryAfterSec). */
  'TOO_MANY_ATTEMPTS',
  /** Supabase Auth or the counter cannot answer at the moment. */
  'UNAVAILABLE',
  /** Anything else. */
  'FAILED',
] as const;

export type PasswordChangeCode = (typeof PASSWORD_CHANGE_CODES)[number];

export function isPasswordChangeCode(
  value: unknown
): value is PasswordChangeCode {
  return (
    typeof value === 'string' &&
    (PASSWORD_CHANGE_CODES as readonly string[]).includes(value)
  );
}

/** Error of the browser side change of the password, carries the code only. */
export class PasswordChangeError extends Error {
  readonly code: PasswordChangeCode;
  readonly retryAfterSec?: number;

  constructor(code: PasswordChangeCode, retryAfterSec?: number) {
    super(code);
    this.name = 'PasswordChangeError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export function isPasswordChangeError(
  error: unknown
): error is PasswordChangeError {
  return error instanceof PasswordChangeError;
}

/** Counter scope of the check of the current password (auth_attempts). */
export const PASSWORD_CHANGE_SCOPE = 'password-change';

/** Per person: 5 attempts, then locks of 1, 5 and 15 minutes. */
export const PASSWORD_USER_POLICY: AttemptPolicy = {
  threshold: 5,
  lockSeconds: [60, 300, 900],
  quietHours: 24,
};

/** Per address: more room, so colleagues behind one office address are not locked. */
export const PASSWORD_IP_POLICY: AttemptPolicy = {
  threshold: 15,
  lockSeconds: [60, 300, 900],
  quietHours: 24,
};

/** Memory limit of one server instance, on top of the counter in the database. */
export const PASSWORD_MEMORY_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };

/**
 * No password of the platform is this long (Supabase Auth hashes at most 72
 * bytes). A longer value is refused without being sent to Supabase.
 */
export const MAX_PASSWORD_INPUT_LENGTH = 256;
