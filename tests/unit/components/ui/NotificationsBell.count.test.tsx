import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import NotificationsBell from '@/components/ui/NotificationsBell';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// WMCNL-2963: the bell counted the unread notifications inside the list it
// had loaded (the newest 30), so it never showed more than 30. It shows the
// number of the server and keeps it right when notifications are read.

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

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const items = Array.from({ length: 30 }, (_, i) => ({
  id: `n${i}`,
  userId: 'u1',
  actorId: null,
  type: 'QUIZ_REVIEWED',
  title: `Quiz bewertet ${i}`,
  message: `Dein Quiz „Test ${i}“ wurde bewertet (Ergebnis: 80 %).`,
  linkUrl: '/trainee/trainer-feedback',
  isRead: false,
  readAt: null,
  createdAt: '2026-10-29T10:00:00.000Z',
}));

function serve(unreadCount: number) {
  authFetchMock.mockImplementation(async input =>
    String(input).startsWith('/api/notifications?')
      ? json({ notifications: items, unreadCount })
      : json({ ok: true })
  );
}

const badge = (container: HTMLElement) =>
  container.querySelector('button[aria-label] span')?.textContent;

describe('NotificationsBell: the number of unread notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'u1', role: 'trainee' },
    });
  });

  it('shows the number of the server, not the 30 of the list', async () => {
    serve(41);
    const { container } = renderWithProviders(<NotificationsBell />);
    await waitFor(() => expect(badge(container)).toBe('41'));
  });

  it('writes 99+ for a very large number', async () => {
    serve(250);
    const { container } = renderWithProviders(<NotificationsBell />);
    await waitFor(() => expect(badge(container)).toBe('99+'));
  });

  it('counts down when one is read and shows the whole message of the quiz', async () => {
    serve(41);
    const { container } = renderWithProviders(<NotificationsBell />);
    await waitFor(() => expect(badge(container)).toBe('41'));
    fireEvent.click(
      container.querySelector('button[aria-label]') as HTMLElement
    );
    expect(
      await screen.findByText(
        'Dein Quiz „Test 0“ wurde bewertet (Ergebnis: 80 %).'
      )
    ).toBeInTheDocument();
    // the title comes from the type now (translated), the row is found by its message
    fireEvent.click(
      screen.getByText('Dein Quiz „Test 0“ wurde bewertet (Ergebnis: 80 %).')
    );
    await waitFor(() => expect(badge(container)).toBe('40'));
  });

  it('clears the number when all are marked as read', async () => {
    serve(41);
    const { container } = renderWithProviders(<NotificationsBell />);
    await waitFor(() => expect(badge(container)).toBe('41'));
    fireEvent.click(
      container.querySelector('button[aria-label]') as HTMLElement
    );
    fireEvent.click(await screen.findByTitle(/Alle gelesen|Mark all read/));
    await waitFor(() => expect(badge(container)).toBeUndefined());
  });
});
