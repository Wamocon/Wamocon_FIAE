/**
 * Time limits of the sign in. A sign in must never hang without a message: the
 * Supabase client can wait forever for its auth lock (another tab or a stuck
 * call holds it), then signInWithPassword neither answers nor fails and the
 * login button spins without end.
 */

/** The sign in of the Supabase client (signInWithPassword). */
export const SDK_SIGN_IN_TIMEOUT_MS = 12_000;

/** The direct request to /auth/v1/token and setSession that follows. */
export const FALLBACK_SIGN_IN_TIMEOUT_MS = 10_000;

/** Reading the session after the sign in (getSession, signOut of a failed one). */
export const SESSION_READ_TIMEOUT_MS = 5_000;

/** Waiting for the profile of the person after the sign in. */
export const POST_SIGN_IN_TIMEOUT_MS = 15_000;

export const SIGN_IN_TIMEOUT_CODE = 'SIGN_IN_TIMEOUT';

/**
 * The sign in did not answer in time. The login form shows the translated
 * text (auth.signInTimeout) for this code, the message is the German default
 * for every other caller.
 */
export class SignInTimeoutError extends Error {
  readonly code = SIGN_IN_TIMEOUT_CODE;

  constructor() {
    super(
      'Die Anmeldung dauert zu lange. Bitte laden Sie die Seite neu und versuchen Sie es erneut.'
    );
    this.name = 'SignInTimeoutError';
  }
}

export function isSignInTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === SIGN_IN_TIMEOUT_CODE
  );
}

/**
 * The result of `promise`, or a SignInTimeoutError after `ms`. The timer is
 * always cleared. A promise that settles after the limit is ignored (its
 * rejection is handled here, so it is never unhandled). `onTimeout` runs once
 * when the limit is hit, for example to abort a request.
 */
export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  onTimeout?: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new SignInTimeoutError());
    }, ms);
    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
