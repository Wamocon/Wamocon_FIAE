import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeEnablerPage from '@/app/trainee/enablers/[enablerId]/page';
import { authFetch } from '@/lib/authFetch';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// The lesson quiz on the enabler page of a trainee. The reasoning of a
// question appears only after the trainee has submitted the answers, and the
// page does not keep a reasoning that a response carries before that.

jest.mock('@/contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    profile: { id: 't1', role: 'TRAINEE', organizationId: 'org-1' },
    subscriptionPlan: 'PRO',
  }),
}));
jest.mock('@/lib/authFetch');
jest.mock('@/lib/hooks/useApiQuery');
jest.mock('@/components/ui/FlipbookViewer', () => ({
  __esModule: true,
  FlipbookViewer: () => null,
  useFlipbookViewer: () => ({ open: jest.fn(), close: jest.fn() }),
}));
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ enablerId: 'e1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/trainee/enablers/e1',
  useSearchParams: () => new URLSearchParams(),
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const useApiQueryMock = useApiQuery as jest.MockedFunction<typeof useApiQuery>;

const REASONING = 'REASONING-THE-SERVER-SENDS-AFTER-THE-ANSWER';
const LEAKED = 'REASONING-IN-THE-QUESTION-RESPONSE';

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

type Quizzes = Array<{
  difficulty: 'LOW' | 'MEDIUM' | 'HIGH';
  quizId?: string;
  title?: string;
  unlocked: boolean;
  isActive?: boolean;
  completed?: boolean;
}>;

function mockQueries(quizzes: Quizzes) {
  // stable objects: the page syncs its form state in an effect on the data
  const enablerData = {
    enabler: {
      id: 'e1',
      title: 'Enabler One',
      isActive: false,
      courseId: 'c1',
    },
    submission: null,
  };
  const quizzesData = { quizzes };
  const docsData = { documents: [] };
  useApiQueryMock.mockImplementation(((url: string | null) => {
    const data = !url
      ? undefined
      : url.includes('/quizzes')
        ? quizzesData
        : url.includes('/documents')
          ? docsData
          : enablerData;
    return { data, isLoading: false, error: null };
  }) as any);
}

/** What the question route answers. `leak` simulates an old or buggy server. */
function questionResponse(leak = false) {
  return {
    quiz: {
      id: 'q1',
      title: 'Lesson quiz',
      difficulty: 'LOW',
      questions: [
        {
          id: 'q-1',
          questionText: 'Which one?',
          questionType: 'MCQ',
          options: [
            {
              id: 'o-1',
              optionText: 'Right',
              ...(leak ? { explanation: LEAKED } : {}),
            },
            { id: 'o-2', optionText: 'Wrong' },
          ],
        },
      ],
    },
  };
}

const submitResponse = {
  submissionId: 's1',
  score: 0,
  locked: false,
  feedback: [
    {
      questionId: 'q-1',
      correct: false,
      correctOptionId: 'o-1',
      explanation: REASONING,
      selectedOptionId: 'o-2',
    },
  ],
};

const tile = () => screen.getByRole('button', { name: /Lesson quiz/ });

async function startQuiz(leak = false) {
  authFetchMock.mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (init?.method === 'POST') return json(submitResponse);
    if (url.includes('/quizzes/LOW')) return json(questionResponse(leak));
    return json({});
  });
  renderWithProviders(<TraineeEnablerPage />);
  fireEvent.click(tile());
  await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
}

describe('lesson quiz on the enabler page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueries([
      {
        difficulty: 'LOW',
        quizId: 'q1',
        title: 'Lesson quiz',
        unlocked: true,
        isActive: true,
        completed: false,
      },
    ]);
  });

  it('shows the question and the options, but no reasoning, while the trainee answers', async () => {
    await startQuiz();
    expect(screen.queryByText(new RegExp(REASONING))).toBeNull();
    expect(screen.queryByText(/Erklärung/)).toBeNull();
  });

  it('keeps a reasoning that the question response carries away from the page', async () => {
    await startQuiz(true);
    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(screen.queryByText(new RegExp(LEAKED))).toBeNull();
    expect(document.body.textContent).not.toContain(LEAKED);
  });

  it('shows the reasoning of the submission only after the answers are submitted', async () => {
    await startQuiz(true);
    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Quiz abgeben/ }));
    await waitFor(() =>
      expect(screen.getByText(new RegExp(REASONING))).toBeInTheDocument()
    );
    // from the submission response, not from the question response
    expect(document.body.textContent).not.toContain(LEAKED);
    const post = authFetchMock.mock.calls.find(
      ([, init]) => (init as any)?.method === 'POST'
    );
    expect(String(post?.[0])).toBe('/api/trainee/quizzes/q1/submit');
    expect(JSON.parse(String((post?.[1] as any).body))).toMatchObject({
      answers: [{ questionId: 'q-1', selectedOptionId: 'o-2' }],
    });
  });

  it('takes the reasoning from the submission only, never from the question response', async () => {
    authFetchMock.mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (init?.method === 'POST')
        return json({
          ...submitResponse,
          feedback: [{ ...submitResponse.feedback[0], explanation: null }],
        });
      if (url.includes('/quizzes/LOW')) return json(questionResponse(true));
      return json({});
    });
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.click(tile());
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Quiz abgeben/ }));
    await waitFor(() =>
      expect(screen.getByText(/Richtig:/)).toBeInTheDocument()
    );
    expect(document.body.textContent).not.toContain(LEAKED);
  });

  it('names the correct option from the submission after the answer', async () => {
    await startQuiz();
    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Quiz abgeben/ }));
    await waitFor(() =>
      expect(screen.getByText(/Richtig:/)).toBeInTheDocument()
    );
    expect(screen.getByText(/Score:/).textContent).toContain('0%');
  });

  it('a completed quiz shows the stored result and reasoning (review only)', async () => {
    mockQueries([
      {
        difficulty: 'LOW',
        quizId: 'q1',
        title: 'Lesson quiz',
        unlocked: true,
        isActive: true,
        completed: true,
        passed: true,
      },
    ]);
    authFetchMock.mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/quizzes/LOW')) return json(questionResponse());
      if (url.includes('/api/trainee/quizzes/q1/submit'))
        return json({ ...submitResponse, locked: true });
      return json({});
    });
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.click(tile());
    await waitFor(() =>
      expect(screen.getByText(new RegExp(REASONING))).toBeInTheDocument()
    );
  });
});

describe('lesson quiz on the enabler page: questions without a solution', () => {
  const freeTextQuestion = {
    quiz: {
      id: 'q1',
      title: 'Lesson quiz',
      difficulty: 'LOW',
      questions: [
        {
          id: 'q-1',
          questionText: 'Which one?',
          questionType: 'MCQ',
          options: [
            { id: 'o-1', optionText: 'Right' },
            { id: 'o-2', optionText: 'Wrong' },
          ],
        },
        {
          id: 'q-2',
          questionText: 'Explain it',
          questionType: 'TEXT',
          options: [],
        },
      ],
    },
  };

  const run = async (submit: unknown) => {
    authFetchMock.mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (init?.method === 'POST') return json(submit);
      if (url.includes('/quizzes/LOW')) return json(freeTextQuestion);
      return json({});
    });
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.click(tile());
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Weiter|Next/ }));
    fireEvent.change(screen.getByPlaceholderText('Antwort eingeben...'), {
      target: { value: 'my text' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Quiz abgeben/ }));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueries([
      {
        difficulty: 'LOW',
        quizId: 'q1',
        title: 'Lesson quiz',
        unlocked: true,
        isActive: true,
        completed: false,
      },
    ]);
  });

  it('mixed: shows the percentage, the note and "Nicht bewertet" at the free text question', async () => {
    await run({
      submissionId: 's1',
      score: 100,
      locked: false,
      autoGraded: true,
      ungradedCount: 1,
      feedback: [
        {
          questionId: 'q-1',
          graded: true,
          correct: true,
          correctOptionId: 'o-1',
          explanation: null,
          selectedOptionId: 'o-1',
        },
        {
          questionId: 'q-2',
          graded: false,
          correct: false,
          correctOptionId: null,
          explanation: null,
          selectedOptionId: null,
          selectedText: 'my text',
          correctAnswerText: null,
        },
      ],
    });
    expect(await screen.findByText(/Score:/)).toHaveTextContent('100%');
    expect(screen.getByTestId('quiz-ungraded-note')).toHaveTextContent(
      'Eine Frage wurde nicht bewertet'
    );
    const item = screen.getByTestId('question-not-graded');
    expect(item).toHaveTextContent('Nicht bewertet');
    expect(item).toHaveTextContent('keine hinterlegte Lösung');
  });

  it('only questions without a solution: no percentage, no pass banner, no retry button', async () => {
    await run({
      submissionId: 's1',
      score: null,
      locked: false,
      autoGraded: false,
      ungradedCount: 2,
      feedback: [
        {
          questionId: 'q-1',
          graded: false,
          correct: false,
          correctOptionId: null,
          explanation: null,
          selectedOptionId: null,
          selectedText: 'x',
          correctAnswerText: null,
        },
        {
          questionId: 'q-2',
          graded: false,
          correct: false,
          correctOptionId: null,
          explanation: null,
          selectedOptionId: null,
          selectedText: 'my text',
          correctAnswerText: null,
        },
      ],
    });
    const box = await screen.findByTestId('quiz-not-graded');
    expect(box).toHaveAttribute('role', 'status');
    expect(box).toHaveTextContent('Dieses Quiz wird nicht automatisch bewertet');
    expect(screen.queryByText(/Score:/)).toBeNull();
    expect(screen.queryByText(/Nicht bestanden/)).toBeNull();
    expect(screen.queryByText(/Bestanden/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Quiz wiederholen/ })).toBeNull();
  });

  it('the tile of a quiz that is not graded automatically says so instead of "retry"', async () => {
    mockQueries([
      {
        difficulty: 'LOW',
        quizId: 'q1',
        title: 'Lesson quiz',
        unlocked: true,
        isActive: true,
        completed: true,
        autoGraded: false,
      } as any,
    ]);
    renderWithProviders(<TraineeEnablerPage />);
    expect(tile()).toHaveTextContent('Nicht automatisch bewertet');
    expect(tile()).not.toHaveTextContent('Wiederholung möglich');
  });
});

describe('lesson quiz on the enabler page: the active difficulty (KFB-1156)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueries([
      {
        difficulty: 'LOW',
        quizId: 'q1',
        title: 'Lesson quiz',
        unlocked: true,
        isActive: true,
        completed: false,
      },
    ]);
  });

  it('a click on the active difficulty keeps the answers and does not load the quiz again', async () => {
    await startQuiz();
    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(screen.getAllByRole('radio')[1]).toBeChecked();
    const loads = () =>
      authFetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/quizzes/LOW')
      ).length;
    expect(loads()).toBe(1);

    fireEvent.click(tile());
    fireEvent.click(tile());

    expect(loads()).toBe(1);
    expect(screen.getAllByRole('radio')[1]).toBeChecked();
  });

  it('a click on the active difficulty does not close the result either', async () => {
    await startQuiz();
    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Quiz abgeben/ }));
    await waitFor(() => expect(screen.getByText(/Score:/)).toBeInTheDocument());
    fireEvent.click(tile());
    expect(screen.getByText(/Score:/)).toBeInTheDocument();
  });

  it('marks the active difficulty for assistive technology', async () => {
    await startQuiz();
    expect(tile()).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('lesson quiz on the enabler page: the right answer (KFB-1161)', () => {
  const questions = {
    quiz: {
      id: 'q1',
      title: 'Lesson quiz',
      difficulty: 'LOW',
      questions: [
        {
          id: 'q-1',
          questionText: 'Which one?',
          questionType: 'MCQ',
          options: [
            { id: 'o-1', optionText: 'Right' },
            { id: 'o-2', optionText: 'Wrong' },
          ],
        },
        {
          id: 'q-2',
          questionText: 'Explain it',
          questionType: 'TEXT',
          options: [],
        },
      ],
    },
  };

  const answerAll = async (submit: unknown) => {
    authFetchMock.mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (init?.method === 'POST') return json(submit);
      if (url.includes('/quizzes/LOW')) return json(questions);
      return json({});
    });
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.click(tile());
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Weiter|Next/ }));
    fireEvent.change(screen.getByPlaceholderText('Antwort eingeben...'), {
      target: { value: 'my text' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Quiz abgeben/ }));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueries([
      {
        difficulty: 'LOW',
        quizId: 'q1',
        title: 'Lesson quiz',
        unlocked: true,
        isActive: true,
        completed: false,
      },
    ]);
  });

  it('shows the right option and the expected text of a question answered wrong, once the attempt is passed', async () => {
    await answerAll({
      submissionId: 's1',
      score: 50,
      locked: false,
      autoGraded: true,
      ungradedCount: 0,
      feedback: [
        {
          questionId: 'q-1',
          graded: true,
          correct: false,
          correctOptionId: 'o-1',
          explanation: null,
          selectedOptionId: 'o-2',
        },
        {
          questionId: 'q-2',
          graded: true,
          correct: false,
          correctOptionId: null,
          explanation: null,
          selectedOptionId: null,
          selectedText: 'my text',
          correctAnswerText: 'THE-EXPECTED-TEXT',
        },
      ],
    });
    await screen.findByText(/Score:/);
    expect(screen.getByText(/Richtig:\s*Right/)).toBeInTheDocument();
    expect(
      screen.getByText(/Richtig:\s*THE-EXPECTED-TEXT/)
    ).toBeInTheDocument();
    expect(screen.queryByTestId('key-after-pass')).toBeNull();
  });

  it('a failed attempt says right or wrong only and tells when the right answer comes, no "Richtig: -"', async () => {
    await answerAll({
      submissionId: 's1',
      score: 0,
      locked: false,
      autoGraded: true,
      ungradedCount: 0,
      feedback: [
        {
          questionId: 'q-1',
          graded: true,
          correct: false,
          correctOptionId: null,
          explanation: null,
          selectedOptionId: 'o-2',
        },
        {
          questionId: 'q-2',
          graded: true,
          correct: false,
          correctOptionId: null,
          explanation: null,
          selectedOptionId: null,
          selectedText: 'my text',
          correctAnswerText: null,
        },
      ],
    });
    await screen.findByText(/Score:/);
    expect(screen.queryByText(/Richtig:/)).toBeNull();
    expect(screen.getAllByTestId('key-after-pass')).toHaveLength(2);
    expect(screen.getAllByTestId('key-after-pass')[0]).toHaveTextContent(
      'nach dem Bestehen'
    );
  });

  it('a right answer needs no "Richtig" line and no hint', async () => {
    await answerAll({
      submissionId: 's1',
      score: 100,
      locked: false,
      autoGraded: true,
      ungradedCount: 0,
      feedback: [
        {
          questionId: 'q-1',
          graded: true,
          correct: true,
          correctOptionId: 'o-2',
          explanation: null,
          selectedOptionId: 'o-2',
        },
        {
          questionId: 'q-2',
          graded: true,
          correct: true,
          correctOptionId: null,
          explanation: null,
          selectedOptionId: null,
          selectedText: 'my text',
          correctAnswerText: 'my text',
        },
      ],
    });
    await screen.findByText(/Score:/);
    expect(screen.queryByText(/Richtig:/)).toBeNull();
    expect(screen.queryByTestId('key-after-pass')).toBeNull();
  });
});

describe('enabler page: the way back (KFB-1158)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueries([]);
  });

  it('leads to the themes of the component, not to a list of all modules', () => {
    renderWithProviders(<TraineeEnablerPage />);
    const back = screen.getByRole('link', { name: /Zurück zu/ });
    expect(back).toHaveAttribute('href', '/trainee/modules/c1');
    expect(back).not.toHaveTextContent('meinen Modulen');
  });
});
