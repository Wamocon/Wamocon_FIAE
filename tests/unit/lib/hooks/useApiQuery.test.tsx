import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiQueryKey, useApiQuery } from '@/lib/hooks/useApiQuery';
import { authFetch } from '@/lib/authFetch';
import { consumePrefetch } from '@/lib/prefetch';
import {
  resetCatalogSelection,
  setCatalogSelection,
} from '@/lib/catalog/selection';

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('@/lib/prefetch', () => ({ consumePrefetch: jest.fn() }));

const authFetchMock = authFetch as jest.Mock;
const consumePrefetchMock = consumePrefetch as jest.Mock;

function ok(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('useApiQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    resetCatalogSelection();
    consumePrefetchMock.mockReturnValue(null);
  });

  describe('a user with a single occupation (FIAE regression)', () => {
    it('keeps the query key [url], so cache, invalidation and prefetch work as before', async () => {
      authFetchMock.mockImplementation(() => ok({ n: 1 }));
      const { client, wrapper } = setup();
      const { result } = renderHook(
        () => useApiQuery<{ n: number }>('/api/a'),
        {
          wrapper,
        }
      );
      await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
      expect(
        client
          .getQueryCache()
          .getAll()
          .map(q => q.queryKey)
      ).toEqual([['/api/a']]);
      expect(apiQueryKey('/api/a')).toEqual(['/api/a']);
      expect(authFetchMock).toHaveBeenCalledWith('/api/a', {
        cache: 'no-store',
      });
    });

    it('stays disabled without an url', () => {
      const { client, wrapper } = setup();
      const { result } = renderHook(() => useApiQuery<unknown>(null), {
        wrapper,
      });
      expect(result.current.fetchStatus).toBe('idle');
      expect(authFetchMock).not.toHaveBeenCalled();
      expect(client.getQueryCache().getAll()[0].queryKey).toEqual([
        '__disabled__',
      ]);
    });

    it('lets the caller switch the query off', () => {
      const { wrapper } = setup();
      const { result } = renderHook(
        () => useApiQuery<unknown>('/api/a', { enabled: false }),
        { wrapper }
      );
      expect(result.current.fetchStatus).toBe('idle');
      expect(authFetchMock).not.toHaveBeenCalled();
    });

    it('reports a failed request with status and text', async () => {
      authFetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      });
      const { wrapper } = setup();
      const { result } = renderHook(() => useApiQuery<unknown>('/api/a'), {
        wrapper,
      });
      await waitFor(() => expect(result.current.error).toBeTruthy());
      expect(result.current.error?.message).toBe('API 403: Forbidden');
    });

    it('consumes a prefetched response when asked to', async () => {
      consumePrefetchMock.mockReturnValue(Promise.resolve({ n: 9 }));
      const { wrapper } = setup();
      const { result } = renderHook(
        () => useApiQuery<{ n: number }>('/api/a', { usePrefetch: true }),
        { wrapper }
      );
      await waitFor(() => expect(result.current.data).toEqual({ n: 9 }));
      expect(authFetchMock).not.toHaveBeenCalled();
    });
  });

  describe('a user with several occupations', () => {
    it('puts the occupation into the query key', async () => {
      setCatalogSelection({ header: 'KFBM', pending: false });
      authFetchMock.mockImplementation(() => ok({ n: 2 }));
      const { client, wrapper } = setup();
      const { result } = renderHook(
        () => useApiQuery<{ n: number }>('/api/a'),
        {
          wrapper,
        }
      );
      await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
      expect(
        client
          .getQueryCache()
          .getAll()
          .map(q => q.queryKey)
      ).toEqual([['/api/a', { catalog: 'KFBM' }]]);
      expect(apiQueryKey('/api/a')).toEqual(['/api/a', { catalog: 'KFBM' }]);
    });

    it('never serves the data of one occupation for another', async () => {
      authFetchMock.mockImplementation(() =>
        ok({ for: (global as any).__catalog })
      );
      const { client, wrapper } = setup();

      (global as any).__catalog = 'FIAE';
      setCatalogSelection({ header: 'FIAE', pending: false });
      const { result } = renderHook(
        () => useApiQuery<{ for: string }>('/api/a'),
        {
          wrapper,
        }
      );
      await waitFor(() => expect(result.current.data).toEqual({ for: 'FIAE' }));

      (global as any).__catalog = 'KFBM';
      act(() => setCatalogSelection({ header: 'KFBM', pending: false }));
      // the key changed: no data of the other occupation, a new request
      await waitFor(() => expect(result.current.data).toEqual({ for: 'KFBM' }));
      expect(authFetchMock).toHaveBeenCalledTimes(2);
      expect(client.getQueryCache().getAll()).toHaveLength(2);

      // back to the first occupation: its own entry, not the other one's
      (global as any).__catalog = 'unused';
      act(() => setCatalogSelection({ header: 'FIAE', pending: false }));
      await waitFor(() => expect(result.current.data).toEqual({ for: 'FIAE' }));
      delete (global as any).__catalog;
    });

    it('ignores a prefetched response, which may have started in another occupation', async () => {
      setCatalogSelection({ header: 'KFBM', pending: false });
      consumePrefetchMock.mockReturnValue(Promise.resolve({ n: 9 }));
      authFetchMock.mockImplementation(() => ok({ n: 2 }));
      const { wrapper } = setup();
      const { result } = renderHook(
        () => useApiQuery<{ n: number }>('/api/a', { usePrefetch: true }),
        { wrapper }
      );
      await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
      expect(consumePrefetchMock).not.toHaveBeenCalled();
    });

    it('is still found by invalidating with the plain url (prefix match)', async () => {
      setCatalogSelection({ header: 'KFBM', pending: false });
      authFetchMock.mockImplementation(() => ok({ n: 1 }));
      const { client, wrapper } = setup();
      const { result } = renderHook(
        () => useApiQuery<{ n: number }>('/api/a'),
        {
          wrapper,
        }
      );
      await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
      await act(async () => {
        await client.invalidateQueries({ queryKey: ['/api/a'] });
      });
      expect(authFetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('while the occupations are loading (a choice is stored)', () => {
    it('does not start before the choice is verified, then asks with the right key', async () => {
      setCatalogSelection({ pending: true });
      authFetchMock.mockImplementation(() => ok({ n: 3 }));
      const { client, wrapper } = setup();
      const { result } = renderHook(
        () => useApiQuery<{ n: number }>('/api/a'),
        {
          wrapper,
        }
      );
      expect(result.current.fetchStatus).toBe('idle');
      expect(authFetchMock).not.toHaveBeenCalled();

      act(() => setCatalogSelection({ header: 'KFBM', pending: false }));
      await waitFor(() => expect(result.current.data).toEqual({ n: 3 }));
      expect(authFetchMock).toHaveBeenCalledTimes(1);
      expect(
        client
          .getQueryCache()
          .getAll()
          .filter(q => q.state.data !== undefined)
          .map(q => q.queryKey)
      ).toEqual([['/api/a', { catalog: 'KFBM' }]]);
    });

    it('starts as before when the check ends with a single occupation', async () => {
      setCatalogSelection({ pending: true });
      authFetchMock.mockImplementation(() => ok({ n: 4 }));
      const { wrapper } = setup();
      const { result } = renderHook(
        () => useApiQuery<{ n: number }>('/api/a'),
        {
          wrapper,
        }
      );
      act(() => setCatalogSelection({ header: null, pending: false }));
      await waitFor(() => expect(result.current.data).toEqual({ n: 4 }));
    });

    it('also holds a query whose enabled option is a function', async () => {
      setCatalogSelection({ pending: true });
      authFetchMock.mockImplementation(() => ok({ n: 5 }));
      const { wrapper } = setup();
      const { result } = renderHook(
        () => useApiQuery<{ n: number }>('/api/a', { enabled: () => true }),
        { wrapper }
      );
      expect(result.current.fetchStatus).toBe('idle');
      act(() => setCatalogSelection({ pending: false }));
      await waitFor(() => expect(result.current.data).toEqual({ n: 5 }));
    });
  });
});
