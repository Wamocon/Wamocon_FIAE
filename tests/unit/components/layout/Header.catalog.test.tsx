import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { Header } from '@/components/layout/Header';
import { useAuth } from '@/contexts/AuthContext';
import { useBreadcrumbs } from '@/contexts/BreadcrumbContext';
import { useCatalog } from '@/contexts/CatalogContext';

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

const DEFAULT_BRANDING = {
  title: 'LFA Plattform',
  shortName: null,
  accent: null,
};
const FIAE = { code: 'FIAE', title: 'FIAE', branding: DEFAULT_BRANDING };
const KFBM = {
  code: 'KFBM',
  title: 'KfBM',
  branding: { title: 'KfBM', shortName: 'KfBM', accent: '#0f766e' },
};

function render(catalogState: Record<string, unknown>) {
  const { profileRole = 'trainer', ...rest } = catalogState as Record<
    string,
    any
  >;
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'u1', role: profileRole },
    subscriptionPlan: null,
    isPlatformOwner: true,
  });
  (useBreadcrumbs as jest.Mock).mockReturnValue({ breadcrumbs: [] });
  (useCatalog as jest.Mock).mockReturnValue({
    status: 'ready',
    catalogs: [FIAE],
    activeCode: 'FIAE',
    isMultiple: false,
    branding: DEFAULT_BRANDING,
    brandingApplied: false,
    selectCatalog: jest.fn(),
    ...rest,
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

describe('Header and the occupation', () => {
  it('is unchanged for a user with a single occupation (FIAE regression)', () => {
    const { container } = render({});
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/catalog-badge/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-tour^="header-catalog"]')).toBeNull();
    // the header is the only thing rendered, no extra row
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe('HEADER');
  });

  it.each(['trainer', 'trainee', 'admin', 'super_admin'])(
    'has no occupation switcher for %s with several occupations (the pages have tabs)',
    role => {
      const { container } = render({
        catalogs: [FIAE, KFBM],
        isMultiple: true,
        tabs: role === 'trainee' ? [] : [FIAE, KFBM],
        profileRole: role,
      });
      // not at the top right, not in a row below the header on a phone
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Wechseln' })
      ).not.toBeInTheDocument();
      expect(
        container.querySelector('[data-tour^="header-catalog"]')
      ).toBeNull();
      expect(container.children).toHaveLength(1);
      expect(container.firstElementChild?.tagName).toBe('HEADER');
    }
  );

  it('keeps language, theme and the other header controls', () => {
    render({ catalogs: [FIAE, KFBM], isMultiple: true });
    expect(
      screen.getByRole('button', { name: 'Toggle sidebar' })
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-tour="header-settings"]')
    ).not.toBeNull();
  });

  it('shows the badge for a user who works in an occupation other than FIAE (one or several)', () => {
    render({
      catalogs: [KFBM],
      activeCode: 'KFBM',
      brandingApplied: true,
      branding: KFBM.branding,
    });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByTestId('catalog-badge-bar')).toHaveTextContent('KfBM');
    expect(screen.getByTestId('catalog-badge-strip')).toHaveTextContent('KfBM');
  });
});
