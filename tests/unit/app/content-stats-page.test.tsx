import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import ContentStatsPage from '@/app/trainer/admin/content-stats/page';

const auth: { loading: boolean; profile: { role: string } | null } = {
  loading: false,
  profile: { role: 'ADMIN' },
};
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
jest.mock('@/components/admin/ContentStatsView', () => ({
  ContentStatsView: () => <p>Statistik</p>,
}));

const renderPage = () =>
  render(
    <LanguageProvider>
      <ContentStatsPage />
    </LanguageProvider>
  );

beforeEach(() => {
  auth.loading = false;
  auth.profile = { role: 'ADMIN' };
});

describe('content statistics page', () => {
  it.each(['SUPER_ADMIN', 'ADMIN', 'TEMP_ADMIN', 'admin'])(
    'shows the statistics to %s',
    role => {
      auth.profile = { role };
      renderPage();
      expect(screen.getByText('Statistik')).toBeInTheDocument();
    }
  );

  it.each(['TRAINER', 'TRAINEE', 'ROOT'])(
    'turns %s away and shows nothing of the page',
    role => {
      auth.profile = { role };
      renderPage();
      expect(screen.queryByText('Statistik')).toBeNull();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Zugriff verweigert'
      );
    }
  );

  it('turns away a visitor without a profile', () => {
    auth.profile = null;
    renderPage();
    expect(screen.queryByText('Statistik')).toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows only the spinner while the session loads', () => {
    auth.loading = true;
    auth.profile = null;
    renderPage();
    expect(screen.queryByText('Statistik')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
