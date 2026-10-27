/**
 * The PostgreSQL error code (SQLSTATE) of a failed query, or undefined.
 *
 * Drizzle wraps the error of the driver (DrizzleQueryError, drizzle-orm 0.44):
 * the code sits on `cause`. The driver error itself carries it directly. Only the
 * code is returned, never the text of the error, which holds the statement and
 * its parameters.
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 3 && current && typeof current === 'object';
    depth++
  ) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** foreign_key_violation: a row that others still point at is deleted. */
export const PG_FOREIGN_KEY_VIOLATION = '23503';
