import { render, waitFor } from '@testing-library/react';
import { CatalogBranding } from '@/components/catalog/CatalogBranding';
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

function context(overrides: Partial<CatalogContextValue> = {}) {
  (useCatalog as jest.Mock).mockReturnValue({
    status: 'ready',
    catalogs: [],
    activeCode: 'FIAE',
    isMultiple: false,
    branding: DEFAULT_BRANDING,
    brandingApplied: false,
    selectCatalog: jest.fn(),
    ...overrides,
  });
}

const kfbm = (branding = {}) =>
  context({
    activeCode: 'KFBM',
    brandingApplied: true,
    branding: {
      title: 'KfBM Lernplattform',
      shortName: 'KfBM',
      accent: '#0f766e',
      ...branding,
    },
  });

const styleTag = () =>
  document.head.querySelector('style[data-catalog-branding]');

describe('CatalogBranding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.title = 'LFA Plattform';
    document.head
      .querySelectorAll('style[data-catalog-branding]')
      .forEach(node => node.remove());
  });

  it('changes nothing for FIAE: no style, same title', () => {
    context();
    render(<CatalogBranding />);
    expect(styleTag()).toBeNull();
    expect(document.title).toBe('LFA Plattform');
  });

  it('changes nothing for FIAE even if the branding object carries values', () => {
    context({
      brandingApplied: false,
      branding: { title: 'Other', shortName: 'X', accent: '#ff0000' },
    });
    render(<CatalogBranding />);
    expect(styleTag()).toBeNull();
    expect(document.title).toBe('LFA Plattform');
  });

  it('sets the accent for both themes and the title for another occupation', () => {
    kfbm();
    render(<CatalogBranding />);
    const css = styleTag()?.textContent ?? '';
    expect(css).toMatch(/^:root,\.dark\{--accent:\d+ \d+% \d+%;/);
    expect(css).toContain('.light{');
    expect(document.title).toBe('KfBM Lernplattform');
  });

  it('only writes the color rules, nothing from the branding text', () => {
    kfbm({ title: 'Büro (2025)', shortName: 'KfBM' });
    render(<CatalogBranding />);
    const css = styleTag()?.textContent ?? '';
    expect(css).not.toContain('Büro');
    expect(css).not.toContain('KfBM');
  });

  it('writes no style without an accent but still sets the title', () => {
    kfbm({ accent: null });
    render(<CatalogBranding />);
    expect(styleTag()).toBeNull();
    expect(document.title).toBe('KfBM Lernplattform');
  });

  it('leaves the title alone when the occupation has no own title', () => {
    kfbm({ title: 'LFA Plattform' });
    render(<CatalogBranding />);
    expect(document.title).toBe('LFA Plattform');
  });

  it('replaces the platform name inside a page specific title', () => {
    document.title = 'Dashboard | LFA Plattform';
    kfbm();
    render(<CatalogBranding />);
    expect(document.title).toBe('Dashboard | KfBM Lernplattform');
  });

  it('puts everything back when it goes away', () => {
    kfbm();
    const { unmount } = render(<CatalogBranding />);
    expect(styleTag()).not.toBeNull();
    unmount();
    expect(styleTag()).toBeNull();
    expect(document.title).toBe('LFA Plattform');
  });

  it('keeps one style tag when the accent changes', () => {
    kfbm();
    const { rerender } = render(<CatalogBranding />);
    kfbm({ accent: '#1d4ed8' });
    rerender(<CatalogBranding />);
    expect(
      document.head.querySelectorAll('style[data-catalog-branding]')
    ).toHaveLength(1);
    expect(styleTag()?.textContent).toContain('--accent');
  });

  it('applies the title again whenever the framework writes another one (navigation, late metadata)', async () => {
    kfbm();
    render(<CatalogBranding />);
    expect(document.title).toBe('KfBM Lernplattform');
    document.title = 'Kurse | LFA Plattform';
    await waitFor(() =>
      expect(document.title).toBe('Kurse | KfBM Lernplattform')
    );
    document.title = 'LFA Plattform';
    await waitFor(() => expect(document.title).toBe('KfBM Lernplattform'));
  });

  it('does not loop when the occupation title contains the platform name', async () => {
    kfbm({ title: 'LFA Plattform KfBM' });
    render(<CatalogBranding />);
    expect(document.title).toBe('LFA Plattform KfBM');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(document.title).toBe('LFA Plattform KfBM');
  });

  it('stops watching the title when it goes away', async () => {
    kfbm();
    const { unmount } = render(<CatalogBranding />);
    unmount();
    document.title = 'Kurse | LFA Plattform';
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(document.title).toBe('Kurse | LFA Plattform');
  });

  it('renders nothing itself', () => {
    kfbm();
    const { container } = render(<CatalogBranding />);
    expect(container).toBeEmptyDOMElement();
  });
});
