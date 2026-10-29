import crypto from 'crypto';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password-policy';

// No look-alike characters (I, l, O, 0, 1), so the password can be read from
// the screen or an e-mail without mistakes.
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';

/**
 * The first password of an account that an administrator creates. It is random
 * and never shorter than the minimum of the password rule
 * (src/lib/auth/password-policy.ts), whatever length the caller asks for.
 */
export function generateInitialPassword(length = 12): string {
  const size = Math.max(length, MIN_PASSWORD_LENGTH);
  // randomInt has no modulo bias, unlike a byte modulo the alphabet size
  return Array.from(
    { length: size },
    () => CHARS[crypto.randomInt(CHARS.length)]
  ).join('');
}
