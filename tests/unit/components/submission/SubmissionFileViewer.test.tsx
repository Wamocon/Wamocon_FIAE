import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { SubmissionFileViewer } from '@/components/submission/SubmissionFileViewer';
import { authFetch } from '@/lib/authFetch';

// WMCNL-2927: the preview of the file of a submission, for the trainee after the
// upload and for the trainer in the review. A PDF goes to the viewer of the app (the
// viewer itself is tested in SecurePdfViewer.test.tsx), a PNG or JPG is shown as an image.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));
jest.mock('@/components/ui/FlipbookViewer', () => ({
  __esModule: true,
  FlipbookViewer: (props: any) => (
    <div
      data-testid="flipbook"
      data-url={props.pdfUrl}
      data-title={props.title}
      data-subtitle={props.subtitle}
      data-download={String(props.allowDownload)}
      data-open={String(props.isOpen)}
    />
  ),
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const URL_ROUTE = '/api/trainee/use-cases/u1/submission-file/content';

const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  created.length = 0;
  revoked.length = 0;
  (URL as any).createObjectURL = jest.fn((blob: Blob) => {
    const url = `blob:test/${created.length}-${blob.size}`;
    created.push(url);
    return url;
  });
  (URL as any).revokeObjectURL = jest.fn((url: string) => revoked.push(url));
});

describe('SubmissionFileViewer: a PDF', () => {
  it('opens the viewer of the app with the route, and no download inside of it', () => {
    renderWithProviders(
      <SubmissionFileViewer
        open
        onClose={() => undefined}
        contentUrl={URL_ROUTE}
        fileName="Loesung.pdf"
        kind="pdf"
      />
    );
    const viewer = screen.getByTestId('flipbook');
    expect(viewer).toHaveAttribute('data-url', URL_ROUTE);
    expect(viewer).toHaveAttribute('data-title', 'Loesung.pdf');
    expect(viewer).toHaveAttribute('data-subtitle', 'Abgegebene Datei');
    // the download is a button of its own next to the file name
    expect(viewer).toHaveAttribute('data-download', 'false');
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it('shows nothing while it is closed', () => {
    renderWithProviders(
      <SubmissionFileViewer
        open={false}
        onClose={() => undefined}
        contentUrl={URL_ROUTE}
        fileName="Loesung.pdf"
        kind="pdf"
      />
    );
    expect(screen.queryByTestId('flipbook')).not.toBeInTheDocument();
  });
});

describe('SubmissionFileViewer: an image', () => {
  const open = (onClose = jest.fn()) =>
    renderWithProviders(
      <SubmissionFileViewer
        open
        onClose={onClose}
        contentUrl={URL_ROUTE}
        fileName="Foto.png"
        kind="image"
      />
    );

  it('asks the route of the app with the session and shows the bytes as an image', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['png-bytes']),
    } as any);
    open();
    const image = await screen.findByRole('img', { name: 'Foto.png' });
    expect(authFetchMock.mock.calls[0][0]).toBe(URL_ROUTE);
    expect(image.getAttribute('src')).toBe(created[0]);
    expect(
      screen.getByRole('dialog', { name: 'Foto.png' })
    ).toBeInTheDocument();
  });

  it('says so when the route does not deliver the file', async () => {
    authFetchMock.mockResolvedValue({ ok: false, status: 404 } as any);
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Datei konnte nicht angezeigt werden. Du kannst sie herunterladen.'
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('closes with the button, with Escape and with a click beside the box', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['x']),
    } as any);
    const onClose = jest.fn();
    open(onClose);
    await screen.findByRole('img');
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('frees the object address when it is closed', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['x']),
    } as any);
    const view = open();
    await screen.findByRole('img');
    view.unmount();
    await waitFor(() => expect(revoked).toEqual(created));
  });
});
