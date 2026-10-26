import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeEvaluationsPage from '@/app/trainee/evaluations/page';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// The weekly evaluation names the phase of the trainee. The page works it out
// from the start of the training and the phase plan of the occupation (KfBM
// S4b): month 16 is phase 2 for KfBM (15 months), phase 1 for FIAE (18 months)
// and phase 2 for a shortened FIAE (12 months).

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');

const formProps = jest.fn();
jest.mock('@/components/arbeitszeugnis/WeeklyEvaluationForm', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    formProps(props);
    return <div data-testid="weekly-form" />;
  },
}));
jest.mock('@/components/arbeitszeugnis/AnnualPerformanceOverview', () => ({
  __esModule: true,
  default: () => null,
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

const FIAE = {
  code: 'FIAE',
  title: 'Fachinformatiker',
  phaseMonths: { '3': [18, 18], '2': [12, 12] },
};
const KFBM = {
  code: 'KFBM',
  title: 'Büromanagement',
  phaseMonths: { '3': [15, 21], '2': [10, 14] },
};

// The start of the training, 16 whole months ago
function sixteenMonthsAgo() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 16, 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01`;
}

async function phaseOfNewForm(
  entry: typeof FIAE | typeof KFBM,
  durationYears: number,
  meOk = true
) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: {
      id: 'trainee-1',
      role: 'trainee',
      training_start_date: sixteenMonthsAgo(),
      ausbildung_duration_years: durationYears,
    },
    loading: false,
  });
  authFetchMock.mockImplementation(async input => {
    const url = String(input);
    if (url.startsWith('/api/me/catalogs')) {
      return meOk
        ? json({ catalogs: [entry], activeCode: entry.code })
        : json({ error: 'Forbidden' }, false, 403);
    }
    return json({ evaluations: [] });
  });
  renderWithProviders(<TraineeEvaluationsPage />);
  // wait for the occupation: the plan arrives with the answer of the server
  await screen.findByText(/Keine Bewertungen/);
  await waitFor(() =>
    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/me/catalogs',
      expect.anything()
    )
  );
  await new Promise(resolve => setTimeout(resolve, 20));
  fireEvent.click(screen.getByText(/Neue Bewertung/));
  await screen.findByTestId('weekly-form');
  const calls = formProps.mock.calls;
  return calls[calls.length - 1][0].ausbildungsjahr;
}

describe('trainee evaluations page: phase of the new evaluation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('KfBM: month 16 is phase 2', async () => {
    expect(await phaseOfNewForm(KFBM, 3)).toBe(2);
  });

  it('FIAE: month 16 is still phase 1', async () => {
    expect(await phaseOfNewForm(FIAE, 3)).toBe(1);
  });

  it('FIAE shortened (2 years): month 16 is phase 2', async () => {
    expect(await phaseOfNewForm(FIAE, 2)).toBe(2);
  });

  it('keeps the previous 18 months when the occupation lookup fails', async () => {
    expect(await phaseOfNewForm(KFBM, 3, false)).toBe(1);
  });
});
