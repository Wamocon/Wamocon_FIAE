import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';
import EditCoursePage from '@/app/trainer/content-management/[moduleId]/edit/page';

// Found in the rehearsal of 02.11.2026 (B1): the edit dialog of a lesson did not
// load isActive, the links and the duration, but saved all of them. Saving
// switched an active lesson off (the trainee then got a 404) and dropped its
// links. The dialog has to send back what it loaded.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('@/components/trainer/PdfUploader', () => ({
  PdfUploader: () => <div data-testid="pdf-uploader" />,
}));
jest.mock('@/components/ui/FlipbookViewer', () => ({
  FlipbookViewer: () => null,
}));
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

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const LESSON = {
  title: 'Enabler one',
  descriptionText: 'Text',
  scenarioPdfUrl: null,
  pptUrl: 'https://example.invalid/slides.pptx',
  videoUrl: 'https://example.invalid/video.mp4',
  durationValue: 3,
  isActive: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'u1', role: 'super_admin', organizationId: 'org-1' },
    isPlatformOwner: false,
    loading: false,
    subscriptionPlan: 'PRO',
  });
  authFetchMock.mockImplementation(async (url: any) => {
    const u = String(url);
    if (u === '/api/trainer/courses/c1') {
      return json({
        course: { title: 'Course one', year: 1, chapter: 1, examPart: 1 },
        skills: [],
        enablers: [{ id: 'e1', title: 'Enabler one', isActive: true }],
        useCases: [],
      });
    }
    if (u === '/api/trainer/enablers/e1') return json({ enabler: LESSON });
    return json({ members: [], quizzes: [], documents: [] });
  });
});

describe('edit dialog of a lesson', () => {
  it('sends back the state it loaded: active, links, duration', async () => {
    renderWithProviders(<EditCoursePage />);
    expect(await screen.findByText('Enabler one')).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', { name: label('common.edit') })[0]
    );
    // the dialog is rendered after the page, its save button is the last one
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: label('common.save') }).length
      ).toBeGreaterThan(1)
    );
    const saveButtons = screen.getAllByRole('button', {
      name: label('common.save'),
    });
    fireEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => {
      const patch = authFetchMock.mock.calls.find(
        c =>
          String(c[0]) === '/api/trainer/enablers/e1' &&
          c[1]?.method === 'PATCH'
      );
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.isActive).toBe(true);
      expect(body.pptUrl).toBe(LESSON.pptUrl);
      expect(body.videoUrl).toBe(LESSON.videoUrl);
      expect(body.durationValue).toBe(3);
    });
  });
});
