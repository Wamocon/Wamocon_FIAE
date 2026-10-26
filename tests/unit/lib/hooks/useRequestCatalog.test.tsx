import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authFetch } from '@/lib/authFetch';
import { useRequestCatalog } from '@/lib/hooks/useRequestCatalog';

jest.mock('@/lib/authFetch');

// The occupation the user chose in the switcher. Without a provider the real
// context is neutral (idle), which most tests below rely on.
const mockCatalog: { status: string; activeCode: string | null } = {
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

  describe('phase one of the occupation (phaseOneMonthsFor)', () => {
    const fiae = {
      code: 'FIAE',
      title: 'F',
      phaseMonths: { '3': [18, 18], '2': [12, 12] },
    };
    const kfbm = {
      code: 'KFBM',
      title: 'K',
      phaseMonths: { '3': [15, 21], '2': [10, 14] },
    };

    it('FIAE: 18 months, 12 shortened (the labels stay as before)', async () => {
      answer({ catalogs: [fiae], activeCode: 'FIAE' });
      const { result } = renderHook(() => useRequestCatalog('u1'), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.phaseOneMonthsFor(3)).toBe(18);
      expect(result.current.phaseOneMonthsFor(2)).toBe(12);
    });

    it('KfBM: 15 months, 10 shortened', async () => {
      answer({ catalogs: [kfbm], activeCode: 'KFBM' });
      const { result } = renderHook(() => useRequestCatalog('u1'), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.phaseOneMonthsFor(3)).toBe(15);
      expect(result.current.phaseOneMonthsFor(2)).toBe(10);
      expect(result.current.phaseOneMonthsFor(null)).toBe(15);
    });

    it('takes the plan of the active occupation, not of the first one', async () => {
      answer({ catalogs: [fiae, kfbm], activeCode: 'KFBM' });
      const { result } = renderHook(() => useRequestCatalog('u1'), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.phaseOneMonthsFor(3)).toBe(15);
    });

    it('takes the plan of the occupation chosen in the switcher', async () => {
      mockCatalog.status = 'ready';
      mockCatalog.activeCode = 'KFBM';
      answer({ catalogs: [fiae, kfbm], activeCode: 'FIAE' });
      const { result } = renderHook(() => useRequestCatalog('u1'), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.phaseOneMonthsFor(3)).toBe(15);
    });

    it('gives nothing without a phase plan in the answer (the previous lengths apply)', async () => {
      answer({ catalogs: [{ code: 'KFBM', title: 'K' }], activeCode: 'KFBM' });
      const { result } = renderHook(() => useRequestCatalog('u1'), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.phaseOneMonthsFor(3)).toBeUndefined();
    });

    it('gives nothing for an invalid phase plan', async () => {
      answer({
        catalogs: [
          { code: 'KFBM', title: 'K', phaseMonths: { '3': [15, 20] } },
        ],
        activeCode: 'KFBM',
      });
      const { result } = renderHook(() => useRequestCatalog('u1'), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.phaseOneMonthsFor(3)).toBeUndefined();
    });

    it('gives nothing when the occupation is not in the list', async () => {
      answer({ catalogs: [fiae], activeCode: 'KFBM' });
      const { result } = renderHook(() => useRequestCatalog('u1'), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.phaseOneMonthsFor(3)).toBeUndefined();
    });

    it('gives nothing when the lookup fails or is not done yet', async () => {
      answer({ error: 'Unauthorized' }, false, 401);
      const { result } = renderHook(() => useRequestCatalog('u1'), {
        wrapper: wrapper(),
      });
      expect(result.current.phaseOneMonthsFor(3)).toBeUndefined();
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.phaseOneMonthsFor(3)).toBeUndefined();
    });

    it('keeps the same function while the plan does not change', async () => {
      answer({ catalogs: [kfbm], activeCode: 'KFBM' });
      const { result, rerender } = renderHook(() => useRequestCatalog('u1'), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.ready).toBe(true));
      const first = result.current.phaseOneMonthsFor;
      rerender();
      expect(result.current.phaseOneMonthsFor).toBe(first);
    });
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
