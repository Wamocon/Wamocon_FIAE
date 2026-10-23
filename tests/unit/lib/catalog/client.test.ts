import { normalizeCatalogCode } from '@/lib/catalog/client';

describe('normalizeCatalogCode', () => {
  it('upper-cases and trims a valid occupation code', () => {
    expect(normalizeCatalogCode('kfbm')).toBe('KFBM');
    expect(normalizeCatalogCode(' fiae ')).toBe('FIAE');
    expect(normalizeCatalogCode('KFBM')).toBe('KFBM');
    expect(normalizeCatalogCode('it-sys_2')).toBe('IT-SYS_2');
  });

  it('rejects everything that is not a short code', () => {
    for (const value of [
      '',
      ' ',
      'x',
      'A'.repeat(17),
      'KF BM',
      'KFBM&x=1',
      'KFBM/../etc',
      '<script>',
      'KF\nBM',
      "KFBM'--",
      'Büro',
    ]) {
      expect(normalizeCatalogCode(value)).toBeUndefined();
    }
  });

  it('accepts the length limits', () => {
    expect(normalizeCatalogCode('AB')).toBe('AB');
    expect(normalizeCatalogCode('A'.repeat(16))).toBe('A'.repeat(16));
  });

  it('rejects values that are not a string, for example a repeated query parameter', () => {
    expect(normalizeCatalogCode(undefined)).toBeUndefined();
    expect(normalizeCatalogCode(null)).toBeUndefined();
    expect(normalizeCatalogCode(42)).toBeUndefined();
    expect(normalizeCatalogCode(['KFBM', 'FIAE'])).toBeUndefined();
    expect(normalizeCatalogCode({ code: 'KFBM' })).toBeUndefined();
  });
});
