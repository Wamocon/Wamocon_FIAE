import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeEnablerPage from '@/app/trainee/enablers/[enablerId]/page';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// The documents of an enabler on the page of a trainee (teaching texts and
// scenarios). The page reads them from the trainee route, which a trainee may
// call, and not from the trainer route, which answers a trainee with 403. A
// row without a file is no link. The LIGHT plan hides the shared teaching
// texts.
//
// Document protection (WMCNL-2872, 2873, 2891): the page holds no address of a
// file. The viewer is opened with the route of the document (its id), the slides
// are not offered, there is one button per document and no download or link to
// a file. The subtitle of the viewer names the kind of document (WMCNL-2932).

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
    subtitle: '',
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
  documentType: 'THEORY',
  isOwnOrganization: false,
  ...overrides,
});

function mockQueries(
  documents: unknown[],
  enablerOverrides: Record<string, unknown> = {}
) {
  // stable objects: the page syncs its form state in an effect on the data
  const enablerData = {
    enabler: {
      id: 'e1',
      title: 'Enabler One',
      isActive: false,
      ...enablerOverrides,
    },
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
      }),
      doc({
        id: 'c',
        title: 'Szenario: Part1 Netzwerk',
        documentType: 'EXERCISE',
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
    // the route of the document and the kind of document, no address of a file
    expect(openPdf).toHaveBeenCalledWith(
      'Lehrtext Grundlagen',
      '/api/trainee/documents/a/content',
      'Theorie-Dokument'
    );
  });

  it('opens a scenario part with its own route and the subtitle "Szenario", not "Theorie-Dokument"', () => {
    mockQueries([
      doc({
        id: 'c',
        title: 'Szenario: Part1 Netzwerk',
        documentType: 'EXERCISE',
      }),
    ]);
    renderWithProviders(<TraineeEnablerPage />);
    const part = screen
      .getAllByRole('button')
      .find(b => (b.textContent || '').endsWith('PDF'))!;
    fireEvent.click(part);
    expect(openPdf).toHaveBeenCalledTimes(1);
    expect(openPdf.mock.calls[0][1]).toBe('/api/trainee/documents/c/content');
    expect(openPdf.mock.calls[0][2]).toBe('Szenario');
  });

  it('opens the single scenario PDF of the enabler by the enabler, not by an address', () => {
    mockQueries([], { hasScenarioPdf: true });
    renderWithProviders(<TraineeEnablerPage />);
    fireEvent.click(screen.getByRole('button', { name: /Szenario/i }));
    expect(openPdf).toHaveBeenCalledTimes(1);
    expect(openPdf.mock.calls[0][1]).toBe(
      '/api/trainee/enablers/e1/scenario/content'
    );
    expect(openPdf.mock.calls[0][2]).toBe('Szenario');
  });

  it('has no download, no PPT link and no link to a file; the video link stays', () => {
    mockQueries(
      [
        doc({ id: 'a', title: 'Lehrtext Grundlagen' }),
        doc({
          id: 'b',
          title: 'Szenario: Part1 Netzwerk',
          documentType: 'EXERCISE',
        }),
      ],
      {
        // an older answer or a manipulated one: the page does not offer it
        pptUrl: 'https://files.test/slides.pptx',
        videoUrl: 'https://video.test/watch?v=1',
      }
    );
    const { container } = renderWithProviders(<TraineeEnablerPage />);
    expect(container.querySelector('a[download]')).toBeNull();
    expect(container.innerHTML).not.toContain('slides.pptx');
    expect(screen.queryByText('PPT öffnen')).not.toBeInTheDocument();
    const links = [...container.querySelectorAll('a[href]')].map(a =>
      a.getAttribute('href')
    );
    expect(links).toContain('https://video.test/watch?v=1');
    expect(
      links.filter(href => /\.(pdf|pptx?|docx?)$/i.test(href ?? ''))
    ).toEqual([]);
  });

  it('has exactly one button per document', () => {
    mockQueries([
      doc({ id: 'a', title: 'Lehrtext Grundlagen' }),
      doc({ id: 'b', title: 'Lehrtext Vertiefung' }),
      doc({
        id: 'c',
        title: 'Szenario: Part1 Netzwerk',
        documentType: 'EXERCISE',
      }),
    ]);
    renderWithProviders(<TraineeEnablerPage />);
    expect(
      screen.getAllByRole('button', { name: 'Lehrtext Grundlagen' })
    ).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'Lehrtext Vertiefung' })
    ).toHaveLength(1);
    const parts = screen
      .getAllByRole('button')
      .filter(b => (b.textContent || '').endsWith('PDF'));
    expect(parts).toHaveLength(1);
  });

  it('shows no scenario button when the enabler has no scenario PDF and no scenario part', () => {
    mockQueries([doc({ id: 'a', title: 'Mit Datei' })], {
      hasScenarioPdf: false,
    });
    renderWithProviders(<TraineeEnablerPage />);
    expect(
      screen.getByRole('button', { name: 'Mit Datei' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Szenario/i })
    ).not.toBeInTheDocument();
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
