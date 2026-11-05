import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeCoursesPage from '@/app/trainee/courses/page';
import TraineeModuleDetailPage from '@/app/trainee/modules/[moduleId]/page';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// The list of the Fragenkomplexe (WMCNL-2930, WMCNL-2933): the percentage is
// explained by the counts of both parts, a missing phase shows no dash, titles
// start with a capital letter.

jest.mock('@/contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    profile: { id: 't1', role: 'trainee', organizationId: 'org-1' },
  }),
}));
jest.mock('@/lib/hooks/useApiQuery');
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ moduleId: 'c1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/trainee/courses',
  useSearchParams: () => new URLSearchParams(),
}));

const useApiQueryMock = useApiQuery as jest.MockedFunction<typeof useApiQuery>;

function answer(data: unknown) {
  useApiQueryMock.mockImplementation(((url: string | null) => ({
    data: url ? data : undefined,
    isLoading: false,
    error: null,
  })) as any);
}

describe('list of the Fragenkomplexe', () => {
  it('shows 35 percent next to the counts it is made of', () => {
    answer({
      courses: [
        {
          id: 'c1',
          title: 'Informationsmanagement anwenden',
          year: null,
          chapter: 10,
          progress: 35,
          enablerCount: 6,
          completedCount: 3,
          useCaseCount: 1,
          approvedUseCaseCount: 0,
        },
      ],
    });
    renderWithProviders(<TraineeCoursesPage />);
    expect(
      screen.getByText('3 von 6 Themenkreisen abgeschlossen')
    ).toBeVisible();
    expect(screen.getByText('35 %')).toBeVisible();
    const explain = screen.getByTestId('course-progress-explain');
    expect(explain).toHaveTextContent('0 von 1 Use Cases abgeschlossen');
    expect(explain).toHaveTextContent(
      'Der Fortschritt zählt die Themenkreise zu 70 % und die Use Cases zu 30 %.'
    );
  });

  it('adds nothing to explain for a course without use cases', () => {
    answer({
      courses: [
        {
          id: 'c1',
          title: 'Kurs',
          year: 1,
          chapter: 1,
          progress: 50,
          enablerCount: 2,
          completedCount: 1,
        },
      ],
    });
    renderWithProviders(<TraineeCoursesPage />);
    expect(screen.queryByTestId('course-progress-explain')).toBeNull();
  });

  it('shows no dash for a missing phase and starts a title with a capital letter', () => {
    answer({
      courses: [
        {
          id: 'c1',
          title: 'bürowirtschaftliche Abläufe organisieren',
          year: null,
          chapter: null,
          progress: 0,
          enablerCount: 0,
          completedCount: 0,
        },
        {
          id: 'c2',
          title: 'Phase gesetzt',
          year: 2,
          chapter: 130,
          progress: 0,
          enablerCount: 0,
          completedCount: 0,
        },
      ],
    });
    renderWithProviders(<TraineeCoursesPage />);
    expect(
      screen.getByText('Bürowirtschaftliche Abläufe organisieren')
    ).toBeInTheDocument();
    expect(screen.queryByText(/—/)).toBeNull();
    expect(screen.getByText('Phase 2 • ID 130')).toBeInTheDocument();
  });

  it('names the grammatically right sentence for the choice', () => {
    answer({ courses: [] });
    renderWithProviders(<TraineeCoursesPage />);
    expect(
      screen.getByText('Wähle einen Fragenkomplex aus, um fortzufahren')
    ).toBeInTheDocument();
  });
});

describe('page of one Fragenkomplex', () => {
  it('shows no dash for a missing phase and capitalizes the titles', () => {
    answer({
      course: {
        id: 'c1',
        title: 'kaufmännische Steuerung',
        year: null,
        chapter: null,
      },
      enablers: [{ id: 'e1', title: 'wege der Informationsbeschaffung' }],
      useCases: [],
    });
    renderWithProviders(<TraineeModuleDetailPage />);
    expect(
      screen.getByRole('heading', { name: 'Kaufmännische Steuerung' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/—/)).toBeNull();
    expect(
      screen.getByText('Wege der Informationsbeschaffung')
    ).toBeInTheDocument();
  });
});
