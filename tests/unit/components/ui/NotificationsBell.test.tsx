import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import NotificationsBell from '@/components/ui/NotificationsBell';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// The notification routes answer only with a bearer session (the person comes
// from the token). The bell therefore has to call them with authFetch, a plain
// fetch would be answered with 401 and the bell would stay empty.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('@/lib/supabase', () => {
  const channel: any = {
    on: jest.fn(() => channel),
    subscribe: jest.fn(() => channel),
    unsubscribe: jest.fn(),
  };
  return { supabase: { channel: jest.fn(() => channel) } };
});

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const plainFetch = jest.fn();

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

const notification = {
  id: 'n1',
  userId: 'u1',
  actorId: null,
  type: 'catalog_request',
  title: 'Neue Anfrage',
  message: 'Max Muster',
  linkUrl: null,
  isRead: false,
  readAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
};

const urlOf = (call: unknown[]) => String(call[0]);
const callsTo = (fragment: string) =>
  authFetchMock.mock.calls.filter(call => urlOf(call).includes(fragment));

describe('NotificationsBell sends the session token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // A plain fetch would reach the route without a token: fail loudly
    (global as any).fetch = plainFetch;
    plainFetch.mockRejectedValue(new Error('plain fetch must not be used'));
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'u1', role: 'trainer' },
    });
    authFetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith('/api/notifications?')) {
        return json({ notifications: [notification], unreadCount: 1 });
      }
      if (init?.method === 'PATCH') return json({ notification });
      return json({ ok: true });
    });
  });

  function renderBell() {
    const view = renderWithProviders(<NotificationsBell />);
    const bell = view.container.querySelector('button[aria-label]');
    return { ...view, bell: bell as HTMLElement };
  }

  it('loads the list with authFetch', async () => {
    renderBell();
    await waitFor(() => expect(callsTo('/api/notifications?')).toHaveLength(1));
    expect(urlOf(callsTo('/api/notifications?')[0])).toContain('limit=30');
    expect(plainFetch).not.toHaveBeenCalled();
    // The unread badge shows the notification that arrived with the answer
    expect(await screen.findByText('1')).toBeTruthy();
  });

  it('marks a notification as read with authFetch (PATCH)', async () => {
    const { bell } = renderBell();
    await screen.findByText('1');
    fireEvent.click(bell);
    fireEvent.click(await screen.findByText('Neue Anfrage'));
    await waitFor(() =>
      expect(callsTo('/api/notifications/n1')).toHaveLength(1)
    );
    const [, init] = callsTo('/api/notifications/n1')[0];
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ isRead: true });
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it('marks all as read with authFetch (POST)', async () => {
    const { bell } = renderBell();
    await screen.findByText('1');
    fireEvent.click(bell);
    fireEvent.click(await screen.findByTitle(/Alle gelesen|Mark all read/));
    await waitFor(() =>
      expect(callsTo('/api/notifications/mark-all-read')).toHaveLength(1)
    );
    const [, init] = callsTo('/api/notifications/mark-all-read')[0];
    expect(init?.method).toBe('POST');
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it('reloads with authFetch when marking all as read fails', async () => {
    authFetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith('/api/notifications?')) {
        return json({ notifications: [notification], unreadCount: 1 });
      }
      return init?.method === 'POST'
        ? json({ error: 'Unauthorized' }, false, 401)
        : json({});
    });
    const { bell } = renderBell();
    await screen.findByText('1');
    fireEvent.click(bell);
    fireEvent.click(await screen.findByTitle(/Alle gelesen|Mark all read/));
    await waitFor(() => expect(callsTo('/api/notifications?')).toHaveLength(2));
    expect(plainFetch).not.toHaveBeenCalled();
  });
});
