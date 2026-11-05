import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import TraineeDashboard from '@/components/dashboard/TraineeDashboard';
import TrainerDashboard from '@/components/dashboard/TrainerDashboard';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useCatalog } from '@/contexts/CatalogContext';

// Both dashboards, for every occupation, name the occupation the same way.

jest.mock('@/contexts/AuthContext');
jest.mock('@/contexts/CatalogContext');
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('@/components/dashboard/DashboardCharts', () => ({
  ProgressTrendChart: () => <div />,
  ModuleProgressChart: () => <div />,
}));
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

const BRANDING = { title: 'LFA Plattform', shortName: null, accent: null };
const FIAE = {
  code: 'FIAE',
  title: 'Fachinformatiker/in Anwendungsentwicklung',
  branding: BRANDING,
  isActive: true,
};
const KFBM = {
  code: 'KFBM',
  title: 'Kaufmann/-frau für Büromanagement',
  branding: { title: 'KfBM', shortName: 'KfBM', accent: '#0f766e' },
  isActive: true,
};

function catalog(activeCode: 'FIAE' | 'KFBM') {
  (useCatalog as jest.Mock).mockReturnValue({
    status: 'ready',
    catalogs: [FIAE, KFBM],
    activeCode,
    isMultiple: true,
    tabs: [FIAE, KFBM],
    branding: BRANDING,
    brandingApplied: activeCode !== 'FIAE',
    inProvider: true,
  });
}

describe.each([
  ['TraineeDashboard', TraineeDashboard, 'TRAINEE'],
  ['TrainerDashboard', TrainerDashboard, 'TRAINER'],
])('%s names the occupation', (_name, Dashboard, role) => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn() });
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'u1' },
      profile: { id: 'p1', role },
    });
    global.fetch = jest.fn().mockImplementation(() => new Promise(() => {}));
  });

  it.each([
    ['FIAE', 'Fachinformatiker/in Anwendungsentwicklung'],
    ['KFBM', 'Kaufmann/-frau für Büromanagement'],
  ] as const)('for %s', async (code, title) => {
    catalog(code);
    renderWithProviders(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-occupation')).toHaveTextContent(
        title
      )
    );
  });
});
