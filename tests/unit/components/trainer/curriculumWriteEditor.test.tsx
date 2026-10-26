import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';
import EditCoursePage from '@/app/trainer/content-management/[moduleId]/edit/page';
import LernfeldDetailPage from '@/app/trainer/lernfelder/[id]/page';

// The course editor and the learning field page keep showing the content to
// every trainer. The controls that change curriculum content (save, add, edit
// mode, delete, activate, document upload and removal) are only there for the
// platform wide admin (SUPER_ADMIN, or an ADMIN of the platform organization).
// The API checks the role itself, this only decides what the UI shows.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('@/components/trainer/PdfUploader', () => ({
  PdfUploader: () => <div data-testid="pdf-uploader" />,
}));
jest.mock('@/components/ui/FlipbookViewer', () => ({
  FlipbookViewer: () => null,
}));

// React 18 has no use(): resolve the params promise of the page synchronously
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  use: (value: any) => value.__value,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    refresh: jest.fn(),
  }),
  useParams: () => ({ moduleId: 'c1' }),
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
    profile: { id: 'u1', role: WHO[who].role, organizationId: 'org-1' },
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
    if (u === '/api/trainer/courses/c1') {
      return json({
        course: { title: 'Course one', year: 1, chapter: 1, examPart: 1 },
        skills: [],
        enablers: [{ id: 'e1', title: 'Enabler one', isActive: true }],
        useCases: [{ id: 'u1', title: 'Use case one', isActive: true }],
      });
    }
    if (u.endsWith('/enablers/e1/documents')) {
      return json({
        documents: [
          {
            id: 'd1',
            title: 'Theory doc',
            documentType: 'THEORY',
            storageUrl: 'x',
            fileName: 'a.pdf',
            organizationId: 'org-1',
          },
        ],
      });
    }
    if (u === '/api/trainer/enablers/e1') {
      return json({ enabler: { title: 'Enabler one' } });
    }
    if (u.startsWith('/api/trainer/lernfelder/')) {
      return json({
        lernfeld: { id: 'lf1', title: 'Learning field one', description: 'T' },
        useCases: [],
      });
    }
    return json({ members: [], quizzes: [], documents: [] });
  });
});

describe('course editor', () => {
  it.each(EDITORS)('%s sees every edit control', async who => {
    signIn(who);
    renderWithProviders(<EditCoursePage />);
    expect(await screen.findByText('Enabler one')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: label('common.save') })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: new RegExp(label('trainer.content.addLesson')),
      })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: label('common.delete') }).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('button', { name: label('common.edit') }).length
    ).toBeGreaterThan(0);
  });

  it.each(OTHERS)('%s only views the course', async who => {
    signIn(who);
    renderWithProviders(<EditCoursePage />);
    expect(await screen.findByText('Enabler one')).toBeInTheDocument();
    expect(screen.getByText('Use case one')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: label('common.save') })
    ).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: new RegExp(label('trainer.content.addLesson')),
      })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: label('common.delete') })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: label('common.edit') })
    ).toBeNull();
    expect(
      screen.getAllByRole('button', { name: label('content.view') }).length
    ).toBeGreaterThan(0);
  });

  it.each(EDITORS)(
    '%s can upload and remove documents of an enabler',
    async who => {
      signIn(who);
      renderWithProviders(<EditCoursePage />);
      fireEvent.click(
        (
          await screen.findAllByRole('button', { name: label('common.edit') })
        )[0]
      );
      expect(await screen.findByText('Theory doc')).toBeInTheDocument();
      expect(screen.getAllByTestId('pdf-uploader').length).toBeGreaterThan(0);
      expect(
        screen.getAllByTitle(label('common.remove')).length
      ).toBeGreaterThan(0);
    }
  );

  it.each(OTHERS)(
    '%s can read the documents of an enabler but not change them',
    async who => {
      signIn(who);
      renderWithProviders(<EditCoursePage />);
      fireEvent.click(
        (
          await screen.findAllByRole('button', { name: label('content.view') })
        )[0]
      );
      expect(await screen.findByText('Theory doc')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryAllByTestId('pdf-uploader')).toHaveLength(0)
      );
      expect(screen.queryAllByTitle(label('common.remove'))).toHaveLength(0);
    }
  );
});

describe('learning field page', () => {
  const params = { __value: { id: 'lf1' } } as any;

  it.each(EDITORS)('%s can edit and delete the learning field', async who => {
    signIn(who);
    renderWithProviders(<LernfeldDetailPage params={params} />);
    expect(await screen.findByText('Learning field one')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: label('common.edit') })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: label('common.delete') })
    ).toBeInTheDocument();
  });

  it.each(OTHERS)('%s only reads the learning field', async who => {
    signIn(who);
    renderWithProviders(<LernfeldDetailPage params={params} />);
    expect(await screen.findByText('Learning field one')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: label('common.edit') })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: label('common.delete') })
    ).toBeNull();
  });
});
