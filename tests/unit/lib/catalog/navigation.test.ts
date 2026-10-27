import { pushCatalogUrl } from '@/lib/catalog/navigation';

function nextPopState(): Promise<void> {
  return new Promise(resolve => {
    window.addEventListener('popstate', () => resolve(), { once: true });
  });
}

describe('pushCatalogUrl', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/trainer/trainees');
  });
  afterEach(() => jest.restoreAllMocks());

  it('adds a history entry that names the new occupation and keeps other parameters', () => {
    window.history.replaceState(null, '', '/trainer/trainees?q=ab#top');
    const length = window.history.length;
    pushCatalogUrl(null, 'KFBM');
    const params = new URLSearchParams(window.location.search);
    expect(window.location.pathname).toBe('/trainer/trainees');
    expect(params.get('catalog')).toBe('KFBM');
    expect(params.get('q')).toBe('ab');
    expect(window.location.hash).toBe('#top');
    expect(window.history.length).toBe(length + 1);
  });

  it('first names the previous occupation in the current entry, so back leads to it', async () => {
    const length = window.history.length;
    pushCatalogUrl('FIAE', 'KFBM');
    // one replace and one push: exactly one new entry
    expect(window.history.length).toBe(length + 1);
    expect(window.location.search).toBe('?catalog=KFBM');
    const popped = nextPopState();
    window.history.back();
    await popped;
    expect(window.location.search).toBe('?catalog=FIAE');
  });

  it('does not rewrite an entry that already names an occupation', () => {
    window.history.replaceState(null, '', '/trainer/trainees?catalog=FIAE');
    const replace = jest.spyOn(window.history, 'replaceState');
    pushCatalogUrl('FIAE', 'KFBM');
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?catalog=KFBM');
  });

  it('does not rewrite the entry without a previous occupation, and replaces an invalid code', () => {
    const replace = jest.spyOn(window.history, 'replaceState');
    pushCatalogUrl(null, 'KFBM');
    expect(replace).not.toHaveBeenCalled();
    window.history.replaceState(
      null,
      '',
      '/trainer/trainees?catalog=bad%20code'
    );
    replace.mockClear();
    pushCatalogUrl('FIAE', 'KFBM');
    // the invalid value names no occupation: the previous one is written first
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?catalog=KFBM');
  });
});
