import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authFetch } from '@/lib/authFetch';
import { useRequestCatalog } from '@/lib/hooks/useRequestCatalog';

jest.mock('@/lib/authFetch');

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
  beforeEach(() => jest.clearAllMocks());

  it('is not ready before the own occupations are known', async () => {
    authFetchMock.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useRequestCatalog(), {
      wrapper: wrapper(),
    });
    expect(result.current.ready).toBe(false);
  });

  it('does not ask while it is disabled (nobody signed in yet)', async () => {
    const { result } = renderHook(() => useRequestCatalog(false), {
      wrapper: wrapper(),
    });
    expect(result.current.ready).toBe(false);
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it('asks /api/me/catalogs without a catalog parameter', async () => {
    answer({ catalogs: [{ code: 'FIAE', title: 'F' }], activeCode: 'FIAE' });
    const { result } = renderHook(() => useRequestCatalog(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(authFetchMock.mock.calls[0][0]).toBe('/api/me/catalogs');
  });

  it('FIAE: urls stay exactly as they are', async () => {
    answer({ catalogs: [{ code: 'FIAE', title: 'F' }], activeCode: 'FIAE' });
    const { result } = renderHook(() => useRequestCatalog(), {
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
    const { result } = renderHook(() => useRequestCatalog(), {
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
    const { result } = renderHook(() => useRequestCatalog(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.catalog).toBeUndefined();
    expect(result.current.withCatalog('/api/x')).toBe('/api/x');
  });

  it('is ready with the plain urls when the lookup fails', async () => {
    answer({ error: 'Unauthorized' }, false, 401);
    const { result } = renderHook(() => useRequestCatalog(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.catalog).toBeUndefined();
    expect(result.current.withCatalog('/api/x')).toBe('/api/x');
  });

  it('keeps the same function while the occupation does not change', async () => {
    answer({ catalogs: [{ code: 'KFBM', title: 'K' }], activeCode: 'KFBM' });
    const { result, rerender } = renderHook(() => useRequestCatalog(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    const first = result.current.withCatalog;
    rerender();
    expect(result.current.withCatalog).toBe(first);
  });
});
