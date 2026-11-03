import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { LernfeldNotes } from '@/components/school/LernfeldNotes';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// WMCNL-2959: the Lernfelder of the notes are in the order of their numbers
// (LF-1, LF-2, ... LF-10, not LF-1, LF-10, LF-11, LF-12, LF-2) and every row
// carries the name of the Lernfeld, not only the start of its description.
// WMCNL-2946: deleting a note asks in the dialog of the platform and Escape
// closes the dialog of a new note.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const lf = (n: number, name: string, description: string | null = null) => ({
  id: `lf${n}`,
  code: `LF-${n}`,
  name,
  title: name,
  description,
  trainingYear: null,
  hoursBudget: null,
  isCommon: false,
  orderIndex: n,
});

// the API sends them as text order: LF-1, LF-10, LF-11, LF-12, LF-2, LF-3
const textOrder = [
  lf(
    1,
    'Das Unternehmen und die eigene Rolle im Betrieb beschreiben',
    'Die Auszubildenden stellen ihr Unternehmen vor'
  ),
  lf(10, 'Kundenspezifische Systeme entwickeln'),
  lf(11, 'Funktionalität in Anwendungen realisieren'),
  lf(12, 'Betrieb und Sicherheit von Anwendungen'),
  lf(2, 'Arbeitsplätze nach Kundenwunsch ausstatten'),
  lf(3, 'Clients in Netzwerke einbinden'),
];

describe('LernfeldNotes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainee-1', role: 'trainee' },
      loading: false,
    });
    authFetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith('/api/trainee/school/lernfelder'))
        return json({ lernfelder: textOrder });
      if (init?.method === 'DELETE') return json({ ok: true });
      if (url.startsWith('/api/trainee/knowledge-notes'))
        return json({
          notes: [
            {
              id: 'n1',
              title: 'Meine Notiz',
              content: 'Inhalt',
              createdAt: '2026-10-30T10:00:00.000Z',
              oneDriveLink: null,
              lernfeldCode: 'LF-2',
            },
          ],
        });
      return json({});
    });
  });

  it('lists the Lernfelder by their number and names each one', async () => {
    renderWithProviders(<LernfeldNotes />);
    await screen.findByText('Clients in Netzwerke einbinden');
    const badges = screen.getAllByText(/^LF-\d+$/).map(el => el.textContent);
    expect(badges).toEqual(['LF-1', 'LF-2', 'LF-3', 'LF-10', 'LF-11', 'LF-12']);
    // the name is there even when a description exists
    expect(
      screen.getByText(
        'Das Unternehmen und die eigene Rolle im Betrieb beschreiben'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('Die Auszubildenden stellen ihr Unternehmen vor')
    ).toBeInTheDocument();
  });

  it('deletes a note only after the dialog of the platform, Escape cancels', async () => {
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, 'confirm');
    renderWithProviders(<LernfeldNotes />);
    await screen.findByText('Clients in Netzwerke einbinden');
    // open LF-2 (the second row) where the note is
    await user.click(
      screen.getByText('Arbeitsplätze nach Kundenwunsch ausstatten')
    );
    await screen.findByText('Meine Notiz');
    await user.click(screen.getByRole('button', { name: 'Löschen' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Notiz wirklich löschen?');
    expect(confirmSpy).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );
    expect(
      authFetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')
    ).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: /Löschen/,
      })
    );
    await waitFor(() =>
      expect(screen.queryByText('Meine Notiz')).not.toBeInTheDocument()
    );
  });
});
