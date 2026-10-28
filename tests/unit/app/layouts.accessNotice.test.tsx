import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeLayout from '@/app/trainee/layout';
import TrainerLayout from '@/app/trainer/layout';
import { useAuth } from '@/contexts/AuthContext';
import { useCatalog } from '@/contexts/CatalogContext';

// The layouts of the trainee and the trainer area. Only a visitor who is not
// signed in goes to the login (with a reason, by replace, so the back button
// does not bring the loop back). Every other case that stops a signed in
// person is a page with a message, and the area behind it is never mounted:
// no pages, no requests, no data but the name.

jest.mock('@/contexts/AuthContext');
jest.mock('@/contexts/CatalogContext');
jest.mock('@/contexts/SidebarContext', () => ({
  useSidebar: () => ({ isOpen: false, toggle: jest.fn() }),
}));
const replace = jest.fn();
const push = jest.fn();
// like Next.js, the router object is the same on every render
const router = { push, replace };
jest.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/trainee/dashboard',
}));
jest.mock('@/components/layout/MainLayout', () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="main-layout">{children}</div>
  ),
}));
jest.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/ui/LanguageToggle', () => ({
  LanguageToggle: () => null,
}));

const signOut = jest.fn();
const refreshProfile = jest.fn();
const user = { id: 'u1', email: 'u1@example.com' };

function auth(overrides: Record<string, unknown> = {}) {
  (useAuth as jest.Mock).mockReturnValue({
    user,
    loading: false,
    signOut,
    refreshProfile,
    profile: {
      id: 'u1',
      email: 'u1@example.com',
      full_name: 'Neue Azubi',
      role: 'trainee',
      birth_date: '2005-05-05',
      isActive: true,
      trainerActivated: true,
    },
    ...overrides,
  });
}

function profile(extra: Record<string, unknown>) {
  return {
    id: 'u1',
    email: 'u1@example.com',
    full_name: 'Neue Azubi',
    role: 'trainee',
    birth_date: '2005-05-05',
    isActive: true,
    trainerActivated: true,
    ...extra,
  };
}

const Secret = () => <div data-testid="secret">Azubi-Daten</div>;

beforeEach(() => {
  jest.clearAllMocks();
  (useCatalog as jest.Mock).mockReturnValue({ noCatalog: false });
  auth();
});

describe('trainee layout', () => {
  const render = () =>
    renderWithProviders(
      <TraineeLayout>
        <Secret />
      </TraineeLayout>
    );

  it('shows the area to a released trainee', () => {
    render();
    expect(screen.getByTestId('main-layout')).toBeInTheDocument();
    expect(screen.getByTestId('secret')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the notice to a trainee who waits for the release, without a jump and without the area', () => {
    auth({ profile: profile({ trainerActivated: false }) });
    render();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Ihr Konto wartet auf die Freigabe',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ihr Konto wurde angelegt und wartet auf die Freigabe durch Ihren Ausbilder oder Administrator.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Angemeldet als Neue Azubi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeVisible();
    // nothing of the area, no jump anywhere
    expect(screen.queryByTestId('secret')).toBeNull();
    expect(screen.queryByTestId('main-layout')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows no e-mail address and no birth date prompt before the release', () => {
    auth({
      profile: profile({ trainerActivated: false, birth_date: null }),
    });
    render();
    expect(document.body.textContent).not.toMatch(/u1@example\.com/);
    expect(screen.queryByText('Geburtsdatum erforderlich')).toBeNull();
  });

  it('takes the area as soon as the release arrives', () => {
    auth({ profile: profile({ trainerActivated: false }) });
    const view = render();
    expect(screen.queryByTestId('secret')).toBeNull();
    auth();
    view.rerender(
      <TraineeLayout>
        <Secret />
      </TraineeLayout>
    );
    expect(screen.getByTestId('secret')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('a deactivated account gets its own notice', () => {
    auth({ profile: profile({ isActive: false }) });
    render();
    expect(
      screen.getByRole('heading', { name: 'Ihr Konto ist deaktiviert' })
    ).toBeInTheDocument();
    expect(screen.queryByTestId('secret')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('a deactivated organization gets its own notice', () => {
    auth({
      profile: profile({ organization: { isActive: false } }),
    });
    render();
    expect(
      screen.getByRole('heading', { name: 'Ihre Organisation ist deaktiviert' })
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('a trainer in the trainee area gets the wrong area notice with a link', () => {
    auth({ profile: profile({ role: 'trainer' }) });
    render();
    expect(
      screen.getByRole('heading', {
        name: 'Dieser Bereich ist für Auszubildende',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zum Ausbilderbereich' })
    ).toHaveAttribute('href', '/trainer/dashboard');
    expect(screen.queryByTestId('secret')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('a trainee without an occupation gets its own notice', () => {
    (useCatalog as jest.Mock).mockReturnValue({ noCatalog: true });
    render();
    expect(
      screen.getByRole('heading', { name: 'Kein Beruf zugeordnet' })
    ).toBeInTheDocument();
    expect(screen.queryByTestId('secret')).toBeNull();
  });

  it('only a visitor who is not signed in goes to the login, with the reason, by replace', () => {
    auth({ user: null, profile: null });
    render();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/login?reason=signin-required');
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByTestId('secret')).toBeNull();
  });

  it('waits while the sign in state is determined', () => {
    auth({ user: null, profile: null, loading: true });
    render();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('secret')).toBeNull();
    expect(screen.getByText('Lädt...')).toBeInTheDocument();
  });

  describe('a profile that does not arrive', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('shows the loading state first, then its own notice (no endless spinner, no jump)', () => {
      auth({ profile: null });
      render();
      expect(screen.getByText('Lädt...')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      act(() => {
        jest.advanceTimersByTime(1600);
      });
      expect(
        screen.getByRole('heading', {
          name: 'Ihr Profil konnte nicht geladen werden',
        })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Erneut prüfen' })
      ).toBeVisible();
      expect(replace).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    });
  });
});

describe('trainer layout', () => {
  const render = () =>
    renderWithProviders(
      <TrainerLayout>
        <Secret />
      </TrainerLayout>
    );
  const trainerProfile = (extra: Record<string, unknown> = {}) =>
    profile({ role: 'trainer', ...extra });

  it('shows the area to a trainer level account', () => {
    auth({ profile: trainerProfile() });
    render();
    expect(screen.getByTestId('secret')).toBeInTheDocument();
    auth({ profile: trainerProfile({ role: 'admin' }) });
    render();
    expect(replace).not.toHaveBeenCalled();
  });

  it('a trainee gets the wrong area notice with a link to the trainee area', () => {
    render();
    expect(
      screen.getByRole('heading', {
        name: 'Dieser Bereich ist für Ausbilder und Administratoren',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zum Azubi-Bereich' })
    ).toHaveAttribute('href', '/trainee/dashboard');
    expect(screen.queryByTestId('secret')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('a trainee who waits for the release is told so and learns nothing of the trainer area', () => {
    auth({ profile: profile({ trainerActivated: false }) });
    render();
    expect(
      screen.getByRole('heading', { name: 'Ihr Konto wartet auf die Freigabe' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByTestId('secret')).toBeNull();
  });

  it('a trainer level account with the flag false is not locked out (only trainees wait for a release)', () => {
    auth({ profile: trainerProfile({ trainerActivated: false }) });
    render();
    expect(screen.getByTestId('secret')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('a deactivated account and a deactivated organization have their own notices', () => {
    auth({ profile: trainerProfile({ isActive: false }) });
    const first = render();
    expect(
      screen.getByRole('heading', { name: 'Ihr Konto ist deaktiviert' })
    ).toBeInTheDocument();
    first.unmount();
    auth({
      profile: trainerProfile({ organization: { isActive: false } }),
    });
    render();
    expect(
      screen.getByRole('heading', { name: 'Ihre Organisation ist deaktiviert' })
    ).toBeInTheDocument();
  });

  it('only a visitor who is not signed in goes to the login, with the reason', () => {
    auth({ user: null, profile: null });
    render();
    expect(replace).toHaveBeenCalledWith('/login?reason=signin-required');
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ['manual', '/'],
    ['deactivated', '/login?reason=deactivated'],
    ['organization-deactivated', '/login?reason=organization-deactivated'],
  ])(
    'after a sign out (%s) it goes where the sign out went, not to a second place',
    (sessionEnd, target) => {
      auth({ user: null, profile: null, sessionEnd });
      render();
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith(target);
    }
  );

  it('shows its own notice when the profile does not arrive', () => {
    jest.useFakeTimers();
    auth({ profile: null });
    render();
    expect(screen.getByText('Lädt...')).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(
      screen.getByRole('heading', {
        name: 'Ihr Profil konnte nicht geladen werden',
      })
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
