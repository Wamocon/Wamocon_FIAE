import { MIN_PASSWORD_LENGTH, VALIDATION } from '@/lib/constants';

/**
 * The one rule for a password of the platform: at least MIN_PASSWORD_LENGTH
 * characters, nothing else (no character classes, no trimming). It is the same
 * minimum as the Supabase Auth setting of the project, so the app says "too
 * short" before Supabase has to.
 *
 * Used by the self-registration (page and route), the password reset, the
 * change of the own password, the passwords the administration creates and the
 * scripts that create accounts. The German texts are the ones of
 * VALIDATION.password in src/lib/constants.ts.
 */

export { MIN_PASSWORD_LENGTH };

/**
 * The German message for a password that does not satisfy the rule, or null if
 * it does. Anything that is not a non-empty string counts as missing.
 */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) {
    return VALIDATION.password.required;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return VALIDATION.password.minLength;
  }
  return null;
}

/** True if the password satisfies the rule. */
export function isValidPassword(password: unknown): password is string {
  return passwordProblem(password) === null;
}

/**
 * Throws an Error with the German message if the password does not satisfy the
 * rule. For scripts that must stop before they create an account.
 */
export function assertValidPassword(
  password: unknown,
  label = 'Passwort'
): asserts password is string {
  const problem = passwordProblem(password);
  if (problem) throw new Error(`${label}: ${problem}`);
}
