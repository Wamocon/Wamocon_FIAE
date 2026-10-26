import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { ActivityReportsList } from '@/components/school/ActivityReportsList';
import { BlockCalendar } from '@/components/school/BlockCalendar';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// The school view names the months of a phase with the phase plan of the
// occupation of the trainee (KfBM S4b): the report list, the report detail and
// the block detail. KfBM: "1. bis 15." and "16. bis 36." Ausbildungsmonat,
// FIAE keeps "1. bis 18." and "19. bis 36.".

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const fetchMock = jest.fn();

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

function signIn(
  entry: typeof FIAE | typeof KFBM,
  durationYears: number,
  meOk = true
) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: {
      id: 'trainee-1',
      role: 'trainee',
      ausbildung_duration_years: durationYears,
    },
    loading: false,
  });
  // The school routes answer only with the session token, so the components
  // call them with authFetch like the occupation lookup. Their answers come
  // from fetchMock, a plain global fetch is rejected (see beforeEach).
  authFetchMock.mockImplementation(async (input, init) =>
    String(input).startsWith('/api/me/catalogs')
      ? meOk
        ? json({ catalogs: [entry], activeCode: entry.code })
        : json({ error: 'Forbidden' }, false, 403)
      : fetchMock(input, init)
  );
}

const report = (id: string, phase: number) => ({
  id,
  traineeId: 'trainee-1',
  weekNumber: 40 + phase,
  year: 2027,
  ausbildungsjahr: phase,
  periodStart: '2027-10-04',
  periodEnd: '2027-10-08',
  abteilung: 'FAE',
  status: 'DRAFT',
  submittedAt: null,
  reviewedAt: null,
  reviewerFeedback: null,
  pdfUrl: null,
  createdAt: '2027-10-08',
});

describe('ActivityReportsList: phase labels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (global as any).fetch = jest.fn().mockRejectedValue(
      new Error('plain fetch must not be used for the school routes')
    );
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/api/trainee/school/reports/r2')) {
        return json({ report: report('r2', 2), entries: [] });
      }
      return json({
        reports: [report('r1', 1), report('r2', 2)],
        meta: { stats: { total: 2, draft: 2 } },
      });
    });
  });

  it('KfBM list: Phase 1 is 1. bis 15., Phase 2 is 16. bis 36. Ausbildungsmonat', async () => {
    signIn(KFBM, 3);
    renderWithProviders(<ActivityReportsList />);
    expect(
      await screen.findByText(/Phase 1: 1\. bis 15\. Ausbildungsmonat/)
    ).toBeTruthy();
    expect(
      screen.getByText(/Phase 2: 16\. bis 36\. Ausbildungsmonat/)
    ).toBeTruthy();
  });

  it('KfBM detail of a report names the months of KfBM', async () => {
    signIn(KFBM, 3);
    renderWithProviders(<ActivityReportsList />);
    fireEvent.click(
      (
        await screen.findByText(/Phase 2: 16\. bis 36\. Ausbildungsmonat/)
      ).closest('div[class*="cursor-pointer"]') as HTMLElement
    );
    expect(
      await screen.findByText(/- Phase 2: 16\. bis 36\. Ausbildungsmonat/)
    ).toBeTruthy();
  });

  it('FIAE list: 1. bis 18. and 19. bis 36. as before', async () => {
    signIn(FIAE, 3);
    renderWithProviders(<ActivityReportsList />);
    expect(
      await screen.findByText(/Phase 1: 1\. bis 18\. Ausbildungsmonat/)
    ).toBeTruthy();
    expect(
      screen.getByText(/Phase 2: 19\. bis 36\. Ausbildungsmonat/)
    ).toBeTruthy();
  });

  it('FIAE shortened list: 1. bis 12. and 13. bis 24. as before', async () => {
    signIn(FIAE, 2);
    renderWithProviders(<ActivityReportsList />);
    expect(
      await screen.findByText(/Phase 1: 1\. bis 12\. Ausbildungsmonat/)
    ).toBeTruthy();
    expect(
      screen.getByText(/Phase 2: 13\. bis 24\. Ausbildungsmonat/)
    ).toBeTruthy();
  });

  it('keeps the previous lengths when the occupation lookup fails', async () => {
    signIn(KFBM, 3, false);
    renderWithProviders(<ActivityReportsList />);
    expect(
      await screen.findByText(/Phase 1: 1\. bis 18\. Ausbildungsmonat/)
    ).toBeTruthy();
  });
});

describe('BlockCalendar: phase label of a block', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (global as any).fetch = jest.fn().mockRejectedValue(
      new Error('plain fetch must not be used for the school routes')
    );
    const now = new Date();
    const block = {
      id: 'b1',
      traineeId: 'trainee-1',
      schuljahr: '2026/2027',
      ausbildungsjahr: 2,
      calendarWeek: 1,
      year: now.getFullYear(),
      startDate: new Date(
        now.getFullYear(),
        now.getMonth(),
        10,
        8
      ).toISOString(),
      endDate: new Date(
        now.getFullYear(),
        now.getMonth(),
        12,
        16
      ).toISOString(),
      blockType: 'SCHOOL',
      title: 'Blockwoche Schule',
    };
    fetchMock.mockImplementation(async (input: unknown) =>
      String(input).includes('/blocks')
        ? json({
            blocks: [block],
            meta: {
              currentSchuljahr: '2026/2027',
              currentWeek: 1,
              currentYear: now.getFullYear(),
            },
          })
        : json({ exams: [] })
    );
  });

  async function openBlock() {
    const buttons = await screen.findAllByText(/Blockwoche Schule/);
    fireEvent.click(buttons[0].closest('button') as HTMLElement);
  }

  it('KfBM: Phase 2 is 16. bis 36. Ausbildungsmonat', async () => {
    signIn(KFBM, 3);
    renderWithProviders(<BlockCalendar />);
    await openBlock();
    expect(
      await screen.findByText('Phase 2: 16. bis 36. Ausbildungsmonat')
    ).toBeTruthy();
  });

  it('FIAE: Phase 2 is 19. bis 36. Ausbildungsmonat as before', async () => {
    signIn(FIAE, 3);
    renderWithProviders(<BlockCalendar />);
    await openBlock();
    expect(
      await screen.findByText('Phase 2: 19. bis 36. Ausbildungsmonat')
    ).toBeTruthy();
  });

  it('FIAE shortened (2 years): Phase 2 is 13. bis 24. Ausbildungsmonat as before', async () => {
    signIn(FIAE, 2);
    renderWithProviders(<BlockCalendar />);
    await openBlock();
    expect(
      await screen.findByText('Phase 2: 13. bis 24. Ausbildungsmonat')
    ).toBeTruthy();
  });
});
