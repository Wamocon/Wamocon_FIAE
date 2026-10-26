import {
  CATALOG_REQUEST_HEADER,
  PREFERRED_CATALOG_KEY,
  getCatalogHeader,
  getCatalogSelection,
  isCatalogPending,
  readPreferredCatalog,
  resetCatalogSelection,
  setCatalogSelection,
  subscribeCatalogSelection,
  whenCatalogSettled,
  writePreferredCatalog,
} from '@/lib/catalog/selection';

describe('catalog selection (client state)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCatalogSelection();
  });

  it('uses the agreed storage key and header name', () => {
    expect(PREFERRED_CATALOG_KEY).toBe('lfa.preferredCatalog');
    expect(CATALOG_REQUEST_HEADER).toBe('x-catalog');
  });

  describe('stored preference', () => {
    it('reads nothing when nothing is stored', () => {
      expect(readPreferredCatalog()).toBeNull();
    });

    it('stores and reads a code, normalized to upper case', () => {
      writePreferredCatalog('kfbm');
      expect(window.localStorage.getItem('lfa.preferredCatalog')).toBe('KFBM');
      expect(readPreferredCatalog()).toBe('KFBM');
    });

    it('removes the entry for null', () => {
      writePreferredCatalog('KFBM');
      writePreferredCatalog(null);
      expect(window.localStorage.getItem('lfa.preferredCatalog')).toBeNull();
    });

    it.each(['', ' ', 'k', 'KFBM; drop', '<b>', 'a'.repeat(17), '../x'])(
      'ignores a stored value that is not a code: %p',
      value => {
        window.localStorage.setItem('lfa.preferredCatalog', value);
        expect(readPreferredCatalog()).toBeNull();
      }
    );

    it('does not store something that is not a code', () => {
      writePreferredCatalog('not a code!');
      expect(window.localStorage.getItem('lfa.preferredCatalog')).toBeNull();
    });

    it('survives a missing or throwing localStorage', () => {
      const spies = [
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
          throw new Error('blocked');
        }),
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new Error('blocked');
        }),
        jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
          throw new Error('blocked');
        }),
      ];
      try {
        expect(readPreferredCatalog()).toBeNull();
        expect(() => writePreferredCatalog('KFBM')).not.toThrow();
        expect(() => writePreferredCatalog(null)).not.toThrow();
      } finally {
        spies.forEach(spy => spy.mockRestore());
      }
    });

    it('survives an inaccessible window.localStorage getter', () => {
      const spy = jest
        .spyOn(window, 'localStorage', 'get')
        .mockImplementation(() => {
          throw new Error('SecurityError');
        });
      try {
        expect(readPreferredCatalog()).toBeNull();
        expect(() => writePreferredCatalog('KFBM')).not.toThrow();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('shared state', () => {
    it('starts without a header and not pending when nothing is stored', () => {
      expect(getCatalogHeader()).toBeNull();
      expect(isCatalogPending()).toBe(false);
      expect(getCatalogSelection()).toEqual({ header: null, pending: false });
    });

    it('starts pending when a preference is stored (the list is still loading)', () => {
      window.localStorage.setItem('lfa.preferredCatalog', 'KFBM');
      resetCatalogSelection();
      expect(isCatalogPending()).toBe(true);
      expect(getCatalogHeader()).toBeNull();
    });

    it('sets header and pending and tells the subscribers once per change', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeCatalogSelection(listener);
      setCatalogSelection({ header: 'KFBM', pending: false });
      expect(getCatalogHeader()).toBe('KFBM');
      expect(listener).toHaveBeenCalledTimes(1);
      setCatalogSelection({ header: 'KFBM', pending: false });
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
      setCatalogSelection({ header: null, pending: false });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('keeps the snapshot object stable while nothing changes', () => {
      const first = getCatalogSelection();
      expect(getCatalogSelection()).toBe(first);
      setCatalogSelection({ pending: true });
      expect(getCatalogSelection()).not.toBe(first);
    });

    it('only accepts a code as header', () => {
      setCatalogSelection({ header: 'bad value; x' as any });
      expect(getCatalogHeader()).toBeNull();
      setCatalogSelection({ header: 'kfbm' });
      expect(getCatalogHeader()).toBe('KFBM');
    });
  });

  describe('whenCatalogSettled', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('resolves at once when nothing is pending', async () => {
      await expect(whenCatalogSettled()).resolves.toBeUndefined();
    });

    it('waits for the end of the pending state', async () => {
      setCatalogSelection({ pending: true });
      let done = false;
      const waiting = whenCatalogSettled().then(() => {
        done = true;
      });
      await Promise.resolve();
      expect(done).toBe(false);
      setCatalogSelection({ header: 'KFBM', pending: false });
      await waiting;
      expect(done).toBe(true);
    });

    it('gives up after the timeout, so a request is never held for ever', async () => {
      setCatalogSelection({ pending: true });
      const waiting = whenCatalogSettled(5000);
      jest.advanceTimersByTime(5000);
      await expect(waiting).resolves.toBeUndefined();
      // the waiter does not stay subscribed
      const listener = jest.fn();
      subscribeCatalogSelection(listener)();
      expect(isCatalogPending()).toBe(true);
    });
  });
});
