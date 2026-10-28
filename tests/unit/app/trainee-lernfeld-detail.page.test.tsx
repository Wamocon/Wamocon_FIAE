import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import LernfeldDetailPage from '@/app/trainee/lernfelder/[id]/page';
import { authFetch } from '@/lib/authFetch';

// The Lernfeld detail page of a trainee (the target of the cards in the
// Berufsschule tab). It loads GET /api/trainee/lernfelder/[id] with the token
// of the trainee and links an item only when the trainee is a member of its
// course.

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));

let routeId = 'lf-1';
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ id: routeId }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/trainee/lernfelder/lf-1',
  useSearchParams: () => new URLSearchParams(),
}));

const authFetchMock = authFetch as jest.Mock;

function reply(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

const detail = {
  lernfeld: {
    id: 'lf-1',
    title: 'Das Unternehmen präsentieren',
    description: 'Beschreibung des Lernfelds',
    label: 'LF1',
    hoursBudget: 80,
    trainingYear: 1,
  },
  useCases: [
    {
      id: 'uc-open',
      title: 'Aufgabe offen',
      descriptionText: 'Text der Aufgabe',
      durationValue: 2,
      durationUnit: 'DAYS',
      accessible: true,
    },
    {
      id: 'uc-closed',
      title: 'Aufgabe gesperrt',
      descriptionText: null,
      durationValue: null,
      durationUnit: null,
      accessible: false,
    },
  ],
  enablers: [
    {
      id: 'en-open',
      code: 'K1-a',
      title: 'Enabler offen',
      courseTitle: 'Kurs K1',
      durationValue: 1,
      durationUnit: 'WEEKS',
      accessible: true,
    },
  ],
};

function renderPage(id = 'lf-1') {
  routeId = id;
  return renderWithProviders(<LernfeldDetailPage />);
}

describe('Lernfeld detail page of a trainee', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads with authFetch and shows title, description, hours, enablers and use cases', async () => {
    authFetchMock.mockResolvedValue(reply(detail));
    renderPage();

    expect(
      await screen.findByText('Das Unternehmen präsentieren')
    ).toBeInTheDocument();
    expect(screen.getByText('LF1')).toBeInTheDocument();
    expect(screen.getByText('Beschreibung des Lernfelds')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(String(authFetchMock.mock.calls[0][0])).toBe(
      '/api/trainee/lernfelder/lf-1'
    );
    expect(screen.getByText('Enabler offen')).toBeInTheDocument();
    expect(screen.getByText('2 Tage')).toBeInTheDocument();
    expect(screen.getByText('1 Wochen')).toBeInTheDocument();
  });

  it('links only the items of courses the trainee is a member of', async () => {
    authFetchMock.mockResolvedValue(reply(detail));
    renderPage();
    await screen.findByText('Aufgabe offen');

    expect(screen.getByRole('link', { name: 'Aufgabe offen' })).toHaveAttribute(
      'href',
      '/trainee/use-cases/uc-open'
    );
    expect(screen.getByRole('link', { name: 'Enabler offen' })).toHaveAttribute(
      'href',
      '/trainee/enablers/en-open'
    );
    // the closed item is listed without a link and says why
    expect(
      screen.queryByRole('link', { name: 'Aufgabe gesperrt' })
    ).not.toBeInTheDocument();
    expect(screen.getByText('Aufgabe gesperrt')).toBeInTheDocument();
    expect(screen.getByText('noch nicht zugewiesen')).toBeInTheDocument();
  });

  it('the back link returns to the Lernfelder tab of the school page', async () => {
    authFetchMock.mockResolvedValue(reply(detail));
    renderPage();
    await screen.findByText('Aufgabe offen');
    expect(screen.getByRole('link', { name: /zurück/i })).toHaveAttribute(
      'href',
      '/trainee/school?tab=lernfelder'
    );
  });

  it('says "not found" for a learning field of another occupation (404)', async () => {
    authFetchMock.mockResolvedValue(reply({ error: 'Not found' }, 404));
    renderPage('foreign');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Lernfeld nicht gefunden'
    );
  });

  it('shows the empty states', async () => {
    authFetchMock.mockResolvedValue(
      reply({
        lernfeld: { ...detail.lernfeld, hoursBudget: null, description: null },
        useCases: [],
        enablers: [],
      })
    );
    renderPage();
    expect(
      await screen.findByText(
        'Diesem Lernfeld sind noch keine Enabler zugeordnet.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('Für dich sind noch keine Use Cases freigeschaltet.')
    ).toBeInTheDocument();
    expect(screen.getByText('nicht angegeben')).toBeInTheDocument();
  });
});
