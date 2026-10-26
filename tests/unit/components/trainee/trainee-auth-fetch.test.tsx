import { waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { LernfeldNotes } from '@/components/school/LernfeldNotes';
import SubLesson from '@/components/learning/SubLesson';
import { consumePrefetch, prefetch } from '@/lib/prefetch';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { resetCatalogSelection } from '@/lib/catalog/selection';

// The routes of a trainee answer only with the bearer token of the session.
// These tests run the real authFetch with a mocked Supabase session and a
// mocked window.fetch and check that the calls of the components and of the
// prefetch carry the Authorization header. authFetchCallers.test.ts checks
// every call site in the source, this one checks the behaviour.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() } },
}));

const getSession = supabase.auth.getSession as jest.Mock;
const fetchMock = jest.fn();

function json(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 401, json: async () => body } as Response;
}

/** The authorization header of the call to a url. */
function authorizationOf(urlPart: string): string | null {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes(urlPart)
  );
  if (!call) throw new Error(`no request to ${urlPart}`);
  return new Headers(call[1]?.headers).get('authorization');
}

describe('browser calls of the trainee routes carry the session token', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    resetCatalogSelection();
    getSession.mockResolvedValue({
      data: { session: { access_token: 'tok-1' } },
    });
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainee-1', role: 'trainee' },
      loading: false,
    });
    fetchMock.mockImplementation(async (url: string) =>
      json(
        String(url).includes('lernfelder') ? { lernfelder: [] } : { notes: [] }
      )
    );
    global.fetch = fetchMock as any;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('LernfeldNotes loads the notes with the token', async () => {
    renderWithProviders(<LernfeldNotes />);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/api/trainee/knowledge-notes')
        )
      ).toBe(true)
    );
    expect(authorizationOf('/api/trainee/knowledge-notes')).toBe(
      'Bearer tok-1'
    );
    expect(authorizationOf('/api/trainee/school/lernfelder')).toBe(
      'Bearer tok-1'
    );
  });

  it('SubLesson reads the lesson progress with the token', async () => {
    fetchMock.mockImplementation(async () => json({ completedIds: [] }));
    renderWithProviders(
      <SubLesson
        data={{
          id: 's1',
          title: 'Part',
          content: 'x',
          duration_minutes: 5,
          lesson: { id: 'l1', title: 'Lesson' },
        }}
      />
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/api/trainee/lesson-progress')
        )
      ).toBe(true)
    );
    expect(authorizationOf('/api/trainee/lesson-progress')).toBe(
      'Bearer tok-1'
    );
  });

  describe('prefetch of the dashboard (starts before the page mounts)', () => {
    const url = '/api/trainee/dashboard?userId=trainee-1';

    it('sends the token and hands the answer to the page', async () => {
      fetchMock.mockImplementation(async () => json({ modules: [] }));
      prefetch(url);
      const data = await consumePrefetch(url);
      expect(data).toEqual({ modules: [] });
      expect(authorizationOf('/api/trainee/dashboard')).toBe('Bearer tok-1');
    });

    it('without a session the server answers 401, the prefetch yields null and the page falls back to its own request', async () => {
      getSession.mockResolvedValue({ data: { session: null } });
      fetchMock.mockImplementation(async () => json({ error: 'x' }, false));
      const other = '/api/trainee/dashboard?userId=trainee-2';
      prefetch(other);
      const data = await consumePrefetch(other);
      // useApiQuery treats null like "no prefetch" and calls authFetch itself
      expect(data).toBeNull();
      expect(authorizationOf('/api/trainee/dashboard')).toBeNull();
    });
  });
});
