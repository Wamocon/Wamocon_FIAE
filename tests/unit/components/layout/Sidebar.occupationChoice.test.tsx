import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { Sidebar } from '@/components/layout/Sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { useCatalog } from '@/contexts/CatalogContext';

jest.mock('@/contexts/AuthContext');
jest.mock('@/contexts/CatalogContext');

// The way back to the occupation choice (/berufswahl) is an entry of the user
// area of the sidebar, only for a user who has more than one occupation. For
// everyone else the sidebar stays as it was (Sidebar.test.tsx).

function renderFor(role: 'trainer' | 'trainee', isMultiple: boolean) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'p1', full_name: 'Test Person', role, avatar: null },
    signOut: jest.fn(),
    loading: false,
    subscriptionPlan: 'LIGHT',
    isAdmin: false,
    isPlatformOwner: false,
  });
  (useCatalog as jest.Mock).mockReturnValue({ isMultiple });
  return renderWithProviders(
    <Sidebar
      currentView="dashboard"
      isOpen
      onToggle={() => {}}
      userRole={role}
    />
  );
}

describe('Sidebar and the occupation choice', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['trainer', 'trainee'] as const)(
    '%s with several occupations: a link to the occupation choice above the sign out',
    role => {
      renderFor(role, true);
      const link = screen.getByRole('link', { name: 'Berufswahl' });
      expect(link).toHaveAttribute('href', '/berufswahl');
      const signOut = screen.getByRole('button', { name: 'Abmelden' });
      // the link comes before the sign out button in the reading order
      expect(
        link.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  );

  it.each(['trainer', 'trainee'] as const)(
    '%s with one occupation: no link (nothing changes)',
    role => {
      renderFor(role, false);
      expect(screen.queryByRole('link', { name: 'Berufswahl' })).toBeNull();
      expect(
        screen
          .getAllByRole('link')
          .some(a => a.getAttribute('href') === '/berufswahl')
      ).toBe(false);
    }
  );
});
