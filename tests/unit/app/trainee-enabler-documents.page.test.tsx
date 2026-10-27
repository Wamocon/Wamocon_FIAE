import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeEnablerPage from '@/app/trainee/enablers/[enablerId]/page';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// The documents of an enabler on the page of a trainee (teaching texts and
// scenarios). The page reads them from the trainee route, which a trainee may
// call, and not from the trainer route, which answers a trainee with 403. A
// row without a file is no link. The LIGHT plan hides the shared teaching
// texts.

const mockPlan = { value: 'PRO' as 'PRO' | 'LIGHT' };
const openPdf = jest.fn();

jest.mock('@/contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    profile: { id: 't1', role: 'TRAINEE', organizationId: 'org-1' },
    subscriptionPlan: mockPlan.value,
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
    openPdf: (...args: unknown[]) => openPdf(...args),
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

const useApiQueryMock = useApiQuery as jest.MockedFunction<typeof useApiQuery>;

const doc = (overrides: Record<string, unknown>) => ({
  id: 'd',
  title: 'Doc',
  storageUrl: 'https://files.test/doc.pdf',
  documentType: 'THEORY',
  isOwnOrganization: false,
  ...overrides,
});

function mockQueries(documents: unknown[]) {
  // stable objects: the page syncs its form state in an effect on the data
  const enablerData = {
    enabler: { id: 'e1', title: 'Enabler One', isActive: false },
    submission: null,
  };
  const quizzesData = { quizzes: [] };
  const docsData = { documents };
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

const requestedUrls = () =>
  useApiQueryMock.mock.calls.map(([url]) => String(url));

describe('enabler documents on the page of a trainee', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlan.value = 'PRO';
  });

  it('reads the documents from the trainee route, never from the trainer route', () => {
    mockQueries([]);
    renderWithProviders(<TraineeEnablerPage />);
    expect(requestedUrls()).toContain('/api/trainee/enablers/e1/documents');
    expect(requestedUrls().some(u => u.includes('/api/trainer/'))).toBe(false);
  });

  it('lists the teaching texts and the scenario parts and opens the file', () => {
    mockQueries([
      doc({ id: 'a', title: 'Lehrtext Grundlagen' }),
      doc({
        id: 'b',
        title: 'Szenario: Part2 Datenbank',
        documentType: 'EXERCISE',
        storageUrl: 'https://files.test/b.pdf',
      }),
      doc({
        id: 'c',
        title: 'Szenario: Part1 Netzwerk',
        documentType: 'EXERCISE',
        storageUrl: 'https://files.test/c.pdf',
      }),
    ]);
    renderWithProviders(<TraineeEnablerPage />);

    expect(
      screen.getByRole('button', { name: 'Lehrtext Grundlagen' })
    ).toBeInTheDocument();
    // the scenario parts in order of their number (part 1 before part 2)
    const parts = screen
      .getAllByRole('button')
      .map(b => b.textContent || '')
      .filter(text => text.endsWith('PDF'));
    expect(parts).toHaveLength(2);
    expect(parts[0].startsWith('1')).toBe(true);
    expect(parts[1].startsWith('2')).toBe(true);

    fireEvent.click(
      screen.getByRole('button', { name: 'Lehrtext Grundlagen' })
    );
    expect(openPdf).toHaveBeenCalledWith(
      'Lehrtext Grundlagen',
      'https://files.test/doc.pdf'
    );
  });

  it('shows no button for a row without a file, even if the route sent one', () => {
    mockQueries([
      doc({ id: 'a', title: 'Mit Datei' }),
      doc({ id: 'b', title: 'Leere Adresse', storageUrl: '' }),
      doc({ id: 'c', title: 'Nur Leerzeichen', storageUrl: '   ' }),
      doc({
        id: 'd',
        title: 'Szenario: Part9 Ohne Datei',
        documentType: 'EXERCISE',
        storageUrl: '',
      }),
    ]);
    renderWithProviders(<TraineeEnablerPage />);
    expect(
      screen.getByRole('button', { name: 'Mit Datei' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Leere Adresse')).not.toBeInTheDocument();
    expect(screen.queryByText('Nur Leerzeichen')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ohne Datei/)).not.toBeInTheDocument();
  });

  it('PRO shows the shared teaching texts, LIGHT only the own ones', () => {
    const docs = [
      doc({
        id: 'shared',
        title: 'Gemeinsamer Lehrtext',
        isOwnOrganization: false,
      }),
      doc({ id: 'own', title: 'Eigener Lehrtext', isOwnOrganization: true }),
    ];
    mockQueries(docs);
    const { unmount } = renderWithProviders(<TraineeEnablerPage />);
    expect(screen.getByText('Gemeinsamer Lehrtext')).toBeInTheDocument();
    expect(screen.getByText('Eigener Lehrtext')).toBeInTheDocument();
    unmount();

    mockPlan.value = 'LIGHT';
    mockQueries(docs);
    renderWithProviders(<TraineeEnablerPage />);
    expect(screen.queryByText('Gemeinsamer Lehrtext')).not.toBeInTheDocument();
    expect(screen.getByText('Eigener Lehrtext')).toBeInTheDocument();
  });
});
