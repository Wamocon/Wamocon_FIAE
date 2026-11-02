import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';
import { TrainerCalendarTab } from '@/components/trainer/school/TrainerCalendarTab';

// WMCNL-3017 and WMCNL-3019: the dialog "Blocker erstellen" of the trainer.
// The calendar invitation is off until the trainer ticks it, an end before the
// start is said in words next to the fields (not only by a grey button), the
// texts are German and there is no "N/A", the dialog hangs in the body (not
// inside the glass panel, where it was cut off) and closes with Esc, and the
// deletion of a blocker asks for the blocker, not for an exam.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const texts = de as Record<string, string>;

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const trainees = [
  {
    id: 't2',
    firstName: 'Leon',
    lastName: 'Moretz',
    email: 'leon.moretz@example.com',
  },
];

const today = new Date();
today.setHours(12, 0, 0, 0);

const ownBlocker = {
  id: 'b1',
  calendarWeek: 1,
  year: today.getFullYear(),
  startDate: today.toISOString(),
  endDate: today.toISOString(),
  blockType: 'TRAINER_BLOCKER',
  blockNumber: null,
  title: 'Teamtag',
  notes: null,
  description: null,
  createdByTrainerId: 'tr1',
  isPersonal: false,
};

let blocks: unknown[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  window.sessionStorage.setItem('wmc_trainer_calendar_trainee', 't2');
  blocks = [];
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'tr1', role: 'trainer' },
    isPlatformOwner: false,
  });
  authFetchMock.mockImplementation(async (input: any) => {
    const url = String(input);
    if (url.startsWith('/api/trainer/trainees')) return json({ trainees });
    if (url.startsWith('/api/trainer/blocks')) return json({ blocks });
    if (url.startsWith('/api/trainer/school/exams')) return json({ exams: [] });
    return json({});
  });
});

async function openDialog() {
  const view = renderWithProviders(<TrainerCalendarTab />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: texts['trainer.calendar.createBlock'],
    })
  );
  const dialog = await screen.findByRole('dialog');
  return { view, dialog };
}

describe('dialog "Blocker erstellen"', () => {
  it('does not send the calendar invitation by default', async () => {
    const { dialog } = await openDialog();
    const box = within(dialog).getByRole('checkbox', {
      name: texts['calendar.sendInvite'],
    });
    expect(box).not.toBeChecked();
  });

  it('sends no invitation unless the trainer ticks the box', async () => {
    const { dialog } = await openDialog();
    fireEvent.change(
      within(dialog).getByLabelText(texts['calendar.modal.startDate']),
      {
        target: { value: '2027-03-01' },
      }
    );
    fireEvent.change(
      within(dialog).getByLabelText(texts['calendar.modal.endDate']),
      {
        target: { value: '2027-03-01' },
      }
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: texts['common.create'] })
    );
    await waitFor(() =>
      expect(
        authFetchMock.mock.calls.some(
          c =>
            String(c[0]) === '/api/trainer/blocks' &&
            (c[1] as any)?.method === 'POST'
        )
      ).toBe(true)
    );
    const post = authFetchMock.mock.calls.find(
      c =>
        String(c[0]) === '/api/trainer/blocks' &&
        (c[1] as any)?.method === 'POST'
    )!;
    expect(JSON.parse((post[1] as any).body).sendInvitation).toBe(false);
  });

  it('says in words that the end lies before the start, and the button is off', async () => {
    const { dialog } = await openDialog();
    fireEvent.change(
      within(dialog).getByLabelText(texts['calendar.modal.startDate']),
      {
        target: { value: '2027-03-01' },
      }
    );
    fireEvent.change(
      within(dialog).getByLabelText(texts['calendar.modal.endDate']),
      {
        target: { value: '2027-02-01' },
      }
    );
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      texts['trainer.school.calendar.endBeforeStart']
    );
    expect(
      within(dialog).getByRole('button', { name: texts['common.create'] })
    ).toBeDisabled();
  });

  it('writes the recipients and the labels in German, with no "N/A"', async () => {
    const { dialog } = await openDialog();
    expect(within(dialog).getByText('Für Leon Moretz')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Trainee\(s\)|Azubi\(s\)/)).toBeNull();
    expect(within(dialog).queryByText('N/A')).toBeNull();
    expect(
      within(dialog).getByText(texts['calendar.modal.blockType'])
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/Block-Type/)).toBeNull();
  });

  it('hangs in the body, not inside the panel of the page', async () => {
    const { view, dialog } = await openDialog();
    expect(view.container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('closes with Esc', async () => {
    await openDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('deleting a blocker', () => {
  it('asks "Blocker wirklich löschen?", not for an exam', async () => {
    blocks = [ownBlocker];
    renderWithProviders(<TrainerCalendarTab />);
    fireEvent.click(await screen.findByText(/Teamtag/));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: texts['common.delete'] })
    );
    expect(
      within(dialog).getByText('Blocker wirklich löschen?')
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/Prüfung wirklich/)).toBeNull();
  });
});
