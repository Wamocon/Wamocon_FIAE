import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { FlipbookViewer } from '@/components/ui/FlipbookViewer';

// Trainees must not download or save documents (WMCNL-2872, 2873, 2891). The viewer keeps
// its download buttons for trainers (exactly one download button: the toolbar of the
// browser's PDF viewer is off, it has a second one) and, for a caller that sets
// allowDownload to false, drops the download, the new tab with the raw file and the PDF
// viewer of the browser altogether. A trainee gets the reading view that draws the pages
// itself (SecurePdfViewer, loaded on demand), fed with the route of the document and not
// with an address of the file.

jest.mock('@/components/ui/SecurePdfViewer', () => ({
  __esModule: true,
  default: ({ src, title }: { src: string; title: string }) => (
    <div data-testid="secure-viewer" data-src={src} data-title={title} />
  ),
}));

// next/dynamic loads the component asynchronously: here it is the component itself
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => jest.requireMock('@/components/ui/SecurePdfViewer').default,
}));

const ROUTE = '/api/trainee/documents/d1/content';

const open = (
  props: Partial<React.ComponentProps<typeof FlipbookViewer>> = {}
) =>
  renderWithProviders(
    <FlipbookViewer
      title="Szenario"
      pdfUrl="https://files.example/doc.pdf"
      isOpen
      onClose={() => undefined}
      {...props}
    />
  );

describe('FlipbookViewer for trainers (download allowed)', () => {
  it('offers one download link and a new tab', () => {
    const { container } = open();
    expect(container.querySelectorAll('a[download]')).toHaveLength(1);
    expect(container.querySelector('a[target="_blank"]')).not.toBeNull();
  });

  it('hides the toolbar of the browser PDF viewer, so there is no second download button', () => {
    const { container } = open();
    const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
    expect(src).toContain('toolbar=0');
    expect(src).toContain('navpanes=0');
    expect(src).not.toContain('toolbar=1');
  });

  it('keeps the zoom controls of the header', () => {
    open();
    expect(screen.getByTitle('Vergrößern (+)')).toBeInTheDocument();
  });
});

describe('FlipbookViewer for trainees (allowDownload false)', () => {
  it('has no download link, no new tab and no link to a file', () => {
    const { container } = open({ allowDownload: false, pdfUrl: ROUTE });
    screen.getByTestId('secure-viewer');
    expect(container.querySelector('a[download]')).toBeNull();
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
    expect(container.querySelector('a[href]')).toBeNull();
    expect(container.innerHTML).not.toContain('files.example');
  });

  it('has no iframe: the PDF viewer of the browser is not used', () => {
    const { container } = open({ allowDownload: false, pdfUrl: ROUTE });
    screen.getByTestId('secure-viewer');
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('embed')).toBeNull();
    expect(container.querySelector('object')).toBeNull();
  });

  it('feeds the reading view with the route of the document', () => {
    open({ allowDownload: false, pdfUrl: ROUTE, title: 'Lehrtext' });
    const viewer = screen.getByTestId('secure-viewer');
    expect(viewer.getAttribute('data-src')).toBe(ROUTE);
    expect(viewer.getAttribute('data-title')).toBe('Lehrtext');
  });

  it('the reading view has its own zoom: the header has none', () => {
    open({ allowDownload: false, pdfUrl: ROUTE });
    screen.getByTestId('secure-viewer');
    expect(screen.queryByTitle('Vergrößern (+)')).not.toBeInTheDocument();
  });

  it('still shows the close and the fullscreen button', () => {
    const { container } = open({ allowDownload: false, pdfUrl: ROUTE });
    screen.getByTestId('secure-viewer');
    expect(screen.getByTitle('Schließen (Esc)')).toBeInTheDocument();
    expect(container.querySelectorAll('button').length).toBeGreaterThan(1);
  });

  it('prints nothing of the viewer', () => {
    const { container } = open({ allowDownload: false, pdfUrl: ROUTE });
    expect((container.firstChild as HTMLElement).className).toContain(
      'print:hidden'
    );
  });
});

describe('FlipbookViewer subtitle (WMCNL-2932)', () => {
  it('says "Theorie-Dokument" when no subtitle is given', () => {
    open();
    expect(screen.getByText('Theorie-Dokument')).toBeInTheDocument();
  });

  it('shows the given kind of document instead', () => {
    open({ subtitle: 'Szenario' });
    expect(screen.queryByText('Theorie-Dokument')).not.toBeInTheDocument();
    expect(screen.getAllByText('Szenario').length).toBeGreaterThan(0);
  });
});
