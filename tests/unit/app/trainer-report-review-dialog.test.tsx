import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TrainerActivityReportsPage from '@/app/trainer/activity-reports/page';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import { useRequestCatalog } from '@/lib/hooks/useRequestCatalog';
import { withCatalogParam } from '@/lib/catalog/request-catalog';
import de from '@/locales/de.json';

// WMCNL-3011 and WMCNL-3012: the review dialog of an Ausbildungsnachweis (trainer).
// The title fits the status, the button is "Weiter" (not "Next"), Genehmigen is
// reachable from every tab (what is missing stands next to it), Esc closes the
// dialog, hours are written with a comma and the text speaks to the trainer
// with "du". A use case without hours says "ohne Vorgabe" instead of "0 Std.".

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('@/lib/hooks/useRequestCatalog');
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const texts = de as Record<string, string>;

function json(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const report = (status: string, id = 'r1') => ({
  id,
  traineeId: 't1',
  traineeName: 'Leon Moretz',
  ausbildungsjahr: 1,
  weekNumber: 42,
  year: 2026,
  periodStart: '2026-10-12T00:00:00.000Z',
  periodEnd: '2026-10-18T00:00:00.000Z',
  status,
  submittedAt: null,
  reviewerFeedback: null,
  traineeSignedAt: null,
  trainerSignedAt: null,
  reviewerId: null,
  reviewerName: null,
  createdAt: '2026-10-19T08:00:00.000Z',
  hasOverbooking: false,
});

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  reportId: 'r1',
  useCaseId: 'u1',
  plannedHours: 40,
  actualHours: 8,
  isOverbooked: false,
  notes: 'Netzwerk eingerichtet',
  traineeGrade: '2',
  trainerGrade: null,
  gradeComment: null,
  ...over,
});

function api(
  reports: unknown[],
  entries: unknown[],
  plannedHours = 40,
  criteria: unknown[] = []
) {
  authFetchMock.mockImplementation(async input => {
    const url = String(input);
    if (url.startsWith('/api/training-components')) {
      return json({
        components: [{ id: 'c1', code: 'K1', title: 'Komponente' }],
      });
    }
    if (url.startsWith('/api/training-use-cases')) {
      return json({
        useCases: [
          {
            id: 'u1',
            componentId: 'c1',
            letter: 'a',
            description: 'Netzwerk planen',
            plannedHours,
          },
        ],
      });
    }
    if (url.startsWith('/api/trainer/activity-reports'))
      return json({ reports });
    if (url.startsWith('/api/trainer/trainees')) return json({ trainees: [] });
    if (url.includes('/entries')) return json({ entries });
    if (url.startsWith('/api/softskill-criteria')) return json({ criteria });
    return json({});
  });
}

async function openReport(name = 'Leon Moretz') {
  const user = userEvent.setup();
  renderWithProviders(<TrainerActivityReportsPage />);
  await user.click(
    await screen.findByRole('button', { name: new RegExp(name) })
  );
  return {
    user,
    dialog: await screen.findByRole('dialog'),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'tr1', role: 'trainer' },
    loading: false,
  });
  (useRequestCatalog as jest.Mock).mockReturnValue({
    ready: true,
    catalog: 'FIAE',
    withCatalog: (url: string) => withCatalogParam(url, 'FIAE'),
    phaseOneMonthsFor: () => undefined,
  });
});

describe('review dialog of the trainer', () => {
  it('is called "prüfen" while there is something to check', async () => {
    api([report('SUBMITTED')], [entry()]);
    const { dialog } = await openReport();
    expect(
      within(dialog).getByRole('heading', {
        name: 'Ausbildungsnachweis prüfen',
      })
    ).toBeInTheDocument();
  });

  it('is not called "prüfen" once the report is done', async () => {
    api([report('APPROVED')], [entry({ trainerGrade: '2' })]);
    const user = userEvent.setup();
    renderWithProviders(<TrainerActivityReportsPage />);
    // the card of the approved reports is the filter
    await user.click(
      await screen.findByText(texts['trainer.reports.approved'])
    );
    await user.click(
      await screen.findByRole('button', { name: /Leon Moretz/ })
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', {
        name: 'Ausbildungsnachweis (genehmigt)',
      })
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Ausbildungsnachweis prüfen')).toBeNull();
  });

  it('has "Weiter" and "Genehmigen" on the first tab, no English "Next"', async () => {
    api([report('SUBMITTED')], [entry()]);
    const { dialog } = await openReport();
    expect(
      within(dialog).getByRole('button', { name: 'Weiter' })
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Genehmigen' })
    ).toBeEnabled();
    expect(within(dialog).queryByText('Next')).toBeNull();
  });

  it('closes with Esc', async () => {
    api([report('SUBMITTED')], [entry()]);
    await openReport();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('writes the hours with a comma and "Std."', async () => {
    api([report('SUBMITTED')], [entry({ actualHours: 8, plannedHours: 8 })], 8);
    const { dialog } = await openReport();
    // plan 8 and actual 8: the difference is 0,0 Std., not 0.0 Std
    expect(within(dialog).getAllByText('0,0 Std.').length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/0\.0/)).toBeNull();
  });

  it('says "ohne Vorgabe" for a use case without hours, no 0 Std. and no difference', async () => {
    api([report('SUBMITTED')], [entry({ plannedHours: 0, actualHours: 6 })], 0);
    const { dialog } = await openReport();
    expect(
      within(dialog).getAllByText(texts['reports.noPlannedHours']).length
    ).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/^0 Std\.$/)).toBeNull();
  });

  it('says what is missing next to Genehmigen, and a click goes to the tab', async () => {
    api([report('SUBMITTED')], [entry()]);
    const { user, dialog } = await openReport();
    const hint = within(dialog).getByTestId('approve-missing');
    expect(hint).toHaveTextContent(
      texts['trainer.reports.modal.approveMissingPrefix']
    );
    expect(hint).toHaveTextContent('Noten für alle Tätigkeiten');
    await user.click(
      within(dialog).getByRole('button', { name: 'Genehmigen' })
    );
    // the grades are missing: the dialog leads to the grades tab
    expect(
      await within(dialog).findByText(texts['trainer.reports.modal.gradeInfo'])
    ).toBeInTheDocument();
  });

  it('a report without entries can only be rejected', async () => {
    api([report('SUBMITTED')], []);
    const { dialog } = await openReport();
    expect(within(dialog).getByTestId('approve-missing')).toHaveTextContent(
      texts['trainer.reports.modal.approveMissingEntries']
    );
    expect(
      within(dialog).getByRole('button', { name: 'Genehmigen' })
    ).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'Ablehnen' })
    ).toBeEnabled();
  });

  it('shows a neutral text when no rating criteria are set up, no developer hint', async () => {
    api([report('SUBMITTED')], [entry()], 40, []);
    const { user, dialog } = await openReport();
    await user.click(within(dialog).getByRole('button', { name: /Skills/ }));
    expect(
      await within(dialog).findByText(
        texts['trainer.reports.modal.noSoftskills']
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Seed/i)).toBeNull();
    expect(texts['trainer.reports.modal.noSoftskills']).not.toMatch(
      /Seed|Skript/i
    );
  });

  it('speaks to the trainer with "du" in the texts of the dialog', () => {
    const keys = Object.keys(texts).filter(key =>
      key.startsWith('trainer.reports.')
    );
    const formal = keys.filter(key =>
      /\b(Sie|Ihre|Ihr|Ihnen|Ihrem)\b/.test(texts[key])
    );
    expect(formal).toEqual([]);
  });
});
