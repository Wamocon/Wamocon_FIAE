/**
 * Short lived proof that a person entered the admin PIN.
 *
 * The PIN used to be a gate of the admin dialog only, the routes behind it
 * (embed, sync) checked the role and not the PIN. Now POST /api/hai/verify-pin
 * answers a right PIN with a proof, and those routes ask for it in the header
 * `x-admin-pin-proof`, in addition to the role (role first, then proof).
 *
 * The proof is `v1.<expiry in ms>.<hex hmac>`:
 *  - bound to the person: the profile id of the SESSION is part of the signed
 *    text but not of the token, so a proof of one person fails for another
 *  - bound to a purpose, so a proof for one gate opens no other gate
 *  - bound to the database schema: Preview and Production share one Supabase
 *    project and so the key, a proof of the one is no proof of the other
 *  - valid for ten minutes, the expiry is part of the signed text
 *
 * Key: derived (HMAC with a fixed label, so the Supabase key itself is never
 * the MAC key) from the server side Supabase secret key
 * (SUPABASE_SECRET_KEY, formerly SUPABASE_SERVICE_ROLE_KEY), which every
 * deployment already has. No new variable. Without that key nothing is signed
 * and nothing is accepted: the gate fails closed (the routes answer 503).
 *
 * The proof is a bearer token for at most ten minutes. It is not logged, not
 * stored on the server and not written to localStorage by the browser.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { getSupabaseSecretKey } from '@/lib/env';
import { ADMIN_PROOF_HEADER } from '@/lib/auth/admin-proof-header';
import { DB_SCHEMA } from '@/lib/db-schema';

/** Header that carries the proof to the gated routes (also used by the browser). */
export { ADMIN_PROOF_HEADER };

/** How long a proof is valid. */
export const ADMIN_PROOF_TTL_SEC = 600;

/** The gates that use a proof. A proof of one purpose is refused at another. */
export type AdminProofPurpose = 'hai-index-admin';

/** A shorter key is a placeholder, not a secret. */
const MIN_SECRET_LENGTH = 16;

const KEY_LABEL = 'wamocon:admin-proof:key:v1';
const PROOF_PATTERN = /^v1\.(\d{1,15})\.([0-9a-f]{64})$/;
const MAX_PROOF_LENGTH = 100;

function derivedKey(): Buffer | null {
  const secret = getSupabaseSecretKey();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return createHmac('sha256', secret).update(KEY_LABEL).digest();
}

function mac(
  key: Buffer,
  profileId: string,
  purpose: AdminProofPurpose,
  expiresAt: number
): Buffer {
  return createHmac('sha256', key)
    .update(`v1|${purpose}|${DB_SCHEMA}|${profileId}|${expiresAt}`)
    .digest();
}

/** Whether proofs can be signed and checked at all (the key exists). */
export function isAdminProofConfigured(): boolean {
  return derivedKey() !== null;
}

/**
 * A new proof for the person, or null when no key is configured or the person
 * is empty.
 */
export function signAdminProof(
  profileId: string,
  purpose: AdminProofPurpose,
  now: number = Date.now()
): { proof: string; expiresAt: number } | null {
  const key = derivedKey();
  if (!key || !profileId) return null;
  const expiresAt = now + ADMIN_PROOF_TTL_SEC * 1000;
  const signature = mac(key, profileId, purpose, expiresAt).toString('hex');
  return { proof: `v1.${expiresAt}.${signature}`, expiresAt };
}

/**
 * 'valid' for a proof of this person and purpose that has not expired,
 * 'unconfigured' when there is no key (checked first, nothing can be valid),
 * 'invalid' for everything else.
 */
export function verifyAdminProof(
  proof: unknown,
  profileId: string,
  purpose: AdminProofPurpose,
  now: number = Date.now()
): 'valid' | 'invalid' | 'unconfigured' {
  const key = derivedKey();
  if (!key) return 'unconfigured';
  if (
    typeof proof !== 'string' ||
    proof.length > MAX_PROOF_LENGTH ||
    !profileId
  ) {
    return 'invalid';
  }
  const match = PROOF_PATTERN.exec(proof);
  if (!match) return 'invalid';

  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return 'invalid';
  // A proof never lives longer than the lifetime, whatever its text says
  if (expiresAt - now > ADMIN_PROOF_TTL_SEC * 1000) return 'invalid';

  const given = Buffer.from(match[2], 'hex');
  const expected = mac(key, profileId, purpose, expiresAt);
  return given.length === expected.length && timingSafeEqual(given, expected)
    ? 'valid'
    : 'invalid';
}
