import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CatalogProvider, useCatalog } from '@/contexts/CatalogContext';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import { resetCatalogSelection } from '@/lib/catalog/selection';

// noCatalog: the server said the signed in trainee has no occupation to work
// in (403 with the code NO_CATALOG). Every other failure (a refused choice, a
// network error, 503) is only "status error" as before, so the trainee area
// shows the occupation notice only for the case it is meant for.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('@/lib/catalog/navigation', () => ({
  reloadPage: jest.fn(),
  navigateTo: jest.fn(),
}));

const authFetchMock = authFetch as jest.Mock;

function respond(body: unknown, status: number) {
  authFetchMock.mockImplementation(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    })
  );
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

describe('CatalogProvider noCatalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    resetCatalogSelection();
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'user-1' },
      loading: false,
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('is false for the neutral default value (no provider)', () => {
    const { result } = renderHook(() => useCatalog());
    expect(result.current.noCatalog).toBe(false);
  });

  it('is true when the server says no occupation is available', async () => {
    respond(
      { error: 'No training catalog available', code: 'NO_CATALOG' },
      403
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.noCatalog).toBe(true);
  });

  it.each([
    [403, { error: 'Training catalog not allowed' }],
    [403, { error: 'Forbidden' }],
    [503, { error: 'Catalog scope unavailable' }],
    [500, null],
  ])('stays false for %s %j', async (status, body) => {
    respond(body, status);
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.noCatalog).toBe(false);
  });

  it('stays false when the answer of a 403 is not readable', async () => {
    authFetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.reject(new Error('no json')),
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.noCatalog).toBe(false);
  });

  it('stays false for a user with an occupation', async () => {
    respond(
      {
        catalogs: [
          {
            code: 'FIAE',
            title: 'Fachinformatiker/in',
            branding: { title: 'LFA', shortName: null, accent: null },
          },
        ],
        activeCode: 'FIAE',
      },
      200
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.noCatalog).toBe(false);
  });

  it('goes back to false after a sign out', async () => {
    respond(
      { error: 'No training catalog available', code: 'NO_CATALOG' },
      403
    );
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.noCatalog).toBe(true));
    (useAuth as jest.Mock).mockReturnValue({ profile: null, loading: false });
    rerender();
    await waitFor(() => expect(result.current.noCatalog).toBe(false));
  });
});
