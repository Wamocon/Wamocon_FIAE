import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeEnablerPage from '@/app/trainee/enablers/[enablerId]/page';
import { authFetch } from '@/lib/authFetch';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// The page of one Themenkreis (enabler) of a trainee: the summary needs a text
// (WMCNL-2925), the link back goes to the Fragenkomplex (WMCNL-2929), the
// review of a passed quiz shows the stored answers or says that there are none
// (WMCNL-2937), titles and texts use one word per thing (WMCNL-2933).

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
  useFlipbookViewer: () => ({
    title: '',
    pdfUrl: '',
    isOpen: false,
    openPdf: jest.fn(),
    closePdf: jest.fn(),
  }),
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

function json(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    clone() {
      return this;
    },
  } as unknown as Response;
}

const open = { state: 'open', locked: false, reason: null, lockedBy: null };

function mockQueries(
  quizzes: unknown[] = [],
  enabler: Record<string, unknown> = {}
) {
  // stable objects: the page syncs its form state in an effect on the data
  const enablerData = {
    enabler: {
      id: 'e1',
      title: 'Betriebliche Kommunikationssysteme',
      isActive: false,
      courseId: 'course-10',
      ...enabler,
    },
    submission: null,
    progression: open,
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

const submitButton = () =>
  screen.getByRole('button', { name: /Zusammenfassung einreichen/ });
const posts = () =>
  authFetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

describe('summary of a Themenkreis (WMCNL-2925)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueries();
  });

  it('does not send an empty summary and says why', () => {
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Bitte schreibe zuerst deine Zusammenfassung'
    );
    expect(posts()).toHaveLength(0);
    // the page stays, it is no error page
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('does not send a summary that is only white space', () => {
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '  \n\t ' },
    });
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('sends a summary with a text and clears the hint', async () => {
    authFetchMock.mockResolvedValue(json({ submission: { id: 's1' } }));
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.click(submitButton());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Meine Zusammenfassung' },
    });
    fireEvent.click(submitButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String(posts()[0][1]?.body)).solutions).toEqual([
      { scenarioIndex: 0, text: 'Meine Zusammenfassung' },
    ]);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows the answer of the server for an empty summary at the form, not instead of the page', async () => {
    authFetchMock.mockResolvedValue(
      json({ error: 'Empty submission', code: 'EMPTY_SUBMISSION' }, false, 400)
    );
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Text' },
    });
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Bitte schreibe zuerst deine Zusammenfassung'
      )
    );
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});

describe('link back and wording (WMCNL-2929, WMCNL-2933)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('goes back to the Fragenkomplex the Themenkreis was opened from', () => {
    mockQueries();
    renderWithProviders(<TraineeEnablerPage />);
    const link = screen.getByRole('link', { name: 'Zurück zum Fragenkomplex' });
    expect(link).toHaveAttribute('href', '/trainee/modules/course-10');
  });

  it('starts the title with a capital letter and says Themenkreis in the generated intro', () => {
    mockQueries([], {
      title: 'wege der Informationsbeschaffung beherrschen',
      descriptionText:
        'In diesem Modul "Wege" werden folgende Inhalte behandelt:',
    });
    renderWithProviders(<TraineeEnablerPage />);
    expect(
      screen.getByRole('heading', {
        name: 'Wege der Informationsbeschaffung beherrschen',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/In diesem Themenkreis "Wege" werden folgende/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/In diesem Modul/)).toBeNull();
  });
});

describe('review of a passed quiz (WMCNL-2937)', () => {
  const tile = {
    difficulty: 'LOW',
    quizId: 'q1',
    title: 'Lesson quiz',
    unlocked: true,
    isActive: true,
    completed: true,
    passed: true,
  };
  const question = {
    quiz: {
      id: 'q1',
      title: 'Lesson quiz',
      questions: [
        {
          id: 'qq1',
          questionText: 'Which one?',
          questionType: 'MCQ',
          options: [
            { id: 'o1', optionText: 'Right' },
            { id: 'o2', optionText: 'Wrong' },
          ],
        },
        {
          id: 'qq2',
          questionText: 'And this one?',
          questionType: 'MCQ',
          options: [
            { id: 'o3', optionText: 'Yes' },
            { id: 'o4', optionText: 'No' },
          ],
        },
      ],
    },
  };

  const review = async (stored: unknown) => {
    mockQueries([tile]);
    authFetchMock.mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/quizzes/LOW')) return json(question);
      if (url.includes('/api/trainee/quizzes/q1/submit')) return json(stored);
      return json({});
    });
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.click(screen.getByRole('button', { name: /Lesson quiz/ }));
    await waitFor(() => expect(screen.getByText(/Score:/)).toBeInTheDocument());
  };

  it('shows the stored answer of every question and no question counter', async () => {
    await review({
      score: 100,
      feedback: [
        {
          questionId: 'qq1',
          correct: true,
          correctOptionId: 'o1',
          selectedOptionId: 'o1',
        },
        {
          questionId: 'qq2',
          correct: true,
          correctOptionId: 'o3',
          selectedOptionId: 'o3',
        },
      ],
    });
    const answers = screen.getAllByText(/Deine Antwort:/);
    expect(answers).toHaveLength(2);
    expect(answers[0]).toHaveTextContent('Deine Antwort: Right');
    expect(answers[1]).toHaveTextContent('Deine Antwort: Yes');
    expect(screen.queryByText(/Frage 1 \/ 2/)).toBeNull();
    expect(screen.getByText(/Hier siehst du deine gespeicherten Antworten/));
  });

  it('says that no answers are stored instead of listing "Deine Antwort: -"', async () => {
    await review({ score: 98, feedback: [] });
    expect(screen.getByText(/Score:/)).toHaveTextContent('98%');
    expect(
      screen.getByText(
        /Zu diesem Ergebnis sind keine einzelnen Antworten gespeichert/
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Deine Antwort:/)).toBeNull();
    expect(screen.queryByText(/Hier siehst du deine gespeicherten/)).toBeNull();
    expect(screen.queryByText(/Frage 1 \/ 2/)).toBeNull();
  });

  it('keeps the question counter while the quiz is taken', async () => {
    mockQueries([{ ...tile, passed: false, completed: false }]);
    authFetchMock.mockImplementation(async () => json(question));
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.click(screen.getByRole('button', { name: /Lesson quiz/ }));
    await waitFor(() =>
      expect(screen.getByText('Frage 1 / 2')).toBeInTheDocument()
    );
  });
});
