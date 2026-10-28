import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeEnablerPage from '@/app/trainee/enablers/[enablerId]/page';
import { authFetch } from '@/lib/authFetch';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// The order of work on the enabler page of a trainee: a locked enabler shows
// its title and material, says why it is locked (padlock and words), and
// closes the submission and the quizzes with aria-disabled and an explaining
// text. A quiz that was not passed can be taken again.

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
  useParams: () => ({ enablerId: 'e2' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/trainee/enablers/e2',
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

type Progression = {
  state: 'locked' | 'open' | 'completed';
  locked: boolean;
  reason: 'SEQUENCE' | 'MANUAL' | null;
  lockedBy: { id: string; title: string } | null;
};

const locked: Progression = {
  state: 'locked',
  locked: true,
  reason: 'SEQUENCE',
  lockedBy: { id: 'e1', title: 'Enabler Eins' },
};
const open: Progression = {
  state: 'open',
  locked: false,
  reason: null,
  lockedBy: null,
};

function mockQueries(
  progression: Progression,
  quizzes: unknown[],
  extra: Record<string, unknown> = {}
) {
  // stable objects: the page syncs its form state in an effect on the data
  const enablerData = {
    enabler: {
      id: 'e2',
      title: 'Enabler Zwei',
      isActive: false,
      descriptionText: 'Material des Enablers',
    },
    submission: null,
    progression,
  };
  const quizzesData = { quizzes, ...extra };
  const docsData = {
    documents: [
      {
        id: 'd1',
        title: 'Lehrtext Grundlagen',
        storageUrl: 'https://files.test/a.pdf',
        documentType: 'THEORY',
      },
    ],
  };
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

const lockedQuizzes = [
  {
    difficulty: 'LOW',
    quizId: 'q2',
    title: 'Lesson quiz',
    unlocked: false,
    isActive: true,
    completed: false,
    passed: false,
  },
];

describe('locked enabler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueries(locked, lockedQuizzes, {
      enablerLocked: true,
      lockedBy: locked.lockedBy,
    });
  });

  it('says that it is locked and what to finish first, and keeps title and material readable', () => {
    renderWithProviders(<TraineeEnablerPage />);
    const banner = screen.getByTestId('enabler-locked-banner');
    expect(banner).toHaveTextContent('Dieser Enabler ist noch gesperrt');
    expect(banner).toHaveTextContent('Enabler Eins');
    expect(screen.getByText('Enabler Zwei')).toBeInTheDocument();
    expect(screen.getByText('Material des Enablers')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Lehrtext Grundlagen' })
    ).toBeEnabled();
  });

  it('closes the submission: aria-disabled button with an explaining text, textarea disabled', () => {
    renderWithProviders(<TraineeEnablerPage />);
    const submit = screen.getByRole('button', {
      name: /Zusammenfassung einreichen/,
    });
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    const hint = document.getElementById(
      submit.getAttribute('aria-describedby') as string
    );
    expect(hint).toHaveTextContent('Die Abgabe ist gesperrt');
    expect(hint).toHaveTextContent('Erst nach „Enabler Eins“ möglich');
    expect(screen.getByRole('textbox')).toBeDisabled();
    fireEvent.click(submit);
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it('closes the quizzes: the tile is aria-disabled with the reason and does not load questions', () => {
    renderWithProviders(<TraineeEnablerPage />);
    const tile = screen.getByRole('button', { name: /Lesson quiz/ });
    expect(tile).toHaveAttribute('aria-disabled', 'true');
    expect(tile).toHaveTextContent('Gesperrt');
    expect(tile).toHaveTextContent('Erst nach „Enabler Eins“ möglich');
    fireEvent.click(tile);
    expect(authFetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Die Quizze sind gesperrt/)).toBeInTheDocument();
  });

  it('names a lock of the trainer without an enabler to finish', () => {
    mockQueries(
      { state: 'locked', locked: true, reason: 'MANUAL', lockedBy: null },
      lockedQuizzes,
      { enablerLocked: true, lockedBy: null }
    );
    renderWithProviders(<TraineeEnablerPage />);
    expect(screen.getByTestId('enabler-locked-banner')).toHaveTextContent(
      'Dein Ausbilder hat diesen Enabler für dich gesperrt'
    );
  });
});

describe('open enabler and the repetition of a quiz', () => {
  const failedQuiz = {
    difficulty: 'LOW',
    quizId: 'q2',
    title: 'Lesson quiz',
    unlocked: true,
    isActive: true,
    completed: true,
    passed: false,
  };

  const question = {
    quiz: {
      id: 'q2',
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
      ],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows no lock for an open enabler and enables the submission', () => {
    mockQueries(open, [{ ...failedQuiz, completed: false }]);
    renderWithProviders(<TraineeEnablerPage />);
    expect(screen.queryByTestId('enabler-locked-banner')).toBeNull();
    expect(
      screen.getByRole('button', { name: /Zusammenfassung einreichen/ })
    ).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('offers a quiz that was not passed again and shows the result with a repeat button', async () => {
    mockQueries(open, [failedQuiz]);
    authFetchMock.mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (init?.method === 'POST')
        return json({
          submissionId: 's2',
          score: 0,
          locked: false,
          feedback: [
            {
              questionId: 'qq1',
              correct: false,
              correctOptionId: 'o1',
              selectedOptionId: 'o2',
            },
          ],
        });
      if (url.includes('/quizzes/LOW')) return json(question);
      return json({});
    });
    renderWithProviders(<TraineeEnablerPage />);

    const tile = screen.getByRole('button', { name: /Lesson quiz/ });
    expect(tile).not.toHaveAttribute('aria-disabled', 'true');
    expect(tile).toHaveTextContent('Nicht bestanden, Wiederholung möglich');
    fireEvent.click(tile);
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    // taken again, not shown as a review of the stored attempt
    expect(
      authFetchMock.mock.calls.some(([u]) =>
        String(u).includes('/api/trainee/quizzes/q2/submit')
      )
    ).toBe(false);

    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Quiz abgeben/ }));
    await waitFor(() =>
      expect(screen.getByText(/Nicht bestanden\./)).toBeInTheDocument()
    );
    const retry = screen.getByRole('button', { name: 'Quiz wiederholen' });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    expect(screen.queryByText(/Nicht bestanden\./)).toBeNull();
  });

  it('shows a pass without a repeat button', async () => {
    mockQueries(open, [{ ...failedQuiz, completed: false }]);
    authFetchMock.mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (init?.method === 'POST')
        return json({
          submissionId: 's2',
          score: 100,
          locked: false,
          feedback: [
            {
              questionId: 'qq1',
              correct: true,
              correctOptionId: 'o1',
              selectedOptionId: 'o1',
            },
          ],
        });
      if (url.includes('/quizzes/LOW')) return json(question);
      return json({});
    });
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.click(screen.getByRole('button', { name: /Lesson quiz/ }));
    await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Quiz abgeben/ }));
    await waitFor(() =>
      expect(screen.getByText(/Bestanden\. Das Quiz zählt/)).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('button', { name: 'Quiz wiederholen' })
    ).toBeNull();
  });

  it('tells a locked answer of the server in its own sentence', async () => {
    mockQueries(open, [{ ...failedQuiz, completed: false }]);
    authFetchMock.mockImplementation(async () =>
      json({ code: 'ENABLER_LOCKED' }, false, 403)
    );
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.click(screen.getByRole('button', { name: /Lesson quiz/ }));
    await waitFor(() =>
      expect(
        screen.getByText(/Schließe zuerst den Enabler davor ab/)
      ).toBeInTheDocument()
    );
  });
});
