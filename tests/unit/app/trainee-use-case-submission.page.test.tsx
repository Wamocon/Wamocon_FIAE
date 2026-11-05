import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeUseCaseDetailPage from '@/app/trainee/use-cases/[useCaseId]/page';
import { authFetch } from '@/lib/authFetch';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// The hand-in of a use case (WMCNL-2926): text, link or file is needed, an
// empty hand-in is not sent and the page says why.

jest.mock('@/contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    profile: { id: 't1', role: 'trainee', organizationId: 'org-1' },
  }),
}));
jest.mock('@/lib/authFetch');
jest.mock('@/lib/hooks/useApiQuery', () => ({
  __esModule: true,
  useApiQuery: jest.fn(),
  apiQueryKey: (url: string) => [url],
}));
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ useCaseId: 'u1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/trainee/use-cases/u1',
  useSearchParams: () => new URLSearchParams(),
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const useApiQueryMock = useApiQuery as jest.MockedFunction<typeof useApiQuery>;

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

function mockQueries(file: unknown = null, fileFeature = true) {
  const ucData = {
    useCase: {
      id: 'u1',
      title: 'Betriebliche Kommunikationssysteme auswählen',
      descriptionText: 'Beschreibung',
      courseId: 'c1',
      courseTitle: 'Informationsmanagement anwenden',
    },
    submission: null,
  };
  const docsData = { documents: [] };
  const fileData = { enabled: fileFeature, file };
  useApiQueryMock.mockImplementation(((url: string | null) => {
    const data = !url
      ? undefined
      : url.includes('/submission-file')
        ? fileData
        : url.includes('/documents')
          ? docsData
          : ucData;
    return { data, isLoading: false, error: null };
  }) as any);
}

const submitButton = () => screen.getByRole('button', { name: 'Abgeben' });
const posts = () =>
  authFetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

describe('hand-in of a use case', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueries();
  });

  it('does not send an empty hand-in and shows a hint', () => {
    renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.click(submitButton());
    expect(screen.getByText(/Eine leere Abgabe wird nicht angenommen/));
    expect(posts()).toHaveLength(0);
    expect(screen.queryByText(/Abgabe gespeichert/)).toBeNull();
  });

  it('does not send white space as a solution', () => {
    renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: '   \n ' },
    });
    fireEvent.change(screen.getByPlaceholderText(/https:\/\/github\.com/), {
      target: { value: '  ' },
    });
    fireEvent.click(submitButton());
    expect(screen.getByText(/Eine leere Abgabe wird nicht angenommen/));
    expect(posts()).toHaveLength(0);
  });

  it('sends a hand-in with a solution text', async () => {
    authFetchMock.mockResolvedValue(json({ ok: true, submissionId: 's1' }));
    renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'Meine Lösung' },
    });
    fireEvent.click(submitButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByText(/Abgabe gespeichert/)).toBeInTheDocument()
    );
  });

  it('sends a hand-in with only a link', async () => {
    authFetchMock.mockResolvedValue(json({ ok: true, submissionId: 's1' }));
    renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.change(screen.getByPlaceholderText(/https:\/\/github\.com/), {
      target: { value: 'https://github.com/a/b' },
    });
    fireEvent.click(submitButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  it('sends a hand-in with only a file that is stored already', async () => {
    mockQueries({ fileName: 'a.pdf', size: 3, uploadedAt: '2026-11-02' });
    authFetchMock.mockResolvedValue(json({ ok: true, submissionId: 's1' }));
    renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.click(submitButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  it('shows the answer of the server for an empty hand-in', async () => {
    authFetchMock.mockResolvedValue(
      json({ error: 'Empty submission', code: 'EMPTY_SUBMISSION' }, false, 400)
    );
    renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'x' },
    });
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(
        screen.getByText(/Eine leere Abgabe wird nicht angenommen/)
      ).toBeInTheDocument()
    );
  });
});

// WMCNL-2928: a link is an http or https address, every link can be removed
// on its own. WMCNL-2934: no description that only repeats the title.
describe('links of a hand-in (WMCNL-2928)', () => {
  const urlFields = () => screen.getAllByLabelText('URL');

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueries();
  });

  it('does not take text that is no link and says why', () => {
    renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.change(urlFields()[0], { target: { value: 'kein-link' } });
    fireEvent.click(screen.getByRole('button', { name: /Link hinzufügen/ }));
    expect(urlFields()).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /https:\/\/ oder http:\/\//
    );
    expect(urlFields()[0]).toHaveAttribute('aria-invalid', 'true');
  });

  it('adds a row for the next link after a valid one', () => {
    renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.change(urlFields()[0], { target: { value: 'https://a.org/x' } });
    fireEvent.click(screen.getByRole('button', { name: /Link hinzufügen/ }));
    expect(urlFields()).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not send a hand-in with an invalid link', () => {
    renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'Meine Lösung' },
    });
    fireEvent.change(urlFields()[0], { target: { value: 'ftp://a.org' } });
    fireEvent.click(submitButton());
    expect(posts()).toHaveLength(0);
    expect(
      screen.getAllByText(/https:\/\/ oder http:\/\//).length
    ).toBeGreaterThan(0);
  });

  it('removes the first link on its own, and keeps one empty field for the last', () => {
    renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.change(urlFields()[0], { target: { value: 'https://a.org' } });
    fireEvent.click(screen.getByRole('button', { name: /Link hinzufügen/ }));
    fireEvent.change(urlFields()[1], { target: { value: 'https://b.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link 1 entfernen' }));
    expect(urlFields()).toHaveLength(1);
    expect(urlFields()[0]).toHaveValue('https://b.org');
    fireEvent.click(screen.getByRole('button', { name: 'Link 1 entfernen' }));
    expect(urlFields()).toHaveLength(1);
    expect(urlFields()[0]).toHaveValue('');
  });

  it('shows the answer of the server for an invalid link', async () => {
    authFetchMock.mockResolvedValue(
      json({ error: 'Invalid link', code: 'INVALID_LINK' }, false, 400)
    );
    renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.change(urlFields()[0], { target: { value: 'https://a.org' } });
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(
        screen.getAllByText(/https:\/\/ oder http:\/\//).length
      ).toBeGreaterThan(0)
    );
  });
});

describe('title and description of a use case (WMCNL-2934)', () => {
  function mockUseCase(descriptionText: string, code: string | null = null) {
    useApiQueryMock.mockImplementation(((url: string | null) => {
      const data = !url
        ? undefined
        : url.includes('/submission-file')
          ? { enabled: true, file: null }
          : url.includes('/documents')
            ? { documents: [] }
            : {
                useCase: {
                  id: 'u1',
                  code,
                  title: 'Betriebliche Kommunikationssysteme auswählen',
                  descriptionText,
                  courseId: 'c1',
                },
                submission: null,
              };
      return { data, isLoading: false, error: null };
    }) as any);
  }

  it('does not repeat the title as the description', () => {
    mockUseCase(' Betriebliche Kommunikationssysteme auswählen. ');
    renderWithProviders(<TraineeUseCaseDetailPage />);
    expect(
      screen.getAllByText('Betriebliche Kommunikationssysteme auswählen')
    ).toHaveLength(1);
  });

  it('shows a description of its own', () => {
    mockUseCase('Du wählst ein Kommunikationssystem für einen Betrieb.');
    renderWithProviders(<TraineeUseCaseDetailPage />);
    expect(
      screen.getByText('Du wählst ein Kommunikationssystem für einen Betrieb.')
    ).toBeInTheDocument();
  });

  it('names the use case with its code, so it differs from the Themenkreis', () => {
    mockUseCase('Beschreibung', 'K1-a');
    renderWithProviders(<TraineeUseCaseDetailPage />);
    expect(screen.getByText('Use Case K1-a')).toBeInTheDocument();
  });

  it('shows the status of the file once, with a styled choose button and no native file text', () => {
    mockUseCase('Beschreibung');
    renderWithProviders(<TraineeUseCaseDetailPage />);
    expect(screen.getAllByText('Es ist keine Datei angehängt.')).toHaveLength(
      1
    );
    expect(
      screen.getByRole('button', { name: 'Datei wählen' })
    ).toBeInTheDocument();
    const input = screen.getByTestId('submission-file-input');
    expect(input).toHaveClass('sr-only');
    expect(input).toHaveAttribute('aria-hidden', 'true');
  });
});
