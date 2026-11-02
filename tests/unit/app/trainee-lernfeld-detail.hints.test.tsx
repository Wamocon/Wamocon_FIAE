import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import LernfeldDetailPage from '@/app/trainee/lernfelder/[id]/page';
import { authFetch } from '@/lib/authFetch';

// WMCNL-2960: the text of a Lernfeld taken from a PDF broke in the middle of
// the sentence (hard line breaks), and a locked use case or enabler said only
// "noch nicht zugewiesen" without telling the trainee what happens next.

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ id: 'lf-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/trainee/lernfelder/lf-1',
  useSearchParams: () => new URLSearchParams(),
}));

const authFetchMock = authFetch as jest.Mock;

const closed = (id: string, title: string) => ({
  id,
  title,
  descriptionText: null,
  durationValue: null,
  durationUnit: null,
  accessible: false,
});

describe('Lernfeld detail page: text and hints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        lernfeld: {
          id: 'lf-1',
          title: 'Das Unternehmen und die eigene Rolle im Betrieb beschreiben',
          description:
            'Die Auszubildenden stellen das Unternehmen\nund ihre eigene Rolle im Betrieb vor.\n\nSie ordnen ihre Aufgaben\nin die Abläufe ein.',
          label: 'LF1',
          hoursBudget: null,
          trainingYear: 1,
        },
        useCases: [closed('uc1', 'Aufgabe gesperrt')],
        enablers: [
          {
            ...closed('en1', 'Enabler gesperrt'),
            code: 'K1-a',
            courseTitle: null,
          },
        ],
      }),
    } as Response);
  });

  it('lets the text run on without hard line breaks, paragraphs stay', async () => {
    renderWithProviders(<LernfeldDetailPage />);
    expect(
      await screen.findByText(
        'Die Auszubildenden stellen das Unternehmen und ihre eigene Rolle im Betrieb vor.',
        { exact: false }
      )
    ).toBeInTheDocument();
    const text = screen.getByText(/Die Auszubildenden stellen/).textContent!;
    expect(text).not.toContain('Unternehmen\nund');
    // the blank line between two paragraphs is kept
    expect(text).toContain(
      'vor.\n\nSie ordnen ihre Aufgaben in die Abläufe ein.'
    );
  });

  it('tells what happens to a locked use case and a locked enabler', async () => {
    renderWithProviders(<LernfeldDetailPage />);
    await screen.findByText('Aufgabe gesperrt');
    expect(screen.getAllByText('noch nicht zugewiesen')).toHaveLength(2);
    expect(
      screen.getAllByText('Wird vom Ausbilder freigeschaltet')
    ).toHaveLength(2);
  });
});
