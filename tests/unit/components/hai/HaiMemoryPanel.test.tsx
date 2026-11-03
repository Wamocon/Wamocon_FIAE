import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiMemoryPanel } from '@/components/hai/HaiMemoryPanel';
import { authFetch } from '@/lib/authFetch';

// "Mein HAI-Gedächtnis" in the profile: the person sees the own entries per
// occupation, changes and deletes them, deletes everything and switches the
// memory on or off. Nothing is shown while the feature is not available.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
}));

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<unknown>
>;

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const E1 = '30000000-0000-4000-8000-000000000001';
const E2 = '30000000-0000-4000-8000-000000000002';

const entry = (over: Record<string, unknown> = {}) => ({
  id: E1,
  catalogId: FIAE,
  kind: 'preference',
  source: 'stated',
  status: 'active',
  content: 'Bevorzugt kurze, knappe Antworten.',
  createdAt: '2026-11-03T10:00:00.000Z',
  updatedAt: '2026-11-03T10:00:00.000Z',
  confirmedAt: '2026-11-03T10:00:00.000Z',
  ...over,
});

const overview = (over: Record<string, unknown> = {}) => ({
  available: true,
  enabled: true,
  occupations: [
    {
      id: FIAE,
      code: 'FIAE',
      title: 'Fachinformatiker/in',
      entries: [
        entry(),
        entry({
          id: E2,
          kind: 'weakness',
          source: 'derived',
          status: 'proposed',
          confirmedAt: null,
          content: 'Tut sich beim Thema „Subnetze“ schwer.',
        }),
      ],
    },
    { id: KFBM, code: 'KFBM', title: 'Kaufleute', entries: [] },
  ],
  ...over,
});

function respond(
  handler: (
    url: string,
    init?: RequestInit
  ) => { ok: boolean; status?: number; body: unknown }
) {
  authFetchMock.mockImplementation(async (url, init) => {
    const r = handler(String(url), init);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body,
    };
  });
}

const callsTo = (method: string) =>
  authFetchMock.mock.calls.filter(([, init]) => init?.method === method);

beforeEach(() => jest.clearAllMocks());

describe('HaiMemoryPanel', () => {
  it('shows nothing while the feature is not available', async () => {
    respond(() => ({ ok: true, body: { available: false } }));
    const { container } = renderWithProviders(<HaiMemoryPanel />);
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled());
    await act(async () => undefined);
    expect(
      container.querySelector('[data-testid="hai-memory-panel"]')
    ).toBeNull();
  });

  it('shows nothing when the memory cannot be loaded', async () => {
    authFetchMock.mockRejectedValue(new Error('offline'));
    const { container } = renderWithProviders(<HaiMemoryPanel />);
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled());
    await act(async () => undefined);
    expect(
      container.querySelector('[data-testid="hai-memory-panel"]')
    ).toBeNull();
  });

  it('says what is stored and that only the person sees it, and lists the entries per occupation', async () => {
    respond(() => ({ ok: true, body: overview() }));
    renderWithProviders(<HaiMemoryPanel />);
    expect(await screen.findByText('Mein HAI-Gedächtnis')).toBeTruthy();
    expect(screen.getByText(/Nur du siehst dieses Gedächtnis/)).toBeTruthy();
    expect(
      screen.getByText(/Nichts wird ohne deine Zustimmung gespeichert/)
    ).toBeTruthy();
    expect(screen.getByText('Fachinformatiker/in')).toBeTruthy();
    expect(screen.getByText('Kaufleute')).toBeTruthy();
    expect(screen.getByText('Bevorzugt kurze, knappe Antworten.')).toBeTruthy();
    expect(screen.getByText('Wartet auf deine Antwort')).toBeTruthy();
    expect(screen.getAllByText('Noch keine Einträge.')).toHaveLength(1);
    expect(screen.getAllByTestId('hai-memory-entry')).toHaveLength(2);
  });

  it('the switch turns the memory off and on', async () => {
    respond((url, init) =>
      init?.method === 'PATCH'
        ? { ok: true, body: { enabled: false } }
        : { ok: true, body: overview() }
    );
    renderWithProviders(<HaiMemoryPanel />);
    const toggle = (await screen.findByRole('switch')) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await act(async () => {
      fireEvent.click(toggle);
    });
    const [url, init] = callsTo('PATCH')[0];
    expect(url).toBe('/api/hai/memory');
    expect(JSON.parse(String(init?.body))).toEqual({ enabled: false });
  });

  it('says what the switch does when the memory is off', async () => {
    respond(() => ({ ok: true, body: overview({ enabled: false }) }));
    renderWithProviders(<HaiMemoryPanel />);
    expect(
      await screen.findByText(/Ausgeschaltet: Die HAI lädt nichts/)
    ).toBeTruthy();
  });

  it('deletes one entry', async () => {
    respond((url, init) =>
      init?.method === 'DELETE'
        ? { ok: true, body: { deleted: true } }
        : { ok: true, body: overview() }
    );
    renderWithProviders(<HaiMemoryPanel />);
    await screen.findByText('Bevorzugt kurze, knappe Antworten.');
    await act(async () => {
      fireEvent.click(screen.getAllByText('Löschen')[0]);
    });
    expect(callsTo('DELETE')[0][0]).toBe(`/api/hai/memory/${E1}`);
  });

  it('edits an active entry and takes over a changed proposal', async () => {
    respond((url, init) =>
      init?.method === 'PATCH'
        ? { ok: true, body: { entry: entry() } }
        : { ok: true, body: overview() }
    );
    renderWithProviders(<HaiMemoryPanel />);
    await screen.findByText('Bevorzugt kurze, knappe Antworten.');

    // the entries are listed newest first as the server sends them: first the active one
    fireEvent.click(screen.getAllByText('Bearbeiten')[0]);
    fireEvent.change(screen.getByLabelText('Text ändern'), {
      target: { value: ' Lieber ausführlich. ' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Speichern'));
    });
    let [url, init] = callsTo('PATCH')[0];
    expect(url).toBe(`/api/hai/memory/${E1}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      content: 'Lieber ausführlich.',
    });

    // a proposal that is changed becomes a yes with the new text
    fireEvent.click(screen.getAllByText('Bearbeiten')[1]);
    fireEvent.change(screen.getByLabelText('Text ändern'), {
      target: { value: 'Subnetze wiederholen.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Speichern'));
    });
    [url, init] = callsTo('PATCH')[1];
    expect(url).toBe(`/api/hai/memory/${E2}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      decision: 'confirm',
      content: 'Subnetze wiederholen.',
    });
  });

  it('answers an open proposal with Yes or No', async () => {
    respond((url, init) =>
      init?.method === 'PATCH'
        ? { ok: true, body: { entry: entry() } }
        : { ok: true, body: overview() }
    );
    renderWithProviders(<HaiMemoryPanel />);
    await screen.findByText('Bevorzugt kurze, knappe Antworten.');
    await act(async () => {
      fireEvent.click(screen.getByText('Ja'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Nein'));
    });
    expect(
      callsTo('PATCH').map(([, init]) => JSON.parse(String(init?.body)))
    ).toEqual([{ decision: 'confirm' }, { decision: 'reject' }]);
  });

  it('deletes everything only after a second question', async () => {
    respond((url, init) =>
      init?.method === 'DELETE'
        ? { ok: true, body: { deleted: 2 } }
        : { ok: true, body: overview() }
    );
    renderWithProviders(<HaiMemoryPanel />);
    await screen.findByText('Bevorzugt kurze, knappe Antworten.');
    fireEvent.click(screen.getByText('Alles löschen'));
    expect(callsTo('DELETE')).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toMatch(
      /Wirklich alle Einträge/
    );
    fireEvent.click(screen.getAllByText('Abbrechen')[0]);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByText('Alles löschen'));
    await act(async () => {
      fireEvent.click(screen.getByText('Ja, alles löschen'));
    });
    expect(callsTo('DELETE')).toHaveLength(1);
    expect(callsTo('DELETE')[0][0]).toBe('/api/hai/memory');
  });

  it('says so when a call fails and keeps the list', async () => {
    const toast = jest.requireMock('react-hot-toast') as {
      default: { error: jest.Mock };
    };
    respond((url, init) =>
      init?.method === 'DELETE'
        ? { ok: false, status: 500, body: { code: 'DELETE_FAILED' } }
        : { ok: true, body: overview() }
    );
    renderWithProviders(<HaiMemoryPanel />);
    await screen.findByText('Bevorzugt kurze, knappe Antworten.');
    await act(async () => {
      fireEvent.click(screen.getAllByText('Löschen')[0]);
    });
    expect(toast.default.error).toHaveBeenCalledWith(
      'Das hat gerade nicht geklappt. Bitte versuche es noch einmal.'
    );
    expect(screen.getByText('Bevorzugt kurze, knappe Antworten.')).toBeTruthy();

    respond((url, init) =>
      init?.method === 'PATCH'
        ? {
            ok: false,
            status: 422,
            body: { code: 'CONTENT', reason: 'solution' },
          }
        : { ok: true, body: overview() }
    );
    fireEvent.click(screen.getAllByText('Bearbeiten')[0]);
    await act(async () => {
      fireEvent.click(screen.getByText('Speichern'));
    });
    expect(toast.default.error).toHaveBeenLastCalledWith(
      expect.stringMatching(/Stil und Vorlieben/)
    );
  });

  it('shows no "delete everything" without entries', async () => {
    respond(() => ({
      ok: true,
      body: overview({
        occupations: [
          { id: FIAE, code: 'FIAE', title: 'Fachinformatiker/in', entries: [] },
        ],
      }),
    }));
    renderWithProviders(<HaiMemoryPanel />);
    await screen.findByText('Mein HAI-Gedächtnis');
    expect(screen.queryByText('Alles löschen')).toBeNull();
  });
});
