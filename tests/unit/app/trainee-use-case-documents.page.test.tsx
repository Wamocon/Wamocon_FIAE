import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeUseCaseDetailPage from '@/app/trainee/use-cases/[useCaseId]/page';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// The task PDFs of a use case on the page of a trainee (WMCNL-2891). The page holds no
// address of a file: it opens the reading view with the route of the document, and
// there is no iframe of the browser's PDF viewer, no download and no link to a file.

jest.mock('@/contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    profile: { id: 't1', role: 'TRAINEE', organizationId: 'org-1' },
  }),
}));
jest.mock('@/lib/authFetch');
jest.mock('@/lib/hooks/useApiQuery');
jest.mock('@/components/trainee/SubmissionFileField', () => ({
  __esModule: true,
  SubmissionFileField: () => null,
}));
jest.mock('@/components/ui/SecurePdfViewer', () => ({
  __esModule: true,
  default: ({ src, title }: { src: string; title: string }) => (
    <div data-testid="secure-viewer" data-src={src} data-title={title} />
  ),
}));
// next/dynamic loads the component asynchronously: here it is the component itself
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => jest.requireMock('@/components/ui/SecurePdfViewer').default,
}));
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ useCaseId: 'u1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/trainee/use-cases/u1',
  useSearchParams: () => new URLSearchParams(),
}));

const useApiQueryMock = useApiQuery as jest.MockedFunction<typeof useApiQuery>;

const ucData = {
  useCase: { id: 'u1', title: 'Use Case K2-a', descriptionText: 'Text' },
  submission: null,
};
const docsData = {
  documents: [
    {
      id: 'doc-1',
      title: 'Use Case K2-a: Aufgabe (PDF)',
      documentType: 'TRAINEE_QUESTION',
    },
    { id: 'doc-2', title: 'Anlage', documentType: 'EXERCISE' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  useApiQueryMock.mockImplementation(((url: string | null) => ({
    data: !url ? undefined : url.includes('/documents') ? docsData : ucData,
    isLoading: false,
    error: null,
  })) as any);
});

describe('documents of a use case on the page of a trainee', () => {
  it('shows one button per document and no viewer before a click', () => {
    renderWithProviders(<TraineeUseCaseDetailPage />);
    expect(
      screen.getAllByRole('button', { name: /Aufgabe \(PDF\)/ })
    ).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Anlage/ })).toHaveLength(1);
    expect(screen.queryByTestId('secure-viewer')).not.toBeInTheDocument();
  });

  it('opens the reading view with the route of the document, not with an address', () => {
    const { container } = renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.click(screen.getByRole('button', { name: /Aufgabe \(PDF\)/ }));
    const viewer = screen.getByTestId('secure-viewer');
    expect(viewer.getAttribute('data-src')).toBe(
      '/api/trainee/documents/doc-1/content'
    );
    expect(viewer.getAttribute('data-title')).toContain('Aufgabe');
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('embed')).toBeNull();
    expect(container.querySelector('a[download]')).toBeNull();
    expect(viewer.parentElement?.innerHTML).not.toMatch(/https?:|storage\/v1/);
    expect(container.querySelector('a[href*="storage"]')).toBeNull();
  });

  it('switches to another document and closes with a second click', () => {
    renderWithProviders(<TraineeUseCaseDetailPage />);
    fireEvent.click(screen.getByRole('button', { name: /Aufgabe \(PDF\)/ }));
    fireEvent.click(screen.getByRole('button', { name: /Anlage/ }));
    expect(screen.getByTestId('secure-viewer').getAttribute('data-src')).toBe(
      '/api/trainee/documents/doc-2/content'
    );
    fireEvent.click(screen.getByRole('button', { name: /Anlage/ }));
    expect(screen.queryByTestId('secure-viewer')).not.toBeInTheDocument();
  });
});
