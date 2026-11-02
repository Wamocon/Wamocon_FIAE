import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeQuizzesPage from '@/app/trainee/quizzes/page';
import { authFetch } from '@/lib/authFetch';

// "Quizze & Tests" (WMCNL-2938): the page lists the global quizzes and the
// quizzes of the Themenkreise with status and result, and says so when there
// is none (it used to stay empty under the heading).

jest.mock('@/contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    profile: { id: 't1', role: 'trainee', organizationId: 'org-1' },
    loading: false,
  }),
}));
jest.mock('@/lib/authFetch');

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

function answer(globals: unknown, lessons: unknown) {
  authFetchMock.mockImplementation(async (input: any) => {
    const url = String(input);
    if (url.includes('/api/trainee/lesson-quizzes')) return json(lessons);
    if (url.includes('/api/trainee/quizzes')) return json(globals);
    return json({}, false, 404);
  });
}

const globalQuiz = {
  id: 'g1',
  title: 'Abschlussquiz Büromanagement',
  description: 'Global Quiz',
  difficulty: 'intermediate',
  bestScore: 0,
  questionsCount: 20,
  timeLimit: '30 min',
  attempts: 0,
};
const lessonQuiz = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  kind: 'LESSON',
  title: 'Quiz Niedrig',
  difficulty: 'LOW',
  enablerId: 'e1',
  enablerTitle: 'betriebliche Kommunikationssysteme',
  courseTitle: 'Informationsmanagement anwenden',
  locked: false,
  bestScore: 98,
  attempts: 1,
  questionsCount: 10,
  ...over,
});

describe('page "Quizze & Tests"', () => {
  beforeEach(() => jest.clearAllMocks());

  it('says so when the trainee has no quiz', async () => {
    answer([], []);
    renderWithProviders(<TraineeQuizzesPage />);
    expect(await screen.findByTestId('quiz-list-empty')).toHaveTextContent(
      'Für dich sind noch keine Quizze vorhanden'
    );
    expect(screen.queryAllByTestId('quiz-card')).toHaveLength(0);
  });

  it('asks both lists and lists a lesson quiz with status, result and the way to its Themenkreis', async () => {
    answer([], [lessonQuiz()]);
    renderWithProviders(<TraineeQuizzesPage />);
    const card = await screen.findByTestId('quiz-card');
    expect(within(card).getByText('Quiz Niedrig')).toBeInTheDocument();
    expect(card).toHaveTextContent('Themenkreis-Quiz');
    expect(card).toHaveTextContent('Niedrig');
    // the Themenkreis starts with a capital letter
    expect(card).toHaveTextContent('Betriebliche Kommunikationssysteme');
    expect(within(card).getByTestId('quiz-status')).toHaveTextContent(
      'Bestanden'
    );
    expect(card).toHaveTextContent('98%');
    expect(within(card).getByRole('link')).toHaveAttribute(
      'href',
      '/trainee/enablers/e1'
    );
    expect(screen.queryByTestId('quiz-list-empty')).toBeNull();
    const urls = authFetchMock.mock.calls.map(([u]) => String(u));
    expect(urls).toEqual(
      expect.arrayContaining([
        '/api/trainee/quizzes',
        '/api/trainee/lesson-quizzes',
      ])
    );
  });

  it('shows a global quiz as not started with its own link', async () => {
    answer([globalQuiz], []);
    renderWithProviders(<TraineeQuizzesPage />);
    const card = await screen.findByTestId('quiz-card');
    expect(card).toHaveTextContent('Global-Quiz');
    expect(within(card).getByTestId('quiz-status')).toHaveTextContent(
      'Noch nicht begonnen'
    );
    // the fixed English texts of the list route are not shown
    expect(card).not.toHaveTextContent('intermediate');
    expect(card).not.toHaveTextContent('30 min');
    expect(within(card).getByRole('link')).toHaveAttribute(
      'href',
      '/trainee/quizzes/g1'
    );
  });

  it('tells a quiz that was not passed from a passed one and a locked one', async () => {
    answer(
      [],
      [
        lessonQuiz({ id: 'a', title: 'A', bestScore: 30, attempts: 2 }),
        lessonQuiz({ id: 'b', title: 'B', bestScore: 50, attempts: 1 }),
        lessonQuiz({
          id: 'c',
          title: 'C',
          locked: true,
          bestScore: 0,
          attempts: 0,
        }),
      ]
    );
    renderWithProviders(<TraineeQuizzesPage />);
    await waitFor(() =>
      expect(screen.getAllByTestId('quiz-card')).toHaveLength(3)
    );
    const status = screen.getAllByTestId('quiz-status').map(s => s.textContent);
    expect(status).toEqual([
      'Nicht bestanden, Wiederholung möglich',
      'Bestanden',
      'Gesperrt',
    ]);
  });

  it('says that the quizzes could not be loaded instead of showing an empty page', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    authFetchMock.mockResolvedValue(json({ error: 'x' }, false, 500));
    renderWithProviders(<TraineeQuizzesPage />);
    expect(await screen.findByTestId('quiz-list-error')).toHaveTextContent(
      'konnten nicht geladen werden'
    );
    expect(screen.queryByTestId('quiz-list-empty')).toBeNull();
  });
});
