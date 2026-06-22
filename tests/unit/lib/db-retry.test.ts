import { describe, it, expect, jest } from '@jest/globals';
import { withDbRetry } from '@/lib/db-retry';

describe('lib/db-retry withDbRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = jest.fn(async () => 'ok');
    const result = await withDbRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a transient connection error and eventually succeeds', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 3) {
        const err: any = new Error('Connection terminated unexpectedly');
        throw err;
      }
      return 'recovered';
    });
    const result = await withDbRetry(fn, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on a transient SQLSTATE code (53300 too_many_connections)', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 2) {
        const err: any = new Error('sorry, too many clients already');
        err.code = '53300';
        throw err;
      }
      return 'ok';
    });
    const result = await withDbRetry(fn, { retries: 2, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a genuine (non-transient) query error and rethrows immediately', async () => {
    const err: any = new Error('column "foo" does not exist');
    err.code = '42703'; // undefined_column — a real logic error
    const fn = jest.fn(async () => {
      throw err;
    });
    await expect(withDbRetry(fn, { retries: 3, baseDelayMs: 1 })).rejects.toThrow(
      'column "foo" does not exist'
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws the last transient error after exhausting all retries', async () => {
    const fn = jest.fn(async () => {
      const err: any = new Error('connect_timeout');
      throw err;
    });
    await expect(withDbRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow(
      'connect_timeout'
    );
    // initial attempt + 2 retries
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
