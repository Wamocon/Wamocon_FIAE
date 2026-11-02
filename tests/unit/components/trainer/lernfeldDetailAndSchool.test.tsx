import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { useBreadcrumbs } from '@/contexts/BreadcrumbContext';
import { authFetch } from '@/lib/authFetch';
import LernfeldDetailPage from '@/app/trainer/lernfelder/[id]/page';
import { TrainerSchoolView } from '@/components/trainer/TrainerSchoolView';

// WMCNL-3021: the page of a learning field is named after the learning field
// (not "Details"), its text has no torn lines, and the line under "Berufsschule"
// does not promise to "manage" learning fields to somebody who can only view them.

const push = jest.fn();

// React 18 has no use(): resolve the params of the page synchronously
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  use: (value: any) => value.__value,
}));
jest.mock('@/contexts/AuthContext');
jest.mock('@/contexts/BreadcrumbContext');
jest.mock('@/lib/authFetch');
jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/trainer/school',
}));
jest.mock('@/components/trainer/school/TrainerCalendarTab', () => ({
  TrainerCalendarTab: () => <div />,
}));
jest.mock('@/components/trainer/school/TrainerExamsTab', () => ({
  TrainerExamsTab: () => <div />,
}));
jest.mock('@/components/trainer/school/TrainerLernfelderTab', () => ({
  TrainerLernfelderTab: () => <div />,
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const lernfeld = {
  id: 'lf1',
  label: 'LF1',
  title: 'Kundenkommunikation',
  description:
    'Die Schülerinnen und Schüler besitzen\ndie Kompetenz, Telefonate\nzu führen.',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const useCase = {
  id: 'uc1',
  title: 'Telefonat führen',
  courseId: null,
  descriptionText: 'Telefonat führen',
  orderIndex: 1,
  durationValue: null,
  durationUnit: null,
  isActive: true,
  year: null,
  trainingStage: null,
  lernfelder: ['LF1'],
};

function asRole(role: string, isPlatformOwner = false) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'u1', role },
    isPlatformOwner,
    loading: false,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  authFetchMock.mockImplementation(async (input: any) => {
    const url = String(input);
    if (url.startsWith('/api/trainer/lernfelder/lf1')) {
      return json({ lernfeld, useCases: [useCase] });
    }
    return json({ pendingReports: 0, upcomingExams: 0, trainees: 0 });
  });
});

describe('Lernfeld detail page (WMCNL-3021)', () => {
  it('names the page after the learning field and shows the text without torn lines', async () => {
    asRole('trainer');
    const setBreadcrumbs = jest.fn();
    (useBreadcrumbs as jest.Mock).mockReturnValue({
      breadcrumbs: [
        { label: 'Ausbilder', href: '/trainer/dashboard' },
        { label: 'Lernfelder', href: '/trainer/lernfelder' },
        { label: 'Details', href: '/trainer/lernfelder/lf1' },
      ],
      setBreadcrumbs,
    });
    renderWithProviders(
      <LernfeldDetailPage params={{ __value: { id: 'lf1' } } as any} />
    );
    expect(
      await screen.findByText(
        'Die Schülerinnen und Schüler besitzen die Kompetenz, Telefonate zu führen.'
      )
    ).toBeInTheDocument();
    await waitFor(() => expect(setBreadcrumbs).toHaveBeenCalled());
    const items = setBreadcrumbs.mock.calls[0][0];
    expect(items[2]).toEqual({
      label: 'LF1: Kundenkommunikation',
      href: '/trainer/lernfelder/lf1',
    });
    expect(items[0].label).toBe('Ausbilder');
  });

  it('a use case of the learning field opens its page', async () => {
    asRole('trainer');
    (useBreadcrumbs as jest.Mock).mockReturnValue({
      breadcrumbs: [],
      setBreadcrumbs: jest.fn(),
    });
    renderWithProviders(
      <LernfeldDetailPage params={{ __value: { id: 'lf1' } } as any} />
    );
    const row = (
      await screen.findByText('Telefonat führen', {
        selector: 'h3',
      })
    ).closest('div[class*="cursor-pointer"]') as HTMLElement;
    row.click();
    expect(push).toHaveBeenCalledWith('/trainer/use-cases/uc1');
  });
});

describe('line under Berufsschule (WMCNL-3021)', () => {
  it('says "ansehen" to a trainer who cannot change the curriculum', async () => {
    asRole('trainer');
    renderWithProviders(<TrainerSchoolView />);
    expect(
      await screen.findByText('Lernfelder und zugehörige Use Cases ansehen')
    ).toBeInTheDocument();
    expect(screen.queryByText('Lernfelder und Use Cases verwalten')).toBeNull();
  });

  it('keeps "verwalten" for the platform admin', async () => {
    asRole('super_admin');
    renderWithProviders(<TrainerSchoolView />);
    expect(
      await screen.findByText('Lernfelder und Use Cases verwalten')
    ).toBeInTheDocument();
  });
});
