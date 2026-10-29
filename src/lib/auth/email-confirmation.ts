import { getBaseUrlFromRequest } from '@/lib/url';

/**
 * Confirmation of the e-mail address after the self-registration.
 *
 * With "Confirm email" switched on in Supabase Auth, a registration yields an
 * account without a session until the person clicks the link of the e-mail.
 * The link leads to GET /auth/callback (src/app/auth/callback/route.ts), which
 * exchanges the token hash and then sends the person on. The place it sends
 * them to is never taken from the request: it comes from the positive list
 * below, so the route cannot be used as an open redirect.
 */

/** Page route that receives the link of the confirmation e-mail. */
export const CONFIRM_CALLBACK_PATH = '/auth/callback';

/** API route that sends the confirmation e-mail again. */
export const RESEND_CONFIRMATION_PATH = '/api/auth/resend-confirmation';

/**
 * The only paths of the app the callback may send a person to (exact match).
 * Add a path here only after a review, never derive one from the request.
 */
export const CONFIRM_TARGETS = ['/login'] as const;
export const DEFAULT_CONFIRM_TARGET: (typeof CONFIRM_TARGETS)[number] =
  '/login';

/**
 * The target for the value of ?next=: the value itself if it is exactly one of
 * CONFIRM_TARGETS, otherwise the default. Absolute URLs, protocol-relative
 * URLs, backslashes, encoded tricks and everything else fall back.
 */
export function safeConfirmTarget(next: unknown): string {
  const raw = Array.isArray(next) ? next[0] : next;
  return typeof raw === 'string' &&
    (CONFIRM_TARGETS as readonly string[]).includes(raw)
    ? raw
    : DEFAULT_CONFIRM_TARGET;
}

/** Types of token the callback accepts: the confirmation of a sign up only. */
export type ConfirmOtpType = 'email' | 'signup';

export function parseConfirmOtpType(value: unknown): ConfirmOtpType | null {
  return value === 'email' || value === 'signup' ? value : null;
}

/** A token hash has this shape (hex or url safe characters, bounded). */
export function isPlausibleTokenHash(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value);
}

/**
 * What the login page says after the callback: the address is confirmed
 * (done), the link did not work (failed), or the callback got no token and
 * cannot tell (check, for example if Supabase confirmed the address itself).
 */
export const CONFIRM_NOTICES = ['done', 'failed', 'check'] as const;
export type ConfirmNotice = (typeof CONFIRM_NOTICES)[number];

/** The value of ?confirm= if it is a known notice, otherwise null. */
export function normalizeConfirmNotice(value: unknown): ConfirmNotice | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' &&
    (CONFIRM_NOTICES as readonly string[]).includes(raw)
    ? (raw as ConfirmNotice)
    : null;
}

/** Path and query the callback sends the person to. */
export function confirmRedirectPath(
  target: string,
  notice: ConfirmNotice
): string {
  return `${safeConfirmTarget(target)}?confirm=${notice}`;
}

const PRODUCTION_URL = 'https://fiae-learn.com';

/**
 * Base URL for the links in e-mails and for the redirect of the callback. The
 * configured public URL wins over the headers of the request, so a forged Host
 * or X-Forwarded-Host header cannot point a link at another site. Without a
 * valid configured URL a production build does not trust the headers either
 * and uses the production address; only development and tests read the
 * headers.
 */
export function authRedirectBase(headers: {
  get(name: string): string | null;
}): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // a malformed value is treated as not configured
    }
  }
  if (process.env.NODE_ENV === 'production') return PRODUCTION_URL;
  return getBaseUrlFromRequest({ headers });
}

/**
 * True for the limits of Supabase on sending e-mails (per user and minute, or
 * per project and hour).
 */
export function isEmailRateLimitError(error: unknown): boolean {
  const { status, code } = (error ?? {}) as { status?: number; code?: string };
  return (
    status === 429 ||
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit'
  );
}

/** Where Supabase sends the person after the confirmation (emailRedirectTo). */
export function confirmationRedirectUrl(headers: {
  get(name: string): string | null;
}): string {
  return `${authRedirectBase(headers)}${CONFIRM_CALLBACK_PATH}`;
}

/**
 * The sign in failed because the address is not confirmed yet. The login form
 * shows its own text and offers to send the e-mail again.
 */
export class EmailNotConfirmedError extends Error {
  constructor(message = 'E-Mail ist noch nicht bestätigt.') {
    super(message);
    this.name = 'EmailNotConfirmedError';
  }
}

export function isEmailNotConfirmedError(
  e: unknown
): e is EmailNotConfirmedError {
  return e instanceof EmailNotConfirmedError;
}
