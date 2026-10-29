import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicKey } from '@/lib/env';
import { blockInPreview } from '@/lib/preview-guard';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import {
  confirmationRedirectUrl,
  isEmailRateLimitError,
} from '@/lib/auth/email-confirmation';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

// Public endpoint that makes Supabase send an e-mail, so it is limited three
// ways: per client address, per e-mail address within an hour, and one request
// per address and minute (Supabase itself only sends one per minute and user).
const IP_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 };
const EMAIL_HOUR_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 };
const EMAIL_MINUTE_LIMIT = { limit: 1, windowMs: 60 * 1000 };

// The same answer whether or not an account exists for the address, so the
// route cannot be used to find out who is registered.
const SENT_MESSAGE =
  'Wenn zu dieser Adresse ein Konto mit unbestätigter E-Mail-Adresse besteht, haben wir Ihnen einen neuen Link geschickt.';

function tooMany(retryAfterSec: number, message: string) {
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
  );
}

/**
 * POST /api/auth/resend-confirmation  { email }
 *
 * Sends the confirmation e-mail of a self-registration again. Always answers
 * 200 with the same text for a well formed address, except when one of the own
 * limits is hit (429, counted whether or not an account exists). Errors of
 * Supabase, its limits included, are only logged, never shown, because they
 * would tell whether the address is registered.
 */
export async function POST(request: Request) {
  try {
    // Preview shares the Auth of Production: no e-mail from there
    const blocked = blockInPreview();
    if (blocked) return blocked;

    const ip = getClientIp(request.headers);
    const ipRate = checkRateLimit(`resend-ip:${ip}`, IP_LIMIT);
    if (!ipRate.allowed) {
      return tooMany(
        ipRate.retryAfterSec,
        'Zu viele Anfragen. Bitte versuchen Sie es später erneut.'
      );
    }

    let body: { email?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Ungültige Anfrage.' },
        { status: 400 }
      );
    }
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        { error: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.' },
        { status: 400 }
      );
    }

    const key = email.toLowerCase();
    const minuteRate = checkRateLimit(`resend-min:${key}`, EMAIL_MINUTE_LIMIT);
    if (!minuteRate.allowed) {
      return tooMany(
        minuteRate.retryAfterSec,
        'Bitte warten Sie eine Minute, bevor Sie die E-Mail erneut anfordern.'
      );
    }
    const hourRate = checkRateLimit(`resend-hour:${key}`, EMAIL_HOUR_LIMIT);
    if (!hourRate.allowed) {
      return tooMany(
        hourRate.retryAfterSec,
        'Sie haben die E-Mail zu oft angefordert. Bitte versuchen Sie es später erneut.'
      );
    }

    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.SUPABASE_URL_INTERNAL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = getSupabasePublicKey();
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: 'Server misconfigured: missing Supabase URL or anon key' },
        { status: 500 }
      );
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { error } = await authClient.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: confirmationRedirectUrl(request.headers) },
    });

    if (error) {
      // Not even the limit of Supabase is shown: it answers 429 inside its
      // minute only for an account that exists and is not confirmed, so the
      // status would tell who is registered. The limits above already tell the
      // person to wait.
      // eslint-disable-next-line no-console
      console.warn(
        '[api/auth/resend-confirmation] resend failed:',
        (error as { code?: string }).code,
        isEmailRateLimitError(error) ? '(rate limit)' : ''
      );
    }

    return NextResponse.json({ success: true, message: SENT_MESSAGE });
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.error('[api/auth/resend-confirmation] error:', err);
    return NextResponse.json(
      {
        error:
          'Die E-Mail konnte nicht verschickt werden. Bitte versuchen Sie es später erneut.',
      },
      { status: 500 }
    );
  }
}
