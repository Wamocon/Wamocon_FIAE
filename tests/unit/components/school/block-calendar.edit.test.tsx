import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { BlockCalendar } from '@/components/school/BlockCalendar';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// Berufsschule, Blockkalender:
// WMCNL-2957 an entry can be edited (date, time, type, texts), not only
// deleted, WMCNL-2958 "Noch keine Einträge" only when nothing is to be seen and
// today is marked in the week view too, WMCNL-2946 the dialogs close with
// Escape and deleting asks in the dialog of the platform.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function json(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const now = new Date();

const block = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  traineeId: 'trainee-1',
  schuljahr: '2026/2027',
  ausbildungsjahr: 2,
  calendarWeek: 1,
  year: now.getFullYear(),
  startDate: new Date(now.getFullYear(), now.getMonth(), 10, 8).toISOString(),
  endDate: new Date(now.getFullYear(), now.getMonth(), 12, 16).toISOString(),
  blockType: 'SCHOOL',
  blockNumber: 3,
  title: 'Blockwoche Schule',
  notes: 'alt',
  description: null,
  examSubType: null,
  inviteeEmails: null,
  isPersonal: false,
  createdByTrainerId: null,
  ...over,
});

function server(blocks: unknown[], exams: unknown[] = []) {
  authFetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith('/api/me/catalogs'))
      return json({ catalogs: [], activeCode: 'FIAE' });
    if (
      url.startsWith('/api/trainee/school/blocks/') &&
      init?.method === 'PUT'
    ) {
      return json({
        block: { ...(blocks[0] as object), ...JSON.parse(String(init.body)) },
      });
    }
    if (
      url.startsWith('/api/trainee/school/blocks/') &&
      init?.method === 'DELETE'
    ) {
      return json({ success: true });
    }
    if (url.startsWith('/api/trainee/school/blocks')) {
      return json({
        blocks,
        meta: {
          currentSchuljahr: '2026/2027',
          currentWeek: 1,
          currentYear: now.getFullYear(),
        },
      });
    }
    if (url.startsWith('/api/trainee/school/exams')) return json({ exams });
    return json({});
  });
}

const callsOf = (method: string) =>
  authFetchMock.mock.calls.filter(([, init]) => init?.method === method);

describe('BlockCalendar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (useAuth as jest.Mock).mockReturnValue({
      profile: {
        id: 'trainee-1',
        role: 'trainee',
        ausbildung_duration_years: 3,
      },
      loading: false,
    });
  });

  describe('editing an entry (WMCNL-2957)', () => {
    async function openBlock(user: ReturnType<typeof userEvent.setup>) {
      const entries = await screen.findAllByText(/Blockwoche Schule/);
      await user.click(entries[0].closest('button') as HTMLElement);
    }

    it('offers "Bearbeiten", fills the form with the entry and saves with PUT', async () => {
      server([block()]);
      const user = userEvent.setup();
      const onChanged = jest.fn();
      renderWithProviders(<BlockCalendar onChanged={onChanged} />);
      await openBlock(user);
      await user.click(
        await screen.findByRole('button', { name: 'Bearbeiten' })
      );

      expect(await screen.findByText('Eintrag bearbeiten')).toBeInTheDocument();
      const form = document.querySelector('form') as HTMLFormElement;
      // date, time, type and the texts of the entry are in the form
      const dates =
        form.querySelectorAll<HTMLInputElement>('input[type="date"]');
      const times =
        form.querySelectorAll<HTMLInputElement>('input[type="time"]');
      const day = (n: number) =>
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${n}`;
      expect(dates[0].value).toBe(day(10));
      expect(dates[1].value).toBe(day(12));
      expect(times[0].value).toBe('08:00');
      expect(times[1].value).toBe('16:00');
      expect(
        within(form).getByRole('button', { name: 'Schule' })
      ).toHaveAttribute('aria-pressed', 'true');
      const notes = within(form).getByDisplayValue('alt');

      fireEvent.change(notes, { target: { value: 'neu' } });
      fireEvent.change(times[1], { target: { value: '15:30' } });
      await user.click(within(form).getByRole('button', { name: 'Speichern' }));

      await waitFor(() => expect(callsOf('PUT')).toHaveLength(1));
      const [url, init] = callsOf('PUT')[0];
      expect(String(url)).toBe('/api/trainee/school/blocks/b1');
      const body = JSON.parse(String(init?.body));
      expect(body.notes).toBe('neu');
      expect(body.blockType).toBe('SCHOOL');
      expect(body.title).toBe('Blockwoche Schule');
      expect(new Date(body.endDate).getHours()).toBe(15);
      expect(new Date(body.endDate).getMinutes()).toBe(30);
      // the form is gone, the card above the tabs is told, nothing was created
      await waitFor(() =>
        expect(screen.queryByText('Eintrag bearbeiten')).not.toBeInTheDocument()
      );
      expect(onChanged).toHaveBeenCalled();
      expect(callsOf('POST')).toHaveLength(0);
    });

    it('does not offer "Bearbeiten" for an entry a trainer made', async () => {
      server([block({ createdByTrainerId: 'trainer-1' })]);
      const user = userEvent.setup();
      renderWithProviders(<BlockCalendar />);
      await openBlock(user);
      expect(
        await screen.findByRole('button', { name: 'Löschen' })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Bearbeiten' })
      ).not.toBeInTheDocument();
    });
  });

  describe('empty state and today (WMCNL-2958)', () => {
    const exam = {
      id: 'x1',
      examDate: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        12
      ).toISOString(),
      subject: 'Netzwerktechnick',
      examTypeValue: null,
      lernfeldCode: null,
      teacher: null,
      period: null,
    };

    it('shows the hint when there is no entry at all', async () => {
      server([], []);
      renderWithProviders(<BlockCalendar />);
      expect(
        await screen.findByText('Noch keine Einträge')
      ).toBeInTheDocument();
    });

    it('does not show the hint while an exam is on the calendar', async () => {
      server([], [exam]);
      renderWithProviders(<BlockCalendar />);
      expect(await screen.findByText('Netzwerktechnick')).toBeInTheDocument();
      expect(screen.queryByText('Noch keine Einträge')).not.toBeInTheDocument();
    });

    it('marks today in the week view like in the month view', async () => {
      server([], []);
      const user = userEvent.setup();
      renderWithProviders(<BlockCalendar />);
      await screen.findByText('Noch keine Einträge');
      await user.click(screen.getByRole('button', { name: 'Woche' }));
      const today = document.querySelector('[aria-current="date"]');
      expect(today).not.toBeNull();
      expect(today).toHaveTextContent(String(now.getDate()));
      expect(today).toHaveClass('bg-accent');
    });
  });

  describe('dialogs (WMCNL-2946)', () => {
    it('closes the detail with Escape', async () => {
      server([block()]);
      const user = userEvent.setup();
      renderWithProviders(<BlockCalendar />);
      const entries = await screen.findAllByText(/Blockwoche Schule/);
      await user.click(entries[0].closest('button') as HTMLElement);
      expect(
        await screen.findByRole('button', { name: 'Schließen' })
      ).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Schließen' })
        ).not.toBeInTheDocument()
      );
    });

    it('closes the form of a new entry with Escape', async () => {
      server([block()]);
      const user = userEvent.setup();
      renderWithProviders(<BlockCalendar />);
      await screen.findAllByText(/Blockwoche Schule/);
      await user.click(screen.getByRole('button', { name: 'Neu' }));
      expect(await screen.findByText('Block hinzufügen')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByText('Block hinzufügen')).not.toBeInTheDocument()
      );
    });

    it('asks before deleting in the dialog of the platform, Escape only closes that dialog', async () => {
      server([block()]);
      const confirmSpy = jest.spyOn(window, 'confirm');
      const user = userEvent.setup();
      renderWithProviders(<BlockCalendar />);
      const entries = await screen.findAllByText(/Blockwoche Schule/);
      await user.click(entries[0].closest('button') as HTMLElement);
      await user.click(await screen.findByRole('button', { name: 'Löschen' }));

      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toHaveTextContent('Block wirklich löschen?');
      expect(confirmSpy).not.toHaveBeenCalled();

      // Escape answers to the dialog on top, the detail below stays open
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      );
      expect(
        screen.getByRole('button', { name: 'Schließen' })
      ).toBeInTheDocument();
      expect(callsOf('DELETE')).toHaveLength(0);

      await user.click(screen.getByRole('button', { name: 'Löschen' }));
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: /Löschen/,
        })
      );
      await waitFor(() => expect(callsOf('DELETE')).toHaveLength(1));
    });
  });
});
