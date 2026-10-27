import { pushCatalogUrl } from '@/lib/catalog/navigation';

describe('pushCatalogUrl', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/trainer/trainees');
  });

  it('adds a history entry that names the new occupation and keeps other parameters', () => {
    window.history.replaceState(null, '', '/trainer/trainees?q=ab#top');
    const length = window.history.length;
    pushCatalogUrl(null, 'KFBM');
    expect(window.location.pathname).toBe('/trainer/trainees');
    expect(new URLSearchParams(window.location.search).get('catalog')).toBe(
      'KFBM'
    );
    expect(new URLSearchParams(window.location.search).get('q')).toBe('ab');
    expect(window.location.hash).toBe('#top');
    expect(window.history.length).toBe(length + 1);
  });

  it('first names the previous occupation in the current entry, so back leads to it', () => {
    const length = window.history.length;
    pushCatalogUrl('FIAE', 'KFBM');
    // one replace and one push: exactly one new entry
    expect(window.history.length).toBe(length + 1);
    expect(window.location.search).toBe('?catalog=KFBM');
    window.history.back();
    return new Promise<void>(resolve => {
      window.addEventListener(
        'popstate',
        () => {
          expect(window.location.search).toBe('?catalog=FIAE');
          resolve();
        },
        { once: true }
      );
    });
  });

  it('does not rewrite an entry that already names an occupation', () => {
    window.history.replaceState(null, '', '/trainer/trainees?catalog=FIAE');
    const replace = jest.spyOn(window.history, 'replaceState');
    pushCatalogUrl('FIAE', 'KFBM');
    expect(replace).not.toHaveBeenCalled();
    replace.mockRestore();
  });
});
