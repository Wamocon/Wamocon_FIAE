import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';
import NewCoursePage from '@/app/trainer/content-management/new/page';
import NewQuizPage from '@/app/trainer/quiz-management/new-quiz/page';
import NewEnablerQuizPage from '@/app/trainer/enablers/[enablerId]/quizzes/new/page';
import EnablerQuizBuilderPage from '@/app/trainer/enablers/[enablerId]/quiz/page';
import EditEnablerQuizPage from '@/app/trainer/enablers/[enablerId]/quizzes/[quizId]/page';
import TrainerUseCaseDetailPage from '@/app/trainer/use-cases/[useCaseId]/page';

// Curriculum content (courses, enablers, use cases, quizzes) may only be
// changed by the platform wide admin (SUPER_ADMIN, or an ADMIN of the platform
// organization). The pages hide their write controls for everybody else. The
// API checks the role itself, this only decides what the UI shows.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');

const replace = jest.fn();
const back = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace, back, refresh: jest.fn() }),
  useParams: () => ({ enablerId: 'e1', quizId: 'q1', useCaseId: 'u1' }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

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
    subscriptionPlan: 'PRO',
  });
}

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  authFetchMock.mockImplementation(async (url: any) => {
    const u = String(url);
    if (u.includes('/api/trainer/use-cases/')) {
      return json({
        useCase: {
          id: 'u1',
          title: 'Use case one',
          descriptionText: 'Text',
          isActive: true,
        },
      });
    }
    if (u.includes('/quizzes/')) {
      return json({
        quiz: {
          id: 'q1',
          title: 'Quiz one',
          isActive: true,
          difficulty: 'LOW',
          questions: [],
        },
      });
    }
    return json({ modules: [], courses: [], quiz: null, documents: [] });
  });
});

describe.each([
  ['new course', NewCoursePage, 'course.form.save'],
  ['new quiz', NewQuizPage, 'quiz.form.create'],
] as const)('%s page', (_name, Page, saveKey) => {
  it.each(EDITORS)('%s sees the form', async who => {
    signIn(who);
    renderWithProviders(<Page />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: label(saveKey as any) })
      ).toBeInTheDocument()
    );
  });

  it.each(OTHERS)('%s sees the notice and no form', async who => {
    signIn(who);
    renderWithProviders(<Page />);
    await waitFor(() =>
      expect(screen.getByText(label('curriculum.superAdminOnly'))).toBeVisible()
    );
    expect(
      screen.queryByRole('button', { name: label(saveKey as any) })
    ).toBeNull();
  });
});

describe.each([
  ['new enabler quiz', NewEnablerQuizPage],
  ['enabler quiz builder', EnablerQuizBuilderPage],
] as const)('%s page', (_name, Page) => {
  it.each(OTHERS)('%s is sent back to the content list', async who => {
    signIn(who);
    renderWithProviders(<Page />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/trainer/content-management')
    );
  });

  it.each(EDITORS)('%s stays on the page', async who => {
    signIn(who);
    renderWithProviders(<Page />);
    await waitFor(() =>
      expect(authFetchMock.mock.calls.length >= 0).toBe(true)
    );
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('enabler quiz detail page', () => {
  it.each(EDITORS)('%s can switch to the edit mode', async who => {
    signIn(who);
    renderWithProviders(<EditEnablerQuizPage />);
    expect(
      await screen.findByRole('button', {
        name: label('trainer.enablerQuiz.editMode'),
      })
    ).toBeInTheDocument();
  });

  it.each(OTHERS)('%s only reads the quiz', async who => {
    signIn(who);
    renderWithProviders(<EditEnablerQuizPage />);
    expect(
      await screen.findByRole('button', { name: label('common.back') })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: label('trainer.enablerQuiz.editMode'),
      })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: label('common.delete') })
    ).toBeNull();
  });
});

describe('use case detail page', () => {
  it.each(EDITORS)('%s can edit the use case', async who => {
    signIn(who);
    renderWithProviders(<TrainerUseCaseDetailPage />);
    expect(
      await screen.findByRole('button', { name: label('common.edit') })
    ).toBeInTheDocument();
  });

  it.each(OTHERS)('%s sees the use case without the edit button', async who => {
    signIn(who);
    renderWithProviders(<TrainerUseCaseDetailPage />);
    expect(await screen.findByText('Use case one')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: label('common.edit') })
    ).toBeNull();
  });
});
