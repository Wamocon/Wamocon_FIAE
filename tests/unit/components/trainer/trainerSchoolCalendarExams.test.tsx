import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';
import { TrainerCalendarTab } from '@/components/trainer/school/TrainerCalendarTab';
import { TrainerExamsTab } from '@/components/trainer/school/TrainerExamsTab';

// WMCNL-3018 and WMCNL-3020: the calendar of the trainer shows the exams the
// trainee entered, the names are written like names, the placeholder is German
// and the chosen trainee stays over a switch of the occupation tab. The list of
// the exams shows the type the exam was given.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const texts = de as Record<string, string>;

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const trainees = [
  {
    id: 't1',
    firstName: null,
    lastName: null,
    email: 'yordan.krastev@example.com',
    full_name: null,
  },
  {
    id: 't2',
    firstName: 'Leon',
    lastName: 'Moretz',
    email: 'leon.moretz@example.com',
  },
];

const today = new Date();
today.setHours(12, 0, 0, 0);

const exam = {
  id: 'e1',
  traineeId: 't2',
  traineeName: 'Leon Moretz',
  examDate: today.toISOString(),
  subject: 'Netzwerktechnik',
  examTypeValue: 'TEST',
  isPersonal: true,
  lernfeldCode: null,
  isCompanyExam: true,
  points: null,
  maxPoints: null,
  passed: null,
};

const urls: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  urls.length = 0;
  window.sessionStorage.clear();
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'tr1', role: 'trainer' },
    isPlatformOwner: false,
  });
  authFetchMock.mockImplementation(async (input: any) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith('/api/trainer/trainees')) return json({ trainees });
    if (url.startsWith('/api/trainer/blocks')) return json({ blocks: [] });
    if (url.startsWith('/api/trainer/school/exams')) {
      return json({ exams: [exam] });
    }
    return json({});
  });
});

describe('trainer calendar (WMCNL-3020)', () => {
  it('writes the names like names and the placeholder in German', async () => {
    renderWithProviders(<TrainerCalendarTab />);
    expect(
      await screen.findByRole('option', { name: 'Leon Moretz' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Yordan Krastev' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'yordan krastev' })).toBeNull();
    expect(
      screen.getByRole('option', {
        name: texts['trainer.school.calendar.selectTrainee'],
      })
    ).toBeInTheDocument();
    expect(texts['trainer.school.calendar.selectTrainee']).toBe(
      'Azubi auswählen...'
    );
    expect(screen.queryByText(/Trainee auswählen/)).toBeNull();
  });

  it('keeps the chosen trainee over a switch of the occupation tab', async () => {
    window.sessionStorage.setItem('wmc_trainer_calendar_trainee', 't2');
    renderWithProviders(<TrainerCalendarTab />);
    await screen.findByRole('option', { name: 'Leon Moretz' });
    await waitFor(() =>
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(
        't2'
      )
    );
  });

  it('takes the first trainee on purpose when the chosen one is not in the list', async () => {
    window.sessionStorage.setItem('wmc_trainer_calendar_trainee', 'gone');
    renderWithProviders(<TrainerCalendarTab />);
    await screen.findByRole('option', { name: 'Leon Moretz' });
    await waitFor(() =>
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(
        't1'
      )
    );
  });

  it('remembers a choice of the trainer', async () => {
    renderWithProviders(<TrainerCalendarTab />);
    await screen.findByRole('option', { name: 'Leon Moretz' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't2' } });
    expect(window.sessionStorage.getItem('wmc_trainer_calendar_trainee')).toBe(
      't2'
    );
  });
});

describe('trainer calendar shows the exams of the trainee (WMCNL-3018)', () => {
  it('draws an exam the trainee entered into the calendar', async () => {
    window.sessionStorage.setItem('wmc_trainer_calendar_trainee', 't2');
    renderWithProviders(<TrainerCalendarTab />);
    expect(await screen.findByText(/Netzwerktechnik/)).toBeInTheDocument();
    expect(
      urls.some(u => u.startsWith('/api/trainer/school/exams?traineeId=t2'))
    ).toBe(true);
  });

  it('shows an exam of the same day only once when a block of the type exam exists', async () => {
    window.sessionStorage.setItem('wmc_trainer_calendar_trainee', 't2');
    authFetchMock.mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.startsWith('/api/trainer/trainees')) return json({ trainees });
      if (url.startsWith('/api/trainer/blocks')) {
        return json({
          blocks: [
            {
              id: 'b1',
              calendarWeek: 1,
              year: today.getFullYear(),
              startDate: today.toISOString(),
              endDate: today.toISOString(),
              blockType: 'EXAM',
              blockNumber: null,
              title: 'Klausur WMC',
              notes: null,
              description: null,
              createdByTrainerId: null,
              isPersonal: false,
            },
          ],
        });
      }
      if (url.startsWith('/api/trainer/school/exams')) {
        return json({ exams: [exam] });
      }
      return json({});
    });
    renderWithProviders(<TrainerCalendarTab />);
    expect(await screen.findByText(/Klausur WMC/)).toBeInTheDocument();
    expect(screen.queryByText(/Netzwerktechnik/)).toBeNull();
  });
});

describe('trainer exam list (WMCNL-3018)', () => {
  it('shows the type the exam was given, not "Betrieblich"', async () => {
    renderWithProviders(<TrainerExamsTab />);
    expect(await screen.findByText('Netzwerktechnik')).toBeInTheDocument();
    expect(screen.getByText(texts['exams.type.test'])).toBeInTheDocument();
    expect(screen.queryByText(texts['exams.type.company'])).toBeNull();
  });

  it('asks for the exams of one trainee with a real query string', async () => {
    renderWithProviders(<TrainerExamsTab />);
    await screen.findByText('Netzwerktechnik');
    authFetchMock.mockClear();
    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 't2' },
    });
    await waitFor(() =>
      expect(
        authFetchMock.mock.calls.some(
          c => String(c[0]) === '/api/trainer/school/exams?traineeId=t2'
        )
      ).toBe(true)
    );
  });
});
