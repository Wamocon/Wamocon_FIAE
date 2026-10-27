import { PG_FOREIGN_KEY_VIOLATION, pgErrorCode } from '@/lib/pg-error';

describe('pgErrorCode', () => {
  it('reads the code of a driver error and of a Drizzle error that wraps it', () => {
    expect(pgErrorCode({ code: '23503' })).toBe('23503');
    expect(pgErrorCode({ message: 'x', cause: { code: '23505' } })).toBe(
      '23505'
    );
    expect(pgErrorCode({ cause: { cause: { code: '40001' } } })).toBe('40001');
    expect(PG_FOREIGN_KEY_VIOLATION).toBe('23503');
  });

  it('reads codes with letters (SQLSTATE class 42P01)', () => {
    expect(pgErrorCode({ cause: { code: '42P01' } })).toBe('42P01');
  });

  it('is undefined for anything that is no code', () => {
    for (const value of [
      undefined,
      null,
      'x',
      42,
      {},
      { code: 'ECONNRESET' },
      { code: 23503 },
      { code: '2350' },
      { cause: 'x' },
      new Error('boom'),
    ]) {
      expect(pgErrorCode(value)).toBeUndefined();
    }
  });

  it('does not follow a long chain of causes', () => {
    expect(
      pgErrorCode({ cause: { cause: { cause: { code: '23503' } } } })
    ).toBeUndefined();
  });
});
