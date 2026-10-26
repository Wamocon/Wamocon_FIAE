import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authFetch } from '@/lib/authFetch';
import { useRequestCatalog } from '@/lib/hooks/useRequestCatalog';

jest.mock('@/lib/authFetch');

// The occupation the user chose in the switcher. Without a provider the real
// context is neutral (idle), which most tests below rely on.
const mockCatalog: {
  status: string;
  activeCode: string | null;
  inProvider?: boolean;
} = {
  status: 'idle',
  activeCode: null,
};
jest.mock('@/contexts/CatalogContext', () => ({
  useCatalog: () => mockCatalog,
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function answer(body: unknown, ok = true, status = 200) {
  authFetchMock.mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useRequestCatalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCatalog.status = 'idle';
    mockCatalog.activeCode = null;
    delete mockCatalog.inProvider;
  });

  it('is not ready before the own occupations are known', async () => {
    authFetchMock.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useRequestCatalog('u1'), {
      wrapper: wrapper(),
    });
    expect(result.current.ready).toBe(false);
  });

  it('does not ask while nobody is signed in yet (no user id)', async () => {
    const { result } = renderHook(() => useRequestCatalog(null), {
      wrapper: wrapper(),
    });
    expect(result.current.ready).toBe(false);
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it('asks /api/me/catalogs without a catalog parameter', async () => {
    answer({ catalogs: [{ code: 'FIAE', title: 'F' }], activeCode: 'FIAE' });
    const { result } = renderHook(() => useRequestCatalog('u1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(authFetchMock.mock.calls[0][0]).toBe('/api/me/catalogs');
  });

  it('FIAE: urls stay exactly as they are', async () => {
    answer({ catalogs: [{ code: 'FIAE', title: 'F' }], activeCode: 'FIAE' });
    const { result } = renderHook(() => useRequestCatalog('u1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.catalog).toBe('FIAE');
    expect(result.current.withCatalog('/api/training-components')).toBe(
      '/api/training-components'
    );
  });

  it('KfBM: urls get ?catalog=KFBM', async () => {
    answer({ catalogs: [{ code: 'KFBM', title: 'K' }], activeCode: 'KFBM' });
    const { result } = renderHook(() => useRequestCatalog('u1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.catalog).toBe('KFBM');
    expect(result.current.withCatalog('/api/training-components')).toBe(
      '/api/training-components?catalog=KFBM'
    );
  });

  it('falls back to the plain urls when there is no active occupation', async () => {
    answer({ catalogs: [], activeCode: null });
    const { result } = renderHook(() => useRequestCatalog('u1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.catalog).toBeUndefined();
    expect(result.current.withCatalog('/api/x')).toBe('/api/x');
  });

  it('is ready with the plain urls when the lookup fails', async () => {
    answer({ error: 'Unauthorized' }, false, 401);
    const { result } = renderHook(() => useRequestCatalog('u1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.catalog).toBeUndefined();
    expect(result.current.withCatalog('/api/x')).toBe('/api/x');
  });

  it('asks again for another user in the same tab (no cache across users)', async () => {
    // Same QueryClient on purpose: the cache survives a sign-out in the browser
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const sameClient = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    answer({ catalogs: [{ code: 'FIAE', title: 'F' }], activeCode: 'FIAE' });
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string | null }) => useRequestCatalog(userId),
      { wrapper: sameClient, initialProps: { userId: 'user-a' } }
    );
    await waitFor(() => expect(result.current.catalog).toBe('FIAE'));

    // User A signs out, user B (KfBM) signs in within the stale time of five minutes
    rerender({ userId: null });
    answer({ catalogs: [{ code: 'KFBM', title: 'K' }], activeCode: 'KFBM' });
    rerender({ userId: 'user-b' });

    await waitFor(() => expect(result.current.catalog).toBe('KFBM'));
    expect(authFetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.withCatalog('/api/training-components')).toBe(
      '/api/training-components?catalog=KFBM'
    );
  });

  it('uses the occupation chosen in the switcher, not the server default', async () => {
    // A trainer with FIAE and KfBM chose KfBM. GET /api/me/catalogs is asked
    // without the header, so the server names its default (FIAE).
    mockCatalog.status = 'ready';
    mockCatalog.activeCode = 'KFBM';
    answer({
      catalogs: [
        { code: 'FIAE', title: 'F' },
        { code: 'KFBM', title: 'K' },
      ],
      activeCode: 'FIAE',
    });
    const { result } = renderHook(() => useRequestCatalog('u1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.catalog).toBe('KFBM');
    expect(result.current.withCatalog('/api/training-components')).toBe(
      '/api/training-components?catalog=KFBM'
    );
  });

  it('is not ready while the occupations are still being loaded', async () => {
    // The lookup of this hook may answer before the occupation context knows
    // the choice, the first request must not go out with the default.
    mockCatalog.status = 'loading';
    answer({ catalogs: [{ code: 'FIAE', title: 'F' }], activeCode: 'FIAE' });
    const { result } = renderHook(() => useRequestCatalog('u1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(result.current.ready).toBe(false);
  });

  describe('with the provider of the occupations mounted', () => {
    beforeEach(() => {
      mockCatalog.inProvider = true;
    });

    it('is not ready while the provider has not started yet (idle), also if the lookup of this hook is cached', async () => {
      // sign in again within the five minutes of the cache: the query of this
      // hook is answered at once, the provider has not loaded anything yet
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      client.setQueryData(['me-catalogs', 'u1'], {
        catalogs: [{ code: 'FIAE', title: 'F' }],
        activeCode: 'FIAE',
      });
      const cached = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      answer({ catalogs: [{ code: 'FIAE', title: 'F' }], activeCode: 'FIAE' });
      const { result, rerender } = renderHook(() => useRequestCatalog('u1'), {
        wrapper: cached,
      });
      expect(result.current.ready).toBe(false);
      mockCatalog.status = 'loading';
      rerender();
      expect(result.current.ready).toBe(false);
      mockCatalog.status = 'ready';
      mockCatalog.activeCode = 'KFBM';
      rerender();
      expect(result.current.ready).toBe(true);
      expect(result.current.catalog).toBe('KFBM');
    });

    it('is ready when the provider failed, the lookup of this hook answered', async () => {
      mockCatalog.status = 'error';
      answer({ catalogs: [{ code: 'FIAE', title: 'F' }], activeCode: 'FIAE' });
      const { result } = renderHook(() => useRequestCatalog('u1'), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.ready).toBe(true));
    });

    it('is ready for a FIAE user as soon as both have answered (nothing is waited for beyond that)', async () => {
      mockCatalog.status = 'ready';
      mockCatalog.activeCode = 'FIAE';
      answer({ catalogs: [{ code: 'FIAE', title: 'F' }], activeCode: 'FIAE' });
      const { result } = renderHook(() => useRequestCatalog('u1'), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.withCatalog('/api/x')).toBe('/api/x');
    });

    it('does not become ready without a user id', () => {
      mockCatalog.status = 'ready';
      const { result } = renderHook(() => useRequestCatalog(null), {
        wrapper: wrapper(),
      });
      expect(result.current.ready).toBe(false);
    });
  });

  it('falls back to the answer of the server when the context failed', async () => {
    mockCatalog.status = 'error';
    mockCatalog.activeCode = null;
    answer({ catalogs: [{ code: 'KFBM', title: 'K' }], activeCode: 'KFBM' });
    const { result } = renderHook(() => useRequestCatalog('u1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.catalog).toBe('KFBM');
  });

  it('keeps the same function while the occupation does not change', async () => {
    answer({ catalogs: [{ code: 'KFBM', title: 'K' }], activeCode: 'KFBM' });
    const { result, rerender } = renderHook(() => useRequestCatalog('u1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    const first = result.current.withCatalog;
    rerender();
    expect(result.current.withCatalog).toBe(first);
  });
});
