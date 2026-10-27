import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CatalogProvider, useCatalog } from '@/contexts/CatalogContext';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import { pushCatalogUrl } from '@/lib/catalog/navigation';
import {
  getCatalogHeader,
  readPreferredCatalog,
  resetCatalogSelection,
  writePreferredCatalog,
} from '@/lib/catalog/selection';

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('@/lib/catalog/navigation', () => ({
  reloadPage: jest.fn(),
  navigateTo: jest.fn(),
  pushCatalogUrl: jest.fn(),
}));

const authFetchMock = authFetch as jest.Mock;

const FIAE = { code: 'FIAE', title: 'Fachinformatiker/in' };
const KFBM = { code: 'KFBM', title: 'Büromanagement' };
const ELEK = { code: 'ELEK', title: 'Elektroniker/in' };
const OFF = { code: 'OFF', title: 'Noch nicht freigegeben', isActive: false };

function respond(body: unknown) {
  authFetchMock.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    })
  );
}

function signedInAs(role: string) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'user-1', role },
    loading: false,
  });
}

function setup() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <CatalogProvider>{children}</CatalogProvider>
    </QueryClientProvider>
  );
  return renderHook(() => useCatalog(), { wrapper });
}

function setUrl(search: string) {
  window.history.replaceState(null, '', `/trainer/trainees${search}`);
}

describe('CatalogProvider tabs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    resetCatalogSelection();
    setUrl('');
    signedInAs('trainer');
  });

  describe('who gets tabs', () => {
    it.each(['trainer', 'admin', 'temp_admin', 'super_admin'])(
      '%s with two usable occupations',
      async role => {
        signedInAs(role);
        respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
        const { result } = setup();
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.tabs.map(c => c.code)).toEqual(['FIAE', 'KFBM']);
      }
    );

    it('no tabs for a trainee, also with several occupations (Altdaten)', async () => {
      signedInAs('trainee');
      respond({ catalogs: [FIAE, KFBM], activeCode: 'KFBM' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.tabs).toEqual([]);
      // the enrollment decides, the active one is shown, nothing to switch
      expect(result.current.activeCode).toBe('KFBM');
      expect(getCatalogHeader()).toBe('KFBM');
    });

    it('no tabs for a single occupation (FIAE regression)', async () => {
      respond({ catalogs: [FIAE], activeCode: 'FIAE' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.tabs).toEqual([]);
      expect(getCatalogHeader()).toBeNull();
      expect(result.current.epoch).toBe(0);
    });

    it('no tab for an inactive occupation, and no tabs if only one is active', async () => {
      respond({ catalogs: [FIAE, KFBM, OFF], activeCode: 'FIAE' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.tabs.map(c => c.code)).toEqual(['FIAE', 'KFBM']);

      respond({ catalogs: [FIAE, OFF], activeCode: 'FIAE' });
      resetCatalogSelection();
      const single = setup();
      await waitFor(() => expect(single.result.current.status).toBe('ready'));
      expect(single.result.current.tabs).toEqual([]);
    });
  });

  describe('which occupation is active', () => {
    beforeEach(() =>
      respond({ catalogs: [FIAE, KFBM, ELEK], activeCode: 'FIAE' })
    );

    it('starts with the server default (FIAE first) and sends it', async () => {
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('FIAE');
      expect(getCatalogHeader()).toBe('FIAE');
    });

    it('takes the occupation of the URL', async () => {
      setUrl('?catalog=kfbm');
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('KFBM');
      expect(getCatalogHeader()).toBe('KFBM');
      expect(readPreferredCatalog()).toBe('KFBM');
    });

    it('the URL wins over the stored choice', async () => {
      writePreferredCatalog('ELEK');
      resetCatalogSelection();
      setUrl('?catalog=KFBM');
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('KFBM');
    });

    it.each(['?catalog=ZZZ', '?catalog=<x>', '?catalog=KFBM&catalog=ELEK'])(
      'falls back to the default for the invalid URL %p (fail closed)',
      async search => {
        setUrl(search);
        const { result } = setup();
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.activeCode).toBe('FIAE');
      }
    );

    it('does not take an occupation from the URL for an inactive one', async () => {
      respond({ catalogs: [FIAE, KFBM, OFF], activeCode: 'FIAE' });
      setUrl('?catalog=OFF');
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('FIAE');
    });

    it('a trainee ignores the URL', async () => {
      signedInAs('trainee');
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      setUrl('?catalog=KFBM');
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('FIAE');
    });
  });

  describe('selectTab', () => {
    beforeEach(() =>
      respond({ catalogs: [FIAE, KFBM, ELEK], activeCode: 'FIAE' })
    );

    it('switches without a reload: header, storage, URL, epoch', async () => {
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      const before = result.current.epoch;
      act(() => result.current.selectTab('kfbm'));
      expect(result.current.activeCode).toBe('KFBM');
      expect(getCatalogHeader()).toBe('KFBM');
      expect(readPreferredCatalog()).toBe('KFBM');
      expect(pushCatalogUrl).toHaveBeenCalledWith('FIAE', 'KFBM');
      expect(result.current.epoch).toBe(before + 1);
    });

    it('does nothing for the active occupation', async () => {
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      const before = result.current.epoch;
      act(() => result.current.selectTab('FIAE'));
      expect(pushCatalogUrl).not.toHaveBeenCalled();
      expect(result.current.epoch).toBe(before);
    });

    it.each(['ZZZ', '', 'a b', '<script>', 'KFBM;x'])(
      'refuses %p',
      async code => {
        const { result } = setup();
        await waitFor(() => expect(result.current.status).toBe('ready'));
        act(() => result.current.selectTab(code));
        expect(result.current.activeCode).toBe('FIAE');
        expect(getCatalogHeader()).toBe('FIAE');
        expect(pushCatalogUrl).not.toHaveBeenCalled();
      }
    );

    it('refuses an inactive occupation', async () => {
      respond({ catalogs: [FIAE, KFBM, OFF], activeCode: 'FIAE' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.selectTab('OFF'));
      expect(result.current.activeCode).toBe('FIAE');
    });

    it('does nothing for a trainee (no tabs)', async () => {
      signedInAs('trainee');
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.selectTab('KFBM'));
      expect(result.current.activeCode).toBe('FIAE');
      expect(pushCatalogUrl).not.toHaveBeenCalled();
    });
  });

  describe('back and forward buttons', () => {
    beforeEach(() =>
      respond({ catalogs: [FIAE, KFBM, ELEK], activeCode: 'FIAE' })
    );

    it('follow the occupation in the URL', async () => {
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      setUrl('?catalog=ELEK');
      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(result.current.activeCode).toBe('ELEK');
      expect(getCatalogHeader()).toBe('ELEK');
      // the URL is already right, nothing is pushed again
      expect(pushCatalogUrl).not.toHaveBeenCalled();
    });

    it.each(['', '?catalog=ZZZ', '?catalog=FIAE'])(
      'leave the occupation alone for the URL %p',
      async search => {
        const { result } = setup();
        await waitFor(() => expect(result.current.status).toBe('ready'));
        setUrl(search);
        const before = result.current.epoch;
        act(() => {
          window.dispatchEvent(new PopStateEvent('popstate'));
        });
        expect(result.current.activeCode).toBe('FIAE');
        expect(result.current.epoch).toBe(before);
      }
    );
  });

  describe('the page content loads again (epoch)', () => {
    it('once the header is first set, for requests that went out without it', async () => {
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      const { result } = setup();
      expect(result.current.epoch).toBe(0);
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.epoch).toBe(1);
    });

    it('not when a stored choice held the requests back (nothing went out)', async () => {
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      writePreferredCatalog('KFBM');
      resetCatalogSelection();
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('KFBM');
      expect(result.current.epoch).toBe(0);
    });
  });
});
