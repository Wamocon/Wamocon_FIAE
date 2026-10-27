// Test helper for the admin PIN proof (src/lib/auth/admin-proof.ts): a fixed
// test key in the environment, and the request header of a valid proof for a
// person. Not a real secret.

import { signAdminProof, ADMIN_PROOF_HEADER } from '@/lib/auth/admin-proof';

export const TEST_PROOF_KEY = 'test-only-key-for-the-admin-proof-0123456789';

/** Set the key, returns the function that restores the previous value. */
export function useTestProofKey(): () => void {
  const before = {
    secret: process.env.SUPABASE_SECRET_KEY,
    legacy: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SECRET_KEY = TEST_PROOF_KEY;
  return () => {
    if (before.secret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = before.secret;
    if (before.legacy === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else process.env.SUPABASE_SERVICE_ROLE_KEY = before.legacy;
  };
}

/** The proof of the person, for the hai-index-admin gate. */
export function proofFor(profileId: string, now?: number): string {
  const signed = signAdminProof(profileId, 'hai-index-admin', now);
  if (!signed) throw new Error('test key missing');
  return signed.proof;
}

/** Header object with a valid proof of the person. */
export function proofHeader(
  profileId: string,
  now?: number
): Record<string, string> {
  return { [ADMIN_PROOF_HEADER]: proofFor(profileId, now) };
}
