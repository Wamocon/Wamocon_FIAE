import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { SubmissionFileField } from '@/components/trainee/SubmissionFileField';
import { authFetch } from '@/lib/authFetch';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// WMCNL-2927: after the upload the trainee can look at the attached file in the
// platform (a PDF in the viewer, a PNG or JPG as an image). Word and Excel files
// have no preview. Downloading the own file stays possible.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));
jest.mock('@/lib/hooks/useApiQuery', () => ({
  __esModule: true,
  useApiQuery: jest.fn(),
  apiQueryKey: (url: string) => ['api', url],
}));
jest.mock('@/components/submission/SubmissionFileViewer', () => ({
  __esModule: true,
  SubmissionFileViewer: (props: any) =>
    props.open ? (
      <div
        data-testid="viewer"
        data-url={props.contentUrl}
        data-name={props.fileName}
        data-kind={props.kind}
      >
        <button onClick={props.onClose}>viewer schliessen</button>
      </div>
    ) : null,
}));

const useApiQueryMock = useApiQuery as jest.MockedFunction<typeof useApiQuery>;
const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const assign = jest.fn();

const withFile = (fileName: string | null) =>
  useApiQueryMock.mockReturnValue({
    data: {
      enabled: true,
      file: fileName
        ? { fileName, size: 2048, uploadedAt: '2026-11-02T10:00:00Z' }
        : null,
    },
    isLoading: false,
    error: null,
  } as any);

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
});

const render = (canEdit = true) =>
  renderWithProviders(<SubmissionFileField useCaseId="u1" canEdit={canEdit} />);

describe('SubmissionFileField: preview', () => {
  it.each([
    ['Loesung.pdf', 'pdf'],
    ['Bild.png', 'image'],
    ['foto.jpg', 'image'],
  ])('offers the preview of %s', (fileName, kind) => {
    withFile(fileName);
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Ansehen' }));
    const viewer = screen.getByTestId('viewer');
    expect(viewer).toHaveAttribute('data-kind', kind);
    expect(viewer).toHaveAttribute('data-name', fileName);
    expect(viewer).toHaveAttribute(
      'data-url',
      '/api/trainee/use-cases/u1/submission-file/content'
    );
  });

  it('does not open the viewer before the button is pressed, and closes it again', () => {
    withFile('Loesung.pdf');
    render();
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ansehen' }));
    fireEvent.click(screen.getByText('viewer schliessen'));
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument();
  });

  it.each(['Bericht.docx', 'Tabelle.xlsx'])(
    'has no preview button for %s, only the download',
    fileName => {
      withFile(fileName);
      render();
      expect(
        screen.queryByRole('button', { name: 'Ansehen' })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Herunterladen' })
      ).toBeInTheDocument();
    }
  );

  it('offers the preview also when the submission can no longer be changed', () => {
    withFile('Loesung.pdf');
    render(false);
    expect(screen.getByRole('button', { name: 'Ansehen' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Datei entfernen' })
    ).not.toBeInTheDocument();
  });

  it('shows no preview button without a file', () => {
    withFile(null);
    render();
    expect(
      screen.queryByRole('button', { name: 'Ansehen' })
    ).not.toBeInTheDocument();
  });

  it('keeps the download of the own file', async () => {
    withFile('Loesung.pdf');
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ file: { url: 'https://storage.example/x?t=1' } }),
    } as any);
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Herunterladen' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://storage.example/x?t=1')
    );
    expect(authFetchMock.mock.calls[0][0]).toBe(
      '/api/trainee/use-cases/u1/submission-file?link=1'
    );
  });
});
