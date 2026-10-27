import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { isErrorResponse } from '@/lib/auth/session';
import { requireHaiIndexManager } from '@/lib/hai/guards';
import { isAdminProofConfigured, signAdminProof } from '@/lib/auth/admin-proof';
import { getClientIp } from '@/lib/rate-limit';
import {
  HAI_PIN_SCOPE,
  PIN_IP_POLICY,
  PIN_USER_POLICY,
  clearAttempts,
  ipSubject,
  reserveAttempt,
  userSubject,
} from '@/lib/auth/attempt-limiter';

const TAG = '[hai-verify-pin]';

/** No PIN is this long, a longer value is wrong without being hashed. */
const MAX_PIN_LENGTH = 128;

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Compares in constant time: both sides are hashed to the same length first,
 * so neither the content nor the length of the expected PIN shows in the time.
 */
function pinMatches(provided: unknown, expected: string): boolean {
  if (
    typeof provided !== 'string' ||
    provided.length === 0 ||
    provided.length > MAX_PIN_LENGTH
  ) {
    return false;
  }
  return timingSafeEqual(sha256(provided), sha256(expected));
}

function locked(retryAfterSec: number) {
  return NextResponse.json(
    { success: false, error: 'Too many attempts', retryAfterSec },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
  );
}

export async function POST(request: Request) {
  // Only platform staff may even try the PIN. A right PIN is answered with a
  // short lived proof bound to this session (src/lib/auth/admin-proof.ts), which
  // embed and sync ask for in the header x-admin-pin-proof.
  const manager = await requireHaiIndexManager(request);
  if (isErrorResponse(manager)) return manager;

  // No key to sign the proof: the gate stays shut, nothing is counted or compared
  if (!isAdminProofConfigured()) {
    console.error(`${TAG} no server key to sign the PIN proof`);
    return NextResponse.json(
      { success: false, error: 'Temporarily unavailable' },
      { status: 503 }
    );
  }

  const expectedPin = process.env.HAI_ADMIN_PIN;
  if (!expectedPin) {
    console.error('HAI_ADMIN_PIN environment variable is not set');
    return NextResponse.json(
      { success: false, error: 'Server configuration error' },
      { status: 500 }
    );
  }

  let pin: unknown;
  try {
    pin = (await request.json())?.pin;
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }

  // Every attempt is counted BEFORE the PIN is compared, per person (the
  // session, never a value of the request) and per address. The person counter
  // is the one that holds: a changed address header does not reset it. The
  // answer of a locked caller says nothing about the PIN. The person is counted
  // first: a person who is locked does not burn the counter of the address,
  // which colleagues behind the same office address share (the address has
  // more room for that reason). The other way round, a locked address costs a
  // person one counted attempt, which is the smaller harm.
  const userKey = userSubject(manager.id);
  const ipKey = ipSubject(getClientIp(request.headers));
  let failures = 0;
  let lockSec = 0;
  try {
    const person = await reserveAttempt(
      HAI_PIN_SCOPE,
      userKey,
      PIN_USER_POLICY
    );
    if (!person.allowed) {
      console.warn(
        `${TAG} refused, locked user=${manager.id} retryAfterSec=${person.retryAfterSec}`
      );
      return locked(person.retryAfterSec);
    }
    failures = person.failures;
    lockSec = person.retryAfterSec;

    if (ipKey) {
      const address = await reserveAttempt(HAI_PIN_SCOPE, ipKey, PIN_IP_POLICY);
      if (!address.allowed) {
        console.warn(
          `${TAG} refused, address locked user=${manager.id} retryAfterSec=${address.retryAfterSec}`
        );
        return locked(address.retryAfterSec);
      }
      lockSec = Math.max(lockSec, address.retryAfterSec);
    }
  } catch (err) {
    // A gate that cannot count does not open
    console.error(`${TAG} attempt counter failed`, err);
    return NextResponse.json(
      { success: false, error: 'Temporarily unavailable' },
      { status: 503 }
    );
  }

  if (!pinMatches(pin, expectedPin)) {
    console.warn(`${TAG} wrong PIN user=${manager.id} failures=${failures}`);
    if (lockSec > 0) {
      console.warn(
        `${TAG} lock started user=${manager.id} retryAfterSec=${lockSec}`
      );
      return locked(lockSec);
    }
    return NextResponse.json({ success: false }, { status: 401 });
  }

  try {
    await clearAttempts(HAI_PIN_SCOPE, ipKey ? [userKey, ipKey] : [userKey]);
  } catch (err) {
    // The PIN was right, old counters only expire later
    console.error(`${TAG} could not reset the attempt counter`, err);
  }
  const signed = signAdminProof(manager.id, 'hai-index-admin');
  if (!signed) {
    console.error(`${TAG} could not sign the PIN proof`);
    return NextResponse.json(
      { success: false, error: 'Temporarily unavailable' },
      { status: 503 }
    );
  }
  return NextResponse.json({
    success: true,
    proof: signed.proof,
    expiresAt: signed.expiresAt,
  });
}
