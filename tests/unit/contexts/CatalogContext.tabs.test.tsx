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

function setTraineeUrl(search: string, path = '/trainee/dashboard') {
  window.history.replaceState(null, '', `${path}${search}`);
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

    it('a trainee with several enrollments gets tabs for exactly those, the server default is active', async () => {
      signedInAs('trainee');
      respond({ catalogs: [FIAE, KFBM], activeCode: 'KFBM' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.tabs.map(c => c.code)).toEqual(['FIAE', 'KFBM']);
      // nothing chosen yet: the first enrolled occupation of the server
      expect(result.current.activeCode).toBe('KFBM');
      expect(getCatalogHeader()).toBe('KFBM');
    });

    it('the last choice of a trainee wins over the server default', async () => {
      signedInAs('trainee');
      respond({ catalogs: [FIAE, KFBM], activeCode: 'KFBM' });
      writePreferredCatalog('FIAE');
      resetCatalogSelection();
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('FIAE');
      expect(getCatalogHeader()).toBe('FIAE');
    });

    it('a stored choice that is no enrollment of the trainee is not used', async () => {
      signedInAs('trainee');
      respond({ catalogs: [FIAE, KFBM], activeCode: 'KFBM' });
      writePreferredCatalog('ELEK');
      resetCatalogSelection();
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('KFBM');
    });

    it('no tabs for a trainee with ONE enrollment, and no header (as before)', async () => {
      signedInAs('trainee');
      respond({ catalogs: [KFBM], activeCode: 'KFBM' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.tabs).toEqual([]);
      expect(result.current.activeCode).toBe('KFBM');
      expect(getCatalogHeader()).toBeNull();
      expect(result.current.epoch).toBe(0);
    });

    it('no tabs for a single occupation (FIAE regression)', async () => {
      respond({ catalogs: [FIAE], activeCode: 'FIAE' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.tabs).toEqual([]);
      expect(getCatalogHeader()).toBeNull();
      expect(result.current.epoch).toBe(0);
    });

    it('a super admin gets a tab for an inactive occupation too, after the active ones', async () => {
      signedInAs('super_admin');
      respond({ catalogs: [FIAE, OFF, KFBM], activeCode: 'FIAE' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.tabs.map(c => [c.code, c.isActive])).toEqual([
        ['FIAE', true],
        ['KFBM', true],
        ['OFF', false],
      ]);
      expect(result.current.activeCode).toBe('FIAE');
    });

    it('an ADMIN of the platform organization counts as super admin', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        profile: {
          id: 'user-1',
          role: 'admin',
          organization: { isPlatformOwner: true },
        },
        loading: false,
      });
      respond({ catalogs: [FIAE, OFF], activeCode: 'FIAE' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.tabs.map(c => c.code)).toEqual(['FIAE', 'OFF']);
    });

    it.each([
      [
        'an org admin',
        {
          id: 'user-1',
          role: 'admin',
          organization: { isPlatformOwner: false },
        },
      ],
      [
        'a trainer of the platform organization',
        {
          id: 'user-1',
          role: 'trainer',
          organization: { isPlatformOwner: true },
        },
      ],
    ])('%s gets no tab for an inactive occupation', async (_label, profile) => {
      (useAuth as jest.Mock).mockReturnValue({ profile, loading: false });
      // the server never lists an inactive occupation for them, and if it did
      // the client would not offer it
      respond({ catalogs: [FIAE, KFBM, OFF], activeCode: 'FIAE' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.tabs.map(c => c.code)).toEqual(['FIAE', 'KFBM']);
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

    it('a super admin takes an inactive occupation from the URL', async () => {
      signedInAs('super_admin');
      respond({ catalogs: [FIAE, KFBM, OFF], activeCode: 'FIAE' });
      setUrl('?catalog=OFF');
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('OFF');
      expect(getCatalogHeader()).toBe('OFF');
    });

    it('does not take an occupation from the URL for an inactive one', async () => {
      respond({ catalogs: [FIAE, KFBM, OFF], activeCode: 'FIAE' });
      setUrl('?catalog=OFF');
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('FIAE');
    });

    it('a trainee takes the occupation of the URL on a trainee page with tabs', async () => {
      signedInAs('trainee');
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      setTraineeUrl('?catalog=KFBM');
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('KFBM');
      expect(getCatalogHeader()).toBe('KFBM');
    });

    it.each(['?catalog=ZZZ', '?catalog=ELEK', '?catalog=KFBM&catalog=FIAE'])(
      'a trainee falls back to the default for the URL %p (an occupation of somebody else is never taken)',
      async search => {
        signedInAs('trainee');
        respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
        setTraineeUrl(search);
        const { result } = setup();
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.activeCode).toBe('FIAE');
      }
    );

    it('a trainee ignores the URL on a page without tabs', async () => {
      signedInAs('trainee');
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      setTraineeUrl('?catalog=KFBM', '/trainee/profile');
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

    it('a super admin can switch to an inactive occupation', async () => {
      signedInAs('super_admin');
      respond({ catalogs: [FIAE, KFBM, OFF], activeCode: 'FIAE' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.selectTab('OFF'));
      expect(result.current.activeCode).toBe('OFF');
      expect(getCatalogHeader()).toBe('OFF');
      expect(pushCatalogUrl).toHaveBeenCalledWith('FIAE', 'OFF');
    });

    it('refuses an inactive occupation', async () => {
      respond({ catalogs: [FIAE, KFBM, OFF], activeCode: 'FIAE' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.selectTab('OFF'));
      expect(result.current.activeCode).toBe('FIAE');
      expect(getCatalogHeader()).toBe('FIAE');
      expect(pushCatalogUrl).not.toHaveBeenCalled();
    });

    it('a trainee switches between the own enrollments, nothing else', async () => {
      signedInAs('trainee');
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.selectTab('KFBM'));
      expect(result.current.activeCode).toBe('KFBM');
      expect(getCatalogHeader()).toBe('KFBM');
      expect(readPreferredCatalog()).toBe('KFBM');
      expect(pushCatalogUrl).toHaveBeenCalledWith('FIAE', 'KFBM');
      // an occupation the trainee is not enrolled in is refused
      act(() => result.current.selectTab('ELEK'));
      expect(result.current.activeCode).toBe('KFBM');
      expect(pushCatalogUrl).toHaveBeenCalledTimes(1);
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

  describe('pages without tabs and a catalog list without an active occupation', () => {
    it('reads the URL only on a page that has tabs', async () => {
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      window.history.replaceState(null, '', '/trainer/profile?catalog=KFBM');
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('FIAE');
    });

    it('does not load a page without tabs again for the first header', async () => {
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      window.history.replaceState(null, '', '/trainer/profile');
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(getCatalogHeader()).toBe('FIAE');
      expect(result.current.epoch).toBe(0);
    });

    it('loads the page of a trainee with two enrollments again for the first header', async () => {
      signedInAs('trainee');
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      setTraineeUrl('');
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.epoch).toBe(1);
    });

    it('does not load a trainee page without tabs again', async () => {
      signedInAs('trainee');
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      setTraineeUrl('', '/trainee/profile');
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(getCatalogHeader()).toBe('FIAE');
      expect(result.current.epoch).toBe(0);
    });

    it('sends no header and shows no tab when no occupation is active (never an inactive one)', async () => {
      respond({
        catalogs: [
          { ...OFF, code: 'OFA' },
          { ...OFF, code: 'OFB' },
        ],
        activeCode: null,
      });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.tabs).toEqual([]);
      expect(getCatalogHeader()).toBeNull();
    });

    it('a super admin with only inactive occupations gets tabs and a header for the first', async () => {
      signedInAs('super_admin');
      respond({
        catalogs: [
          { ...OFF, code: 'OFA' },
          { ...OFF, code: 'OFB' },
        ],
        activeCode: null,
      });
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.tabs.map(c => c.code)).toEqual(['OFA', 'OFB']);
      expect(getCatalogHeader()).toBe('OFA');
    });

    it('a stored inactive choice is not used', async () => {
      respond({ catalogs: [FIAE, KFBM, OFF], activeCode: 'FIAE' });
      writePreferredCatalog('OFF');
      resetCatalogSelection();
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.activeCode).toBe('FIAE');
      expect(getCatalogHeader()).toBe('FIAE');
    });
  });

  describe('the popstate listener', () => {
    beforeEach(() =>
      respond({ catalogs: [FIAE, KFBM, OFF], activeCode: 'FIAE' })
    );

    it('ignores an inactive occupation in the URL', async () => {
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      setUrl('?catalog=OFF');
      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(result.current.activeCode).toBe('FIAE');
      expect(getCatalogHeader()).toBe('FIAE');
    });

    it('is registered for a trainee with tabs, not for one occupation and not on a page without tabs', async () => {
      const add = jest.spyOn(window, 'addEventListener');
      signedInAs('trainee');
      respond({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      const trainee = setup();
      await waitFor(() => expect(trainee.result.current.status).toBe('ready'));
      expect(add.mock.calls.filter(c => c[0] === 'popstate')).toHaveLength(1);
      trainee.unmount();

      add.mockClear();
      resetCatalogSelection();
      respond({ catalogs: [KFBM], activeCode: 'KFBM' });
      const single = setup();
      await waitFor(() => expect(single.result.current.status).toBe('ready'));
      expect(add.mock.calls.filter(c => c[0] === 'popstate')).toHaveLength(0);
      single.unmount();

      respond({ catalogs: [FIAE, KFBM, OFF], activeCode: 'FIAE' });
      signedInAs('trainer');
      resetCatalogSelection();
      window.history.replaceState(null, '', '/trainer/profile');
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      window.history.replaceState(null, '', '/trainer/profile?catalog=KFBM');
      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(result.current.activeCode).toBe('FIAE');
      add.mockRestore();
    });

    it('is removed when the provider unmounts', async () => {
      const remove = jest.spyOn(window, 'removeEventListener');
      const { result, unmount } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      unmount();
      expect(remove.mock.calls.some(c => c[0] === 'popstate')).toBe(true);
      remove.mockRestore();
    });

    it('does not push the URL again after a switch by the buttons', async () => {
      const { result } = setup();
      await waitFor(() => expect(result.current.status).toBe('ready'));
      setUrl('?catalog=KFBM');
      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(result.current.activeCode).toBe('KFBM');
      expect(pushCatalogUrl).not.toHaveBeenCalled();
    });
  });
});
