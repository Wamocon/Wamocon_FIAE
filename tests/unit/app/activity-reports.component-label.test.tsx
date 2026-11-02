import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeActivityReportsPage from '@/app/trainee/activity-reports/page';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// The list of the components under "Neuer Nachweis" shows the label of a FIAE
// component (2.1, 2.2) under its title, not the database code. The code stays the
// key. Without a label (an old answer) the code is shown as before.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
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

const component = (over: Record<string, unknown>) => ({
  description: null,
  totalWeeks: 4,
  totalHours: 160,
  trainingYear: 1,
  ...over,
});

function api(components: unknown[]) {
  authFetchMock.mockImplementation(async input => {
    const url = String(input);
    if (url.startsWith('/api/me/catalogs'))
      return json({ catalogs: [], activeCode: 'FIAE' });
    if (url.startsWith('/api/training-components')) return json({ components });
    if (url.startsWith('/api/training-use-cases'))
      return json({ useCases: [] });
    if (url.startsWith('/api/activity-reports')) return json({ reports: [] });
    return json({});
  });
}

async function openCreateModal() {
  const user = userEvent.setup();
  renderWithProviders(<TraineeActivityReportsPage />);
  await user.click(
    await screen.findByRole('button', { name: /Neuer Nachweis/ })
  );
}

describe('trainee Ausbildungsnachweis: the label of a component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainee-1', role: 'trainee' },
      loading: false,
      refreshProfile: jest.fn(() => Promise.resolve()),
    });
  });

  it('shows 2.1 and 2.2 under the titles, not 2-P1 and 2-P2', async () => {
    api([
      component({
        id: 'a',
        code: '2-P1',
        label: '2.1',
        title: 'Informieren',
        orderIndex: 2,
      }),
      component({
        id: 'b',
        code: '2-P2',
        label: '2.2',
        title: 'Informieren (Vertiefung)',
        orderIndex: 13,
      }),
    ]);
    await openCreateModal();
    await waitFor(() =>
      expect(screen.getByText('2.1 • 160 Std gesamt')).toBeInTheDocument()
    );
    expect(screen.getByText('2.2 • 160 Std gesamt')).toBeInTheDocument();
    expect(screen.queryByText(/2-P1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2-P2/)).not.toBeInTheDocument();
  });

  it('shows the code when the answer has no label', async () => {
    api([component({ id: 'a', code: 'K1', title: 'Thema', orderIndex: 1 })]);
    await openCreateModal();
    await waitFor(() =>
      expect(screen.getByText('K1 • 160 Std gesamt')).toBeInTheDocument()
    );
  });
});
