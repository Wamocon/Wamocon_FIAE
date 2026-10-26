import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeActivityReportsPage from '@/app/trainee/activity-reports/page';
import TrainerActivityReportsPage from '@/app/trainer/activity-reports/page';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// The phase labels of the Ausbildungsnachweis pages follow the phase plan of
// the occupation (KfBM S4b): "1. bis 15. Monat" and "16. bis 36. Monat" for
// KfBM, FIAE keeps "1. bis 18." and "19. bis 36." (12 + 12 shortened).

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function json(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const FIAE = {
  code: 'FIAE',
  title: 'Fachinformatiker',
  phaseMonths: { '3': [18, 18], '2': [12, 12] },
};
const KFBM = {
  code: 'KFBM',
  title: 'Büromanagement',
  phaseMonths: { '3': [15, 21], '2': [10, 14] },
};

const traineeReport = (id: string, phase: number) => ({
  id,
  traineeId: 'trainee-1',
  ausbildungsjahr: phase,
  weekNumber: 40 + phase,
  year: 2027,
  periodStart: '2027-10-04',
  periodEnd: '2027-10-08',
  status: 'APPROVED',
  submittedAt: null,
  reviewerFeedback: null,
  traineeSignedAt: null,
  trainerSignedAt: null,
  reviewerId: null,
  reviewerName: null,
  createdAt: '2027-10-08',
});

describe('trainee Ausbildungsnachweis page: phase labels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  function setup(
    entry: typeof FIAE | typeof KFBM,
    durationYears: number | null,
    meOk = true
  ) {
    (useAuth as jest.Mock).mockReturnValue({
      profile: {
        id: 'trainee-1',
        role: 'trainee',
        ausbildung_duration_years: durationYears,
      },
      loading: false,
      refreshProfile: jest.fn(() => Promise.resolve()),
    });
    authFetchMock.mockImplementation(async input => {
      const url = String(input);
      if (url.startsWith('/api/me/catalogs')) {
        return meOk
          ? json({ catalogs: [entry], activeCode: entry.code })
          : json({ error: 'Forbidden' }, false, 403);
      }
      if (url.startsWith('/api/training-components')) {
        return json({ components: [] });
      }
      if (url.startsWith('/api/training-use-cases')) {
        return json({ useCases: [] });
      }
      if (url.startsWith('/api/activity-reports')) {
        return json({
          reports: [traineeReport('r1', 1), traineeReport('r2', 2)],
        });
      }
      return json({});
    });
  }

  it('KfBM: 1. bis 15. and 16. bis 36. Ausbildungsmonat', async () => {
    setup(KFBM, 3);
    renderWithProviders(<TraineeActivityReportsPage />);
    expect(
      await screen.findByText('Phase 1: 1. bis 15. Ausbildungsmonat')
    ).toBeTruthy();
    expect(
      screen.getByText('Phase 2: 16. bis 36. Ausbildungsmonat')
    ).toBeTruthy();
    expect(screen.queryByText(/1\. bis 18\./)).toBeNull();
  });

  it('KfBM shortened (2 years): 1. bis 10. and 11. bis 24. Ausbildungsmonat', async () => {
    setup(KFBM, 2);
    renderWithProviders(<TraineeActivityReportsPage />);
    expect(
      await screen.findByText('Phase 1: 1. bis 10. Ausbildungsmonat')
    ).toBeTruthy();
    expect(
      screen.getByText('Phase 2: 11. bis 24. Ausbildungsmonat')
    ).toBeTruthy();
  });

  it('FIAE: 1. bis 18. and 19. bis 36. Ausbildungsmonat as before', async () => {
    setup(FIAE, 3);
    renderWithProviders(<TraineeActivityReportsPage />);
    expect(
      await screen.findByText('Phase 1: 1. bis 18. Ausbildungsmonat')
    ).toBeTruthy();
    expect(
      screen.getByText('Phase 2: 19. bis 36. Ausbildungsmonat')
    ).toBeTruthy();
  });

  it('FIAE shortened (2 years): 1. bis 12. and 13. bis 24. Ausbildungsmonat as before', async () => {
    setup(FIAE, 2);
    renderWithProviders(<TraineeActivityReportsPage />);
    expect(
      await screen.findByText('Phase 1: 1. bis 12. Ausbildungsmonat')
    ).toBeTruthy();
    expect(
      screen.getByText('Phase 2: 13. bis 24. Ausbildungsmonat')
    ).toBeTruthy();
  });

  it('keeps the labels of the time before the occupations when the lookup fails', async () => {
    setup(KFBM, 3, false);
    renderWithProviders(<TraineeActivityReportsPage />);
    expect(
      await screen.findByText('Phase 1: 1. bis 18. Ausbildungsmonat')
    ).toBeTruthy();
  });
});

describe('trainer Ausbildungsnachweis page: phase labels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainer-1', role: 'trainer' },
      loading: false,
    });
  });

  const trainerReport = (
    id: string,
    traineeId: string,
    name: string,
    phase: number,
    durationYears: number,
    phaseOneMonths?: number
  ) => ({
    id,
    traineeId,
    traineeName: name,
    traineeAusbildungDurationYears: durationYears,
    ...(phaseOneMonths === undefined
      ? {}
      : { traineePhaseOneMonths: phaseOneMonths }),
    ausbildungsjahr: phase,
    weekNumber: 46,
    year: 2027,
    periodStart: '2027-11-15',
    periodEnd: '2027-11-19',
    status: 'SUBMITTED',
    hasOverbooking: false,
  });

  function setup(reports: unknown[], trainees: unknown[] = []) {
    authFetchMock.mockImplementation(async input => {
      const url = String(input);
      if (url.startsWith('/api/me/catalogs')) {
        return json({ catalogs: [FIAE, KFBM], activeCode: 'FIAE' });
      }
      if (url.startsWith('/api/trainer/activity-reports')) {
        return json({ reports });
      }
      if (url.startsWith('/api/trainer/trainees')) {
        return json({ trainees });
      }
      if (url.startsWith('/api/training-components')) {
        return json({ components: [] });
      }
      if (url.startsWith('/api/training-use-cases')) {
        return json({ useCases: [] });
      }
      return json({});
    });
  }

  it('labels the report of each trainee with the plan of their own occupation', async () => {
    setup([
      trainerReport('r1', 'k1', 'Karla Kfbm', 2, 3, 15),
      trainerReport('r2', 'f1', 'Frieda Fiae', 1, 3, 18),
      trainerReport('r3', 'f2', 'Franz Fiae', 2, 2, 12),
    ]);
    renderWithProviders(<TrainerActivityReportsPage />);
    expect(await screen.findByText('Phase 2: 16. bis 36. Monat')).toBeTruthy();
    expect(screen.getByText('Phase 1: 1. bis 18. Monat')).toBeTruthy();
    expect(screen.getByText('Phase 2: 13. bis 24. Monat')).toBeTruthy();
  });

  it('keeps the previous labels for a report without a phase plan', async () => {
    setup([trainerReport('r1', 'f1', 'Frieda Fiae', 1, 3)]);
    renderWithProviders(<TrainerActivityReportsPage />);
    expect(await screen.findByText('Phase 1: 1. bis 18. Monat')).toBeTruthy();
  });

  it('labels the phase filter of a chosen trainee with the plan of their occupation', async () => {
    setup(
      [
        {
          ...trainerReport('r1', 'k1', 'Karla Kfbm', 2, 3, 15),
          status: 'APPROVED',
        },
      ],
      [
        {
          id: 'k1',
          fullName: 'Karla Kfbm',
          email: 'k@example.com',
          ausbildungDurationYears: 3,
        },
      ]
    );
    const { container } = renderWithProviders(<TrainerActivityReportsPage />);
    // the filters belong to the history
    fireEvent.click(await screen.findByText('Historie'));
    await screen.findByText('Phase 2: 16. bis 36. Monat');
    // without a chosen trainee the options only name the phase
    expect(
      Array.from(container.querySelectorAll('option')).map(o => o.textContent)
    ).toContain('Phase 1');
    // choose the trainee: the options name the months of KfBM
    const select = container.querySelectorAll('select')[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'k1' } });
    await waitFor(() => {
      const options = Array.from(container.querySelectorAll('option')).map(
        o => o.textContent
      );
      expect(options).toContain('Phase 1: 1. bis 15. Monat');
      expect(options).toContain('Phase 2: 16. bis 36. Monat');
    });
  });
});
