import {
  DEFAULT_CATALOG_CODE,
  withCatalogParam,
} from '@/lib/catalog/request-catalog';

describe('withCatalogParam', () => {
  describe('the default occupation: the request does not change', () => {
    it.each([
      ['FIAE', '/api/training-components'],
      ['fiae', '/api/training-use-cases'],
      [' FIAE ', '/api/training-use-cases?x=1'],
    ])('keeps %p on %s', (code, url) => {
      expect(withCatalogParam(url, code)).toBe(url);
    });

    it.each([null, undefined, '', '  '])(
      'keeps the url for the code %p',
      code => {
        expect(withCatalogParam('/api/training-components', code)).toBe(
          '/api/training-components'
        );
      }
    );

    it('exposes the default code', () => {
      expect(DEFAULT_CATALOG_CODE).toBe('FIAE');
    });
  });

  describe('another occupation', () => {
    it('appends ?catalog=CODE', () => {
      expect(withCatalogParam('/api/training-components', 'KFBM')).toBe(
        '/api/training-components?catalog=KFBM'
      );
    });

    it('appends &catalog=CODE to an existing query', () => {
      expect(withCatalogParam('/api/x?userId=1', 'KFBM')).toBe(
        '/api/x?userId=1&catalog=KFBM'
      );
    });

    it('normalizes the code to upper case', () => {
      expect(withCatalogParam('/api/x', ' kfbm ')).toBe('/api/x?catalog=KFBM');
    });

    it('does not add a second catalog parameter', () => {
      expect(withCatalogParam('/api/x?catalog=OTHER', 'KFBM')).toBe(
        '/api/x?catalog=OTHER'
      );
      expect(withCatalogParam('/api/x?a=1&catalog=OTHER', 'KFBM')).toBe(
        '/api/x?a=1&catalog=OTHER'
      );
    });
  });

  describe('input that is not an occupation code', () => {
    it.each(['KF BM', 'a&catalog=EVIL', '<script>', 'X', 'ABCDEFGHIJKLMNOPQ'])(
      'leaves the url alone for %p',
      code => {
        expect(withCatalogParam('/api/x', code)).toBe('/api/x');
      }
    );
  });
});
