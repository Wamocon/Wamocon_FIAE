/**
 * Transient database error retry helper.
 *
 * On Vercel serverless + Supabase (postgres-js over the pooler), cold starts and
 * brief pool saturation can cause transient connection failures. Without a retry,
 * a single hiccup surfaces as a 500 (or, in authorization helpers, a misleading
 * 403). This helper retries idempotent read operations a small number of times
 * with exponential backoff, but only for errors that look transient — genuine
 * query/logic errors are re-thrown immediately.
 */

// postgres-js / node connection-level error fragments (lower-cased match)
const TRANSIENT_MESSAGE_FRAGMENTS = [
  'connect_timeout',
  'connection_ended',
  'connection_closed',
  'connection_destroyed',
  'connection terminated',
  'terminating connection',
  'econnreset',
  'etimedout',
  'epipe',
  'socket hang up',
  'timeout',
  'too many clients',
  'remaining connection slots',
  'server closed the connection',
];

// PostgreSQL SQLSTATE codes that indicate transient connection/availability issues
const TRANSIENT_PG_CODES = new Set([
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  'XX000', // internal_error (often a dropped pooler connection)
]);

function isTransientError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as { code?: unknown; message?: unknown; cause?: { code?: unknown } };
  const code = anyErr.code ?? anyErr.cause?.code;
  if (code != null && TRANSIENT_PG_CODES.has(String(code))) return true;
  const message = String(anyErr.message ?? err).toLowerCase();
  return TRANSIENT_MESSAGE_FRAGMENTS.some(fragment => message.includes(fragment));
}

export interface DbRetryOptions {
  retries?: number;
  baseDelayMs?: number;
}

/**
 * Execute an idempotent DB operation, retrying on transient connection errors.
 *
 * @param fn A function that performs the DB call. It is re-invoked on each retry,
 *           so it must build a fresh query each time (e.g. `() => db.select()...`).
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  { retries = 2, baseDelayMs = 150 }: DbRetryOptions = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isTransientError(error)) {
        throw error;
      }
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
