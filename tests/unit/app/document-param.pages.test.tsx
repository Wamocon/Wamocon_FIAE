import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeEnablerPage from '@/app/trainee/enablers/[enablerId]/page';
import TraineeUseCaseDetailPage from '@/app/trainee/use-cases/[useCaseId]/page';
import TrainerUseCaseDetailPage from '@/app/trainer/use-cases/[useCaseId]/page';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { authFetch } from '@/lib/authFetch';

// A link of the HAI with ?document=<uuid> opens that document in the reader, but only
// when it is one of the documents the page itself lists for the person. Anything else
// (a document that does not exist, one of another record, one of the solutions, a bad
// value, an extra parameter) gets the same neutral note and no reader.

const ENABLER = '10000000-0000-4000-8000-000000000001';
const USE_CASE = '10000000-0000-4000-8000-000000000002';
const D_THEORY = '20000000-0000-4000-8000-000000000001';
const D_SCENARIO = '20000000-0000-4000-8000-000000000002';
const D_OTHER = '20000000-0000-4000-8000-000000000003';
const D_SOLUTION = '20000000-0000-4000-8000-000000000004';

let mockSearch = '';
let mockParams: Record<string, string> = { enablerId: ENABLER };
const openPdf = jest.fn();
const flipbookProps: Array<Record<string, unknown>> = [];

jest.mock('@/contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    profile: { id: 't1', role: 'TRAINEE', organizationId: 'org-1' },
    subscriptionPlan: 'PRO',
  }),
}));
jest.mock('@/lib/authFetch');
jest.mock('@/lib/hooks/useApiQuery');
jest.mock('@/lib/hooks/useIsSuperAdmin', () => ({
  __esModule: true,
  useIsSuperAdmin: () => false,
}));
jest.mock('@/components/trainee/SubmissionFileField', () => ({
  __esModule: true,
  SubmissionFileField: () => null,
}));
jest.mock('@/components/ui/FlipbookViewer', () => ({
  __esModule: true,
  FlipbookViewer: (props: Record<string, unknown>) => {
    flipbookProps.push(props);
    return props.isOpen ? (
      <div data-testid="flipbook" data-url={String(props.pdfUrl)} />
    ) : null;
  },
  useFlipbookViewer: () => ({
    title: '',
    pdfUrl: '',
    subtitle: '',
    isOpen: false,
    openPdf: (...args: unknown[]) => openPdf(...args),
    closePdf: jest.fn(),
  }),
}));
jest.mock('@/components/ui/SecurePdfViewer', () => ({
  __esModule: true,
  default: ({ src }: { src: string }) => (
    <div data-testid="secure-viewer" data-src={src} />
  ),
}));
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: (loader: () => Promise<unknown>) => {
    void loader;
    return jest.requireMock('@/components/ui/SecurePdfViewer').default;
  },
}));
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/x',
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

const useApiQueryMock = useApiQuery as jest.MockedFunction<typeof useApiQuery>;
const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

const enablerData = {
  enabler: {
    id: ENABLER,
    title: 'Enabler One',
    isActive: false,
    hasScenarioPdf: false,
  },
  submission: null,
};
const docs = {
  documents: [
    {
      id: D_THEORY,
      title: 'Lehrtext Grundlagen',
      documentType: 'THEORY',
      isOwnOrganization: false,
    },
    {
      id: D_SCENARIO,
      title: 'Szenario: Part1 Netzwerk',
      documentType: 'EXERCISE',
      isOwnOrganization: false,
    },
  ],
};

function mockEnabler(extra: Record<string, unknown> = {}, list = docs) {
  const data = {
    ...enablerData,
    enabler: { ...enablerData.enabler, ...extra },
  };
  useApiQueryMock.mockImplementation(((url: string | null) => ({
    data: !url
      ? undefined
      : url.includes('/quizzes')
        ? { quizzes: [] }
        : url.includes('/documents')
          ? list
          : data,
    isLoading: false,
    error: null,
  })) as any);
}

beforeEach(() => {
  jest.clearAllMocks();
  flipbookProps.length = 0;
  mockSearch = '';
  mockParams = { enablerId: ENABLER };
});

describe('the page of an enabler with ?document', () => {
  it('opens a listed teaching text in the reader, with the route of the document', () => {
    mockSearch = `document=${D_THEORY}`;
    mockEnabler();
    renderWithProviders(<TraineeEnablerPage />);
    expect(openPdf).toHaveBeenCalledTimes(1);
    expect(openPdf).toHaveBeenCalledWith(
      'Lehrtext Grundlagen',
      `/api/trainee/documents/${D_THEORY}/content`,
      'Theorie-Dokument'
    );
    expect(screen.queryByTestId('document-not-found')).not.toBeInTheDocument();
  });

  it('opens a listed scenario part with the subtitle Szenario', () => {
    mockSearch = `document=${D_SCENARIO}`;
    mockEnabler();
    renderWithProviders(<TraineeEnablerPage />);
    expect(openPdf).toHaveBeenCalledTimes(1);
    expect(openPdf.mock.calls[0][1]).toBe(
      `/api/trainee/documents/${D_SCENARIO}/content`
    );
    expect(openPdf.mock.calls[0][2]).toBe('Szenario');
  });

  it('opens the single scenario PDF of the enabler when the parameter is the enabler id', () => {
    mockSearch = `document=${ENABLER}`;
    mockEnabler({ hasScenarioPdf: true }, { documents: [] });
    renderWithProviders(<TraineeEnablerPage />);
    expect(openPdf).toHaveBeenCalledTimes(1);
    expect(openPdf.mock.calls[0][1]).toBe(
      `/api/trainee/enablers/${ENABLER}/scenario/content`
    );
  });

  it.each([
    ['a document that does not exist', `document=${D_OTHER}`],
    [
      'the solution of a trainer (never in the list of a trainee)',
      `document=${D_SOLUTION}`,
    ],
    ['the enabler id without a scenario PDF', `document=${ENABLER}`],
    ['a value that is no uuid', 'document=abc'],
    ['an extra parameter', `document=${D_THEORY}&x=1`],
    ['a repeated parameter', `document=${D_THEORY}&document=${D_SCENARIO}`],
  ])('shows the neutral note and no reader for %s', (_name, search) => {
    mockSearch = search;
    mockEnabler();
    renderWithProviders(<TraineeEnablerPage />);
    if (search.startsWith('document=abc') || search.includes('&')) {
      // a crafted value is not even read: no reader, and no note either
      expect(openPdf).not.toHaveBeenCalled();
      return;
    }
    expect(openPdf).not.toHaveBeenCalled();
    expect(screen.getByTestId('document-not-found')).toHaveTextContent(
      'Die Datei wurde nicht gefunden.'
    );
  });

  it('gives the same note for a missing document and for one that is not in the list', () => {
    mockEnabler();
    mockSearch = `document=${D_OTHER}`;
    const first = renderWithProviders(<TraineeEnablerPage />);
    const missing = screen.getByTestId('document-not-found').textContent;
    first.unmount();
    mockSearch = `document=${D_SOLUTION}`;
    renderWithProviders(<TraineeEnablerPage />);
    expect(screen.getByTestId('document-not-found').textContent).toBe(missing);
  });

  it('does nothing without the parameter', () => {
    mockEnabler();
    renderWithProviders(<TraineeEnablerPage />);
    expect(openPdf).not.toHaveBeenCalled();
    expect(screen.queryByTestId('document-not-found')).not.toBeInTheDocument();
  });
});

describe('the page of a use case of a trainee with ?document', () => {
  const ucData = {
    useCase: { id: USE_CASE, title: 'Use Case K2-a', descriptionText: 'Text' },
    submission: null,
  };
  const ucDocs = {
    documents: [
      {
        id: D_THEORY,
        title: 'Aufgabe (PDF)',
        documentType: 'TRAINEE_QUESTION',
      },
    ],
  };
  beforeEach(() => {
    mockParams = { useCaseId: USE_CASE };
    useApiQueryMock.mockImplementation(((url: string | null) => ({
      data: !url ? undefined : url.includes('/documents') ? ucDocs : ucData,
      isLoading: false,
      error: null,
    })) as any);
  });

  it('opens a listed task in the reading view', () => {
    mockSearch = `document=${D_THEORY}`;
    renderWithProviders(<TraineeUseCaseDetailPage />);
    expect(screen.getByTestId('secure-viewer').getAttribute('data-src')).toBe(
      `/api/trainee/documents/${D_THEORY}/content`
    );
  });

  it('shows the neutral note for a document that is not listed, no reading view', () => {
    mockSearch = `document=${D_SOLUTION}`;
    renderWithProviders(<TraineeUseCaseDetailPage />);
    expect(screen.queryByTestId('secure-viewer')).not.toBeInTheDocument();
    expect(screen.getByTestId('document-not-found')).toHaveTextContent(
      'Die Datei wurde nicht gefunden.'
    );
  });
});

describe('the page of a use case of a trainer with ?document', () => {
  beforeEach(() => {
    mockParams = { useCaseId: USE_CASE };
    authFetchMock.mockImplementation((async (url: string) => {
      const body = String(url).endsWith('/documents')
        ? {
            documents: [
              {
                id: D_THEORY,
                title: 'Aufgabe',
                storageUrl: 'https://files.test/a.pdf',
                documentType: 'TRAINEE_QUESTION',
              },
            ],
          }
        : {
            useCase: {
              id: USE_CASE,
              title: 'Bestellsystem',
              isActive: true,
              courseId: null,
              descriptionText: null,
              orderIndex: 1,
              durationValue: null,
              durationUnit: null,
              year: null,
              trainingStage: null,
              lernfelder: null,
            },
          };
      return { ok: true, json: async () => body };
    }) as any);
  });

  it('shows a listed file in the reader of the trainer', async () => {
    mockSearch = `document=${D_THEORY}`;
    renderWithProviders(<TrainerUseCaseDetailPage />);
    const reader = await screen.findByTestId('flipbook');
    expect(reader.getAttribute('data-url')).toBe('https://files.test/a.pdf');
  });

  it('shows the neutral note for a file the list does not give', async () => {
    mockSearch = `document=${D_OTHER}`;
    renderWithProviders(<TrainerUseCaseDetailPage />);
    expect(await screen.findByTestId('document-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('flipbook')).not.toBeInTheDocument();
  });
});
