import { withTransaction } from '@/lib/content-import/apply/pg-db';
import {
  CONNECTION_RELEASED,
  CONNECTION_RESERVE_TIMEOUT,
  fromPgPool,
  fromPostgresJs,
  withReservedConnection,
} from '@/lib/content-upload/connection';
import type {
  ConnectionSource,
  ReservedConnection,
} from '@/lib/content-upload/connection';

/**
 * Adapter between the apply engine (one connection that holds a transaction,
 * src/lib/content-import/apply/pg-db.ts) and a pooled driver. Tested against
 * fakes only: no database, no network. The behavior behind a transaction mode
 * pooler was measured on a local PgBouncer, see
 * docs/ki-upload-spike-verbindungsadapter.md.
 */

interface FakeReserved extends ReservedConnection {
  calls: { text: string; values?: unknown[] }[];
  released: boolean[];
}

function fakeSource(
  options: {
    queryResult?: (text: string) => {
      rows: Record<string, unknown>[];
      rowCount?: number | null;
    };
    releaseError?: Error;
    reserveError?: Error;
  } = {}
): { source: ConnectionSource; reserved: FakeReserved; reserveCalls: number[] } {
  const reserved: FakeReserved = {
    calls: [],
    released: [],
    async query(text, values) {
      reserved.calls.push({ text, values });
      return options.queryResult
        ? options.queryResult(text)
        : { rows: [], rowCount: 0 };
    },
    async release(failed) {
      reserved.released.push(failed === true);
      if (options.releaseError) throw options.releaseError;
    },
  };
  const reserveCalls: number[] = [];
  return {
    reserved,
    reserveCalls,
    source: {
      async reserve() {
        reserveCalls.push(1);
        if (options.reserveError) throw options.reserveError;
        return reserved;
      },
    },
  };
}

describe('withReservedConnection', () => {
  it('reserves one connection, hands it to the work and releases it afterwards', async () => {
    const { source, reserved, reserveCalls } = fakeSource({
      queryResult: () => ({ rows: [{ one: 1 }], rowCount: 1 }),
    });
    const result = await withReservedConnection(source, async client => {
      const first = await client.query('select 1 as one', []);
      const second = await client.query('select 1 as one');
      return [first.rows[0].one, second.rowCount];
    });
    expect(result).toEqual([1, 1]);
    expect(reserveCalls).toHaveLength(1);
    expect(reserved.calls.map(c => c.text)).toEqual([
      'select 1 as one',
      'select 1 as one',
    ]);
    expect(reserved.released).toEqual([false]);
  });

  it('releases the connection and rethrows when the work fails (and marks it failed)', async () => {
    const { source, reserved } = fakeSource();
    const boom = new Error('work failed');
    await expect(
      withReservedConnection(source, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
    expect(reserved.released).toEqual([true]);
  });

  it('lets the error of the work win when the release fails as well', async () => {
    const { source } = fakeSource({ releaseError: new Error('release failed') });
    const boom = new Error('work failed');
    const seen: unknown[] = [];
    await expect(
      withReservedConnection(
        source,
        async () => {
          throw boom;
        },
        { onReleaseError: error => seen.push(error) }
      )
    ).rejects.toBe(boom);
    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).message).toBe('release failed');
  });

  it('returns the result when the release fails after a successful run, and reports it', async () => {
    const { source } = fakeSource({ releaseError: new Error('release failed') });
    const seen: unknown[] = [];
    await expect(
      withReservedConnection(source, async () => 42, {
        onReleaseError: error => seen.push(error),
      })
    ).resolves.toBe(42);
    expect(seen).toHaveLength(1);
    // without a handler the error of the release is dropped, never thrown
    await expect(withReservedConnection(source, async () => 7)).resolves.toBe(
      7
    );
  });

  it('refuses a query after the work is over (a released connection belongs to someone else)', async () => {
    const { source, reserved } = fakeSource();
    let leaked: { query: (text: string) => Promise<unknown> } | undefined;
    await withReservedConnection(source, async client => {
      leaked = client;
    });
    await expect(leaked!.query('select 1')).rejects.toMatchObject({
      code: CONNECTION_RELEASED,
    });
    expect(reserved.calls).toEqual([]);
  });

  it('passes the error of a failed reservation on and releases nothing', async () => {
    const { source, reserved } = fakeSource({
      reserveError: new Error('pool closed'),
    });
    await expect(
      withReservedConnection(source, async () => 1)
    ).rejects.toThrow('pool closed');
    expect(reserved.released).toEqual([]);
  });

  describe('reserve timeout', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('stops waiting for a free connection and releases a late one', async () => {
      const { reserved } = fakeSource();
      let grant: (value: ReservedConnection) => void = () => undefined;
      const slow: ConnectionSource = {
        reserve: () =>
          new Promise<ReservedConnection>(resolve => {
            grant = resolve;
          }),
      };
      const pending = withReservedConnection(slow, async () => 'never', {
        reserveTimeoutMs: 1000,
      });
      const outcome = expect(pending).rejects.toMatchObject({
        code: CONNECTION_RESERVE_TIMEOUT,
      });
      await jest.advanceTimersByTimeAsync(1000);
      await outcome;
      // the pool hands the connection over after the caller gave up: it goes back
      grant(reserved);
      await jest.advanceTimersByTimeAsync(0);
      expect(reserved.released).toEqual([false]);
    });

    it('reports a late connection that cannot be released either', async () => {
      const { reserved } = fakeSource({ releaseError: new Error('late') });
      let grant: (value: ReservedConnection) => void = () => undefined;
      const slow: ConnectionSource = {
        reserve: () =>
          new Promise<ReservedConnection>(resolve => {
            grant = resolve;
          }),
      };
      const seen: unknown[] = [];
      const pending = withReservedConnection(slow, async () => 'never', {
        reserveTimeoutMs: 10,
        onReleaseError: error => seen.push(error),
      });
      const outcome = expect(pending).rejects.toMatchObject({
        code: CONNECTION_RESERVE_TIMEOUT,
      });
      await jest.advanceTimersByTimeAsync(10);
      await outcome;
      grant(reserved);
      await jest.advanceTimersByTimeAsync(0);
      expect(seen).toHaveLength(1);
    });

    it('does not leave a timer behind after a successful reservation', async () => {
      const { source } = fakeSource();
      await withReservedConnection(source, async () => 1, {
        reserveTimeoutMs: 5000,
      });
      expect(jest.getTimerCount()).toBe(0);
    });

    it('does not leave a timer behind after a failed reservation', async () => {
      const { source } = fakeSource({ reserveError: new Error('nope') });
      await expect(
        withReservedConnection(source, async () => 1, {
          reserveTimeoutMs: 5000,
        })
      ).rejects.toThrow('nope');
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('carries the transaction of the engine on one reserved connection', async () => {
    const { source, reserved } = fakeSource({
      queryResult: text =>
        /pg_try_advisory_xact_lock/.test(text)
          ? { rows: [{ locked: true }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    });
    await withReservedConnection(source, client =>
      withTransaction(
        client,
        { mode: 'write', finish: 'rollback' },
        async () => {
          await client.query('select 1');
        }
      )
    );
    expect(reserved.calls.map(c => c.text)).toEqual([
      'begin isolation level repeatable read read write',
      "set local lock_timeout = '5s'",
      "set local statement_timeout = '60s'",
      'set local row_security = off',
      'select pg_try_advisory_xact_lock(hashtext($1)) as locked',
      'select 1',
      'rollback',
    ]);
    expect(reserved.released).toEqual([false]);
  });

  it('rolls back and releases the connection when the engine fails inside the transaction', async () => {
    const { source, reserved } = fakeSource({
      queryResult: text =>
        /pg_try_advisory_xact_lock/.test(text)
          ? { rows: [{ locked: true }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    });
    await expect(
      withReservedConnection(source, client =>
        withTransaction(
          client,
          { mode: 'write', finish: 'commit' },
          async () => {
            throw new Error('engine failed');
          }
        )
      )
    ).rejects.toThrow('engine failed');
    const texts = reserved.calls.map(c => c.text);
    expect(texts[texts.length - 1]).toBe('rollback');
    expect(texts).not.toContain('commit');
    expect(reserved.released).toEqual([true]);
  });
});

describe('fromPostgresJs', () => {
  function fakeSql(withCount = true) {
    const count = withCount ? 2 : undefined;
    const reservedCalls: { text: string; values?: unknown[] }[] = [];
    const released: number[] = [];
    const reserved = {
      unsafe: (text: string, values?: unknown[]) => {
        reservedCalls.push({ text, values });
        // postgres-js returns a thenable array with the property count
        const rows = Object.assign(
          [{ id: 'a' }, { id: 'b' }] as Record<string, unknown>[],
          { count }
        );
        return Promise.resolve(rows);
      },
      release: () => {
        released.push(1);
      },
    };
    const sql = {
      reserveCalls: 0,
      async reserve() {
        sql.reserveCalls += 1;
        return reserved;
      },
    };
    return { sql, reservedCalls, released };
  }

  it('maps query() to unsafe() on the reserved connection and rows to a plain array', async () => {
    const { sql, reservedCalls, released } = fakeSql(true);
    const connection = await fromPostgresJs(sql).reserve();
    const result = await connection.query('select id from t where id = $1', [
      'a',
    ]);
    expect(reservedCalls).toEqual([
      { text: 'select id from t where id = $1', values: ['a'] },
    ]);
    expect(result.rows).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(Array.isArray(result.rows)).toBe(true);
    expect(Object.keys(result.rows)).toEqual(['0', '1']);
    expect(result.rowCount).toBe(2);
    await connection.release();
    expect(released).toEqual([1]);
  });

  it('sends a query without values with an empty value list and reports a missing count as null', async () => {
    const { sql, reservedCalls } = fakeSql(false);
    const connection = await fromPostgresJs(sql).reserve();
    const result = await connection.query('commit');
    expect(reservedCalls).toEqual([{ text: 'commit', values: [] }]);
    expect(result.rowCount).toBeNull();
  });

  it('sends a final rollback before the release after a failed run and still releases when it fails', async () => {
    const { sql, reservedCalls, released } = fakeSql(true);
    await expect(
      withReservedConnection(fromPostgresJs(sql), async () => {
        throw new Error('failed');
      })
    ).rejects.toThrow('failed');
    expect(reservedCalls).toEqual([{ text: 'rollback', values: [] }]);
    expect(released).toEqual([1]);

    const releasedBroken: number[] = [];
    const brokenSql = {
      async reserve() {
        return {
          unsafe: () => Promise.reject(new Error('connection gone')),
          release: () => {
            releasedBroken.push(1);
          },
        };
      },
    };
    await expect(
      withReservedConnection(fromPostgresJs(brokenSql), async () => {
        throw new Error('failed again');
      })
    ).rejects.toThrow('failed again');
    expect(releasedBroken).toEqual([1]);
  });

  it('does not send a rollback after a successful run', async () => {
    const { sql, reservedCalls } = fakeSql(true);
    await withReservedConnection(fromPostgresJs(sql), async () => 1);
    expect(reservedCalls).toEqual([]);
  });

  it('works through withReservedConnection and releases exactly once', async () => {
    const { sql, released } = fakeSql();
    await withReservedConnection(fromPostgresJs(sql), async client => {
      await client.query('select 1');
    });
    expect(sql.reserveCalls).toBe(1);
    expect(released).toEqual([1]);
  });
});

describe('fromPgPool', () => {
  function fakePool() {
    const calls: { text: string; values?: unknown[] }[] = [];
    const released: unknown[] = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return { rows: [{ ok: true }], rowCount: 1 };
      },
      release: (error?: boolean | Error) => {
        released.push(error);
      },
    };
    return { pool: { connect: async () => client }, calls, released };
  }

  it('maps query() to the client of the pool', async () => {
    const { pool, calls } = fakePool();
    const connection = await fromPgPool(pool).reserve();
    const result = await connection.query('select $1::int', [1]);
    expect(calls).toEqual([{ text: 'select $1::int', values: [1] }]);
    expect(result).toEqual({ rows: [{ ok: true }], rowCount: 1 });
  });

  it('returns a healthy connection to the pool and destroys one after a failure', async () => {
    const healthy = fakePool();
    await withReservedConnection(fromPgPool(healthy.pool), async () => 1);
    expect(healthy.released).toEqual([undefined]);

    const broken = fakePool();
    await expect(
      withReservedConnection(fromPgPool(broken.pool), async () => {
        throw new Error('failed');
      })
    ).rejects.toThrow('failed');
    // release(true) makes the pool close the connection instead of reusing it
    expect(broken.released).toEqual([true]);
  });
});
