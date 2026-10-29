import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { DashboardOccupation } from '@/components/catalog/DashboardOccupation';
import {
  useCatalog,
  type CatalogContextValue,
} from '@/contexts/CatalogContext';

jest.mock('@/contexts/CatalogContext');

const DEFAULT_BRANDING = {
  title: 'LFA Plattform',
  shortName: null,
  accent: null,
};
const FIAE = {
  code: 'FIAE',
  title: 'Fachinformatiker/in Anwendungsentwicklung',
  branding: DEFAULT_BRANDING,
  isActive: true,
};
const KFBM = {
  code: 'KFBM',
  title: 'Kaufmann/-frau für Büromanagement',
  branding: { title: 'KfBM', shortName: 'KfBM', accent: '#0f766e' },
  isActive: true,
};

function context(overrides: Partial<CatalogContextValue> = {}) {
  (useCatalog as jest.Mock).mockReturnValue({
    status: 'ready',
    catalogs: [FIAE],
    activeCode: 'FIAE',
    isMultiple: false,
    tabs: [],
    branding: DEFAULT_BRANDING,
    brandingApplied: false,
    inProvider: true,
    ...overrides,
  });
}

describe('DashboardOccupation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('names the occupation on the FIAE dashboard', () => {
    context();
    renderWithProviders(<DashboardOccupation />);
    const label = screen.getByTestId('dashboard-occupation');
    expect(label).toHaveTextContent('Ausbildungsberuf');
    expect(label).toHaveTextContent(
      'Fachinformatiker/in Anwendungsentwicklung'
    );
  });

  it('names the occupation on the KfBM dashboard with the same markup', () => {
    context({
      catalogs: [FIAE, KFBM],
      activeCode: 'KFBM',
      isMultiple: true,
      brandingApplied: true,
    });
    renderWithProviders(<DashboardOccupation />);
    const label = screen.getByTestId('dashboard-occupation');
    expect(label).toHaveTextContent('Ausbildungsberuf');
    expect(label).toHaveTextContent('Kaufmann/-frau für Büromanagement');
    expect(label).not.toHaveTextContent('Fachinformatiker');
  });

  it('follows the occupation chosen in the tabs', () => {
    context({ catalogs: [FIAE, KFBM], activeCode: 'FIAE', isMultiple: true });
    const { rerender } = renderWithProviders(<DashboardOccupation />);
    expect(screen.getByTestId('dashboard-occupation')).toHaveTextContent(
      'Fachinformatiker'
    );
    context({ catalogs: [FIAE, KFBM], activeCode: 'KFBM', isMultiple: true });
    rerender(<DashboardOccupation />);
    expect(screen.getByTestId('dashboard-occupation')).toHaveTextContent(
      'Büromanagement'
    );
  });

  it.each([
    [
      'the list is not loaded yet',
      { status: 'loading', catalogs: [], activeCode: null },
    ],
    ['the lookup failed', { status: 'error', catalogs: [], activeCode: null }],
    [
      'no provider is mounted',
      { status: 'idle', catalogs: [], activeCode: null, inProvider: false },
    ],
    ['the active code is not in the list', { activeCode: 'ELEK' }],
  ])('renders nothing when %s', (_label, overrides) => {
    context(overrides as Partial<CatalogContextValue>);
    const { container } = renderWithProviders(<DashboardOccupation />);
    expect(container).toBeEmptyDOMElement();
  });
});
