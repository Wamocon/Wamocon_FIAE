import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabasePublicKey } from '@/lib/env';
import { DB_OPTION } from '@/lib/db-schema';
import {
  extractBearerToken,
  isErrorResponse,
  requireUser,
} from '@/lib/auth/session';
import { passwordProblem } from '@/lib/auth/password-policy';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import {
  clearAttempts,
  ipSubject,
  reserveAttempt,
  userSubject,
} from '@/lib/auth/attempt-limiter';
import {
  MAX_PASSWORD_INPUT_LENGTH,
  PASSWORD_CHANGE_SCOPE,
  PASSWORD_IP_POLICY,
  PASSWORD_MEMORY_LIMIT,
  PASSWORD_USER_POLICY,
  type PasswordChangeCode,
} from '@/lib/auth/password-change';

/**
 * Change of the own password (trainee, trainer and every admin level).
 *
 * The password is changed only if the CURRENT password is right. The server
 * checks it by signing in against Supabase Auth with the e-mail of the session
 * and the given current password. That sign in runs on a client of its own
 * (nothing is persisted, nothing is refreshed), so the session of the browser
 * is neither replaced nor given new tokens. Only after it succeeded the new
 * password is set, with the session of that very sign in (auth.updateUser), and
 * the session of the check is ended again.
 *
 * Attempts are counted BEFORE the current password is compared, per person (the
 * session, never a value of the request) and per address, in the database
 * (src/lib/auth/attempt-limiter.ts) and in the memory of the instance. A person
 * who is locked is not even checked. If the database counter cannot answer (for
 * example the table is not there yet), the memory limit still holds.
 *
 * Answers carry a code (src/lib/auth/password-change.ts), never a text of
 * Supabase Auth, and neither a password nor a token is ever written to a log.
 * A wrong current password is a 400, not a 401: the browser repeats a request
 * that was answered with 401 (src/lib/authFetch.ts), and that repeat would be a
 * second counted guess.
 */

const TAG = '[change-password]';

type AuthErrorLike = {
  status?: number;
  code?: string;
  name?: string;
} | null;

/** Rate limit, server error or no answer from Auth: not the caller's fault. */
function isTransient(error: AuthErrorLike): boolean {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError') return true;
  const status = error.status;
  return status === 0 || status === 429 || (status != null && status >= 500);
}

/** What a log line says about an Auth error: status and code, never a message. */
function describe(error: AuthErrorLike): string {
  if (!error) return 'no error';
  return `${error.status ?? '-'} | ${error.code ?? error.name ?? '-'}`;
}

function failure(
  code: PasswordChangeCode,
  status: number,
  extra: { retryAfterSec?: number } = {}
) {
  const headers: Record<string, string> = {};
  if (extra.retryAfterSec) headers['Retry-After'] = String(extra.retryAfterSec);
  return NextResponse.json(
    { error: code, code, ...extra },
    { status, headers }
  );
}

function tooMany(retryAfterSec: number) {
  return failure('TOO_MANY_ATTEMPTS', 429, { retryAfterSec });
}

export async function POST(request: Request) {
  // Only the signed-in person, and only the own account: the identity is the
  // session, nothing of the body names a person
  const session = await requireUser(request);
  if (isErrorResponse(session)) return session;
  const token = extractBearerToken(request);
  if (!token) return failure('FAILED', 401);

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = (await request.json()) ?? {};
  } catch {
    return failure('FAILED', 400);
  }
  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword =
    typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!currentPassword) return failure('CURRENT_PASSWORD_REQUIRED', 400);
  if (!newPassword || passwordProblem(newPassword)) {
    return failure('PASSWORD_INVALID', 400);
  }
  if (currentPassword.length > MAX_PASSWORD_INPUT_LENGTH) {
    // Nobody has such a password: wrong without asking Supabase
    return failure('CURRENT_PASSWORD_WRONG', 400);
  }
  if (newPassword.length > MAX_PASSWORD_INPUT_LENGTH) {
    return failure('PASSWORD_INVALID', 400);
  }
  if (newPassword === currentPassword)
    return failure('PASSWORD_UNCHANGED', 400);

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_URL_INTERNAL;
  const anonKey = getSupabasePublicKey();
  if (!supabaseUrl || !anonKey) {
    console.error(`${TAG} Supabase URL or public key is missing`);
    return failure('UNAVAILABLE', 503);
  }

  // Count the attempt before the password is compared. The memory limit comes
  // first and always holds, the counter of the database (lock steps, shared
  // by all instances) is added on top.
  const memory = checkRateLimit(
    `password-change:${session.id}`,
    PASSWORD_MEMORY_LIMIT
  );
  if (!memory.allowed) {
    console.warn(
      `${TAG} refused by the memory limit user=${session.id} retryAfterSec=${memory.retryAfterSec}`
    );
    return tooMany(memory.retryAfterSec);
  }

  const userKey = userSubject(session.id);
  const ipKey = ipSubject(getClientIp(request.headers));
  try {
    const person = await reserveAttempt(
      PASSWORD_CHANGE_SCOPE,
      userKey,
      PASSWORD_USER_POLICY
    );
    if (!person.allowed) {
      console.warn(
        `${TAG} refused, locked user=${session.id} retryAfterSec=${person.retryAfterSec}`
      );
      return tooMany(person.retryAfterSec);
    }
    if (ipKey) {
      const address = await reserveAttempt(
        PASSWORD_CHANGE_SCOPE,
        ipKey,
        PASSWORD_IP_POLICY
      );
      if (!address.allowed) {
        console.warn(
          `${TAG} refused, address locked user=${session.id} retryAfterSec=${address.retryAfterSec}`
        );
        return tooMany(address.retryAfterSec);
      }
    }
  } catch (err) {
    // The memory limit above still holds, the sign in below is the real check
    console.warn(
      `${TAG} attempt counter of the database not available, only the memory limit applies`,
      err instanceof Error ? err.name : 'error'
    );
  }

  // A client of its own: no persisted session, no refresh, so the sign in
  // below leaves the session of the browser alone
  const authClient: SupabaseClient = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: DB_OPTION,
  });

  try {
    // The e-mail of the Auth account (the login), not the one of the profile
    const { data: current, error: userError } =
      await authClient.auth.getUser(token);
    if (userError || !current?.user?.id) {
      console.warn(`${TAG} session user not read: ${describe(userError)}`);
      return isTransient(userError)
        ? failure('UNAVAILABLE', 503)
        : failure('FAILED', 400);
    }
    const email = current.user.email;
    if (!email || current.user.id !== session.id) {
      return failure('FAILED', 400);
    }

    const { data: signedIn, error: signInError } =
      await authClient.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
    if (signInError || !signedIn?.session) {
      if (signInError?.code === 'invalid_credentials') {
        console.warn(`${TAG} wrong current password user=${session.id}`);
        return failure('CURRENT_PASSWORD_WRONG', 400);
      }
      console.warn(
        `${TAG} check of the current password failed user=${session.id}: ${describe(signInError)}`
      );
      if (signInError?.status === 429) return tooMany(60);
      return isTransient(signInError)
        ? failure('UNAVAILABLE', 503)
        : failure('FAILED', 400);
    }

    // The current password is right: set the new one with the session of the
    // check (it is fresh, so a "secure password change" setting is met)
    const { error: updateError } = await authClient.auth.updateUser({
      password: newPassword,
    });
    if (updateError) {
      console.warn(
        `${TAG} password not changed user=${session.id}: ${describe(updateError)}`
      );
      if (updateError.code === 'same_password') {
        return failure('PASSWORD_UNCHANGED', 400);
      }
      if (updateError.code === 'weak_password') {
        return failure('PASSWORD_INVALID', 400);
      }
      return isTransient(updateError)
        ? failure('UNAVAILABLE', 503)
        : failure('FAILED', 500);
    }

    try {
      await clearAttempts(
        PASSWORD_CHANGE_SCOPE,
        ipKey ? [userKey, ipKey] : [userKey]
      );
    } catch (err) {
      // The password was right, old counters only expire later
      console.warn(
        `${TAG} could not reset the attempt counter`,
        err instanceof Error ? err.name : 'error'
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    // The error object can carry the request, so only its kind is logged
    console.error(
      `${TAG} unexpected error`,
      err instanceof Error ? err.name : 'error'
    );
    return failure('FAILED', 500);
  } finally {
    // End the session of the check (this one only, not the one of the browser)
    try {
      await authClient.auth.signOut({ scope: 'local' });
    } catch {
      /* the session of the check expires on its own */
    }
  }
}
