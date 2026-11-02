import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import TrainerDashboard from '@/components/dashboard/TrainerDashboard';
import { useAuth } from '@/contexts/AuthContext';
import { useCatalog } from '@/contexts/CatalogContext';
import { useRouter } from 'next/navigation';

// WMCNL-2981: the locally cached dashboard (instant first paint) belongs to ONE
// occupation. A trainer with two occupations must not see the numbers of the
// other tab while the data of the chosen tab loads.

jest.mock('@/contexts/AuthContext');
jest.mock('@/contexts/CatalogContext');
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('@/components/dashboard/DashboardCharts', () => ({
  ProgressTrendChart: () => <div />,
  ModuleProgressChart: () => <div />,
}));

const KEY = 'wmc_trainer_dashboard_cache_v4';
const data = (count: number) => ({
  trainees: Array(count).fill({ id: 't', full_name: 'T', progress: 0 }),
  counts: {
    activeTrainees: count,
    pendingReviews: 0,
    pendingQuiz: 0,
    pendingUseCases: 0,
  },
  charts: { progressTrend: [], moduleProgress: [] },
});
const seed = (key: string, count: number) =>
  localStorage.setItem(
    key,
    JSON.stringify({ data: data(count), timestamp: Date.now() })
  );

describe('TrainerDashboard local cache per occupation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn() });
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'u1' },
      profile: { id: 'p1', role: 'TRAINER' },
    });
    // the request never answers: only the placeholder can be on screen
    global.fetch = jest.fn(() => new Promise(() => {})) as any;
  });

  it('shows the cached dashboard of the active occupation', async () => {
    seed(`${KEY}_FIAE`, 11);
    seed(`${KEY}_KFBM`, 22);
    (useCatalog as jest.Mock).mockReturnValue({
      activeCode: 'KFBM',
      isMultiple: true,
    });
    renderWithProviders(<TrainerDashboard />);
    await waitFor(() => expect(screen.getByText('(22)')).toBeInTheDocument());
    expect(screen.queryByText('(11)')).toBeNull();
  });

  it('never shows the cache of the other occupation', async () => {
    seed(`${KEY}_FIAE`, 11);
    (useCatalog as jest.Mock).mockReturnValue({
      activeCode: 'KFBM',
      isMultiple: true,
    });
    renderWithProviders(<TrainerDashboard />);
    await waitFor(() =>
      expect(screen.getByText('Aktion erforderlich')).toBeInTheDocument()
    );
    expect(screen.queryByText('(11)')).toBeNull();
  });

  it('a trainer with one occupation keeps the cache key of before', async () => {
    seed(KEY, 33);
    (useCatalog as jest.Mock).mockReturnValue({
      activeCode: 'FIAE',
      isMultiple: false,
    });
    renderWithProviders(<TrainerDashboard />);
    await waitFor(() => expect(screen.getByText('(33)')).toBeInTheDocument());
  });
});
