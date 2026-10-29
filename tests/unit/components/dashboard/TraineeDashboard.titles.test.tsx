import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import TraineeDashboard from '@/components/dashboard/TraineeDashboard';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useCatalog } from '@/contexts/CatalogContext';

// KFB-1169: the names of the question sets (modules) were cut with "..." after
// 20 characters in the progress list, although there is room for the rest. The
// name stays whole in the lists. Only the axis of the bar chart (a rotated tick
// with little room) is shortened, and its tooltip carries the whole name.

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

const LONG =
  'Komponente 12 Betriebliche Prozesse und Verantwortung im Unternehmen';

describe('TraineeDashboard: names of question sets', () => {
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
    (useCatalog as jest.Mock).mockReturnValue({
      activeCode: 'FIAE',
      isMultiple: false,
    });
    // the request never answers: the cached dashboard is what is on screen
    global.fetch = jest.fn(() => new Promise(() => {})) as any;
    localStorage.setItem(
      'wmc_trainee_dashboard_cache_p1_3',
      JSON.stringify({
        timestamp: Date.now(),
        data: {
          modules: [{ id: 'm1', title: LONG, progress: 40 }],
          nextItem: null,
          weeklyProgress: [],
          skillRadar: [],
          achievements: [],
          deadlines: [],
        },
      })
    );
  });

  it('shows the whole name in the list, without "..."', async () => {
    renderWithProviders(<TraineeDashboard />);
    await waitFor(() =>
      expect(screen.getAllByText(LONG).length).toBeGreaterThan(0)
    );
    // the card and the compact progress list both carry the whole name
    expect(screen.getAllByText(LONG).length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).not.toContain('Komponente 12 Betrie...');
  });

  it('lets the name wrap instead of cutting it off with an ellipsis', async () => {
    renderWithProviders(<TraineeDashboard />);
    await waitFor(() =>
      expect(screen.getAllByText(LONG).length).toBeGreaterThan(0)
    );
    for (const node of screen.getAllByText(LONG)) {
      expect(node.className).not.toMatch(/\btruncate\b/);
      expect(node.className).not.toMatch(/\bline-clamp-/);
    }
  });
});
