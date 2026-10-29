import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicKey } from '@/lib/env';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import {
  authRedirectBase,
  confirmRedirectPath,
  isPlausibleTokenHash,
  parseConfirmOtpType,
  safeConfirmTarget,
  type ConfirmNotice,
} from '@/lib/auth/email-confirmation';

// The link of the confirmation e-mail. At most 20 attempts per client address
// in ten minutes: a real person needs one, a scripted guess of tokens does not
// get far (Supabase limits the exchange as well).
const CALLBACK_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };

/**
 * GET /auth/callback?token_hash=...&type=email[&next=/login]
 *
 * Exchanges the token hash of the confirmation e-mail (verifyOtp) and sends the
 * person to the login page with a notice. No session is kept: the person signs
 * in with the password afterwards, and a self-registered trainee then waits for
 * the release by a trainer as before.
 *
 * Only the confirmation of a sign up is accepted (type email or signup). The
 * target comes from the positive list in src/lib/auth/email-confirmation.ts,
 * never from the request, and the redirect always stays on the own origin.
 * Without a token (for example if Supabase already confirmed the address and
 * only redirected here) the person gets a neutral notice, nothing is claimed.
 */
export async function GET(request: Request) {
  // authRedirectBase only returns a valid origin (a malformed configured URL
  // counts as not configured), so new URL(..., base) below cannot throw
  const base = authRedirectBase(request.headers);
  const url = new URL(request.url);
  const target = safeConfirmTarget(url.searchParams.get('next'));

  const redirectTo = (notice: ConfirmNotice) =>
    NextResponse.redirect(new URL(confirmRedirectPath(target, notice), base), {
      status: 303,
      // The answer depends on a one-time token, nothing may store it
      headers: { 'Cache-Control': 'no-store' },
    });

  const tokenHash = url.searchParams.get('token_hash');
  const type = parseConfirmOtpType(url.searchParams.get('type'));
  if (!tokenHash || !type) return redirectTo('check');
  if (!isPlausibleTokenHash(tokenHash)) return redirectTo('failed');

  const rate = checkRateLimit(
    `auth-callback:${getClientIp(request.headers)}`,
    CALLBACK_LIMIT
  );
  if (!rate.allowed) return redirectTo('failed');

  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_URL_INTERNAL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = getSupabasePublicKey();
  if (!supabaseUrl || !anonKey) return redirectTo('failed');

  try {
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { error } = await authClient.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) return redirectTo('failed');
    return redirectTo('done');
  } catch (err: unknown) {
    // Details stay in the server log, the person only sees the notice
    // eslint-disable-next-line no-console
    console.error('[auth/callback] error:', err);
    return redirectTo('failed');
  }
}
