import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import TraineeDashboard from '@/components/dashboard/TraineeDashboard';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useCatalog } from '@/contexts/CatalogContext';

// The locally cached dashboard (instant first paint) belongs to ONE training. A
// trainee in two trainings must not see the dashboard of the other one while
// the data of the chosen training loads.

jest.mock('@/contexts/AuthContext');
jest.mock('@/contexts/CatalogContext');
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  PieChart: () => <div />,
  Pie: () => null,
  Cell: () => null,
  Tooltip: () => null,
  BarChart: () => <div />,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  RadarChart: () => <div />,
  PolarGrid: () => null,
  PolarAngleAxis: () => null,
  PolarRadiusAxis: () => null,
  Radar: () => null,
  LineChart: () => <div />,
  Line: () => null,
  AreaChart: () => <div />,
  Area: () => null,
}));

const KEY = 'wmc_trainee_dashboard_cache_p1_3';
const data = (title: string) => ({
  modules: [],
  nextItem: {
    lessonId: 'l1',
    lessonTitle: title,
    moduleTitle: 'Module 1',
    estimatedTime: '10m',
  },
  weeklyProgress: [],
  skillRadar: [],
  achievements: [],
  deadlines: [],
});
const seed = (key: string, title: string) =>
  localStorage.setItem(
    key,
    JSON.stringify({ data: data(title), timestamp: Date.now() })
  );

describe('TraineeDashboard local cache per training', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (useRouter as jest.Mock).mockReturnValue({
      push: jest.fn(),
      replace: jest.fn(),
    });
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'p1',
        role: 'trainee',
        birth_date: '2005-05-05',
        ausbildung_duration_years: 3,
      },
    });
    // the request never answers: only the placeholder can be on screen
    global.fetch = jest.fn(() => new Promise(() => {})) as any;
  });

  it('a trainee with several trainings gets the cached dashboard of the active one', async () => {
    seed(`${KEY}_FIAE`, 'FIAE Lektion');
    seed(`${KEY}_KFBM`, 'KfBM Lektion');
    (useCatalog as jest.Mock).mockReturnValue({
      activeCode: 'KFBM',
      isMultiple: true,
    });
    renderWithProviders(<TraineeDashboard />);
    await waitFor(() =>
      expect(screen.getByText('KfBM Lektion')).toBeInTheDocument()
    );
    expect(screen.queryByText('FIAE Lektion')).toBeNull();
  });

  it('never shows the cache of the other training', async () => {
    seed(`${KEY}_FIAE`, 'FIAE Lektion');
    (useCatalog as jest.Mock).mockReturnValue({
      activeCode: 'KFBM',
      isMultiple: true,
    });
    renderWithProviders(<TraineeDashboard />);
    await waitFor(() =>
      expect(screen.getByText('Mein Lernpfad')).toBeInTheDocument()
    );
    expect(screen.queryByText('FIAE Lektion')).toBeNull();
  });

  it('a trainee with one training keeps the cache key of before', async () => {
    seed(KEY, 'Alte Lektion');
    (useCatalog as jest.Mock).mockReturnValue({
      activeCode: 'FIAE',
      isMultiple: false,
    });
    renderWithProviders(<TraineeDashboard />);
    await waitFor(() =>
      expect(screen.getByText('Alte Lektion')).toBeInTheDocument()
    );
  });
});
