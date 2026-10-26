import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';
import { ContentManagement } from '@/components/trainer/ContentManagement';
import { QuizManagement } from '@/components/trainer/QuizManagement';
import { TrainerLernfelderTab } from '@/components/trainer/school/TrainerLernfelderTab';

// The lists of courses, quizzes and learning fields keep showing their rows to
// every trainer, the buttons that create, edit or delete curriculum content
// are only there for the platform wide admin (SUPER_ADMIN, or an ADMIN of the
// platform organization). The API checks the role itself.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const label = (key: keyof typeof de) => de[key] as string;

type Who = 'superAdmin' | 'platformAdmin' | 'platformTrainer' | 'platformTemp';
const WHO: Record<Who, { role: string; isPlatformOwner: boolean }> = {
  superAdmin: { role: 'super_admin', isPlatformOwner: false },
  platformAdmin: { role: 'admin', isPlatformOwner: true },
  platformTrainer: { role: 'trainer', isPlatformOwner: true },
  platformTemp: { role: 'temp_admin', isPlatformOwner: true },
};
const EDITORS: Who[] = ['superAdmin', 'platformAdmin'];
const OTHERS: Who[] = ['platformTrainer', 'platformTemp'];

function signIn(who: Who) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'u1', role: WHO[who].role },
    isPlatformOwner: WHO[who].isPlatformOwner,
    loading: false,
  });
}

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
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
    if (u.startsWith('/api/trainer/courses')) {
      return json({
        courses: [
          {
            id: 'c1',
            title: 'Course one',
            year: 1,
            chapter: 1,
            examPart: 1,
            enablersCount: 2,
            useCasesCount: 1,
          },
        ],
      });
    }
    if (u.startsWith('/api/trainer/quizzes')) {
      return json({
        quizzes: [
          {
            id: 'q1',
            title: 'Quiz one',
            quiz_type: 'big',
            is_active: true,
            assigned_count: 0,
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
    }
    if (u.startsWith('/api/trainer/lernfelder')) {
      return json({
        lernfelder: [
          {
            id: 'lf1',
            label: 'LF-1',
            title: 'Learning field one',
            description: 'Text',
            useCaseCount: 3,
          },
        ],
      });
    }
    return json({});
  });
});

describe('ContentManagement (course list)', () => {
  it.each(EDITORS)('%s can create, edit and delete courses', async who => {
    signIn(who);
    renderWithProviders(<ContentManagement />);
    expect(await screen.findByText('Course one')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: label('content.newCourse') })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: label('content.edit') })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: label('content.deleteCourse') })
    ).toBeInTheDocument();
  });

  it.each(OTHERS)('%s only views the courses', async who => {
    signIn(who);
    renderWithProviders(<ContentManagement />);
    expect(await screen.findByText('Course one')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: label('content.view') })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: label('content.newCourse') })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: label('content.edit') })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: label('content.deleteCourse') })
    ).toBeNull();
  });

  it('keeps the assignment of trainees to courses for the platform organization', async () => {
    // Course membership is not a curriculum edit, it stays as it was
    signIn('platformTrainer');
    renderWithProviders(<ContentManagement />);
    expect(await screen.findByText('Course one')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: label('content.assignCourses') })
    ).toBeInTheDocument();
  });
});

describe('QuizManagement (quiz list)', () => {
  it.each(EDITORS)('%s can create, edit and delete quizzes', async who => {
    signIn(who);
    renderWithProviders(<QuizManagement />);
    expect(await screen.findByText('Quiz one')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: label('quiz.managementCreate') })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: label('quiz.managementEdit') })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: label('quiz.managementDelete') })
    ).toBeInTheDocument();
  });

  it.each(OTHERS)('%s only views the quizzes', async who => {
    signIn(who);
    renderWithProviders(<QuizManagement />);
    expect(await screen.findByText('Quiz one')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: label('quiz.managementView') })
    ).toBeInTheDocument();
    for (const key of [
      'quiz.managementCreate',
      'quiz.managementEdit',
      'quiz.managementDelete',
    ] as const) {
      expect(screen.queryByRole('button', { name: label(key) })).toBeNull();
    }
  });
});

describe('TrainerLernfelderTab (learning fields)', () => {
  it.each(EDITORS)(
    '%s can create, edit and delete learning fields',
    async who => {
      signIn(who);
      renderWithProviders(<TrainerLernfelderTab />);
      expect(await screen.findByText('Learning field one')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: label('lernfelder.new') })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: new RegExp(label('common.edit')) })
      ).toBeInTheDocument();
    }
  );

  it.each(OTHERS)('%s only views the learning fields', async who => {
    signIn(who);
    renderWithProviders(<TrainerLernfelderTab />);
    expect(await screen.findByText('Learning field one')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryAllByRole('button')).toHaveLength(0)
    );
    expect(
      screen.queryByRole('button', { name: label('lernfelder.new') })
    ).toBeNull();
  });
});
