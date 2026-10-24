import { authFetch } from '@/lib/authFetch';
import {
  resetCatalogSelection,
  setCatalogSelection,
} from '@/lib/catalog/selection';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() } },
}));

const getSession = supabase.auth.getSession as jest.Mock;
const fetchMock = jest.fn();

function sentHeaders(call = 0): Headers {
  return new Headers(fetchMock.mock.calls[call][1].headers);
}

describe('authFetch', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    resetCatalogSelection();
    getSession.mockResolvedValue({
      data: { session: { access_token: 'tok-1' } },
    });
    fetchMock.mockResolvedValue({ ok: true });
    global.fetch = fetchMock as any;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('a user with a single occupation (every FIAE user today)', () => {
    it('sends the token and nothing else, no x-catalog', async () => {
      await authFetch('/api/trainee/dashboard?userId=u1', {
        cache: 'no-store',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/trainee/dashboard?userId=u1');
      expect(init.cache).toBe('no-store');
      expect([...sentHeaders().keys()]).toEqual(['authorization']);
      expect(sentHeaders().get('authorization')).toBe('Bearer tok-1');
    });

    it('does not delay the request', async () => {
      const waiting = authFetch('/api/x');
      await waiting;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps a header set by the caller', async () => {
      await authFetch('/api/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(sentHeaders().get('content-type')).toBe('application/json');
      expect(sentHeaders().has('x-catalog')).toBe(false);
    });
  });

  describe('a user with several occupations and a verified choice', () => {
    beforeEach(() => setCatalogSelection({ header: 'KFBM', pending: false }));

    it('sends x-catalog with the token', async () => {
      await authFetch('/api/trainer/courses');
      expect(sentHeaders().get('x-catalog')).toBe('KFBM');
      expect(sentHeaders().get('authorization')).toBe('Bearer tok-1');
    });

    it('sends it to a same-origin absolute URL', async () => {
      await authFetch(`${window.location.origin}/api/trainer/courses`);
      expect(sentHeaders().get('x-catalog')).toBe('KFBM');
    });

    it('sends it for a URL object and a Request of the same origin', async () => {
      await authFetch(new URL('/api/a', window.location.origin));
      expect(sentHeaders(0).get('x-catalog')).toBe('KFBM');
    });

    it('never sends it (nor the token) to another origin', async () => {
      await authFetch('https://example.org/api/trainer/courses', {
        headers: { Accept: 'application/json' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1].headers).toEqual({
        Accept: 'application/json',
      });
      expect(getSession).not.toHaveBeenCalled();
      await authFetch('//example.org/api/x');
      expect(fetchMock.mock.calls[1][1]).toEqual({});
    });

    it('keeps an x-catalog the caller set itself', async () => {
      await authFetch('/api/trainer/courses', {
        headers: { 'x-catalog': 'FIAE' },
      });
      expect(sentHeaders().get('x-catalog')).toBe('FIAE');
    });

    it('does not send it to the lookup of the occupations itself', async () => {
      await authFetch('/api/me/catalogs');
      expect(sentHeaders().has('x-catalog')).toBe(false);
      expect(sentHeaders().get('authorization')).toBe('Bearer tok-1');
      await authFetch('/api/me/catalogs?catalog=KFBM');
      expect(sentHeaders(1).has('x-catalog')).toBe(false);
    });

    it('still sends it to other /api/me routes', async () => {
      await authFetch('/api/me/other');
      expect(sentHeaders().get('x-catalog')).toBe('KFBM');
    });

    it('sends it without a token too (nobody signed in is not its business)', async () => {
      getSession.mockResolvedValue({ data: { session: null } });
      await authFetch('/api/trainer/courses');
      expect(sentHeaders().has('authorization')).toBe(false);
      expect(sentHeaders().get('x-catalog')).toBe('KFBM');
    });
  });

  describe('while the occupations are loading (a choice is stored)', () => {
    beforeEach(() => setCatalogSelection({ pending: true }));

    it('holds a request until the choice is verified, then sends it with the header', async () => {
      let sent = false;
      const request = authFetch('/api/trainer/courses').then(() => {
        sent = true;
      });
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(sent).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();

      setCatalogSelection({ header: 'KFBM', pending: false });
      await request;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentHeaders().get('x-catalog')).toBe('KFBM');
    });

    it('sends without a header when the check ends with a single occupation', async () => {
      const request = authFetch('/api/trainer/courses');
      setCatalogSelection({ header: null, pending: false });
      await request;
      expect(sentHeaders().has('x-catalog')).toBe(false);
    });

    it('does not hold the lookup of the occupations (it ends the pending state)', async () => {
      await authFetch('/api/me/catalogs');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not hold a request to another origin', async () => {
      await authFetch('https://example.org/x');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
