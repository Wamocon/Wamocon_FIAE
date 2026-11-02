import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { SchoolView } from '@/components/school/SchoolView';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// WMCNL-2956: the card "Anstehende Prüfungen" above the tabs kept the number of
// the first load. It now follows what happens in the tab Prüfungen: an exam is
// added, an exam is deleted (in the dialog of the platform, WMCNL-2946).

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('@/components/school/BlockCalendar', () => ({
  BlockCalendar: () => null,
}));
jest.mock('@/components/school/ActivityReportsList', () => ({
  ActivityReportsList: () => null,
}));
jest.mock('@/components/school/LernfeldNotes', () => ({
  LernfeldNotes: () => null,
}));
jest.mock('@/components/school/LernfelderTab', () => ({
  LernfelderTab: () => null,
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

// the "server": the exams of the trainee
let exams: any[] = [];

const examRow = (id: string, subject: string) => ({
  id,
  examDate: '2099-12-01T00:00:00.000Z',
  dayOfWeek: null,
  period: null,
  teacher: null,
  subject,
  examTypeValue: null,
  lernfeldCode: null,
  notes: null,
  isPersonal: true,
  result: null,
  meta: { daysUntil: 400, isPast: false, isToday: false, isSoon: false },
});

function server() {
  authFetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (
      url.startsWith('/api/trainee/school/exams/') &&
      init?.method === 'DELETE'
    ) {
      const id = url.split('/').pop()!;
      exams = exams.filter(e => e.id !== id);
      return json({ success: true });
    }
    if (url === '/api/trainee/school/exams' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const row = examRow(`e${exams.length + 1}`, body.subject);
      exams = [...exams, row];
      return json({ id: row.id, exam: row });
    }
    if (url.startsWith('/api/trainee/school/exams?')) {
      return json({ exams, meta: { total: exams.length } });
    }
    return json({ reports: [], blocks: [], meta: {} });
  });
}

const upcomingCard = () =>
  screen.getByText('Anstehende Prüfungen').parentElement as HTMLElement;

describe('SchoolView: the counter of the upcoming exams', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    exams = [];
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainee-1', role: 'trainee' },
      loading: false,
    });
    server();
  });

  it('follows adding and deleting an exam', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SchoolView />);
    await waitFor(() => expect(upcomingCard()).toHaveTextContent('0'));

    await user.click(screen.getByRole('button', { name: /Prüfungen/ }));
    await user.click(await screen.findByRole('button', { name: /Hinzufügen/ }));
    const subject = await screen.findByPlaceholderText('z.B. Netzwerktechnik');
    const form = subject.closest('form') as HTMLFormElement;
    fireEvent.change(form.querySelector('input[type="date"]')!, {
      target: { value: '2099-12-01' },
    });
    fireEvent.change(subject, { target: { value: 'Netzwerktechnik' } });
    await user.click(within(form).getByRole('button', { name: /Hinzufügen/ }));

    // the list says 1, and so does the card above the tabs (it said 0)
    await screen.findByText('1 anstehende Prüfung');
    await waitFor(() => expect(upcomingCard()).toHaveTextContent('1'));

    // deleting asks in the dialog of the platform and updates the card again
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /Löschen/ }));
    await screen.findByText('0 anstehende Prüfungen');
    await waitFor(() => expect(upcomingCard()).toHaveTextContent('0'));
    expect(upcomingCard()).not.toHaveTextContent('1');
  });

  it('counts all the upcoming exams, not the first five', async () => {
    exams = Array.from({ length: 7 }, (_, i) => examRow(`e${i}`, `Fach ${i}`));
    renderWithProviders(<SchoolView />);
    await waitFor(() => expect(upcomingCard()).toHaveTextContent('7'));
    const urls = authFetchMock.mock.calls.map(call => String(call[0]));
    expect(
      urls.some(
        u =>
          u.startsWith('/api/trainee/school/exams?') &&
          u.includes('upcoming=true') &&
          !u.includes('limit=5&')
      )
    ).toBe(true);
    expect(urls.some(u => u.endsWith('limit=5'))).toBe(false);
  });
});
