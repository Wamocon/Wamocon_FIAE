import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import QuizSubmissionReviewPage from '@/app/trainer/reviews/quizzes/[submissionId]/page';
import { authFetch } from '@/lib/authFetch';

// The review of one quiz submission for the trainer: the answers of the trainee
// next to the right ones (WMCNL-3006), how many questions were right so the
// percentage can be followed, and an honest hint when the data holds a score but no
// single answer (WMCNL-3007), German terms (WMCNL-3008).

jest.mock('@/lib/authFetch');
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ submissionId: 's1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/trainer',
  useSearchParams: () => new URLSearchParams(),
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

const json = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

const mcq = (id: string, selected: string | null) => ({
  id,
  text: `Frage ${id}`,
  questionType: 'MCQ',
  expectedAnswer: null,
  options: [
    { id: `${id}-a`, optionText: `Richtig ${id}`, isCorrect: true },
    { id: `${id}-b`, optionText: `Falsch ${id}`, isCorrect: false },
  ],
  selectedOptionId: selected,
  textAnswer: null,
});

const textQuestion = (
  id: string,
  expected: string | null,
  given: string | null
) => ({
  id,
  text: `Frage ${id}`,
  questionType: 'TEXT',
  expectedAnswer: expected,
  options: [],
  selectedOptionId: null,
  textAnswer: given,
});

const submission = (score: number | null, questions: unknown[]) => ({
  submission: {
    id: 's1',
    traineeId: 't1',
    quizId: 'q1',
    score,
    isReviewed: false,
  },
  quiz: { title: 'Lesson quiz', quizType: 'LESSON' },
  trainee: { fullName: 'Tina Muster', email: 'tina@example.com' },
  lesson: { difficulty: 'LOW', enablerTitle: 'Enabler One' },
  questions,
});

const show = async (body: unknown) => {
  authFetchMock.mockResolvedValue(json(body));
  const view = renderWithProviders(<QuizSubmissionReviewPage />);
  await screen.findByText('Lesson quiz');
  return view;
};

const cardOf = (text: string) =>
  screen.getByText(new RegExp(text)).closest('.rounded-2xl') as HTMLElement;

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
});

describe('WMCNL-3006: the answer of the trainee next to the right one', () => {
  it('marks the wrong answer of the trainee and the right one, per question', async () => {
    await show(submission(50, [mcq('1', '1-a'), mcq('2', '2-b')]));
    const wrong = cardOf('Frage 2');
    const chosen = within(wrong).getByText('Falsch 2').closest('div')!;
    expect(within(chosen).getByText('Antwort des Azubis')).toBeInTheDocument();
    expect(chosen.className).toContain('border-red');
    const key = within(wrong).getByText('Richtig 2').closest('div')!;
    expect(within(key).getByText('Richtige Antwort')).toBeInTheDocument();
    expect(within(wrong).getByTestId('question-result')).toHaveTextContent(
      'Falsch'
    );
    expect(
      within(cardOf('Frage 1')).getByTestId('question-result')
    ).toHaveTextContent('Richtig');
  });

  it('marks a right answer of the trainee as the key and as chosen', async () => {
    await show(submission(100, [mcq('1', '1-a')]));
    const right = within(cardOf('Frage 1'))
      .getByText('Richtig 1')
      .closest('div')!;
    expect(within(right).getByText('Richtige Antwort')).toBeInTheDocument();
    expect(within(right).getByText('Antwort des Azubis')).toBeInTheDocument();
    expect(right.className).toContain('border-green');
  });

  it('says that a question has no stored answer when the others have one', async () => {
    await show(submission(50, [mcq('1', '1-a'), mcq('2', null)]));
    expect(
      within(cardOf('Frage 2')).getByText(
        'Zu dieser Frage ist keine Antwort gespeichert.'
      )
    ).toBeInTheDocument();
    expect(
      within(cardOf('Frage 2')).getByTestId('question-result')
    ).toHaveTextContent('Nicht beantwortet');
  });

  it('shows the answer to a text question and whether it matches', async () => {
    await show(submission(0, [textQuestion('x', 'Berlin', 'Bonn')]));
    const card = cardOf('Frage x');
    expect(within(card).getByText('Bonn')).toBeInTheDocument();
    expect(within(card).getByText('Berlin')).toBeInTheDocument();
    expect(
      within(card).getByText('Nicht exakt übereinstimmend')
    ).toBeInTheDocument();
    expect(within(card).getByText('Antwort des Azubis')).toBeInTheDocument();
  });
});

describe('WMCNL-3007: the score can be followed', () => {
  it('says how many questions were right out of the graded ones', async () => {
    await show(
      submission(67, [mcq('1', '1-a'), mcq('2', '2-a'), mcq('3', '3-b')])
    );
    expect(screen.getByTestId('quiz-correct-count')).toHaveTextContent(
      '2 von 3 Fragen richtig'
    );
    expect(screen.getByText(/Ergebnis: 67%/)).toBeInTheDocument();
    expect(screen.queryByText(/weicht/)).toBeNull();
  });

  it('says that a text question without an expected answer is not graded', async () => {
    await show(
      submission(100, [mcq('1', '1-a'), textQuestion('x', null, 'irgendwas')])
    );
    expect(screen.getByTestId('quiz-correct-count')).toHaveTextContent(
      '1 von 1 bewerteten Fragen richtig'
    );
    expect(
      screen.getByText(/1 Textfrage\(n\) ohne erwartete Antwort/)
    ).toBeInTheDocument();
    expect(
      within(cardOf('Frage x')).getByTestId('question-result')
    ).toHaveTextContent('Nicht bewertet');
  });

  it('is honest when the stored score does not fit the stored answers', async () => {
    await show(submission(68, [mcq('1', '1-a'), mcq('2', '2-b')]));
    expect(
      screen.getByText(
        'Das gespeicherte Ergebnis (68 %) weicht von den gespeicherten Antworten (50 %) ab. Die Fragen können seit der Abgabe geändert worden sein.'
      )
    ).toBeInTheDocument();
  });

  it('says that no single answers are stored instead of showing empty questions (data with a score only)', async () => {
    await show(submission(68, [mcq('1', null), mcq('2', null)]));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Zu dieser Abgabe sind keine einzelnen Antworten gespeichert. Das Ergebnis von 68 % wurde ohne Einzelantworten erfasst und lässt sich aus den Fragen nicht nachrechnen.'
    );
    // the key is still shown, but there are no verdicts and no count that would be made up
    expect(screen.getAllByText('Richtige Antwort')).toHaveLength(2);
    expect(screen.queryByTestId('question-result')).toBeNull();
    expect(screen.queryByTestId('quiz-correct-count')).toBeNull();
    expect(screen.queryByText(/weicht/)).toBeNull();
  });

  it('does not invent the hint for a quiz without questions', async () => {
    await show(submission(null, []));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Keine Fragen vorhanden.')).toBeInTheDocument();
    expect(screen.getByText(/Ergebnis: Nicht bewertet/)).toBeInTheDocument();
  });
});

describe('WMCNL-3008: German terms', () => {
  it('has no English terms in the German view', async () => {
    const { container } = await show(
      submission(50, [mcq('1', '1-a'), mcq('2', '2-b')])
    );
    expect(screen.getByText('Überprüfungen')).toBeInTheDocument();
    expect(screen.getByText('Quiz-Abgabe')).toBeInTheDocument();
    expect(screen.getByText(/Schwierigkeit:/)).toBeInTheDocument();
    expect(screen.getByText('Niedrig')).toBeInTheDocument();
    const text = container.textContent ?? '';
    for (const english of [
      'Reviews',
      'Quiz Submission',
      'Trainee',
      'Correct',
      'Selected',
      'LOW',
      'Score',
      'Lesson:',
      'No questions',
    ]) {
      expect(text).not.toContain(english);
    }
  });

  it('names the other levels in German too', async () => {
    const view = await show({
      ...submission(50, [mcq('1', '1-a')]),
      lesson: { difficulty: 'HIGH', enablerTitle: null },
    });
    expect(screen.getByText('Hoch')).toBeInTheDocument();
    view.unmount();
  });
});

describe('the way back to the list (WMCNL-3002)', () => {
  it('links back to the list the trainer came from, with its filter', async () => {
    window.sessionStorage.setItem(
      'wmc.trainer.reviews.listState',
      JSON.stringify({
        search: 'view=quizzes&status=all&catalog=KFBM',
        key: 'k',
        scrollTop: 0,
        loaded: 1,
        savedAt: Date.now(),
      })
    );
    await show(submission(50, [mcq('1', '1-a')]));
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: 'Überprüfungen' })
      ).toHaveAttribute(
        'href',
        '/trainer/reviews?view=quizzes&status=all&catalog=KFBM'
      )
    );
  });

  it('links back to the quiz tab without a stored list', async () => {
    await show(submission(50, [mcq('1', '1-a')]));
    expect(screen.getByRole('link', { name: 'Überprüfungen' })).toHaveAttribute(
      'href',
      '/trainer/reviews?view=quizzes'
    );
  });
});
