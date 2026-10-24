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
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'u1', role: 'trainer' },
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
    ...catalogState,
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

describe('Header with the occupation switcher', () => {
  it('is unchanged for a user with a single occupation (FIAE regression)', () => {
    const { container } = render({});
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/catalog-badge/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-tour^="header-catalog"]')).toBeNull();
    // the header is the only thing rendered, no extra row
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe('HEADER');
  });

  it('shows the switcher in the header and, for a phone, in a row below it', () => {
    const { container } = render({ catalogs: [FIAE, KFBM], isMultiple: true });
    expect(
      screen.getAllByRole('combobox', { name: 'Beruf wählen' })
    ).toHaveLength(2);
    expect(
      container.querySelector('header [data-tour="header-catalog"]')
    ).not.toBeNull();
    const strip = container.querySelector('[data-tour="header-catalog-strip"]');
    expect(strip).not.toBeNull();
    // the row sits after the header, not inside it
    expect(strip?.parentElement).toBe(container);
    expect(strip?.previousElementSibling?.tagName).toBe('HEADER');
    expect(screen.queryByTestId(/catalog-badge/)).not.toBeInTheDocument();
  });

  it('shows the badge for a user whose only occupation is not FIAE', () => {
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
