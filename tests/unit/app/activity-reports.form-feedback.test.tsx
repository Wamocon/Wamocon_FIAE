import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeActivityReportsPage from '@/app/trainee/activity-reports/page';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// Azubi Ausbildungsnachweis, the form and the dialogs:
// WMCNL-2943 the hours left follow the hours typed into the form (German
// number format), WMCNL-2944 a draft is not "Abgegeben", WMCNL-2945 what is
// missing is named next to the buttons and the error appears there,
// WMCNL-2946 every dialog closes with Escape and deleting asks in the dialog
// of the platform.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function json(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const component = {
  id: 'c1',
  code: 'K1',
  label: '1.1',
  title: 'Projektmanagement',
  description: null,
  totalWeeks: 4,
  totalHours: 160,
  trainingYear: 1,
  orderIndex: 1,
};
const useCase = {
  id: 'uc1',
  componentId: 'c1',
  letter: 'a',
  description: 'Grundsätze und Methoden des Projektmanagements anwenden',
  plannedHours: 80,
  orderIndex: 1,
};

const draft = {
  id: 'r1',
  traineeId: 'trainee-1',
  ausbildungsjahr: 1,
  weekNumber: 44,
  year: 2026,
  periodStart: '2026-10-26T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  status: 'DRAFT',
  submittedAt: null,
  reviewerFeedback: null,
  traineeSignedAt: null,
  trainerSignedAt: null,
  reviewerId: null,
  reviewerName: null,
  createdAt: '2026-10-30T10:00:00.000Z',
  skillSelfRatings: { FACHKOMPETENZ: '2', METHODENKOMPETENZ: '2' },
};

function api(reports: unknown[] = []) {
  authFetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith('/api/me/catalogs'))
      return json({ catalogs: [], activeCode: 'FIAE' });
    if (url.startsWith('/api/training-components'))
      return json({ components: [component] });
    if (url.startsWith('/api/training-use-cases'))
      return json({ useCases: [useCase] });
    if (url.startsWith('/api/trainee/use-case-hours'))
      return json({
        useCaseHours: [
          {
            useCaseId: 'uc1',
            totalHours: 80,
            usedHours: 0,
            remainingHours: 80,
          },
        ],
      });
    if (url.match(/^\/api\/activity-reports\/r\d+\/entries/))
      return json({
        entries: [
          {
            id: 'e1',
            reportId: 'r1',
            useCaseId: 'uc1',
            plannedHours: 80,
            actualHours: 8,
            isOverbooked: false,
            notes: 'gelernt',
            traineeGrade: '2',
          },
        ],
      });
    if (url.startsWith('/api/weekly-evaluations')) return json({});
    if (init?.method === 'DELETE') return json({ ok: true });
    if (url.startsWith('/api/activity-reports')) return json({ reports });
    return json({});
  });
}

async function renderPage() {
  const user = userEvent.setup();
  renderWithProviders(<TraineeActivityReportsPage />);
  return user;
}

async function openFormWithUseCase(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: /Neuer Nachweis/ })
  );
  await user.click(await screen.findByText('Projektmanagement'));
  await user.click(
    await screen.findByText(/Grundsätze und Methoden des Projektmanagements/)
  );
}

describe('trainee Ausbildungsnachweis: the form', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainee-1', role: 'trainee' },
      loading: false,
      refreshProfile: jest.fn(() => Promise.resolve()),
    });
  });

  it('takes the typed hours off the hours left, with a comma (WMCNL-2943)', async () => {
    api();
    const user = await renderPage();
    await openFormWithUseCase(user);

    // nothing typed yet: the whole budget, no "80.0"
    await waitFor(() =>
      expect(screen.getAllByText('80 Std übrig').length).toBeGreaterThan(0)
    );
    expect(screen.queryByText(/80\.0/)).not.toBeInTheDocument();

    const hours = screen.getByLabelText('IST-Stunden');
    fireEvent.change(hours, { target: { value: '8' } });
    // the card of the activity and the line in the list agree
    await waitFor(() =>
      expect(screen.getAllByText('72 Std übrig')).toHaveLength(2)
    );

    fireEvent.change(hours, { target: { value: '8.5' } });
    await waitFor(() =>
      expect(screen.getAllByText('71,5 Std übrig')).toHaveLength(2)
    );
  });

  it('names what is missing next to the buttons and marks the fields (WMCNL-2945)', async () => {
    api();
    const user = await renderPage();
    await openFormWithUseCase(user);

    const problems = await screen.findByTestId('report-problems');
    expect(
      within(problems).getByText('Zum Einreichen fehlt noch:')
    ).toBeTruthy();
    expect(
      within(problems).getByText(/IST-Stunden eintragen/)
    ).toBeInTheDocument();
    expect(
      within(problems).getByText(/beschreiben, was gelernt wurde/)
    ).toBeInTheDocument();
    expect(
      within(problems).getByText(/drei Kompetenzbereiche/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText('IST-Stunden')).toHaveAttribute(
      'aria-invalid',
      'true'
    );

    // once the hours are there, that line is gone
    fireEvent.change(screen.getByLabelText('IST-Stunden'), {
      target: { value: '8' },
    });
    await waitFor(() =>
      expect(
        within(screen.getByTestId('report-problems')).queryByText(
          /IST-Stunden eintragen/
        )
      ).not.toBeInTheDocument()
    );
  });

  it('shows the error of a click next to the button, not at the top (WMCNL-2945)', async () => {
    api();
    const user = await renderPage();
    await openFormWithUseCase(user);
    fireEvent.change(screen.getByLabelText('IST-Stunden'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByLabelText('Kalenderwoche'), {
      target: { value: '99' },
    });

    const save = screen.getByRole('button', { name: /Als Entwurf speichern/ });
    await user.click(save);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('gültige Kalenderwoche');
    // the alert sits in the same footer as the buttons
    expect(save.closest('.border-t')).toContainElement(alert);
  });

  it('closes with Escape like every other dialog (WMCNL-2946)', async () => {
    api();
    const user = await renderPage();
    await user.click(
      await screen.findByRole('button', { name: /Neuer Nachweis/ })
    );
    expect(await screen.findByText('Neuer Ausbildungsnachweis')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByText('Neuer Ausbildungsnachweis')).toBeNull()
    );
  });
});

describe('trainee Ausbildungsnachweis: list and detail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainee-1', role: 'trainee' },
      loading: false,
      refreshProfile: jest.fn(() => Promise.resolve()),
    });
  });

  it('a draft is not "Abgegeben", a submitted report is (WMCNL-2944)', async () => {
    api([draft]);
    const user = await renderPage();
    await user.click(await screen.findByText(/KW 44/));
    expect(
      await screen.findByText('Entwurf, noch nicht eingereicht')
    ).toBeInTheDocument();
    expect(screen.queryByText('Abgegeben')).not.toBeInTheDocument();
  });

  it('a submitted report shows "Abgegeben" (WMCNL-2944)', async () => {
    api([{ ...draft, status: 'SUBMITTED' }]);
    const user = await renderPage();
    await user.click(await screen.findByText(/KW 44/));
    expect(await screen.findByText('Abgegeben')).toBeInTheDocument();
  });

  it('closes the detail with Escape (WMCNL-2946)', async () => {
    api([draft]);
    const user = await renderPage();
    await user.click(await screen.findByText(/KW 44/));
    expect(
      await screen.findByText('Entwurf, noch nicht eingereicht')
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByText('Entwurf, noch nicht eingereicht')
      ).not.toBeInTheDocument()
    );
  });

  it('asks before deleting in the dialog of the platform, Escape cancels (WMCNL-2946)', async () => {
    api([draft]);
    const confirmSpy = jest.spyOn(window, 'confirm');
    const user = await renderPage();
    await user.click(await screen.findByRole('button', { name: /Löschen/ }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('wirklich löschen');
    expect(confirmSpy).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );
    expect(
      authFetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')
    ).toBe(false);

    // confirming deletes
    await user.click(screen.getByRole('button', { name: /Löschen/ }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: /Löschen/,
      })
    );
    await waitFor(() =>
      expect(
        authFetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === '/api/activity-reports/r1' &&
            init?.method === 'DELETE'
        )
      ).toBe(true)
    );
  });
});
