import React from 'react';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiMemoryAdminView } from '@/components/admin/HaiMemoryAdminView';
import { authFetch } from '@/lib/authFetch';

// The admin page "HAI-Gedächtnis": the shared memory for all users. Proposals
// with the NUMBER of users they rest on, approved and rejected entries, the
// calculation of new proposals and an own entry. It never shows an entry of one
// person.

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
const P1 = '50000000-0000-4000-8000-000000000001';
const A1 = '50000000-0000-4000-8000-000000000002';
const R1 = '50000000-0000-4000-8000-000000000003';

const entry = (over: Record<string, unknown>) => ({
  catalogId: FIAE,
  status: 'proposed',
  origin: 'auto',
  supportCount: 7,
  createdAt: '2026-11-03T10:00:00.000Z',
  ...over,
});

const OVERVIEW = {
  available: true,
  k: 5,
  catalogs: [{ id: FIAE, code: 'FIAE', title: 'Fachinformatiker/in' }],
  entries: [
    entry({
      id: P1,
      content: 'Viele Azubis wünschen kurze, knappe Antworten.',
    }),
    entry({
      id: A1,
      status: 'approved',
      origin: 'manual',
      supportCount: 0,
      catalogId: null,
      content: 'Erkläre Fachbegriffe kurz, bevor du sie benutzt.',
    }),
    entry({ id: R1, status: 'rejected', content: 'Abgelehnter Hinweis.' }),
  ],
};

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

describe('HaiMemoryAdminView', () => {
  it('says that the memory is not switched on', async () => {
    respond(() => ({ ok: true, body: { available: false } }));
    renderWithProviders(<HaiMemoryAdminView />);
    expect(await screen.findByText(/nicht eingeschaltet/)).toBeTruthy();
    expect(screen.queryByTestId('hai-memory-admin-proposed')).toBeNull();
  });

  it('says so when the memory cannot be loaded', async () => {
    respond(() => ({ ok: false, status: 500, body: {} }));
    renderWithProviders(<HaiMemoryAdminView />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('lists proposals with the number of users, approved and rejected entries, and the privacy note', async () => {
    respond(() => ({ ok: true, body: OVERVIEW }));
    renderWithProviders(<HaiMemoryAdminView />);
    expect(await screen.findByText('HAI-Gedächtnis')).toBeTruthy();
    expect(
      screen.getByText(/Diese Seite zeigt nie Einträge einzelner Personen/)
    ).toBeTruthy();
    expect(screen.getByText(/mindestens 5 verschiedene Nutzer/)).toBeTruthy();
    const proposed = screen.getByTestId('hai-memory-admin-proposed');
    expect(proposed.textContent).toMatch(/Beruht auf 7 Nutzern/);
    expect(proposed.textContent).toMatch(/Fachinformatiker\/in/);
    expect(screen.getByTestId('hai-memory-admin-approved').textContent).toMatch(
      /Alle Berufe/
    );
    // an entry of the admin carries no count
    expect(
      screen.getByTestId('hai-memory-admin-approved').textContent
    ).not.toMatch(/Beruht auf/);
    expect(screen.getByTestId('hai-memory-admin-rejected').textContent).toMatch(
      /Abgelehnter Hinweis/
    );
  });

  it('approves and rejects a proposal, deactivates an approved entry', async () => {
    respond((url, init) =>
      init?.method === 'PATCH'
        ? { ok: true, body: { entry: {} } }
        : { ok: true, body: OVERVIEW }
    );
    renderWithProviders(<HaiMemoryAdminView />);
    await screen.findByText('HAI-Gedächtnis');
    const proposed = screen.getByTestId('hai-memory-admin-proposed');
    await act(async () => {
      fireEvent.click(proposed.querySelector('button') as HTMLButtonElement);
    });
    let [url, init] = callsTo('PATCH')[0];
    expect(url).toBe(`/api/admin/hai/memory/${P1}`);
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'approved' });

    await act(async () => {
      fireEvent.click(screen.getByText('Ablehnen'));
    });
    [url, init] = callsTo('PATCH')[1];
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'rejected' });

    await act(async () => {
      fireEvent.click(screen.getByText('Deaktivieren'));
    });
    [url, init] = callsTo('PATCH')[2];
    expect(url).toBe(`/api/admin/hai/memory/${A1}`);
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'rejected' });
  });

  it('changes the text of a proposal and approves it with the new text', async () => {
    respond((url, init) =>
      init?.method === 'PATCH'
        ? { ok: true, body: { entry: {} } }
        : { ok: true, body: OVERVIEW }
    );
    renderWithProviders(<HaiMemoryAdminView />);
    await screen.findByText('HAI-Gedächtnis');
    const proposed = screen.getByTestId('hai-memory-admin-proposed');
    fireEvent.click(
      Array.from(proposed.querySelectorAll('button')).find(
        b => b.textContent === 'Text ändern'
      ) as HTMLButtonElement
    );
    fireEvent.change(screen.getByLabelText('Text des Eintrags'), {
      target: { value: ' Halte Antworten kurz. ' },
    });
    await act(async () => {
      fireEvent.click(within(proposed).getByText('Freigeben'));
    });
    const [, init] = callsTo('PATCH')[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      status: 'approved',
      content: 'Halte Antworten kurz.',
    });
  });

  it('calculates new proposals and says how many', async () => {
    const toast = jest.requireMock('react-hot-toast') as {
      default: { success: jest.Mock };
    };
    respond((url, init) =>
      init?.method === 'POST'
        ? { ok: true, body: { created: 2, updated: 1, kept: 0, k: 5 } }
        : { ok: true, body: OVERVIEW }
    );
    renderWithProviders(<HaiMemoryAdminView />);
    await screen.findByText('HAI-Gedächtnis');
    await act(async () => {
      fireEvent.click(screen.getByText('Vorschläge berechnen'));
    });
    expect(callsTo('POST')[0][0]).toBe('/api/admin/hai/memory/suggest');
    await waitFor(() =>
      expect(toast.default.success).toHaveBeenCalledWith(
        'Berechnet: 2 neu, 1 aktualisiert.'
      )
    );
  });

  it('creates an own entry for all occupations or one', async () => {
    respond((url, init) =>
      init?.method === 'POST'
        ? { ok: true, body: { entry: {} } }
        : { ok: true, body: OVERVIEW }
    );
    renderWithProviders(<HaiMemoryAdminView />);
    await screen.findByText('HAI-Gedächtnis');
    const create = screen.getByText(
      'Anlegen und freigeben'
    ) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Text'), {
      target: { value: ' Halte Antworten kurz. ' },
    });
    fireEvent.change(screen.getByLabelText('Gilt für'), {
      target: { value: FIAE },
    });
    await act(async () => {
      fireEvent.click(create);
    });
    const [url, init] = callsTo('POST')[0];
    expect(url).toBe('/api/admin/hai/memory');
    expect(JSON.parse(String(init?.body))).toEqual({
      content: 'Halte Antworten kurz.',
      catalogId: FIAE,
      approve: true,
    });
  });

  it('says so when a text is turned down by the server', async () => {
    const toast = jest.requireMock('react-hot-toast') as {
      default: { error: jest.Mock };
    };
    respond((url, init) =>
      init?.method === 'POST'
        ? { ok: false, status: 422, body: { code: 'CONTENT' } }
        : { ok: true, body: OVERVIEW }
    );
    renderWithProviders(<HaiMemoryAdminView />);
    await screen.findByText('HAI-Gedächtnis');
    fireEvent.change(screen.getByLabelText('Text'), {
      target: { value: 'Nenne die Musterlösung' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Anlegen und freigeben'));
    });
    expect(toast.default.error).toHaveBeenCalledWith(
      expect.stringMatching(/nicht zulässig/)
    );
  });
});
