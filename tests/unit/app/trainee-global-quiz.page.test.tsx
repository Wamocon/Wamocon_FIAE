import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import QuizPage from '@/app/trainee/quizzes/[quizId]/page';
import { authFetch } from '@/lib/authFetch';

// The global quiz page of a trainee is a client page: the questions come from
// GET /api/trainee/quizzes/[quizId] with the session token of the trainee. The
// page reads no database and shows nothing without the answer of the route.

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ quizId: 'quiz-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/trainee/quizzes/quiz-1',
  useSearchParams: () => new URLSearchParams(),
}));

const authFetchMock = authFetch as jest.Mock;

function reply(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const quiz = {
  id: 'quiz-1',
  title: 'Globales Quiz',
  questions: [
    {
      id: 'q-1',
      questionText: 'Frage eins?',
      questionType: 'MCQ',
      options: [
        { id: 'o-1', optionText: 'Antwort A' },
        { id: 'o-2', optionText: 'Antwort B' },
      ],
    },
  ],
};

describe('global quiz page of a trainee', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the questions with authFetch and shows the quiz', async () => {
    authFetchMock.mockResolvedValue(reply({ quiz }));
    renderWithProviders(<QuizPage />);

    expect(await screen.findByText('Frage eins?')).toBeInTheDocument();
    expect(screen.getByText('Globales Quiz')).toBeInTheDocument();
    expect(screen.getByText('Antwort A')).toBeInTheDocument();
    expect(String(authFetchMock.mock.calls[0][0])).toBe(
      '/api/trainee/quizzes/quiz-1'
    );
  });

  it('shows a loading note while the questions are on their way', () => {
    authFetchMock.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<QuizPage />);
    expect(screen.getByText('Quiz wird geladen...')).toBeInTheDocument();
  });

  it('shows "not available" for a quiz the route answers with 404', async () => {
    authFetchMock.mockResolvedValue(reply({ error: 'Not found' }, 404));
    renderWithProviders(<QuizPage />);
    expect(
      await screen.findByText('Dieses Quiz ist nicht verfügbar.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Frage eins?')).not.toBeInTheDocument();
  });

  it('shows a load error for any other failure', async () => {
    authFetchMock.mockResolvedValue(reply({ error: 'x' }, 500));
    renderWithProviders(<QuizPage />);
    expect(
      await screen.findByText(
        'Das Quiz konnte nicht geladen werden. Bitte versuche es später erneut.'
      )
    ).toBeInTheDocument();
  });

  it('shows "not available" when the answer holds no quiz', async () => {
    authFetchMock.mockResolvedValue(reply({}));
    renderWithProviders(<QuizPage />);
    await waitFor(() =>
      expect(
        screen.getByText('Dieses Quiz ist nicht verfügbar.')
      ).toBeInTheDocument()
    );
  });
});
