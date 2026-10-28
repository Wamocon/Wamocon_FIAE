import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import LernfeldDetailPage from '@/app/trainee/lernfelder/[id]/page';
import ModuleDetailPage from '@/app/trainee/modules/[moduleId]/page';
import {
  EnablerStateBadge,
  lockText,
} from '@/components/trainee/EnablerStateBadge';
import { authFetch } from '@/lib/authFetch';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// Three states per enabler, always as symbol plus words: locked (padlock and
// "erst nach X"), open, completed. In the list of a course ("Lernen") and on
// the page of a learning field.

jest.mock('@/contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({ profile: { id: 't1', role: 'TRAINEE' } }),
}));
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('@/lib/hooks/useApiQuery');
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ id: 'lf-1', moduleId: 'c1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/x',
  useSearchParams: () => new URLSearchParams(),
}));

const authFetchMock = authFetch as jest.Mock;
const useApiQueryMock = useApiQuery as jest.MockedFunction<typeof useApiQuery>;

describe('EnablerStateBadge', () => {
  it('shows the padlock, the word and what to finish first for a locked enabler', () => {
    renderWithProviders(
      <EnablerStateBadge
        state="locked"
        reason="SEQUENCE"
        lockedByTitle="Enabler Eins"
      />
    );
    const badge = screen.getByTestId('enabler-state-locked');
    expect(badge).toHaveTextContent('Gesperrt');
    expect(badge).toHaveTextContent('Erst nach „Enabler Eins“ möglich');
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('names a lock of the trainer and a lock without a known predecessor', () => {
    const t = (key: string, params?: Record<string, string | number>) =>
      `${key}${params ? JSON.stringify(params) : ''}`;
    expect(lockText(t, 'MANUAL')).toBe('progression.lockedManual');
    expect(lockText(t, 'SEQUENCE', null)).toBe(
      'progression.lockedAfterGeneric'
    );
    expect(lockText(t, 'SEQUENCE', 'X')).toContain('"title":"X"');
  });

  it('shows open and completed with symbol and word', () => {
    const { rerender } = renderWithProviders(<EnablerStateBadge state="open" />);
    expect(screen.getByTestId('enabler-state-open')).toHaveTextContent('Offen');
    rerender(<EnablerStateBadge state="completed" />);
    expect(screen.getByTestId('enabler-state-completed')).toHaveTextContent(
      'Abgeschlossen'
    );
  });
});

describe('list of a course', () => {
  it('shows every enabler with its state and keeps a locked one readable (link)', () => {
    useApiQueryMock.mockReturnValue({
      data: {
        course: { id: 'c1', title: 'Kurs', year: 1, chapter: 1 },
        enablers: [
          { id: 'e1', title: 'Enabler Eins', state: 'completed' },
          { id: 'e2', title: 'Enabler Zwei', state: 'open' },
          {
            id: 'e3',
            title: 'Enabler Drei',
            state: 'locked',
            lockReason: 'SEQUENCE',
            lockedBy: { id: 'e2', title: 'Enabler Zwei' },
          },
        ],
        useCases: [],
      },
      isLoading: false,
      error: null,
    } as any);
    renderWithProviders(<ModuleDetailPage />);
    expect(screen.getByTestId('enabler-state-completed')).toBeInTheDocument();
    expect(screen.getByTestId('enabler-state-open')).toBeInTheDocument();
    const locked = screen.getByTestId('enabler-state-locked');
    expect(locked).toHaveTextContent('Erst nach „Enabler Zwei“ möglich');
    // title and material stay reachable
    const link = screen.getByRole('link', { name: /Enabler Drei/ });
    expect(link).toHaveAttribute('href', '/trainee/enablers/e3');
    expect(link).toHaveAttribute('data-state', 'locked');
  });
});

describe('page of a learning field', () => {
  const reply = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as Response;

  it('shows the state of the enablers the trainee works in, not of the others', async () => {
    authFetchMock.mockResolvedValue(
      reply({
        lernfeld: {
          id: 'lf-1',
          title: 'Lernfeld',
          description: null,
          label: 'LF1',
          hoursBudget: 10,
          trainingYear: 1,
        },
        useCases: [],
        enablers: [
          {
            id: 'a',
            code: 'K1',
            title: 'Enabler A',
            courseTitle: 'Kurs',
            durationValue: null,
            durationUnit: null,
            accessible: true,
            state: 'locked',
            lockedBy: { id: 'z', title: 'Enabler Z' },
          },
          {
            id: 'b',
            code: 'K2',
            title: 'Enabler B',
            courseTitle: null,
            durationValue: null,
            durationUnit: null,
            accessible: false,
            state: null,
            lockedBy: null,
          },
        ],
      })
    );
    renderWithProviders(<LernfeldDetailPage />);
    expect(await screen.findByText('Enabler A')).toBeInTheDocument();
    const locked = screen.getAllByTestId('enabler-state-locked');
    expect(locked).toHaveLength(1);
    expect(locked[0]).toHaveTextContent('Erst nach „Enabler Z“ möglich');
    // the not assigned one keeps its own text
    expect(screen.getByText('noch nicht zugewiesen')).toBeInTheDocument();
  });
});
