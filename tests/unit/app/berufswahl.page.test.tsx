import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import BerufswahlPage from '@/app/berufswahl/page';
import { useAuth } from '@/contexts/AuthContext';

jest.mock('@/contexts/AuthContext');

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace }),
}));
jest.mock('@/components/catalog/CatalogTiles', () => ({
  CatalogTiles: () => <div data-testid="tiles" />,
}));
jest.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/ui/LanguageToggle', () => ({
  LanguageToggle: () => null,
}));

const signOut = jest.fn();

function authState(overrides: Record<string, unknown> = {}) {
  (useAuth as jest.Mock).mockReturnValue({
    user: { id: 'u1', email: 'u1@example.com' },
    profile: { id: 'u1', role: 'trainer', full_name: 'Tina Trainer' },
    loading: false,
    signOut,
    ...overrides,
  });
}

describe('/berufswahl', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the title, the tiles and who is signed in', () => {
    authState();
    renderWithProviders(<BerufswahlPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Beruf wählen' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('tiles')).toBeInTheDocument();
    expect(screen.getByText('Angemeldet als Tina Trainer')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('lets the person sign out (wrong account)', async () => {
    authState();
    const user = userEvent.setup();
    renderWithProviders(<BerufswahlPage />);
    await user.click(screen.getByRole('button', { name: 'Abmelden' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('sends a visitor who is not signed in to the login', () => {
    authState({ user: null, profile: null });
    renderWithProviders(<BerufswahlPage />);
    expect(replace).toHaveBeenCalledWith('/login');
    expect(screen.queryByTestId('tiles')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('waits while the sign in state is still being determined', () => {
    authState({ user: null, profile: null, loading: true });
    renderWithProviders(<BerufswahlPage />);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tiles')).toBeNull();
    expect(screen.getByText('Lädt...')).toBeInTheDocument();
  });

  it('waits for the profile of a signed in user without redirecting', () => {
    authState({ profile: null });
    renderWithProviders(<BerufswahlPage />);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tiles')).toBeNull();
    expect(screen.getByText('Lädt...')).toBeInTheDocument();
  });

  it('falls back to the e-mail address when the profile has no name', () => {
    authState({
      profile: { id: 'u1', role: 'trainer', full_name: '' },
    });
    renderWithProviders(<BerufswahlPage />);
    expect(
      screen.getByText('Angemeldet als u1@example.com')
    ).toBeInTheDocument();
  });
});
