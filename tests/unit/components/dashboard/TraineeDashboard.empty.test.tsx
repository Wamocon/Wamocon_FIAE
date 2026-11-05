import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import TraineeDashboard from '@/components/dashboard/TraineeDashboard';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useCatalog } from '@/contexts/CatalogContext';

// Dashboard of the trainee without content:
// WMCNL-2953 "Weitermachen" says that no question set is assigned instead of
// "Weiter lernen / Fragenkomplex: -", with no Play button that does nothing;
// WMCNL-2954 German text for the empty filter and a hint instead of empty
// boxes for the skills and the progress of the question sets.

jest.mock('@/contexts/AuthContext');
jest.mock('@/contexts/CatalogContext');
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
// the charts of the page are lazy (next/dynamic), jest.setup renders them as nothing

const push = jest.fn();

function cache(data: Record<string, unknown>) {
  localStorage.setItem(
    'wmc_trainee_dashboard_cache_p1_3',
    JSON.stringify({
      timestamp: Date.now(),
      data: {
        modules: [],
        nextItem: null,
        weeklyProgress: [],
        skillRadar: [],
        achievements: [],
        deadlines: [],
        ...data,
      },
    })
  );
}

describe('TraineeDashboard without content', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (useRouter as jest.Mock).mockReturnValue({ push, replace: jest.fn() });
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
  });

  it('says that no question set is assigned, without Play button or empty clock (WMCNL-2953)', async () => {
    cache({});
    renderWithProviders(<TraineeDashboard />);
    // in the card "Weitermachen" and in the empty learning path
    expect(
      (await screen.findAllByText('Noch keine Fragenkomplexe zugewiesen'))
        .length
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('WEITERMACHEN')).toBeInTheDocument();
    expect(screen.queryByText('Weiter lernen')).not.toBeInTheDocument();
    expect(screen.queryByText(/Fragenkomplex:/)).not.toBeInTheDocument();
    expect(document.querySelector('.lucide-play')).toBeNull();
    expect(document.querySelector('.lucide-clock')).toBeNull();
  });

  it('keeps the card with the Play button when there is a next step (WMCNL-2953)', async () => {
    cache({
      modules: [{ id: 'm1', title: 'Netzwerke', progress: 10 }],
      nextItem: {
        lessonId: 'l1',
        lessonTitle: 'Subnetting',
        moduleTitle: 'Netzwerke',
        estimatedTime: '2 days',
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<TraineeDashboard />);
    const title = await screen.findByText('Subnetting');
    expect(document.querySelector('.lucide-play')).not.toBeNull();
    await user.click(title);
    expect(push).toHaveBeenCalledWith('/trainee/enablers/l1');
  });

  it('does not claim "no question sets" when only the next step is missing', async () => {
    cache({ modules: [{ id: 'm1', title: 'Netzwerke', progress: 100 }] });
    renderWithProviders(<TraineeDashboard />);
    expect(
      await screen.findByText('Aktuell gibt es nichts zum Weitermachen')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Noch keine Fragenkomplexe zugewiesen')
    ).not.toBeInTheDocument();
  });

  it('gives hints instead of empty boxes and no English text (WMCNL-2954)', async () => {
    cache({});
    renderWithProviders(<TraineeDashboard />);
    expect(
      await screen.findByText('Noch keine Fähigkeiten erfasst')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Noch kein Fortschritt vorhanden')
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('No modules found');
  });

  it('says in German that the filter has no question sets (WMCNL-2954)', async () => {
    cache({ modules: [{ id: 'm1', title: 'Netzwerke', progress: 10 }] });
    const user = userEvent.setup();
    renderWithProviders(<TraineeDashboard />);
    await user.click(
      await screen.findByRole('button', { name: 'Abgeschlossen' })
    );
    expect(
      await screen.findByText('Für diesen Filter gibt es keine Fragenkomplexe.')
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('No modules found');
  });

  it('shows no hint where there is data (WMCNL-2954)', async () => {
    cache({
      modules: [{ id: 'm1', title: 'Netzwerke', progress: 10 }],
      skillRadar: [{ skill: 'Auftragsbearbeitung durchführen', value: 60 }],
    });
    renderWithProviders(<TraineeDashboard />);
    await screen.findByText('Auftragsbearbeitung durchführen');
    expect(
      screen.queryByText('Noch keine Fähigkeiten erfasst')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Noch kein Fortschritt vorhanden')
    ).not.toBeInTheDocument();
  });
});
