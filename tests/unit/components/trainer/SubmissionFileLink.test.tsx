import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { SubmissionFileLink } from '@/components/trainer/SubmissionFileLink';
import { authFetch } from '@/lib/authFetch';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { readLinkAnswers } from '@/lib/submission-file/readLink';

// "Anhang herunterladen" on the review page (WMCNL-2998). The read link of the storage is
// opened by navigating to it. When the storage refused it (503), the request failed in
// the background and nothing happened on the page. The link is tried first, and a link
// that does not answer shows the message.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));
jest.mock('@/lib/hooks/useApiQuery');
// the preview itself is tested in SubmissionFileViewer.test.tsx
jest.mock('@/components/submission/SubmissionFileViewer', () => ({
  __esModule: true,
  SubmissionFileViewer: (props: any) => (
    <div
      data-testid="viewer"
      data-url={props.contentUrl}
      data-name={props.fileName}
      data-kind={props.kind}
    >
      <button onClick={props.onClose}>viewer schliessen</button>
    </div>
  ),
}));
jest.mock('@/lib/submission-file/readLink', () => ({
  __esModule: true,
  readLinkAnswers: jest.fn(),
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const useApiQueryMock = useApiQuery as jest.MockedFunction<typeof useApiQuery>;
const probe = readLinkAnswers as jest.MockedFunction<typeof readLinkAnswers>;

const LINK = 'https://proj.supabase.co/storage/v1/object/sign/x?token=t';
const assign = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  useApiQueryMock.mockReturnValue({
    data: { enabled: true },
    isLoading: false,
    error: null,
  } as any);
  authFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ file: { url: LINK } }),
  } as any);
  probe.mockResolvedValue(true);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
});

const click = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Anhang herunterladen' }));

describe('SubmissionFileLink', () => {
  it('opens the read link when the storage answers it', async () => {
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    click();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(LINK));
    expect(probe).toHaveBeenCalledWith(LINK);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when the storage refuses the link (503), and does not navigate', async () => {
    probe.mockResolvedValue(false);
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    click();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Der Anhang konnte nicht geladen werden.'
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('says so when the route of the app answers with 503', async () => {
    authFetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ code: 'STORAGE_ERROR' }),
    } as any);
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    click();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(probe).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('says that there is no attachment, without trying a link', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ file: null }),
    } as any);
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    click();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Es ist kein Anhang vorhanden.'
    );
    expect(probe).not.toHaveBeenCalled();
  });
});

// WMCNL-2927: the trainer looks at the file inside the platform
describe('SubmissionFileLink: preview', () => {
  const view = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Anhang ansehen' }));
  const answer = (file: unknown, ok = true) =>
    authFetchMock.mockResolvedValue({
      ok,
      json: async () => ({ file }),
    } as any);

  it('offers the preview next to the download', () => {
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    expect(
      screen.getByRole('button', { name: 'Anhang ansehen' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Anhang herunterladen' })
    ).toBeInTheDocument();
  });

  it('shows a PDF in the viewer, reading the name first and no read link', async () => {
    answer({ fileName: 'Loesung.pdf' });
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    view();
    const viewer = await screen.findByTestId('viewer');
    expect(authFetchMock.mock.calls[0][0]).toBe(
      '/api/trainer/reviews/use-cases/s1/file?link=0'
    );
    expect(viewer).toHaveAttribute('data-kind', 'pdf');
    expect(viewer).toHaveAttribute('data-name', 'Loesung.pdf');
    expect(viewer).toHaveAttribute(
      'data-url',
      '/api/trainer/reviews/use-cases/s1/file/content'
    );
    // looking at the file is not a download
    expect(assign).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it('shows a picture as an image', async () => {
    answer({ fileName: 'Bild.png' });
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    view();
    expect(await screen.findByTestId('viewer')).toHaveAttribute(
      'data-kind',
      'image'
    );
  });

  it('closes the viewer', async () => {
    answer({ fileName: 'Loesung.pdf' });
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    view();
    fireEvent.click(await screen.findByText('viewer schliessen'));
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument();
  });

  it.each(['Bericht.docx', 'Tabelle.xlsx'])(
    'says that %s has no preview and leaves the download',
    async fileName => {
      answer({ fileName });
      renderWithProviders(<SubmissionFileLink submissionId="s1" />);
      view();
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Für dieses Format gibt es keine Vorschau. Bitte lade die Datei herunter.'
      );
      expect(screen.queryByTestId('viewer')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Anhang herunterladen' })
      ).toBeEnabled();
    }
  );

  it('says that there is no attachment', async () => {
    answer(null);
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    view();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Es ist kein Anhang vorhanden.'
    );
  });

  it('says so when the route of the app fails', async () => {
    answer(null, false);
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    view();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Der Anhang konnte nicht geladen werden.'
    );
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument();
  });

  it('shows nothing where the feature is off', () => {
    useApiQueryMock.mockReturnValue({
      data: { enabled: false },
      isLoading: false,
      error: null,
    } as any);
    renderWithProviders(<SubmissionFileLink submissionId="s1" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
