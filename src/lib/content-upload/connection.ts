// Connection adapter between the apply engine and a pooled database driver.
//
// The engine (src/lib/content-import/apply/pg-db.ts) needs ONE connection that
// holds its transaction: it sends "begin isolation level repeatable read",
// "set local ...", the advisory lock and "commit" or "rollback" itself, as plain
// statements, one after the other. The driver of the app (postgres-js,
// src/db/index.ts) hands out a different pooled connection per statement, and its
// sql.begin() cannot carry those statements (it refuses them as UNSAFE_TRANSACTION
// and a nested begin would silently drop the isolation level). What is needed is a
// reserved connection: sql.reserve() of postgres-js or pool.connect() of pg.
//
// This module is only the narrow seam that package U7 (web apply) needs:
//   withReservedConnection(source, work)  reserve, run, always release
//   fromPostgresJs(sql) / fromPgPool(pool)  the two drivers behind that seam
// The engine is not changed. The measured behavior behind a transaction mode
// pooler (PgBouncer as a stand-in for Supavisor on port 6543) and the limits are
// in docs/ki-upload-spike-verbindungsadapter.md.
//
// Rules the adapter keeps:
//   - one reservation per run, released in every case (success, error, timeout),
//   - the connection is destroyed instead of reused after an error (pg: release(true)),
//   - a query after the release is refused: a released connection already belongs
//     to someone else (with a pooler it may be a different backend altogether),
//   - waiting for a free connection is bounded (reserveTimeoutMs), a connection that
//     arrives after the caller gave up goes straight back,
//   - only parameterised plain statements are sent (postgres-js unsafe(), no named
//     prepared statements), so nothing depends on session state of the server.

import type { Queryable } from '../content-import/apply/pg-db';

export const CONNECTION_RELEASED = 'CONNECTION_RELEASED';
export const CONNECTION_RESERVE_TIMEOUT = 'CONNECTION_RESERVE_TIMEOUT';

export class ConnectionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConnectionError';
    this.code = code;
  }
}

/** A connection that is held for one run. The engine only sees query(). */
export interface ReservedConnection extends Queryable {
  /**
   * Gives the connection back. `failed` says the run ended with an error: a pool
   * that can do it closes the connection instead of reusing it.
   */
  release(failed?: boolean): Promise<void>;
}

/** Where reserved connections come from. */
export interface ConnectionSource {
  reserve(): Promise<ReservedConnection>;
}

export interface ReservedOptions {
  /** Longest wait for a free connection in milliseconds. Unset: no limit. */
  reserveTimeoutMs?: number;
  /** Called when the release itself fails (the result of the run is kept). */
  onReleaseError?: (error: unknown) => void;
}

async function reserveWithin(
  source: ConnectionSource,
  timeoutMs: number | undefined,
  onReleaseError: ((error: unknown) => void) | undefined
): Promise<ReservedConnection> {
  if (timeoutMs === undefined) return source.reserve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gaveUp = false;
  const reservation = source.reserve();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      gaveUp = true;
      reject(
        new ConnectionError(
          CONNECTION_RESERVE_TIMEOUT,
          `No database connection was free within ${timeoutMs} ms.`
        )
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([reservation, timeout]);
  } catch (error) {
    // The pool may still hand a connection over later: it goes straight back.
    reservation.then(
      late => {
        if (gaveUp) late.release().catch(e => onReleaseError?.(e));
      },
      () => undefined
    );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reserves one connection, runs `work` with it and releases it in every case.
 * The error of `work` always wins over an error of the release.
 */
export async function withReservedConnection<T>(
  source: ConnectionSource,
  work: (client: Queryable) => Promise<T>,
  options: ReservedOptions = {}
): Promise<T> {
  const connection = await reserveWithin(
    source,
    options.reserveTimeoutMs,
    options.onReleaseError
  );
  let released = false;
  const guarded: Queryable = {
    query(text, values) {
      if (released) {
        return Promise.reject(
          new ConnectionError(
            CONNECTION_RELEASED,
            'The connection was released, it must not be used any more.'
          )
        );
      }
      return connection.query(text, values);
    },
  };
  let failed = false;
  try {
    return await work(guarded);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    released = true;
    try {
      await connection.release(failed);
    } catch (error) {
      options.onReleaseError?.(error);
    }
  }
}

// --- postgres-js ------------------------------------------------------------

/** The part of a reserved postgres-js connection that the adapter uses. */
export interface PostgresJsReserved {
  unsafe(
    query: string,
    parameters?: unknown[]
  ): PromiseLike<ArrayLike<Record<string, unknown>> & { count?: number }>;
  release(): void | Promise<void>;
}

/** The part of a postgres-js client (src/db/index.ts) that the adapter uses. */
export interface PostgresJsLike {
  reserve(): Promise<PostgresJsReserved>;
}

/**
 * postgres-js over sql.reserve(). unsafe() sends the statement as it is, with
 * parameters, without a named prepared statement (its default), which is what a
 * transaction mode pooler needs. begin and commit are allowed on a reserved
 * connection.
 */
export function fromPostgresJs(sql: PostgresJsLike): ConnectionSource {
  return {
    async reserve() {
      const reserved = await sql.reserve();
      return {
        async query(text, values) {
          const result = await reserved.unsafe(text, values ?? []);
          return { rows: Array.from(result), rowCount: result.count ?? null };
        },
        async release() {
          await reserved.release();
        },
      };
    },
  };
}

// --- pg ------------------------------------------------------------------------

/** The part of a pg pool client that the adapter uses. */
export interface PgPoolClientLike {
  query(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
  release(destroy?: boolean | Error): void;
}

export interface PgPoolLike {
  connect(): Promise<PgPoolClientLike>;
}

/** pg over pool.connect(). A failed run destroys the connection (release(true)). */
export function fromPgPool(pool: PgPoolLike): ConnectionSource {
  return {
    async reserve() {
      const client = await pool.connect();
      return {
        query: (text, values) => client.query(text, values),
        async release(failed) {
          client.release(failed === true ? true : undefined);
        },
      };
    },
  };
}
