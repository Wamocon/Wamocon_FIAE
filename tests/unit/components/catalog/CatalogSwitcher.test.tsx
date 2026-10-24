import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { CatalogSwitcher } from '@/components/catalog/CatalogSwitcher';
import { CatalogBadge } from '@/components/catalog/CatalogBadge';
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
};
const KFBM = {
  code: 'KFBM',
  title: 'Kaufmann/-frau für Büromanagement',
  branding: {
    title: 'KfBM Lernplattform',
    shortName: 'KfBM',
    accent: '#0f766e',
  },
};

const selectCatalog = jest.fn();

function context(overrides: Partial<CatalogContextValue> = {}) {
  const value: CatalogContextValue = {
    status: 'ready',
    catalogs: [FIAE, KFBM],
    activeCode: 'FIAE',
    isMultiple: true,
    branding: DEFAULT_BRANDING,
    brandingApplied: false,
    selectCatalog,
    ...overrides,
  };
  (useCatalog as jest.Mock).mockReturnValue(value);
}

describe('CatalogSwitcher', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['no occupation', { catalogs: [], activeCode: null, isMultiple: false }],
    [
      'a single occupation (every FIAE user today)',
      { catalogs: [FIAE], activeCode: 'FIAE', isMultiple: false },
    ],
  ])('renders nothing for %s', (_label, overrides) => {
    context(overrides);
    const { container } = renderWithProviders(<CatalogSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a labelled select with the occupations of the user', () => {
    context();
    renderWithProviders(<CatalogSwitcher />);
    const select = screen.getByRole('combobox', { name: 'Beruf wählen' });
    expect(select).toHaveValue('FIAE');
    expect(
      screen.getAllByRole('option').map(option => option.textContent)
    ).toEqual(['FIAE', 'KfBM']);
  });

  it('names the current occupation and the reload for assistive technology', () => {
    context({ activeCode: 'KFBM' });
    renderWithProviders(<CatalogSwitcher />);
    const select = screen.getByRole('combobox', { name: 'Beruf wählen' });
    expect(select).toHaveValue('KFBM');
    expect(select).toHaveAccessibleDescription(
      'Aktueller Beruf: Kaufmann/-frau für Büromanagement. Beim Wechsel wird die Seite neu geladen.'
    );
  });

  it('switches with the mouse or the picker', async () => {
    context();
    renderWithProviders(<CatalogSwitcher />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'KFBM');
    expect(selectCatalog).toHaveBeenCalledTimes(1);
    expect(selectCatalog).toHaveBeenCalledWith('KFBM');
  });

  it('can be reached with the Tab key (a native select works with the keyboard)', async () => {
    context();
    renderWithProviders(<CatalogSwitcher />);
    const select = screen.getByRole('combobox');
    expect(select.tagName).toBe('SELECT');
    await userEvent.tab();
    expect(select).toHaveFocus();
  });

  it('is not part of the tab order twice and is not disabled', () => {
    context();
    renderWithProviders(<CatalogSwitcher />);
    const select = screen.getByRole('combobox');
    expect(select).not.toBeDisabled();
    expect(select).not.toHaveAttribute('tabindex');
  });

  it('shows the code when an occupation has no short name', () => {
    context({
      catalogs: [FIAE, { ...KFBM, branding: DEFAULT_BRANDING }],
    });
    renderWithProviders(<CatalogSwitcher />);
    expect(
      screen.getAllByRole('option').map(option => option.textContent)
    ).toEqual(['FIAE', 'KFBM']);
  });

  it('sits inside the header from the small breakpoint up', () => {
    context();
    const { container } = renderWithProviders(<CatalogSwitcher />);
    expect(container.firstElementChild).toHaveClass('hidden', 'sm:block');
  });

  it('is usable on a phone: its own row below the header, nothing is pushed out of the header', () => {
    context();
    const { container } = renderWithProviders(
      <CatalogSwitcher placement="strip" />
    );
    expect(container.firstElementChild).toHaveClass('sm:hidden');
    const select = screen.getByRole('combobox', { name: 'Beruf wählen' });
    expect(select.className).toMatch(/max-w-/);
    expect(select.className).toMatch(/truncate/);
  });

  it('renders nothing in the strip either for a single occupation', () => {
    context({ catalogs: [FIAE], activeCode: 'FIAE', isMultiple: false });
    const { container } = renderWithProviders(
      <CatalogSwitcher placement="strip" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('switches from the strip as well', async () => {
    context();
    renderWithProviders(<CatalogSwitcher placement="strip" />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'KFBM');
    expect(selectCatalog).toHaveBeenCalledWith('KFBM');
  });
});

describe('CatalogBadge', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows nothing for FIAE (the look stays as it is)', () => {
    context({
      catalogs: [FIAE],
      activeCode: 'FIAE',
      isMultiple: false,
      brandingApplied: false,
    });
    const { container } = renderWithProviders(<CatalogBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing when the switcher already shows the occupation', () => {
    context({ activeCode: 'KFBM', brandingApplied: true });
    const { container } = renderWithProviders(<CatalogBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing before the occupations are known', () => {
    context({
      status: 'loading',
      catalogs: [],
      activeCode: null,
      isMultiple: false,
    });
    const { container } = renderWithProviders(<CatalogBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the single occupation with its short name for a non-FIAE user', () => {
    context({
      catalogs: [KFBM],
      activeCode: 'KFBM',
      isMultiple: false,
      brandingApplied: true,
      branding: KFBM.branding,
    });
    renderWithProviders(<CatalogBadge />);
    expect(screen.getByText('KfBM')).toBeInTheDocument();
    expect(
      screen.getByText('Beruf: Kaufmann/-frau für Büromanagement')
    ).toHaveClass('sr-only');
  });

  it('sits inside the header from the small breakpoint up, and in its own row on a phone', () => {
    context({
      catalogs: [KFBM],
      activeCode: 'KFBM',
      isMultiple: false,
      brandingApplied: true,
      branding: KFBM.branding,
    });
    const bar = renderWithProviders(<CatalogBadge />);
    expect(bar.container.firstElementChild).toHaveClass('hidden', 'sm:block');
    const strip = renderWithProviders(<CatalogBadge placement="strip" />);
    expect(strip.container.firstElementChild).toHaveClass('sm:hidden');
  });

  it('falls back to the code without a short name', () => {
    context({
      catalogs: [{ ...KFBM, branding: DEFAULT_BRANDING }],
      activeCode: 'KFBM',
      isMultiple: false,
      brandingApplied: true,
      branding: DEFAULT_BRANDING,
    });
    renderWithProviders(<CatalogBadge />);
    expect(screen.getByText('KFBM')).toBeInTheDocument();
  });
});
