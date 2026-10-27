import {
  CATALOG_TAB_PATHS,
  catalogFromSearch,
  isCatalogTabPath,
  pickTabCatalog,
  withCatalogInUrl,
} from '@/lib/catalog/tabs';

describe('catalogFromSearch', () => {
  it.each([
    ['?catalog=KFBM', 'KFBM'],
    ['catalog=kfbm', 'KFBM'],
    ['?a=1&catalog=%20fiae%20', 'FIAE'],
  ])('reads %p as %p', (search, expected) => {
    expect(catalogFromSearch(search)).toBe(expected);
  });

  it.each([
    '',
    null,
    undefined,
    '?catalog=',
    '?catalog=x',
    '?catalog=<script>',
    '?catalog=KFBM&catalog=FIAE',
    '?catalog=KFBM&catalog=KFBM',
    '?catalog=A B',
    '?other=KFBM',
  ])('gives nothing for %p (fail closed)', search => {
    expect(catalogFromSearch(search)).toBeNull();
  });
});

describe('withCatalogInUrl', () => {
  it('sets the parameter and keeps the others and the hash', () => {
    expect(
      withCatalogInUrl('/trainer/trainees', '?q=a&catalog=FIAE', 'KFBM', '#x')
    ).toBe('/trainer/trainees?q=a&catalog=KFBM#x');
    expect(withCatalogInUrl('/trainer/school', '', 'KFBM')).toBe(
      '/trainer/school?catalog=KFBM'
    );
  });
});

describe('pickTabCatalog', () => {
  const codes = ['FIAE', 'KFBM'];

  it('prefers the URL, then the stored choice, then the server, then the first', () => {
    expect(
      pickTabCatalog({
        codes,
        fromUrl: 'KFBM',
        stored: 'FIAE',
        serverActive: 'FIAE',
      })
    ).toBe('KFBM');
    expect(
      pickTabCatalog({ codes, stored: 'KFBM', serverActive: 'FIAE' })
    ).toBe('KFBM');
    expect(pickTabCatalog({ codes, serverActive: 'KFBM' })).toBe('KFBM');
    expect(pickTabCatalog({ codes })).toBe('FIAE');
  });

  it('drops every unchecked value that is not a tab occupation', () => {
    expect(
      pickTabCatalog({
        codes,
        fromUrl: 'ZZZ',
        stored: 'YYY',
        serverActive: 'XXX',
      })
    ).toBe('FIAE');
    expect(pickTabCatalog({ codes, fromUrl: 'ZZZ', stored: 'KFBM' })).toBe(
      'KFBM'
    );
  });

  it('gives null without any occupation', () => {
    expect(pickTabCatalog({ codes: [], fromUrl: 'FIAE' })).toBeNull();
  });
});

describe('isCatalogTabPath', () => {
  it.each(CATALOG_TAB_PATHS)('shows the tabs on %s', path => {
    expect(isCatalogTabPath(path)).toBe(true);
    expect(isCatalogTabPath(`${path}/`)).toBe(true);
  });

  it.each([
    '/',
    '/trainer/profile',
    '/trainer/admin/users',
    '/trainer/admin/organizations',
    '/trainer/admin/content-upload',
    '/trainer/use-cases/abc',
    '/trainer/lernfelder/abc',
    '/trainer/quiz-management/abc',
    '/trainee/dashboard',
    '/berufswahl',
    null,
    undefined,
  ])('does not show the tabs on %p (detail, admin or trainee page)', path => {
    expect(isCatalogTabPath(path)).toBe(false);
  });
});
