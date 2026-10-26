import { waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeActivityReportsPage from '@/app/trainee/activity-reports/page';
import TrainerActivityReportsPage from '@/app/trainer/activity-reports/page';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// The Ausbildungsnachweis pages ask the public lists for the occupation of the
// user (KfBM S4): ?catalog= only for an occupation other than FIAE, so the
// requests of a FIAE user stay as they were.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function json(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/** Answer every API call; only the own occupations differ per test. */
function api(activeCode: string | null, meOk = true) {
  authFetchMock.mockImplementation(async input => {
    const url = String(input);
    if (url.startsWith('/api/me/catalogs')) {
      return meOk
        ? json({ catalogs: [], activeCode })
        : json({ error: 'Forbidden' }, false, 403);
    }
    if (url.startsWith('/api/training-components')) {
      return json({ components: [] });
    }
    if (url.startsWith('/api/training-use-cases')) {
      return json({ useCases: [] });
    }
    if (url.startsWith('/api/trainer/activity-reports')) {
      return json({ reports: [] });
    }
    if (url.startsWith('/api/trainer/trainees')) {
      return json({ trainees: [] });
    }
    if (url.startsWith('/api/activity-reports')) {
      return json({ reports: [] });
    }
    return json({});
  });
}

/** URLs the page asked from the two public lists. */
function listUrls() {
  return authFetchMock.mock.calls
    .map(call => String(call[0]))
    .filter(
      url =>
        url.startsWith('/api/training-components') ||
        url.startsWith('/api/training-use-cases')
    )
    .sort();
}

describe('trainee Ausbildungsnachweis page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainee-1', role: 'trainee' },
      loading: false,
      refreshProfile: jest.fn(() => Promise.resolve()),
    });
  });

  it('FIAE: asks the lists exactly as before', async () => {
    api('FIAE');
    renderWithProviders(<TraineeActivityReportsPage />);
    await waitFor(() => expect(listUrls()).toHaveLength(2));
    expect(listUrls()).toEqual([
      '/api/training-components',
      '/api/training-use-cases',
    ]);
  });

  it('KfBM: asks the lists of KfBM', async () => {
    api('KFBM');
    renderWithProviders(<TraineeActivityReportsPage />);
    await waitFor(() => expect(listUrls()).toHaveLength(2));
    expect(listUrls()).toEqual([
      '/api/training-components?catalog=KFBM',
      '/api/training-use-cases?catalog=KFBM',
    ]);
  });

  it('asks the plain lists when the occupation lookup fails', async () => {
    api(null, false);
    renderWithProviders(<TraineeActivityReportsPage />);
    await waitFor(() => expect(listUrls()).toHaveLength(2));
    expect(listUrls()).toEqual([
      '/api/training-components',
      '/api/training-use-cases',
    ]);
  });

  it('does not ask the lists before the occupation is known', async () => {
    authFetchMock.mockImplementation(async input =>
      String(input).startsWith('/api/me/catalogs')
        ? new Promise<Response>(() => undefined)
        : json({})
    );
    renderWithProviders(<TraineeActivityReportsPage />);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(listUrls()).toHaveLength(0);
  });
});

describe('trainer Ausbildungsnachweis page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainer-1', role: 'trainer' },
      loading: false,
    });
  });

  it('FIAE: asks the lists exactly as before', async () => {
    api('FIAE');
    renderWithProviders(<TrainerActivityReportsPage />);
    await waitFor(() => expect(listUrls()).toHaveLength(2));
    expect(listUrls()).toEqual([
      '/api/training-components',
      '/api/training-use-cases',
    ]);
    expect(authFetchMock).toHaveBeenCalledWith('/api/training-components', {
      cache: 'no-store',
    });
  });

  it('KfBM: asks the lists of KfBM', async () => {
    api('KFBM');
    renderWithProviders(<TrainerActivityReportsPage />);
    await waitFor(() => expect(listUrls()).toHaveLength(2));
    expect(listUrls()).toEqual([
      '/api/training-components?catalog=KFBM',
      '/api/training-use-cases?catalog=KFBM',
    ]);
  });

  it('loads the data once the occupation is known, not twice', async () => {
    api('KFBM');
    renderWithProviders(<TrainerActivityReportsPage />);
    await waitFor(() => expect(listUrls()).toHaveLength(2));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(listUrls()).toHaveLength(2);
  });

  it('does not ask the lists before the occupation is known', async () => {
    authFetchMock.mockImplementation(async input =>
      String(input).startsWith('/api/me/catalogs')
        ? new Promise<Response>(() => undefined)
        : json({})
    );
    renderWithProviders(<TrainerActivityReportsPage />);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(listUrls()).toHaveLength(0);
  });
});
