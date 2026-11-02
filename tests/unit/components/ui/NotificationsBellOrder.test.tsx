import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import NotificationsBell from '@/components/ui/NotificationsBell';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// WMCNL-3029: an entry of 30.10. stood between entries of 02.11. (the unread
// ones were listed first, whatever their date), and the texts had no name and
// English words.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/lib/supabase', () => {
  const channel: any = {
    on: jest.fn(() => channel),
    subscribe: jest.fn(() => channel),
    unsubscribe: jest.fn(),
  };
  return { supabase: { channel: jest.fn(() => channel) } };
});

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

const base = { userId: 'u1', linkUrl: null, readAt: null };

const notifications = [
  {
    ...base,
    id: 'n-new-read',
    type: 'catalog_request',
    title: 'Neueste gelesen',
    message: null,
    actorId: null,
    isRead: true,
    createdAt: '2026-11-02T12:00:00.000Z',
  },
  {
    ...base,
    id: 'n-old-unread',
    type: 'LESSON_QUIZ_SUBMITTED',
    title: 'Themenkreis-Quiz eingereicht',
    message: 'Trainee hat ein LOW-Quiz abgegeben: Netzwerke',
    actorId: 't1',
    actorName: 'Leon Moretz',
    context: { difficulty: 'LOW' },
    isRead: false,
    createdAt: '2026-10-30T08:00:00.000Z',
  },
  {
    ...base,
    id: 'n-mid-unread',
    type: 'ENABLER_SUBMITTED',
    title: 'Szenario eingereicht',
    message: 'Ein Trainee hat ein Enabler-Szenario eingereicht: Git',
    actorId: 't2',
    actorName: 'Mia Berg',
    context: null,
    isRead: false,
    createdAt: '2026-11-02T09:00:00.000Z',
  },
];

describe('bell of a trainer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'u1', role: 'trainer' },
    });
    authFetchMock.mockImplementation(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ notifications, unreadCount: 2 }),
        }) as Response
    );
  });

  it('lists by date and names the trainee in German words', async () => {
    const view = renderWithProviders(<NotificationsBell />);
    await screen.findByText('2');
    fireEvent.click(view.container.querySelector('button[aria-label]')!);

    const quiz = await screen.findByText(
      'Leon Moretz hat ein Quiz der Stufe Niedrig abgegeben: Netzwerke'
    );
    const scenario = screen.getByText(
      'Mia Berg hat ein Szenario eingereicht: Git'
    );
    const read = screen.getByText('Neueste gelesen');
    expect(screen.queryByText(/Trainee|LOW|Enabler/)).toBeNull();

    // newest first: read (02.11. 12:00), scenario (02.11. 09:00), quiz (30.10.)
    expect(
      read.compareDocumentPosition(scenario) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      scenario.compareDocumentPosition(quiz) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
