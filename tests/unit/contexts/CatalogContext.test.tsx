import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CatalogProvider, useCatalog } from '@/contexts/CatalogContext';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import { reloadPage } from '@/lib/catalog/navigation';
import {
  getCatalogHeader,
  isCatalogPending,
  readPreferredCatalog,
  resetCatalogSelection,
  writePreferredCatalog,
} from '@/lib/catalog/selection';

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('@/lib/catalog/navigation', () => ({ reloadPage: jest.fn() }));

const authFetchMock = authFetch as jest.Mock;

const DEFAULT_BRANDING = {
  title: 'LFA Plattform',
  shortName: null,
  accent: null,
};
const FIAE = {
  code: 'FIAE',
  title: 'Fachinformatiker/in Anwendungsentwicklung',
  branding: DEFAULT_BRANDING,
};
const KFBM = {
  code: 'KFBM',
  title: 'Kaufmann/-frau für Büromanagement',
  branding: {
    title: 'KfBM Lernplattform',
    shortName: 'KfBM',
    accent: '#0f766e',
  },
};

function respond(body: unknown, status = 200) {
  authFetchMock.mockImplementation(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    })
  );
}

function signedIn(id: string | null = 'user-1', loading = false) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: id ? { id } : null,
    loading,
  });
}

function setup() {
  const client = new QueryClient();
  const clear = jest.spyOn(client, 'clear');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <CatalogProvider>{children}</CatalogProvider>
    </QueryClientProvider>
  );
  const view = renderHook(() => useCatalog(), { wrapper });
  return { ...view, clear, client };
}

describe('CatalogProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    resetCatalogSelection();
    signedIn();
  });

  describe('nobody signed in', () => {
    it('loads nothing, sends no header and holds no request', async () => {
      signedIn(null);
      writePreferredCatalog('KFBM');
      resetCatalogSelection();
      expect(isCatalogPending()).toBe(true);
      const { result } = setup();
      await waitFor(() => expect(isCatalogPending()).toBe(false));
      expect(authFetchMock).not.toHaveBeenCalled();
      expect(result.current.status).toBe('idle');
      expect(result.current.catalogs).toEqual([]);
      expect(getCatalogHeader()).toBeNull();
    });

    it('keeps waiting while the sign in state is still being determined', () => {
      signedIn(null, true);
      writePreferredCatalog('KFBM');
      resetCatalogSelection();
      setup();
      expect(isCatalogPending()).toBe(true);
    });
  });

  describe('a user with a single occupation (FIAE regression)', () => {
    beforeEach(() =>
      respond({ catalogs: [FIAE], activeCode: 'FIAE', selected: false })
    );

    it('asks the server once and changes nothing: no header, no storage', async () => {
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(authFetchMock).toHaveBeenCalledTimes(1);
      expect(authFetchMock.mock.calls[0][0]).toBe('/api/me/catalogs');
      expect(result.current.catalogs.map(c => c.code)).toEqual(['FIAE']);
      expect(result.current.activeCode).toBe('FIAE');
      expect(result.current.isMultiple).toBe(false);
      expect(getCatalogHeader()).toBeNull();
      expect(readPreferredCatalog()).toBeNull();
      expect(window.localStorage.length).toBe(0);
    });

    it('does not apply a branding for FIAE, even if one is stored', async () => {
      respond({
        catalogs: [{ ...FIAE, branding: KFBM.branding }],
        activeCode: 'FIAE',
      });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.brandingApplied).toBe(false);
      expect(result.current.branding).toEqual(DEFAULT_BRANDING);
    });

    it('forgets an old stored choice (it is not needed and would hold requests back)', async () => {
      writePreferredCatalog('KFBM');
      resetCatalogSelection();
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(readPreferredCatalog()).toBeNull();
      expect(isCatalogPending()).toBe(false);
      expect(getCatalogHeader()).toBeNull();
    });
  });

  describe('a user whose only occupation is not FIAE', () => {
    it('shows the branding of that occupation and sends no header', async () => {
      respond({ catalogs: [KFBM], activeCode: 'KFBM', selected: false });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('KFBM');
      expect(result.current.isMultiple).toBe(false);
      expect(result.current.brandingApplied).toBe(true);
      expect(result.current.branding).toEqual(KFBM.branding);
      expect(getCatalogHeader()).toBeNull();
    });
  });

  describe('a user with several occupations', () => {
    beforeEach(() =>
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE', selected: false })
    );

    it('uses the occupation the server names when nothing is stored, and remembers it', async () => {
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.isMultiple).toBe(true);
      expect(result.current.activeCode).toBe('FIAE');
      expect(getCatalogHeader()).toBe('FIAE');
      expect(readPreferredCatalog()).toBe('FIAE');
      expect(result.current.brandingApplied).toBe(false);
    });

    it('uses the stored choice when it is one of the user occupations', async () => {
      writePreferredCatalog('KFBM');
      resetCatalogSelection();
      const { result } = setup();
      // the stored choice holds requests back until it is checked
      expect(isCatalogPending()).toBe(true);
      expect(getCatalogHeader()).toBeNull();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(isCatalogPending()).toBe(false);
      expect(getCatalogHeader()).toBe('KFBM');
      expect(result.current.activeCode).toBe('KFBM');
      expect(result.current.brandingApplied).toBe(true);
      expect(result.current.branding.title).toBe('KfBM Lernplattform');
    });

    it('ignores a stored choice that the user does not have (unchecked values are never used)', async () => {
      writePreferredCatalog('ZZZ');
      resetCatalogSelection();
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('FIAE');
      expect(getCatalogHeader()).toBe('FIAE');
      expect(readPreferredCatalog()).toBe('FIAE');
    });

    it('does not ask the server for the occupation with the header (the lookup is free of it)', async () => {
      writePreferredCatalog('KFBM');
      resetCatalogSelection();
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(authFetchMock).toHaveBeenCalledTimes(1);
      expect(authFetchMock.mock.calls[0][1]?.headers).toBeUndefined();
    });

    describe('selectCatalog', () => {
      it('stores the choice, empties the query cache and reloads the page', async () => {
        const { result, clear } = setup();
        await waitFor(() => expect(result.current.status).toBe('ready'));
        act(() => result.current.selectCatalog('kfbm'));
        expect(readPreferredCatalog()).toBe('KFBM');
        expect(clear).toHaveBeenCalledTimes(1);
        expect(reloadPage).toHaveBeenCalledTimes(1);
        // cache is emptied before the page reloads
        expect(clear.mock.invocationCallOrder[0]).toBeLessThan(
          (reloadPage as jest.Mock).mock.invocationCallOrder[0]
        );
      });

      it('does nothing for the occupation that is already active', async () => {
        const { result, clear } = setup();
        await waitFor(() => expect(result.current.status).toBe('ready'));
        act(() => result.current.selectCatalog('FIAE'));
        expect(clear).not.toHaveBeenCalled();
        expect(reloadPage).not.toHaveBeenCalled();
      });

      it.each(['ZZZ', '', 'a b', '<script>', 'KFBM;x'])(
        'refuses %p: only one of the user occupations can be chosen',
        async code => {
          const { result, clear } = setup();
          await waitFor(() => expect(result.current.status).toBe('ready'));
          act(() => result.current.selectCatalog(code));
          expect(readPreferredCatalog()).toBe('FIAE');
          expect(clear).not.toHaveBeenCalled();
          expect(reloadPage).not.toHaveBeenCalled();
        }
      );
    });
  });

  describe('failures', () => {
    it.each([
      ['a server error', () => respond({ error: 'x' }, 503)],
      ['a broken answer', () => respond({ catalogs: 'x' })],
      ['an empty list', () => respond({ catalogs: [], activeCode: null })],
      [
        'a network error',
        () =>
          authFetchMock.mockImplementation(() =>
            Promise.reject(new Error('offline'))
          ),
      ],
    ])(
      'after %s the requests go on without a header',
      async (_label, arrange) => {
        writePreferredCatalog('KFBM');
        resetCatalogSelection();
        arrange();
        const { result } = setup();
        expect(isCatalogPending()).toBe(true);
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(isCatalogPending()).toBe(false);
        expect(getCatalogHeader()).toBeNull();
        expect(result.current.isMultiple).toBe(false);
        expect(result.current.brandingApplied).toBe(false);
        // the stored choice stays, a later load can use it again
        expect(readPreferredCatalog()).toBe('KFBM');
      }
    );

    it('gives up after a timeout, so a hanging request does not block the app', async () => {
      jest.useFakeTimers();
      try {
        writePreferredCatalog('KFBM');
        resetCatalogSelection();
        authFetchMock.mockImplementation(
          (_url: string, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new Error('aborted'))
              );
            })
        );
        const { result } = setup();
        expect(isCatalogPending()).toBe(true);
        await act(async () => {
          jest.advanceTimersByTime(8000);
        });
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(isCatalogPending()).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('what comes from the server is checked again', () => {
    it('drops entries that are not occupations and replaces an unsafe branding by the default', async () => {
      respond({
        catalogs: [
          FIAE,
          {
            code: 'KFBM',
            title: 'Büromanagement',
            branding: {
              title: '<script>alert(1)</script>',
              shortName: 'KfBM',
              accent: 'url(javascript:alert(1))',
            },
          },
          { code: 'bad code!', title: 'x' },
          { code: 'XY' },
          'text',
          null,
        ],
        activeCode: 'KFBM',
      });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.catalogs.map(c => c.code)).toEqual([
        'FIAE',
        'KFBM',
      ]);
      expect(result.current.catalogs[1].branding).toEqual({
        title: 'LFA Plattform',
        shortName: 'KfBM',
        accent: null,
      });
      expect(result.current.activeCode).toBe('KFBM');
    });

    it('ignores an active code that is not in the list', async () => {
      respond({ catalogs: [FIAE, KFBM], activeCode: 'NOPE' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('FIAE');
    });

    it('gives a catalog without a branding the default one', async () => {
      respond({
        catalogs: [{ code: 'KFBM', title: 'Büromanagement' }],
        activeCode: 'KFBM',
      });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.branding).toEqual(DEFAULT_BRANDING);
      expect(result.current.brandingApplied).toBe(true);
    });
  });

  describe('sign in and sign out', () => {
    it('clears the header when the user signs out', async () => {
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      const { result, rerender } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(getCatalogHeader()).toBe('FIAE');
      signedIn(null);
      rerender();
      await waitFor(() => expect(getCatalogHeader()).toBeNull());
      expect(result.current.status).toBe('idle');
      expect(result.current.catalogs).toEqual([]);
    });

    it('loads again for another user', async () => {
      respond({ catalogs: [FIAE], activeCode: 'FIAE' });
      const { result, rerender } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      respond({ catalogs: [KFBM], activeCode: 'KFBM' });
      signedIn('user-2');
      rerender();
      await waitFor(() => expect(result.current.activeCode).toBe('KFBM'));
      expect(authFetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not load again on a re-render of the same user', async () => {
      respond({ catalogs: [FIAE], activeCode: 'FIAE' });
      const { result, rerender } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      rerender();
      rerender();
      expect(authFetchMock).toHaveBeenCalledTimes(1);
    });

    it('ignores an answer that arrives after the user left', async () => {
      let finish: (value: unknown) => void = () => {};
      authFetchMock.mockImplementation(
        () => new Promise(resolve => (finish = resolve))
      );
      const { result, rerender } = setup();
      signedIn(null);
      rerender();
      await act(async () => {
        finish({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' }),
        });
      });
      expect(result.current.status).toBe('idle');
      expect(getCatalogHeader()).toBeNull();
    });
  });

  describe('without a provider', () => {
    it('gives a neutral value (no occupations, nothing applied)', () => {
      const { result } = renderHook(() => useCatalog());
      expect(result.current.catalogs).toEqual([]);
      expect(result.current.isMultiple).toBe(false);
      expect(result.current.brandingApplied).toBe(false);
      expect(result.current.branding).toEqual(DEFAULT_BRANDING);
      expect(() => result.current.selectCatalog('KFBM')).not.toThrow();
    });
  });
});
