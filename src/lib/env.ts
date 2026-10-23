/**
 * Central access to the Supabase API keys.
 *
 * Supabase renamed its keys: the secret key (`sb_secret_...`) replaces the
 * service role key and the publishable key replaces the anon key. Both name
 * pairs are accepted so deployments can switch without a code change, the new
 * names win when both are set.
 *
 * Notes:
 * - `sb_secret_...` keys are not JWTs. Pass them to `createClient(url, key)`
 *   only, never as an `Authorization: Bearer` header of your own fetch calls.
 * - The `NEXT_PUBLIC_*` reads below must stay literal property accesses, so
 *   Next.js can inline them into the browser bundle at build time.
 * - The secret key exists on the server only and must never reach the client.
 */

/** Publishable (formerly anon) key. Safe for the browser. */
export function getSupabasePublicKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    undefined
  );
}

/** Secret (formerly service role) key. Server side only. */
export function getSupabaseSecretKey(): string | undefined {
  return (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    undefined
  );
}
