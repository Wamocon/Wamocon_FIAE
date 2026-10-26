import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TrainerQuizDetailPage from '@/app/trainer/quiz-management/[quizId]/page';
import QuizSubmissionReviewPage from '@/app/trainer/reviews/quizzes/[submissionId]/page';
import { authFetch } from '@/lib/authFetch';

// The two trainer pages that show the answer key (the quiz detail and the
// review of a submission) read it from a route handler behind the trainer
// session. They no longer read the database on the server, where any visitor
// could have asked for them.

jest.mock('@/lib/authFetch');
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/trainer',
  useSearchParams: () => new URLSearchParams(),
}));

let mockParams: Record<string, string> = {};
const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe('trainer quiz detail page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { quizId: 'q1' };
  });

  it('asks the trainer route with the session and marks the correct option', async () => {
    authFetchMock.mockResolvedValue(
      json({
        id: 'q1',
        title: 'Global quiz',
        quiz_type: 'big',
        questions: [
          {
            id: 'q-1',
            question_text: 'Pick one',
            options: ['Alpha', 'Beta'],
            correct_index: 1,
          },
        ],
      })
    );
    renderWithProviders(<TrainerQuizDetailPage />);
    expect(await screen.findByText('Global quiz')).toBeInTheDocument();
    expect(String(authFetchMock.mock.calls[0][0])).toBe(
      '/api/trainer/quizzes/q1'
    );
    const beta = screen.getByText('Beta').closest('div') as HTMLElement;
    expect(within(beta).getByText('Correct')).toBeInTheDocument();
    const alpha = screen.getByText('Alpha').closest('div') as HTMLElement;
    expect(within(alpha).queryByText('Correct')).toBeNull();
  });

  it('says so for a quiz without questions', async () => {
    authFetchMock.mockResolvedValue(
      json({ id: 'q1', title: 'Empty', quiz_type: 'big', questions: [] })
    );
    renderWithProviders(<TrainerQuizDetailPage />);
    expect(await screen.findByText('No questions.')).toBeInTheDocument();
  });

  it('shows not found for a quiz the route does not return (404)', async () => {
    authFetchMock.mockResolvedValue(json({ error: 'Not found' }, false, 404));
    renderWithProviders(<TrainerQuizDetailPage />);
    expect(await screen.findByText('Quiz not found')).toBeInTheDocument();
  });

  it('shows an error, and no option, when the route refuses (403)', async () => {
    authFetchMock.mockResolvedValue(json({ error: 'Forbidden' }, false, 403));
    renderWithProviders(<TrainerQuizDetailPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Correct')).toBeNull();
  });

  it('shows an error when the request fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    authFetchMock.mockRejectedValue(new Error('offline'));
    renderWithProviders(<TrainerQuizDetailPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('trainer quiz submission review page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { submissionId: 's1' };
  });

  const review = {
    submission: {
      id: 's1',
      traineeId: 't1',
      quizId: 'q1',
      score: 50,
      isReviewed: false,
    },
    quiz: { title: 'Lesson quiz', quizType: 'LESSON' },
    trainee: { fullName: 'Tina Trainee', email: 'tina@example.com' },
    lesson: { difficulty: 'LOW', enablerTitle: 'Enabler One' },
    questions: [
      {
        id: 'q-1',
        text: 'Pick one',
        questionType: 'MCQ',
        expectedAnswer: null,
        options: [
          { id: 'o-1', optionText: 'Alpha', isCorrect: true },
          { id: 'o-2', optionText: 'Beta', isCorrect: false },
        ],
        selectedOptionId: 'o-2',
        textAnswer: null,
      },
      {
        id: 'q-2',
        text: 'Free text?',
        questionType: 'TEXT',
        expectedAnswer: 'forty-two',
        options: [],
        selectedOptionId: null,
        textAnswer: 'forty-two',
      },
    ],
  };

  it('asks the trainer route and shows the answers against the key', async () => {
    authFetchMock.mockResolvedValue(json(review));
    renderWithProviders(<QuizSubmissionReviewPage />);
    expect(await screen.findByText('Lesson quiz')).toBeInTheDocument();
    expect(String(authFetchMock.mock.calls[0][0])).toBe(
      '/api/trainer/quiz-submissions/s1'
    );
    expect(screen.getByText(/Tina Trainee/)).toBeInTheDocument();
    expect(screen.getByText(/Score: 50%/)).toBeInTheDocument();
    expect(screen.getByText(/Lesson: Enabler One/)).toBeInTheDocument();
    const alpha = screen.getByText('Alpha').closest('div') as HTMLElement;
    expect(within(alpha).getByText('Correct')).toBeInTheDocument();
    const beta = screen.getByText('Beta').closest('div') as HTMLElement;
    expect(within(beta).getByText('Selected')).toBeInTheDocument();
    expect(screen.getByText('Erwartete Antwort')).toBeInTheDocument();
    expect(
      screen.getByText('Automatisch als korrekt bewertet')
    ).toBeInTheDocument();
  });

  it('marks a text answer that differs from the expected answer', async () => {
    authFetchMock.mockResolvedValue(
      json({
        ...review,
        questions: [{ ...review.questions[1], textAnswer: 'forty-three' }],
      })
    );
    renderWithProviders(<QuizSubmissionReviewPage />);
    expect(
      await screen.findByText('Nicht exakt übereinstimmend')
    ).toBeInTheDocument();
  });

  it('shows not found for a submission the route does not return (404)', async () => {
    authFetchMock.mockResolvedValue(
      json({ error: 'Submission not found' }, false, 404)
    );
    renderWithProviders(<QuizSubmissionReviewPage />);
    expect(await screen.findByText('Submission not found')).toBeInTheDocument();
  });

  it('shows an error, and no key, when the route refuses (403)', async () => {
    authFetchMock.mockResolvedValue(json({ error: 'Forbidden' }, false, 403));
    renderWithProviders(<QuizSubmissionReviewPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Correct')).toBeNull();
  });

  it('waits for the answer before it shows anything', async () => {
    let release: (r: Response) => void = () => undefined;
    authFetchMock.mockReturnValue(
      new Promise<Response>(resolve => {
        release = resolve;
      })
    );
    const { container } = renderWithProviders(<QuizSubmissionReviewPage />);
    expect(screen.queryByText('Correct')).toBeNull();
    expect(container.textContent).not.toContain('Alpha');
    release(json(review));
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
  });
});
