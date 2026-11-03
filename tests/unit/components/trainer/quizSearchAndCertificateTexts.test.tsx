import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';
import en from '@/locales/en.json';
import { QuizManagement } from '@/components/trainer/QuizManagement';
import { EvidenceSection } from '@/components/trainer/arbeitszeugnis/EvidenceSection';

// WMCNL-3026: the quiz list had no search, and a trainer without edit rights
// got a page called "Verwaltung" without a word on why nothing can be managed.
// WMCNL-3031: texts of the work certificate stayed German in the English view.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const label = (key: keyof typeof de) => de[key] as string;

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function signIn(role: string, isPlatformOwner: boolean) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'u1', role },
    isPlatformOwner,
    loading: false,
  });
}

const quiz = (id: string, title: string) => ({
  id,
  title,
  quiz_type: 'big',
  is_active: true,
  assigned_count: 0,
  created_at: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  // jsdom has no crypto.randomUUID (QuizManagement draws ids with it)
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, 'crypto', {
      value: { ...globalThis.crypto, randomUUID: () => 'uuid-1' },
      configurable: true,
    });
  }
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  authFetchMock.mockImplementation(async (url: any) => {
    const u = String(url);
    if (u.startsWith('/api/trainer/quizzes')) {
      return json({
        quizzes: [quiz('q1', 'Netzwerk Grundlagen'), quiz('q2', 'Datenbanken')],
      });
    }
    if (u.startsWith('/api/trainer/arbeitszeugnis/evidence')) {
      return json({
        highlights: [
          {
            id: 'h1',
            text: 'Hat ein Projekt geleitet',
            grade: 1.5,
            date: '2026-10-01T00:00:00Z',
            category: 'project',
          },
        ],
      });
    }
    return json({});
  });
});

describe('quiz list (WMCNL-3026)', () => {
  it('searches by title', async () => {
    signIn('trainer', true);
    renderWithProviders(<QuizManagement />);
    expect(await screen.findByText('Netzwerk Grundlagen')).toBeInTheDocument();
    expect(screen.getByText('Datenbanken')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: label('quiz.managementSearch') }), {
      target: { value: 'netz' },
    });
    expect(screen.getByText('Netzwerk Grundlagen')).toBeInTheDocument();
    expect(screen.queryByText('Datenbanken')).toBeNull();
  });

  it('tells a trainer without edit rights who can manage the quizzes', async () => {
    signIn('trainer', true);
    renderWithProviders(<QuizManagement />);
    expect(await screen.findByText('Datenbanken')).toBeInTheDocument();
    expect(
      screen.getByText(label('quiz.managementReadOnlyHint'))
    ).toBeInTheDocument();
  });

  it('calls the page "Quiz-Übersicht" for a trainer, who cannot manage', async () => {
    signIn('trainer', true);
    renderWithProviders(<QuizManagement />);
    expect(await screen.findByText('Datenbanken')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Quiz-Übersicht' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Quiz-Verwaltung')).toBeNull();
  });

  it('keeps "Quiz-Verwaltung" for the platform admin', async () => {
    signIn('super_admin', false);
    renderWithProviders(<QuizManagement />);
    expect(await screen.findByText('Datenbanken')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Quiz-Verwaltung' })
    ).toBeInTheDocument();
  });

  it('shows no such hint to the platform admin, who can manage them', async () => {
    signIn('super_admin', false);
    renderWithProviders(<QuizManagement />);
    expect(await screen.findByText('Datenbanken')).toBeInTheDocument();
    expect(screen.queryByText(label('quiz.managementReadOnlyHint'))).toBeNull();
  });
});

describe('work certificate texts follow the language (WMCNL-3031)', () => {
  it('shows the suggestions section in English', async () => {
    window.localStorage.setItem('language', 'en');
    renderWithProviders(<EvidenceSection traineeId="t1" onCopy={() => {}} />);
    expect(
      await screen.findByText(en['arbeitszeugnis.evidenceTitle'])
    ).toBeInTheDocument();
    expect(screen.getByText('Grade: 1.5')).toBeInTheDocument();
    expect(
      screen.getByTitle(en['arbeitszeugnis.evidenceCopy'])
    ).toBeInTheDocument();
    expect(screen.queryByText(/Vorschläge|Note:/)).toBeNull();
  });

  it('shows it in German by default', async () => {
    renderWithProviders(<EvidenceSection traineeId="t1" onCopy={() => {}} />);
    expect(
      await screen.findByText(de['arbeitszeugnis.evidenceTitle'])
    ).toBeInTheDocument();
    expect(screen.getByText('Note: 1.5')).toBeInTheDocument();
  });

  it('has an English text for every new certificate key', () => {
    const keys = Object.keys(de).filter(
      k => k.startsWith('arbeitszeugnis.') && !(k in en)
    );
    expect(keys).toEqual([]);
  });
});
