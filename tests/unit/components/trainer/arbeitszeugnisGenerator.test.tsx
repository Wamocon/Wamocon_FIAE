import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';
import { ArbeitszeugnisGenerator } from '@/components/trainer/arbeitszeugnis/ArbeitszeugnisGenerator';

// WMCNL-3013 and WMCNL-3014: the page of the certificate (Arbeitszeugnis).
// Why the buttons of the Gesamturteil are grey is said at the buttons, there is
// one section "Gesamturteil" (the closing text has its own name and a default
// text without "Person ... der Person"), the period is not invented (without a
// start of the training there is a hint instead of a calculated year), the
// last day of the period is not shown as the next day, counts are grammatical,
// the number of reports waiting for review has a label and no card stands
// empty.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn(async () => 'data:image/png;base64,AAAA') },
}));
jest.mock('@/components/trainer/arbeitszeugnis/SkillRadarChart', () => ({
  __esModule: true,
  SkillRadarChart: () => null,
  renderRadarChartForPDF: jest.fn(),
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const texts = de as Record<string, string>;

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

const trainee = (over: Record<string, unknown> = {}) => ({
  id: 't2',
  firstName: 'Leon',
  lastName: 'Moretz',
  full_name: 'Leon Moretz',
  email: 'leon.moretz@example.com',
  training_start_date: '2026-08-01T00:00:00.000Z',
  ausbildungDurationYears: 3,
  ausbildung_duration_years: 3,
  progress: 10,
  isActive: true,
  approvedReports: 1,
  pendingReports: 1,
  ...over,
});

const aggregate = (over: Record<string, unknown> = {}) => ({
  traineeId: 't2',
  traineeName: 'Leon Moretz',
  ausbildungsjahr: 1,
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2027-07-31T23:59:59.999Z',
  components: [],
  overallAverage: null,
  shorteningEligible: false,
  gradeLegend: {},
  approvedReportsCount: 1,
  totalEvaluatedUseCases: 0,
  totalHours: 8,
  avgWeeklyHours: 8,
  softSkills: {
    averages: {
      fachkompetenz: null,
      methodenkompetenz: null,
      sozialkompetenz: null,
      personalkompetenz: null,
    },
    overallAverage: null,
    criteria: [],
    totalRatings: 0,
  },
  ...over,
});

function api(
  traineeOver: Record<string, unknown> = {},
  aggregateAnswer: () => Response = () => json(aggregate())
) {
  authFetchMock.mockImplementation(async (input: any) => {
    const url = String(input);
    if (url.startsWith('/api/trainer/trainees/with-stats')) {
      return json({ trainees: [trainee(traineeOver)] });
    }
    if (url.includes('/arbeitszeugnis/aggregate/')) return aggregateAnswer();
    if (url.includes('/arbeitszeugnis/skill-radar/')) {
      return json({ radarData: [] });
    }
    if (url.includes('/arbeitszeugnis/certificates/')) {
      return json({ latestCertificate: null });
    }
    if (url.includes('/arbeitszeugnis/evidence/')) {
      return json({ highlights: [] });
    }
    return json({});
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'tr1', role: 'trainer' },
  });
});

async function toConfigure() {
  renderWithProviders(<ArbeitszeugnisGenerator />);
  fireEvent.click(await screen.findByRole('button', { name: /Leon Moretz/ }));
}

async function toReview() {
  await toConfigure();
  fireEvent.click(
    await screen.findByRole('button', {
      name: new RegExp(texts['arbeitszeugnis.continueToPreview']),
    })
  );
}

describe('the cards of the trainees', () => {
  it('labels the number of reports waiting for review', async () => {
    api();
    renderWithProviders(<ArbeitszeugnisGenerator />);
    const card = await screen.findByRole('button', { name: /Leon Moretz/ });
    expect(
      within(card).getByText(texts['arbeitszeugnis.pending'])
    ).toBeInTheDocument();
    expect(texts['arbeitszeugnis.pending']).toBe('zur Prüfung');
  });
});

describe('configure the period', () => {
  it('writes one approved report in the singular', async () => {
    api();
    await toConfigure();
    expect(
      await screen.findByText(/1\s+genehmigter Ausbildungsnachweis insgesamt/)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/1\s+genehmigte Ausbildungsnachweise/)
    ).toBeNull();
  });

  it('writes several approved reports in the plural', async () => {
    api({ approvedReports: 2 });
    await toConfigure();
    expect(
      await screen.findByText(/2\s+genehmigte Ausbildungsnachweise insgesamt/)
    ).toBeInTheDocument();
  });

  it('says there is no period without a start of the training, and does not go on', async () => {
    api({ training_start_date: null });
    await toConfigure();
    expect(
      (await screen.findAllByText(texts['arbeitszeugnis.trainingStartMissing']))
        .length
    ).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole('button', {
        name: new RegExp(texts['arbeitszeugnis.continueToPreview']),
      })
    );
    // still on the configuration, no calculation was asked for
    expect(
      screen.getByRole('button', {
        name: new RegExp(texts['arbeitszeugnis.continueToPreview']),
      })
    ).toBeInTheDocument();
    expect(
      authFetchMock.mock.calls.some(c =>
        String(c[0]).includes('/arbeitszeugnis/aggregate/')
      )
    ).toBe(false);
  });

  it('shows no warning for a trainee with a start of the training', async () => {
    api();
    await toConfigure();
    await screen.findByText(texts['arbeitszeugnis.selectPeriod']);
    expect(
      screen.queryByText(texts['arbeitszeugnis.trainingStartMissing'])
    ).toBeNull();
  });
});

describe('the preview', () => {
  it('shows the last day of the period as that day', async () => {
    api({}, () =>
      json(
        aggregate({
          periodEnd: '2026-07-31T23:59:59.999Z',
          periodStart: '2025-08-01T00:00:00.000Z',
        })
      )
    );
    await toReview();
    expect(await screen.findByText(/31\.7\.2026/)).toBeInTheDocument();
    expect(screen.queryByText(/1\.8\.2026/)).toBeNull();
  });

  it('shows the hint of the server when there is no start of the training', async () => {
    api({}, () =>
      json({ error: 'x', code: 'TRAINING_START_MISSING' }, false, 422)
    );
    await toReview();
    expect(
      await screen.findByText(texts['arbeitszeugnis.trainingStartMissing'])
    ).toBeInTheDocument();
  });

  it('has one section "Gesamturteil" and a closing text with its own name', async () => {
    api();
    await toReview();
    await screen.findByText(texts['arbeitszeugnis.overallAssessment']);
    expect(
      screen.getAllByRole('heading', { name: 'Gesamturteil' })
    ).toHaveLength(1);
    expect(
      screen.getByRole('heading', { name: 'Abschlusstext' })
    ).toBeInTheDocument();
  });

  it('draws no empty card (the suggestions are a card only when there are some)', async () => {
    api();
    await toReview();
    await screen.findByText(texts['arbeitszeugnis.overallAssessment']);
    // let the (empty) suggestions finish loading
    await waitFor(() =>
      expect(
        authFetchMock.mock.calls.some(c =>
          String(c[0]).includes('/arbeitszeugnis/evidence/')
        )
      ).toBe(true)
    );
    const cards = Array.from(
      document.querySelectorAll('div.rounded-2xl.border.p-6')
    );
    expect(cards.length).toBeGreaterThan(3);
    expect(
      cards.filter(card => (card.textContent ?? '').trim() === '')
    ).toEqual([]);
  });

  it('starts the closing text with the name, not with "Person ... der Person"', async () => {
    api();
    await toReview();
    const area = (await screen.findByPlaceholderText(
      texts['arbeitszeugnis.textPlaceholder']
    )) as HTMLTextAreaElement;
    await waitFor(() => expect(area.value).not.toBe(''));
    expect(area.value).toMatch(/^Leon Moretz hat die übertragenen Aufgaben/);
    expect(area.value).not.toMatch(/Person/);
  });

  it('says at the buttons what keeps them grey', async () => {
    api();
    await toReview();
    const generate = await screen.findByRole('button', {
      name: texts['arbeitszeugnis.generateWithAI'],
    });
    expect(generate).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: texts['arbeitszeugnis.generateWithoutAI'],
      })
    ).toBeDisabled();
    const hint = screen.getByTestId('generate-hint');
    expect(hint).toHaveTextContent(texts['arbeitszeugnis.generateNeedsGrade']);
    expect(hint).toHaveTextContent(
      texts['arbeitszeugnis.generateNeedsComponents']
    );

    // a chosen grade takes the first reason away, the second one stays
    fireEvent.click(screen.getByRole('button', { name: /^2\s+Gut$/ }));
    await waitFor(() =>
      expect(screen.getByTestId('generate-hint')).not.toHaveTextContent(
        texts['arbeitszeugnis.generateNeedsGrade']
      )
    );
    expect(screen.getByTestId('generate-hint')).toHaveTextContent(
      texts['arbeitszeugnis.generateNeedsComponents']
    );
  });

  it('has no hint and usable buttons when a grade is chosen and there are graded components', async () => {
    api({}, () =>
      json(
        aggregate({
          overallAverage: 2,
          components: [
            {
              componentId: 'c1',
              componentCode: 'K1',
              componentTitle: 'Komponente',
              averageGrade: 2,
              finalGrade: 2,
              totalHours: 8,
              gradedCount: 1,
              totalUseCases: 1,
            },
          ],
        })
      )
    );
    await toReview();
    const generate = await screen.findByRole('button', {
      name: texts['arbeitszeugnis.generateWithoutAI'],
    });
    await waitFor(() => expect(generate).toBeEnabled());
    expect(screen.queryByTestId('generate-hint')).toBeNull();
  });

  it('explains an empty list of component grades', async () => {
    api();
    await toReview();
    expect(
      await screen.findByText(texts['arbeitszeugnis.noComponentGrades'])
    ).toBeInTheDocument();
  });

  it('names the count of approved reports for the period', async () => {
    api();
    await toReview();
    expect(
      await screen.findByText('Genehmigte Nachweise im Zeitraum')
    ).toBeInTheDocument();
  });
});
