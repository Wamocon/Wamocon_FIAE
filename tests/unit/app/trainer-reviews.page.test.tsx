import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import toast from 'react-hot-toast';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TrainerReviewsPage from '@/app/trainer/reviews/page';
import { authFetch } from '@/lib/authFetch';
import {
  readReviewListState,
  saveReviewListState,
} from '@/lib/trainer/review-list-state';

// The review page of the trainer (WMCNL-2999, 3000, 3001, 3002, 3003, 3004, 3005): one
// page of every list with the total and "Weitere laden", a rejection only with a
// feedback, filter and tab in the address, German terms, quiz cards without double
// entries, and the model solution that says "Musterlösung".

jest.mock('@/contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({ profile: { id: 'tr1', role: 'TRAINER' }, loading: false }),
}));
jest.mock('@/lib/authFetch');
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));
jest.mock('@/components/trainer/SubmissionFileLink', () => ({
  __esModule: true,
  SubmissionFileLink: () => null,
}));
jest.mock('@/components/ui/FlipbookViewer', () => ({
  __esModule: true,
  FlipbookViewer: (props: any) => (
    <div
      data-testid="flipbook"
      data-open={String(props.isOpen)}
      data-title={props.title}
      data-subtitle={props.subtitle}
    />
  ),
}));

let mockSearch = new URLSearchParams('');
jest.mock('next/navigation', () => ({
  __esModule: true,
  useSearchParams: () => mockSearch,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/trainer/reviews',
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const toastError = toast.error as jest.Mock;

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

const enablerItem = (n: number, over: Record<string, unknown> = {}) => ({
  id: `e${n}`,
  enablerId: 'en1',
  enablerTitle: `Themenkreis ${n}`,
  traineeId: 't1',
  traineeName: 'Leon Moretz',
  solutionText: `Zusammenfassung ${n}`,
  solutions: null,
  trainerFeedback: null,
  feedbacks: null,
  status: 'PENDING',
  submittedAt: '2026-11-02T08:00:00Z',
  attemptNumber: 1,
  ...over,
});
const useCaseItem = (n: number, over: Record<string, unknown> = {}) => ({
  id: `u${n}`,
  useCaseId: `uc${n}`,
  useCaseTitle: `Use Case ${n}`,
  traineeId: 't1',
  traineeName: 'Leon Moretz',
  submissionText: `Text ${n}`,
  status: 'PENDING',
  submittedAt: '2026-11-02T08:00:00Z',
  attemptNumber: 1,
  ...over,
});
const quizItem = (n: number, over: Record<string, unknown> = {}) => ({
  id: `q${n}`,
  traineeId: 't1',
  traineeName: 'Leon Moretz',
  quizId: `qz${n}`,
  quizTitle: `Quiz ${n}`,
  quizType: 'LESSON',
  score: 99,
  isReviewed: false,
  submittedAt: '2026-11-02T08:00:00Z',
  attemptNumber: 1,
  difficulty: 'LOW',
  enablerTitle: `Quiz ${n}`,
  ...over,
});

type World = {
  enablers?: any[];
  enablerTotal?: number;
  useCases?: any[];
  useCaseTotal?: number;
  quizzes?: any[];
  quizTotal?: number;
  documents?: any[];
  patch?: (url: string, body: any) => Response;
  /** POST /api/trainer/quiz-submissions/bulk-review */
  bulk?: (body: any) => Response;
  courses?: Array<{ id: string; title: string }>;
};

let calls: string[] = [];

function world(w: World) {
  calls = [];
  authFetchMock.mockImplementation(async (input: any, init: any) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (init?.method === 'PATCH') {
      return w.patch?.(url, JSON.parse(init.body)) ?? json({ ok: true });
    }
    if (
      init?.method === 'POST' &&
      url.endsWith('/quiz-submissions/bulk-review')
    ) {
      const body = JSON.parse(init.body);
      return (
        w.bulk?.(body) ??
        json({
          ok: true,
          requested: body.ids.length,
          marked: body.ids.length,
          alreadyReviewed: 0,
          skipped: 0,
          reviewedIds: body.ids,
        })
      );
    }
    if (url === '/api/trainer/courses') {
      return json({ courses: w.courses ?? [] });
    }
    const q = new URL(url, 'http://x').searchParams;
    const offset = Number(q.get('offset') ?? 0);
    const limit = Number(q.get('limit') ?? 50);
    if (url.startsWith('/api/trainer/reviews?')) {
      const kind = q.get('type');
      const rows = kind === 'enabler' ? (w.enablers ?? []) : (w.useCases ?? []);
      const total =
        kind === 'enabler'
          ? (w.enablerTotal ?? rows.length)
          : (w.useCaseTotal ?? rows.length);
      return json({
        enablerSubmissions:
          kind === 'enabler' ? rows.slice(offset, offset + limit) : [],
        useCaseSubmissions:
          kind === 'usecase' ? rows.slice(offset, offset + limit) : [],
        enablerTotal: kind === 'enabler' ? total : 0,
        useCaseTotal: kind === 'usecase' ? total : 0,
      });
    }
    if (url.startsWith('/api/trainer/quiz-submissions?')) {
      const rows = w.quizzes ?? [];
      return json({
        submissions: rows.slice(offset, offset + limit),
        total: w.quizTotal ?? rows.length,
        limit,
        offset,
      });
    }
    if (url.includes('/documents'))
      return json({ documents: w.documents ?? [] });
    return json({}, false, 404);
  });
}

const render = (search = '') => {
  mockSearch = new URLSearchParams(search);
  window.history.replaceState(
    null,
    '',
    `/trainer/reviews${search ? `?${search}` : ''}`
  );
  return renderWithProviders(<TrainerReviewsPage />);
};

const urls = (kind: string) =>
  calls.filter(c => c.includes(kind)).map(c => c.replace(/^GET /, ''));

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
});

describe('WMCNL-2999: every list is a page with the total and "Weitere laden"', () => {
  it('asks for the first page of 50 and says how many of the total are shown', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => enablerItem(i));
    world({ enablers: rows, enablerTotal: 2158 });
    render();
    expect(await screen.findByText('Themenkreis 0')).toBeInTheDocument();
    expect(urls('/api/trainer/reviews?')).toEqual([
      '/api/trainer/reviews?type=enabler&status=pending&limit=50&offset=0',
    ]);
    expect(screen.getByTestId('reviews-count')).toHaveTextContent(
      '50 von 2158 angezeigt'
    );
    expect(screen.getAllByRole('button', { name: 'Genehmigen' })).toHaveLength(
      50
    );
  });

  it('loads the next page on request and appends it', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => enablerItem(i));
    world({ enablers: rows });
    render();
    await screen.findByText('Themenkreis 0');
    fireEvent.click(screen.getByRole('button', { name: 'Weitere laden' }));
    await waitFor(() =>
      expect(screen.getByTestId('reviews-count')).toHaveTextContent(
        '70 von 70 angezeigt'
      )
    );
    expect(urls('/api/trainer/reviews?')[1]).toBe(
      '/api/trainer/reviews?type=enabler&status=pending&limit=50&offset=50'
    );
    expect(screen.getByText('Themenkreis 69')).toBeInTheDocument();
    expect(screen.getByText('Themenkreis 0')).toBeInTheDocument();
    // everything is loaded: nothing more to ask for
    expect(
      screen.queryByRole('button', { name: 'Weitere laden' })
    ).not.toBeInTheDocument();
  });

  it('shows a row that came twice between two pages once', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => enablerItem(i));
    world({ enablers: rows, enablerTotal: 60 });
    render();
    await screen.findByText('Themenkreis 0');
    // a new submission pushed the rows down, the next page starts with a known one
    const original = authFetchMock.getMockImplementation()!;
    authFetchMock.mockImplementation(async (input: any, init: any) => {
      if (String(input).includes('offset=50')) {
        return json({
          enablerSubmissions: [rows[49], ...rows.slice(50)],
          useCaseSubmissions: [],
          enablerTotal: 60,
          useCaseTotal: 0,
        });
      }
      return original(input, init);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Weitere laden' }));
    await waitFor(() =>
      expect(screen.getByTestId('reviews-count')).toHaveTextContent(
        '60 von 60 angezeigt'
      )
    );
    expect(screen.getAllByText('Themenkreis 49')).toHaveLength(1);
  });

  it('says so when the next page cannot be loaded, and keeps what is shown', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => enablerItem(i));
    world({ enablers: rows });
    render();
    await screen.findByText('Themenkreis 0');
    const original = authFetchMock.getMockImplementation()!;
    authFetchMock.mockImplementation(async (input: any, init: any) =>
      String(input).includes('offset=50')
        ? json({}, false, 500)
        : original(input, init)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Weitere laden' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Weitere Einträge konnten nicht geladen werden'
    );
    expect(screen.getByText('Themenkreis 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weitere laden' })).toBeEnabled();
  });

  it('pages the use cases and the quizzes the same way', async () => {
    world({
      useCases: Array.from({ length: 60 }, (_, i) => useCaseItem(i)),
      quizzes: Array.from({ length: 80 }, (_, i) => quizItem(i)),
      quizTotal: 2100,
    });
    render('view=usecases');
    await screen.findByText('Use Case 0');
    expect(urls('/api/trainer/reviews?')[0]).toContain('type=usecase');
    expect(screen.getByTestId('reviews-count')).toHaveTextContent(
      '50 von 60 angezeigt'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Quizze' }));
    await screen.findByText('Quiz 0');
    expect(urls('/api/trainer/quiz-submissions?')[0]).toBe(
      '/api/trainer/quiz-submissions?onlyPending=true&limit=50&offset=0'
    );
    expect(screen.getByTestId('reviews-count')).toHaveTextContent(
      '50 von 2100 angezeigt'
    );
  });

  it('counts the total down when a review leaves the list of the open ones', async () => {
    world({
      useCases: Array.from({ length: 3 }, (_, i) => useCaseItem(i)),
      useCaseTotal: 2158,
    });
    render('view=usecases');
    await screen.findByText('Use Case 0');
    const card = screen
      .getByText('Use Case 0')
      .closest('.group') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Genehmigen' }));
    await waitFor(() =>
      expect(screen.getByTestId('reviews-count')).toHaveTextContent(
        '2 von 2157 angezeigt'
      )
    );
    expect(screen.queryByText('Use Case 0')).not.toBeInTheDocument();
    // no new request for the whole list: the next page still starts after the rows that are there
    expect(urls('/api/trainer/reviews?')).toHaveLength(1);
  });
});

describe('WMCNL-3000: a rejection needs a feedback', () => {
  it('does not send a rejection of a use case without a feedback, and says why', async () => {
    world({ useCases: [useCaseItem(1)] });
    render('view=usecases');
    await screen.findByText('Use Case 1');
    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bitte schreibe ein Feedback, bevor du ablehnst.'
    );
    expect(toastError).toHaveBeenCalled();
    expect(calls.some(c => c.startsWith('PATCH'))).toBe(false);
    // the card is still there and still open
    expect(screen.getByText('Use Case 1')).toBeInTheDocument();
  });

  it('does not take blanks for a feedback', async () => {
    world({ useCases: [useCaseItem(1)] });
    render('view=usecases');
    await screen.findByText('Use Case 1');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(calls.some(c => c.startsWith('PATCH'))).toBe(false);
  });

  it('sends the rejection with the feedback, and the hint goes away when the trainer types', async () => {
    world({ useCases: [useCaseItem(1)] });
    render('view=usecases');
    await screen.findByText('Use Case 1');
    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    await screen.findByRole('alert');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Bitte ein Beispiel ergänzen.' },
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    await waitFor(() =>
      expect(calls).toContain('PATCH /api/trainer/reviews/use-cases/u1')
    );
    const patch = authFetchMock.mock.calls.find(
      c => (c[1] as any)?.method === 'PATCH'
    )!;
    expect(JSON.parse((patch[1] as any).body)).toEqual({
      status: 'REJECTED',
      trainerFeedback: 'Bitte ein Beispiel ergänzen.',
    });
  });

  it('approves without a feedback', async () => {
    world({ useCases: [useCaseItem(1)] });
    render('view=usecases');
    await screen.findByText('Use Case 1');
    fireEvent.click(screen.getByRole('button', { name: 'Genehmigen' }));
    await waitFor(() =>
      expect(calls).toContain('PATCH /api/trainer/reviews/use-cases/u1')
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('asks for a feedback of a lesson as well, one per scenario counts', async () => {
    world({
      enablers: [
        enablerItem(1, {
          solutionText: null,
          solutions: [
            { scenarioIndex: 0, text: 'Antwort A' },
            { scenarioIndex: 1, text: 'Antwort B' },
          ],
        }),
      ],
    });
    render();
    await screen.findByText('Themenkreis 1');
    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(calls.some(c => c.startsWith('PATCH'))).toBe(false);
    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: 'Szenario 1 ist zu knapp.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    await waitFor(() =>
      expect(calls).toContain('PATCH /api/trainer/reviews/enablers/e1')
    );
  });

  it('keeps a submission without any text rejectable: it gets a feedback field', async () => {
    world({
      enablers: [enablerItem(1, { solutionText: null, solutions: [] })],
    });
    render();
    await screen.findByText('Themenkreis 1');
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('puts the card back and says why when the server asks for a feedback', async () => {
    world({
      useCases: [useCaseItem(1)],
      patch: () => json({ code: 'FEEDBACK_REQUIRED', error: 'x' }, false, 400),
    });
    render('view=usecases');
    await screen.findByText('Use Case 1');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'ok' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bitte schreibe ein Feedback'
    );
    expect(screen.getByText('Use Case 1')).toBeInTheDocument();
  });
});

describe('WMCNL-3002: tab and filter stay, the heading follows the filter', () => {
  it('takes tab and filter from the address, so a reload keeps them', async () => {
    world({ quizzes: [quizItem(1, { isReviewed: true })] });
    render('view=quizzes&status=all');
    await screen.findByText('Quiz 1');
    expect(urls('/api/trainer/quiz-submissions?')[0]).toContain(
      'onlyPending=false'
    );
    expect(
      screen.getByRole('heading', { name: 'Alle Reviews' })
    ).toBeInTheDocument();
  });

  it('keeps the old link of the dashboard working (onlyPending=true)', async () => {
    world({ enablers: [enablerItem(1)] });
    render('onlyPending=true&view=enablers');
    await screen.findByText('Themenkreis 1');
    expect(urls('/api/trainer/reviews?')[0]).toContain('status=pending');
    expect(
      screen.getByRole('heading', { name: 'Offene Reviews' })
    ).toBeInTheDocument();
  });

  it('writes tab and filter into the address and keeps the chosen occupation in it', async () => {
    world({ enablers: [enablerItem(1)], useCases: [useCaseItem(1)] });
    render('catalog=KFBM');
    await screen.findByText('Themenkreis 1');
    expect(window.location.search).toContain('view=enablers');
    fireEvent.click(screen.getByRole('button', { name: 'Use Cases' }));
    await screen.findByText('Use Case 1');
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'approved' },
    });
    await waitFor(() =>
      expect(window.location.search).toContain('status=approved')
    );
    const params = new URLSearchParams(window.location.search);
    expect(params.get('view')).toBe('usecases');
    expect(params.get('status')).toBe('approved');
    expect(params.get('catalog')).toBe('KFBM');
    expect(params.get('onlyPending')).toBeNull();
  });

  it('names the filter in the heading', async () => {
    world({ enablers: [enablerItem(1)] });
    render();
    await screen.findByText('Themenkreis 1');
    const select = screen.getByRole('combobox');
    for (const [value, heading] of [
      ['all', 'Alle Reviews'],
      ['approved', 'Genehmigte Reviews'],
      ['rejected', 'Abgelehnte Reviews'],
      ['pending', 'Offene Reviews'],
    ]) {
      fireEvent.change(select, { target: { value } });
      expect(
        await screen.findByRole('heading', { name: heading })
      ).toBeInTheDocument();
    }
  });

  it('asks the server for the filter, not the whole list', async () => {
    world({ enablers: [enablerItem(1)] });
    render();
    await screen.findByText('Themenkreis 1');
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'rejected' },
    });
    await waitFor(() =>
      expect(urls('/api/trainer/reviews?').at(-1)).toContain('status=rejected')
    );
  });

  it('loads as many rows again as were loaded when "Details" was opened', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => quizItem(i));
    world({ quizzes: rows });
    saveReviewListState({
      search: 'view=quizzes&status=pending',
      key: 'quizzes|pending|all||',
      scrollTop: 640,
      loaded: 120,
    });
    render('view=quizzes&status=pending');
    await screen.findByText('Quiz 0');
    await waitFor(() =>
      expect(screen.getByTestId('reviews-count')).toHaveTextContent(
        '120 von 200 angezeigt'
      )
    );
    const asked = urls('/api/trainer/quiz-submissions?');
    expect(asked[0]).toContain('limit=50&offset=0');
    expect(asked[1]).toContain('limit=70&offset=50');
    // the position is used once
    expect(readReviewListState('quizzes|pending|all||')).toBeNull();
  });

  it('does not use the position of another list', async () => {
    world({ quizzes: Array.from({ length: 200 }, (_, i) => quizItem(i)) });
    saveReviewListState({
      search: 'view=quizzes&status=all',
      key: 'quizzes|all|all||',
      scrollTop: 640,
      loaded: 120,
    });
    render('view=quizzes&status=pending');
    await screen.findByText('Quiz 0');
    expect(urls('/api/trainer/quiz-submissions?')).toHaveLength(1);
  });

  it('stores the list and the position when "Details" is opened', async () => {
    world({ quizzes: [quizItem(1)] });
    render('view=quizzes&status=pending&catalog=KFBM');
    await screen.findByText('Quiz 1');
    const link = screen.getByRole('link', { name: 'Details' });
    expect(link).toHaveAttribute('href', '/trainer/reviews/quizzes/q1');
    act(() => {
      link.addEventListener('click', e => e.preventDefault());
      fireEvent.click(link);
    });
    const state = readReviewListState('quizzes|pending|all||KFBM');
    expect(state).toMatchObject({
      loaded: 1,
      search: 'view=quizzes&status=pending&catalog=KFBM',
    });
  });
});

describe('WMCNL-3003: German terms', () => {
  it('names the tabs, the badges and the status in German', async () => {
    world({
      enablers: [enablerItem(1, { status: 'PENDING' })],
      useCases: [
        useCaseItem(1, { status: 'APPROVED' }),
        useCaseItem(2, { status: 'REJECTED' }),
        useCaseItem(3, { status: 'PENDING' }),
      ],
      quizzes: [
        quizItem(1),
        quizItem(2, { quizType: 'GLOBAL', difficulty: null }),
      ],
    });
    render('status=all');
    await screen.findByText('Themenkreis 1');
    expect(
      screen.getByRole('button', { name: 'Themenkreise' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Use Cases' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quizze' })).toBeInTheDocument();
    expect(screen.getByText('In Prüfung')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use Cases' }));
    await screen.findByText('Use Case 1');
    const approvedCard = screen
      .getByText('Use Case 1')
      .closest('.group') as HTMLElement;
    expect(within(approvedCard).getByText('Genehmigt')).toBeInTheDocument();
    expect(screen.getAllByText('Abgelehnt').length).toBeGreaterThan(0);
    expect(screen.queryByText('APPROVED')).not.toBeInTheDocument();
    expect(screen.queryByText('REJECTED')).not.toBeInTheDocument();
    expect(screen.queryByText('PENDING')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quizze' }));
    await screen.findByText('Quiz 1');
    expect(screen.getByText('Typ:')).toBeInTheDocument();
    // the badge of the quiz type and the level, not LESSON, LOW
    const card = screen.getByText('Quiz 1').closest('.group') as HTMLElement;
    expect(within(card).getByText('Themenkreis')).toBeInTheDocument();
    expect(within(card).getByText('Niedrig')).toBeInTheDocument();
    expect(screen.queryByText('LESSON')).not.toBeInTheDocument();
    expect(screen.queryByText('LOW')).not.toBeInTheDocument();
    expect(screen.getAllByText('Global').length).toBeGreaterThan(0);
    expect(screen.queryByText('GLOBAL')).not.toBeInTheDocument();
  });

  it('names the level of a quiz in German for every level', async () => {
    world({
      quizzes: [
        quizItem(1, { difficulty: 'LOW' }),
        quizItem(2, { difficulty: 'MEDIUM' }),
        quizItem(3, { difficulty: 'HIGH' }),
      ],
    });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    for (const label of ['Niedrig', 'Mittel', 'Hoch']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe('WMCNL-3004: quiz cards without double entries', () => {
  it('names the trainee once and has no progress bar', async () => {
    world({ quizzes: [quizItem(1)] });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    const card = screen.getByText('Quiz 1').closest('.group') as HTMLElement;
    expect(within(card).getAllByText(/Leon Moretz/)).toHaveLength(1);
    expect(within(card).queryByText('Teilnehmer')).not.toBeInTheDocument();
    expect(within(card).queryByText('Fortschritt')).not.toBeInTheDocument();
    expect(card.querySelector('.h-1\\.5')).toBeNull();
  });

  it('does not repeat the quiz title as the lesson, and names the lesson when it says something else', async () => {
    world({
      quizzes: [
        quizItem(1, { enablerTitle: 'Quiz 1' }),
        quizItem(2, { enablerTitle: 'Betriebliche Kommunikationssysteme' }),
      ],
    });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    const same = screen.getByText('Quiz 1').closest('.group') as HTMLElement;
    expect(
      within(same).queryByText('Themenkreis', { selector: 'div' })
    ).toBeNull();
    const other = screen.getByText('Quiz 2').closest('.group') as HTMLElement;
    expect(
      within(other).getByText('Betriebliche Kommunikationssysteme')
    ).toBeInTheDocument();
  });

  it('colours the result by the passing score: green from 50 percent, red below', async () => {
    world({
      quizzes: [
        quizItem(1, { score: 99 }),
        quizItem(2, { score: 50 }),
        quizItem(3, { score: 30 }),
        quizItem(4, { score: null }),
      ],
    });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    const scoreOf = (title: string, text: string) =>
      within(
        screen.getByText(title).closest('.group') as HTMLElement
      ).getByText(text);
    expect(scoreOf('Quiz 1', '99%').className).toContain('text-green');
    expect(scoreOf('Quiz 2', '50%').className).toContain('text-green');
    expect(scoreOf('Quiz 3', '30%').className).toContain('text-red');
    expect(scoreOf('Quiz 4', 'Nicht bewertet').className).not.toMatch(
      /text-(green|red)/
    );
  });

  it('marks a quiz as reviewed: it leaves the list of the open ones and the total goes down', async () => {
    world({ quizzes: [quizItem(1), quizItem(2)], quizTotal: 2100 });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    fireEvent.click(
      within(
        screen.getByText('Quiz 1').closest('.group') as HTMLElement
      ).getByRole('button', { name: /Als bewertet markieren/ })
    );
    await waitFor(() =>
      expect(screen.getByTestId('reviews-count')).toHaveTextContent(
        '1 von 2099 angezeigt'
      )
    );
    expect(screen.queryByText('Quiz 1')).not.toBeInTheDocument();
    const patch = authFetchMock.mock.calls.find(
      c => (c[1] as any)?.method === 'PATCH'
    )!;
    expect(JSON.parse((patch[1] as any).body)).toEqual({ is_reviewed: true });
  });

  it('filters by a text and by the kind of quiz on the server (WMCNL-3001)', async () => {
    world({ quizzes: [quizItem(1)] });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    fireEvent.change(screen.getByPlaceholderText('Azubi oder Quiz suchen'), {
      target: { value: 'Leon' },
    });
    await waitFor(
      () =>
        expect(urls('/api/trainer/quiz-submissions?').at(-1)).toContain(
          'q=Leon'
        ),
      { timeout: 3000 }
    );
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'GLOBAL' } });
    await waitFor(() =>
      expect(urls('/api/trainer/quiz-submissions?').at(-1)).toContain(
        'quizType=GLOBAL'
      )
    );
  });
});

describe('WMCNL-3005: the model solution says what it is', () => {
  it('shows "Musterlösung" under the title, not "Theorie-Dokument"', async () => {
    world({
      useCases: [useCaseItem(1)],
      documents: [
        {
          documentType: 'TRAINER_SOLUTION',
          storageUrl: 'https://storage.example/loesung.pdf',
          title: 'Use Case K2-a: Musterlösung (PDF)',
        },
      ],
    });
    render('view=usecases');
    await screen.findByText('Use Case 1');
    fireEvent.click(await screen.findByRole('button', { name: /Lösungs-PDF/ }));
    const viewer = screen.getByTestId('flipbook');
    expect(viewer).toHaveAttribute('data-open', 'true');
    expect(viewer).toHaveAttribute(
      'data-title',
      'Use Case K2-a: Musterlösung (PDF)'
    );
    expect(viewer).toHaveAttribute('data-subtitle', 'Musterlösung');
  });
});

const COURSE_A = '77777777-7777-4777-8777-777777777777';
const COURSE_B = '88888888-8888-4888-8888-888888888888';

const openQuizzes = (n: number, over: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) => quizItem(i + 1, over));

const markButton = () =>
  screen.getByRole('button', { name: 'Ausgewählte als bewertet markieren' });
const selectAll = () =>
  screen.getByRole('checkbox', { name: 'Alle auf dieser Seite auswählen' });
const postedBulk = () =>
  authFetchMock.mock.calls.filter(c => (c[1] as any)?.method === 'POST');
const confirmInDialog = async () =>
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Als bewertet markieren',
    })
  );

describe('WMCNL-3001: collective action "Als bewertet markieren"', () => {
  it('has a checkbox per open quiz, a select-all and a counter', async () => {
    world({
      quizzes: [
        quizItem(1, { traineeName: 'Leon Moretz' }),
        quizItem(2),
        quizItem(3),
      ],
    });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    expect(
      screen.getByRole('checkbox', {
        name: 'Quiz „Quiz 1“ von Leon Moretz auswählen',
      })
    ).toBeInTheDocument();
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('0 ausgewählt');
    expect(markButton()).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /Quiz „Quiz 2“/ }));
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('1 ausgewählt');
    expect(markButton()).toBeEnabled();
    expect(selectAll()).not.toBeChecked();

    fireEvent.click(selectAll());
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('3 ausgewählt');
    expect(selectAll()).toBeChecked();

    fireEvent.click(selectAll());
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('0 ausgewählt');
  });

  it('offers no checkbox for a quiz that is reviewed already', async () => {
    world({ quizzes: [quizItem(1), quizItem(2, { isReviewed: true })] });
    render('view=quizzes&status=all');
    await screen.findByText('Quiz 1');
    expect(
      screen.getAllByRole('checkbox', { name: /auswählen$/ })
    ).toHaveLength(2);
    fireEvent.click(selectAll());
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('1 ausgewählt');
  });

  it('asks first, names the number of quizzes and trainees, and sends nothing before the confirmation', async () => {
    world({
      quizzes: [
        quizItem(1, { traineeId: 't1' }),
        quizItem(2, { traineeId: 't1' }),
        quizItem(3, { traineeId: 't2', traineeName: 'Anna Beck' }),
      ],
    });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    fireEvent.click(selectAll());
    fireEvent.click(markButton());
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Du markierst 3 Quizze von 2 Azubis als bewertet.'
    );
    expect(dialog).toHaveTextContent(
      'Jeder dieser Azubis erhält dazu eine Benachrichtigung.'
    );
    // the focus starts on "Abbrechen", so a stray Enter confirms nothing
    expect(
      within(dialog).getByRole('button', { name: 'Abbrechen' })
    ).toHaveFocus();
    expect(postedBulk()).toHaveLength(0);
  });

  it('says "1 Quiz von 1 Azubi" for one', async () => {
    world({ quizzes: [quizItem(1)] });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    fireEvent.click(selectAll());
    fireEvent.click(markButton());
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Du markierst 1 Quiz von 1 Azubi als bewertet.'
    );
  });

  it('closes with Escape and with "Abbrechen" and keeps the selection', async () => {
    world({ quizzes: openQuizzes(2) });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    fireEvent.click(selectAll());
    fireEvent.click(markButton());
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 ausgewählt');

    fireEvent.click(markButton());
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Abbrechen',
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(postedBulk()).toHaveLength(0);
  });

  it('keeps the focus inside the dialog (Tab walks in a circle)', async () => {
    world({ quizzes: openQuizzes(2) });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    fireEvent.click(selectAll());
    fireEvent.click(markButton());
    const dialog = await screen.findByRole('dialog');
    within(dialog)
      .getByRole('button', { name: 'Als bewertet markieren' })
      .focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(
      within(dialog).getByRole('button', { name: 'Abbrechen' })
    ).toHaveFocus();
  });

  it('sends the selected ids once confirmed, takes them from the list and the total, and says what happened', async () => {
    world({ quizzes: openQuizzes(3), quizTotal: 2158 });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    fireEvent.click(screen.getByRole('checkbox', { name: /Quiz „Quiz 1“/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Quiz „Quiz 3“/ }));
    fireEvent.click(markButton());
    await confirmInDialog();
    await waitFor(() =>
      expect(screen.queryByText('Quiz 1')).not.toBeInTheDocument()
    );
    expect(calls).toContain('POST /api/trainer/quiz-submissions/bulk-review');
    expect(JSON.parse((postedBulk()[0][1] as any).body)).toEqual({
      ids: ['q1', 'q3'],
    });
    expect(screen.queryByText('Quiz 3')).not.toBeInTheDocument();
    expect(screen.getByText('Quiz 2')).toBeInTheDocument();
    expect(screen.getByTestId('reviews-count')).toHaveTextContent(
      '1 von 2156 angezeigt'
    );
    expect(screen.getByTestId('bulk-result')).toHaveTextContent(
      '2 Quizze als bewertet markiert.'
    );
    expect(toast.success).toHaveBeenCalledWith(
      '2 Quizze als bewertet markiert.'
    );
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('0 ausgewählt');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reports what was already done and what was skipped, and never calls a skipped quiz done', async () => {
    world({
      quizzes: openQuizzes(3),
      bulk: () =>
        json({
          ok: true,
          requested: 3,
          marked: 1,
          alreadyReviewed: 1,
          skipped: 1,
          reviewedIds: ['q1', 'q2'],
        }),
    });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    fireEvent.click(selectAll());
    fireEvent.click(markButton());
    await confirmInDialog();
    await waitFor(() =>
      expect(screen.queryByText('Quiz 1')).not.toBeInTheDocument()
    );
    // the one the server skipped is still open in the list
    expect(screen.getByText('Quiz 3')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-result')).toHaveTextContent(
      '1 Quiz als bewertet markiert. 1 war bereits bewertet. 1 nicht geändert (nicht gefunden oder keine Berechtigung).'
    );
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps everything and says so when the server fails', async () => {
    world({
      quizzes: openQuizzes(2),
      bulk: () => json({ error: 'x' }, false, 500),
    });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    fireEvent.click(selectAll());
    fireEvent.click(markButton());
    await confirmInDialog();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain(
      'konnten nicht als bewertet markiert werden'
    );
    expect(screen.getByText('Quiz 1')).toBeInTheDocument();
    expect(screen.getByText('Quiz 2')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 ausgewählt');
    expect(screen.queryByTestId('bulk-result')).not.toBeInTheDocument();
  });

  it('shows the quizzes as reviewed (not gone) in the list of all', async () => {
    world({ quizzes: openQuizzes(2) });
    render('view=quizzes&status=all');
    await screen.findByText('Quiz 1');
    fireEvent.click(selectAll());
    fireEvent.click(markButton());
    await confirmInDialog();
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Bewertet' })).toHaveLength(
        2
      )
    );
    expect(screen.getByText('Quiz 1')).toBeInTheDocument();
    // nothing is open any more: no action bar
    expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument();
  });

  it('selects at most 100 and says so', async () => {
    world({ quizzes: openQuizzes(130) });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    fireEvent.click(screen.getByRole('button', { name: 'Weitere laden' }));
    await waitFor(() =>
      expect(screen.getByTestId('reviews-count')).toHaveTextContent(
        '100 von 130'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Weitere laden' }));
    await waitFor(() =>
      expect(screen.getByTestId('reviews-count')).toHaveTextContent(
        '130 von 130'
      )
    );
    fireEvent.click(selectAll());
    expect(screen.getByTestId('bulk-count')).toHaveTextContent(
      '100 ausgewählt'
    );
    expect(screen.getByTestId('bulk-bar')).toHaveTextContent('höchstens 100');
    fireEvent.click(screen.getByRole('checkbox', { name: /Quiz „Quiz 101“/ }));
    expect(toastError).toHaveBeenCalledWith(
      'Es lassen sich höchstens 100 Quizze auf einmal auswählen.'
    );
    expect(screen.getByTestId('bulk-count')).toHaveTextContent(
      '100 ausgewählt'
    );
  });

  it('drops the selection when the filter changes', async () => {
    world({ quizzes: openQuizzes(2) });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    fireEvent.click(selectAll());
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 ausgewählt');
    fireEvent.change(screen.getByRole('combobox', { name: 'Fragenkomplex:' }), {
      target: { value: 'global' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('bulk-count')).toHaveTextContent('0 ausgewählt')
    );
  });
});

describe('WMCNL-3001: filter by question set (Fragenkomplex)', () => {
  const courseSelect = () =>
    screen.getByRole('combobox', { name: 'Fragenkomplex:' });

  it('offers all, global and the question sets of the occupation', async () => {
    world({
      quizzes: openQuizzes(1),
      courses: [
        { id: COURSE_A, title: 'K1 Telefonieren' },
        { id: COURSE_B, title: 'K2 Schriftverkehr' },
      ],
    });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    await waitFor(() =>
      expect(within(courseSelect()).getAllByRole('option')).toHaveLength(4)
    );
    expect(
      within(courseSelect())
        .getAllByRole('option')
        .map(o => o.textContent)
    ).toEqual(['Alle', 'Global', 'K1 Telefonieren', 'K2 Schriftverkehr']);
    expect(calls).toContain('GET /api/trainer/courses');
  });

  it('asks the server for the question set and keeps it in the address', async () => {
    world({
      quizzes: openQuizzes(2),
      courses: [{ id: COURSE_A, title: 'K1 Telefonieren' }],
    });
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    await waitFor(() =>
      expect(within(courseSelect()).getAllByRole('option')).toHaveLength(3)
    );
    fireEvent.change(courseSelect(), { target: { value: COURSE_A } });
    await waitFor(() =>
      expect(urls('/api/trainer/quiz-submissions?').at(-1)).toBe(
        `/api/trainer/quiz-submissions?onlyPending=true&limit=50&offset=0&course=${COURSE_A}`
      )
    );
    expect(window.location.search).toContain(`course=${COURSE_A}`);

    fireEvent.change(courseSelect(), { target: { value: 'global' } });
    await waitFor(() =>
      expect(urls('/api/trainer/quiz-submissions?').at(-1)).toContain(
        'course=global'
      )
    );
    expect(window.location.search).toContain('course=global');

    fireEvent.change(courseSelect(), { target: { value: 'all' } });
    await waitFor(() =>
      expect(urls('/api/trainer/quiz-submissions?').at(-1)).not.toContain(
        'course='
      )
    );
    expect(window.location.search).not.toContain('course');
  });

  it('takes the question set from the address (reload, link, way back)', async () => {
    world({
      quizzes: openQuizzes(1),
      courses: [{ id: COURSE_A, title: 'K1 Telefonieren' }],
    });
    render(`view=quizzes&course=${COURSE_A}`);
    await screen.findByText('Quiz 1');
    expect(urls('/api/trainer/quiz-submissions?')[0]).toContain(
      `course=${COURSE_A}`
    );
    await waitFor(() => expect(courseSelect()).toHaveValue(COURSE_A));
  });

  it('ignores a value in the address that is no question set', async () => {
    world({ quizzes: openQuizzes(1) });
    render('view=quizzes&course=nope');
    await screen.findByText('Quiz 1');
    expect(urls('/api/trainer/quiz-submissions?')[0]).not.toContain('course=');
  });

  it('drops a question set of another occupation once the list of this one is known', async () => {
    world({
      quizzes: openQuizzes(1),
      courses: [{ id: COURSE_B, title: 'K2' }],
    });
    render(`view=quizzes&course=${COURSE_A}`);
    await screen.findByText('Quiz 1');
    await waitFor(() => expect(courseSelect()).toHaveValue('all'));
  });

  it('still works when the question sets cannot be loaded', async () => {
    world({ quizzes: openQuizzes(1) });
    const original = authFetchMock.getMockImplementation()!;
    authFetchMock.mockImplementation(async (input: any, init: any) =>
      String(input) === '/api/trainer/courses'
        ? json({}, false, 500)
        : original(input, init)
    );
    render('view=quizzes');
    await screen.findByText('Quiz 1');
    expect(within(courseSelect()).getAllByRole('option')).toHaveLength(2);
  });

  it('is not part of the address of the lessons and use cases', async () => {
    world({ quizzes: openQuizzes(1), enablers: [enablerItem(1)] });
    render('view=quizzes&course=global');
    await screen.findByText('Quiz 1');
    expect(window.location.search).toContain('course=global');
    fireEvent.click(screen.getByRole('button', { name: 'Themenkreise' }));
    await screen.findByText('Themenkreis 1');
    expect(window.location.search).not.toContain('course');
  });
});
