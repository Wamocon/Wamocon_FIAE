import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { FlipbookViewer } from '@/components/ui/FlipbookViewer';

// Trainees must not download documents (KFB-1154, KFB-1155, KFB-1159). The viewer keeps its
// download buttons for trainers and drops them, the new tab with the raw file and the
// toolbar of the PDF viewer for a caller that sets allowDownload to false.

const open = (allowDownload?: boolean) =>
  renderWithProviders(
    <FlipbookViewer
      title="Szenario"
      pdfUrl="https://files.example/doc.pdf"
      isOpen
      onClose={() => undefined}
      {...(allowDownload === undefined ? {} : { allowDownload })}
    />
  );

describe('FlipbookViewer download', () => {
  it('offers download and a new tab by default (trainer side)', () => {
    const { container } = open();
    expect(container.querySelector('a[download]')).not.toBeNull();
    expect(container.querySelector('a[target="_blank"]')).not.toBeNull();
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain(
      'toolbar=1'
    );
  });

  it('offers neither a download link nor a raw file link for trainees', () => {
    const { container } = open(false);
    expect(container.querySelector('a[download]')).toBeNull();
    expect(container.querySelector('a[target="_blank"]')).toBeNull();
    expect(container.querySelector('a[href*="doc.pdf"]')).toBeNull();
  });

  it('hides the toolbar of the PDF viewer for trainees', () => {
    const { container } = open(false);
    const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
    expect(src).toContain('toolbar=0');
    expect(src).not.toContain('toolbar=1');
  });

  it('still shows the document and the close button for trainees', () => {
    const { container } = open(false);
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
  });
});
