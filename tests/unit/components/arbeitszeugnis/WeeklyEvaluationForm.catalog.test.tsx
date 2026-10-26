import { waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import WeeklyEvaluationForm from '@/components/arbeitszeugnis/WeeklyEvaluationForm';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function json(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function render() {
  return renderWithProviders(
    <WeeklyEvaluationForm weekNumber={10} year={2027} ausbildungsjahr={1} />
  );
}

/** URLs the form asked from the public use case list. */
function useCaseUrls(fetchMock: jest.Mock) {
  return fetchMock.mock.calls
    .map(call => String(call[0]))
    .filter(url => url.startsWith('/api/training-use-cases'));
}

describe('WeeklyEvaluationForm use cases per occupation', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainee-1', role: 'trainee' },
    });
    fetchMock = jest.fn(async () => json({ useCases: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('FIAE: asks /api/training-use-cases exactly as before', async () => {
    authFetchMock.mockResolvedValue(
      json({ catalogs: [{ code: 'FIAE', title: 'F' }], activeCode: 'FIAE' })
    );
    render();
    await waitFor(() => expect(useCaseUrls(fetchMock)).toHaveLength(1));
    expect(useCaseUrls(fetchMock)).toEqual(['/api/training-use-cases']);
    expect(fetchMock).toHaveBeenCalledWith('/api/training-use-cases', {
      cache: 'no-store',
    });
  });

  it('KfBM: asks /api/training-use-cases?catalog=KFBM', async () => {
    authFetchMock.mockResolvedValue(
      json({ catalogs: [{ code: 'KFBM', title: 'K' }], activeCode: 'KFBM' })
    );
    render();
    await waitFor(() => expect(useCaseUrls(fetchMock)).toHaveLength(1));
    expect(useCaseUrls(fetchMock)).toEqual([
      '/api/training-use-cases?catalog=KFBM',
    ]);
  });

  it('does not ask for the list before the occupation is known', async () => {
    authFetchMock.mockReturnValue(new Promise(() => undefined));
    render();
    // let effects and the pending lookup settle
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(useCaseUrls(fetchMock)).toHaveLength(0);
  });

  it('asks for the plain list when the lookup of the occupation fails', async () => {
    authFetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
      text: async () => 'Forbidden',
    } as Response);
    render();
    await waitFor(() => expect(useCaseUrls(fetchMock)).toHaveLength(1));
    expect(useCaseUrls(fetchMock)).toEqual(['/api/training-use-cases']);
  });
});
