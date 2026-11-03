import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';
import { TrainerExamsTab } from '@/components/trainer/school/TrainerExamsTab';

// WMCNL-3016: points of an exam only from 0 up to the maximum, in the dialog
// and on the server. A grading stays changeable (a button next to the grade),
// also one saved above its maximum before: it is shown ("über dem Maximum")
// and can be corrected, the dialog says in words what is wrong.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const texts = de as Record<string, string>;

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

const exam = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  traineeId: 't2',
  traineeName: 'Leon Moretz',
  examDate: new Date(2026, 9, 20).toISOString(),
  subject: 'Netzwerktechnik',
  examTypeValue: 'TEST',
  isPersonal: false,
  lernfeldCode: null,
  isCompanyExam: true,
  points: null,
  maxPoints: null,
  passed: null,
  ...over,
});

function api(exams: unknown[], grade?: () => Response) {
  authFetchMock.mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (url.startsWith('/api/trainer/trainees')) return json({ trainees: [] });
    if (url.includes('/grade') && init?.method === 'PUT') {
      return grade ? grade() : json({ passed: true });
    }
    if (url.startsWith('/api/trainer/school/exams')) return json({ exams });
    return json({});
  });
}

const gradeCalls = () =>
  authFetchMock.mock.calls.filter(c => (c[1] as any)?.method === 'PUT');

async function openGrading(buttonName: string) {
  renderWithProviders(<TrainerExamsTab />);
  fireEvent.click(await screen.findByRole('button', { name: buttonName }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'tr1', role: 'trainer' },
    isPlatformOwner: false,
  });
});

describe('grading an exam', () => {
  it('does not take 150 of 100 points: a message, the button is off, nothing is sent', async () => {
    api([exam()]);
    const dialog = await openGrading(texts['exams.grade']);
    fireEvent.change(within(dialog).getByLabelText(texts['exams.points']), {
      target: { value: '150' },
    });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Die Punkte dürfen das Maximum (100) nicht überschreiten.'
    );
    const save = within(dialog).getByRole('button', {
      name: texts['common.save'],
    });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(gradeCalls()).toHaveLength(0);
  });

  it('takes 0 up to the maximum', async () => {
    api([exam()]);
    const dialog = await openGrading(texts['exams.grade']);
    for (const value of ['0', '100']) {
      fireEvent.change(within(dialog).getByLabelText(texts['exams.points']), {
        target: { value },
      });
      expect(
        within(dialog).getByRole('button', { name: texts['common.save'] })
      ).toBeEnabled();
      expect(within(dialog).queryByRole('alert')).toBeNull();
    }
  });

  it('closes with Esc', async () => {
    api([exam()]);
    await openGrading(texts['exams.grade']);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows what the server refuses instead of closing silently', async () => {
    api([exam()], () =>
      json(
        {
          error: 'Die Punkte dürfen die Maximalpunktzahl nicht überschreiten.',
        },
        false,
        400
      )
    );
    const dialog = await openGrading(texts['exams.grade']);
    fireEvent.change(within(dialog).getByLabelText(texts['exams.points']), {
      target: { value: '80' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: texts['common.save'] })
    );
    expect(
      await screen.findByText(
        'Die Punkte dürfen die Maximalpunktzahl nicht überschreiten.'
      )
    ).toBeInTheDocument();
  });
});

describe('a grading that is saved', () => {
  it('stays changeable: the grade has a button "Bewertung ändern"', async () => {
    api([exam({ points: 70, maxPoints: 100, passed: true })]);
    const dialog = await openGrading(texts['exams.gradeChange']);
    expect(within(dialog).getByLabelText(texts['exams.points'])).toHaveValue(
      70
    );
    fireEvent.change(within(dialog).getByLabelText(texts['exams.points']), {
      target: { value: '85' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: texts['common.save'] })
    );
    await waitFor(() => expect(gradeCalls()).toHaveLength(1));
    expect(JSON.parse((gradeCalls()[0][1] as any).body)).toEqual({
      points: 85,
      maxPoints: 100,
    });
  });

  it('shows 150/100 saved before, marks it, and lets the trainer correct it', async () => {
    api([exam({ points: 150, maxPoints: 100, passed: true })]);
    renderWithProviders(<TrainerExamsTab />);
    expect(await screen.findByText(/150\/100/)).toBeInTheDocument();
    expect(screen.getByText(texts['exams.aboveMax'])).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: texts['exams.gradeChange'] })
    );
    const dialog = await screen.findByRole('dialog');
    // the value is still there, the message says what to do, saving is off
    expect(within(dialog).getByLabelText(texts['exams.points'])).toHaveValue(
      150
    );
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: texts['common.save'] })
    ).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(texts['exams.points']), {
      target: { value: '90' },
    });
    expect(
      within(dialog).getByRole('button', { name: texts['common.save'] })
    ).toBeEnabled();
  });

  it('shows a saved result without a known maximum as plain points', async () => {
    api([exam({ points: 0, maxPoints: null, passed: false })]);
    renderWithProviders(<TrainerExamsTab />);
    expect(await screen.findByText(/^0 \(/)).toBeInTheDocument();
    expect(screen.queryByText(/null/)).toBeNull();
  });
});
