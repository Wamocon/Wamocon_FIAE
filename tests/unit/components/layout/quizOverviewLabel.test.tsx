import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { useAuth } from '@/contexts/AuthContext';
import { useBreadcrumbs } from '@/contexts/BreadcrumbContext';
import { useCatalog } from '@/contexts/CatalogContext';

// WMCNL-3026: the page of the quizzes only lists them for a trainer, so the menu
// entry and the title in the header say "Quiz-Übersicht". The platform admin,
// who can create and edit, keeps "Quiz-Verwaltung".

jest.mock('@/contexts/AuthContext');
jest.mock('@/contexts/BreadcrumbContext');
jest.mock('@/contexts/CatalogContext');
jest.mock('@/components/ui/NotificationsBell', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/ui/LanguageToggle', () => ({
  LanguageToggle: () => null,
}));

const TRAINER = { role: 'trainer', isPlatformOwner: true };
const PLATFORM_ADMIN = { role: 'super_admin', isPlatformOwner: true };

function signIn({
  role,
  isPlatformOwner,
}: {
  role: string;
  isPlatformOwner: boolean;
}) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'p1', full_name: 'Test Person', role, avatar: null },
    signOut: jest.fn(),
    loading: false,
    subscriptionPlan: 'LIGHT',
    isPlatformOwner,
  });
  (useCatalog as jest.Mock).mockReturnValue({
    status: 'ready',
    catalogs: [],
    activeCode: 'FIAE',
    isMultiple: false,
    branding: { title: 'LFA Plattform', shortName: null, accent: null },
    brandingApplied: false,
    selectCatalog: jest.fn(),
  });
}

const sidebarLink = () =>
  screen
    .getAllByRole('link')
    .find(a => a.getAttribute('href') === '/trainer/quiz-management');

function renderHeader(href: string, label: string) {
  (useBreadcrumbs as jest.Mock).mockReturnValue({
    breadcrumbs: [{ href, label }],
  });
  return renderWithProviders(
    <Header
      onGoBack={jest.fn()}
      onToggleSidebar={jest.fn()}
      sidebarOpen={false}
      userRole="trainer"
    />
  );
}

describe('menu entry of the quizzes (WMCNL-3026)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is "Quiz-Übersicht" for a trainer', () => {
    signIn(TRAINER);
    renderWithProviders(
      <Sidebar
        currentView="dashboard"
        isOpen
        onToggle={() => {}}
        userRole="trainer"
      />
    );
    expect(sidebarLink()).toHaveTextContent('Quiz-Übersicht');
  });

  it('stays "Quiz-Verwaltung" for the platform admin', () => {
    signIn(PLATFORM_ADMIN);
    renderWithProviders(
      <Sidebar
        currentView="dashboard"
        isOpen
        onToggle={() => {}}
        userRole="trainer"
      />
    );
    expect(sidebarLink()).toHaveTextContent('Quiz-Verwaltung');
  });

  it('is "Quiz overview" in English', () => {
    window.localStorage.setItem('language', 'en');
    signIn(TRAINER);
    renderWithProviders(
      <Sidebar
        currentView="dashboard"
        isOpen
        onToggle={() => {}}
        userRole="trainer"
      />
    );
    expect(sidebarLink()).toHaveTextContent('Quiz overview');
    window.localStorage.removeItem('language');
  });
});

describe('title in the header (WMCNL-3026)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('says "Quiz-Übersicht" for a trainer on the page of the quizzes', () => {
    signIn(TRAINER);
    renderHeader('/trainer/quiz-management', 'Quiz-Verwaltung');
    expect(
      screen.getByRole('heading', { name: 'Quiz-Übersicht' })
    ).toBeInTheDocument();
  });

  it('says "Quiz-Verwaltung" for the platform admin', () => {
    signIn(PLATFORM_ADMIN);
    renderHeader('/trainer/quiz-management', 'Quiz-Verwaltung');
    expect(
      screen.getByRole('heading', { name: 'Quiz-Verwaltung' })
    ).toBeInTheDocument();
  });

  it('leaves the title of every other page alone', () => {
    signIn(TRAINER);
    renderHeader('/trainer/trainees', 'Auszubildende');
    expect(
      screen.getByRole('heading', { name: 'Auszubildende' })
    ).toBeInTheDocument();
  });
});
