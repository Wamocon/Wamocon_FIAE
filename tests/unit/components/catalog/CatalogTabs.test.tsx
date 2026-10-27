import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { CatalogTabs } from '@/components/catalog/CatalogTabs';
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
  branding: {
    title: 'KfBM Lernplattform',
    shortName: 'KfBM',
    accent: '#0f766e',
  },
  isActive: true,
};
const ELEK = {
  code: 'ELEK',
  title: 'Elektroniker/in',
  branding: DEFAULT_BRANDING,
  isActive: true,
};

const selectTab = jest.fn();

function context(overrides: Partial<CatalogContextValue> = {}) {
  const value: CatalogContextValue = {
    status: 'ready',
    catalogs: [FIAE, KFBM],
    activeCode: 'FIAE',
    isMultiple: true,
    tabs: [FIAE, KFBM],
    selectTab,
    epoch: 0,
    branding: DEFAULT_BRANDING,
    brandingApplied: false,
    selectCatalog: jest.fn(),
    inProvider: true,
    ...overrides,
  };
  (useCatalog as jest.Mock).mockReturnValue(value);
}

describe('CatalogTabs', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['no tabs (single occupation, trainee)', { tabs: [] }],
    ['one tab', { tabs: [FIAE] }],
    ['an unknown active occupation', { activeCode: null }],
  ])('renders nothing for %s', (_label, overrides) => {
    context(overrides);
    const { container } = renderWithProviders(<CatalogTabs />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a labelled tablist with one tab per occupation and the active one selected', () => {
    context({ activeCode: 'KFBM' });
    renderWithProviders(<CatalogTabs />);
    expect(
      screen.getByRole('tablist', { name: 'Ausbildung wählen' })
    ).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent)).toEqual(['FIAE', 'KfBM']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('title', KFBM.title);
  });

  it('has a roving tab index: only the selected tab is in the tab order', () => {
    context({ activeCode: 'KFBM' });
    renderWithProviders(<CatalogTabs />);
    const [first, second] = screen.getAllByRole('tab');
    expect(first).toHaveAttribute('tabindex', '-1');
    expect(second).toHaveAttribute('tabindex', '0');
  });

  it('chooses an occupation with a click', async () => {
    context();
    renderWithProviders(<CatalogTabs />);
    await userEvent.click(screen.getByRole('tab', { name: 'KfBM' }));
    expect(selectTab).toHaveBeenCalledWith('KFBM');
  });

  describe('keyboard (manual activation)', () => {
    it('moves the focus with the arrow keys, wraps around, and does not choose', async () => {
      context({ tabs: [FIAE, KFBM, ELEK], catalogs: [FIAE, KFBM, ELEK] });
      renderWithProviders(<CatalogTabs />);
      const [fiae, kfbm, elek] = screen.getAllByRole('tab');
      await userEvent.tab();
      expect(fiae).toHaveFocus();
      await userEvent.keyboard('{ArrowRight}');
      expect(kfbm).toHaveFocus();
      await userEvent.keyboard('{ArrowRight}{ArrowRight}');
      expect(fiae).toHaveFocus();
      await userEvent.keyboard('{ArrowLeft}');
      expect(elek).toHaveFocus();
      await userEvent.keyboard('{Home}');
      expect(fiae).toHaveFocus();
      await userEvent.keyboard('{End}');
      expect(elek).toHaveFocus();
      expect(selectTab).not.toHaveBeenCalled();
    });

    it('leaves Alt, Ctrl and Meta with the arrows to the browser (history)', async () => {
      context();
      renderWithProviders(<CatalogTabs />);
      await userEvent.tab();
      const [fiae] = screen.getAllByRole('tab');
      for (const modifier of ['Alt', 'Control', 'Meta']) {
        await userEvent.keyboard(`{${modifier}>}{ArrowRight}{/${modifier}}`);
        expect(fiae).toHaveFocus();
      }
    });

    it('chooses the focused tab with Enter and with Space', async () => {
      context();
      renderWithProviders(<CatalogTabs />);
      await userEvent.tab();
      await userEvent.keyboard('{ArrowRight}{Enter}');
      expect(selectTab).toHaveBeenCalledWith('KFBM');
      selectTab.mockClear();
      await userEvent.keyboard(' ');
      expect(selectTab).toHaveBeenCalledWith('KFBM');
    });
  });

  it('announces the shown training in a polite status', () => {
    context({ activeCode: 'KFBM' });
    renderWithProviders(<CatalogTabs />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Angezeigt wird: Kaufmann/-frau für Büromanagement'
    );
  });

  it('scrolls sideways on a narrow screen and does not widen the page', () => {
    context();
    const { container } = renderWithProviders(<CatalogTabs />);
    expect(container.firstElementChild).toHaveClass('overflow-x-auto');
    const tab = screen.getAllByRole('tab')[0];
    expect(tab).toHaveClass('shrink-0', 'whitespace-nowrap', 'min-h-11');
  });

  it('shows the code when an occupation has no short name', () => {
    context({ tabs: [FIAE, { ...KFBM, branding: DEFAULT_BRANDING }] });
    renderWithProviders(<CatalogTabs />);
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'FIAE',
      'KFBM',
    ]);
  });
});
