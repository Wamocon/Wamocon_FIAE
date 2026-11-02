import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import de from '@/locales/de.json';
import EditCoursePage from '@/app/trainer/content-management/[moduleId]/edit/page';

// WMCNL-3022 and WMCNL-3023 (test of 02.11.2026): "Ansehen" of a course opened
// an edit page without a save button, the skills field took input that was
// lost on reload without a word. The lesson dialog had a duration and an
// active box that took input but could not be saved.
// A trainer who cannot edit curriculum content gets a view: every field is
// read-only. An editor gets a warning before unsaved changes are lost, and a
// question before a lesson is switched off.

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

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  refresh: jest.fn(),
};
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => ({ moduleId: 'c1' }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const label = (key: keyof typeof de) => de[key] as string;

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function signIn(role: string, isPlatformOwner: boolean) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'u1', role, organizationId: 'org-1' },
    isPlatformOwner,
    loading: false,
    subscriptionPlan: 'PRO',
  });
}
const signInEditor = () => signIn('super_admin', false);
const signInTrainer = () => signIn('trainer', true);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  authFetchMock.mockImplementation(async (url: any) => {
    const u = String(url);
    if (u === '/api/trainer/courses/c1') {
      return json({
        course: { title: 'Course one', year: 1, chapter: 1, examPart: 1 },
        skills: ['Java'],
        enablers: [{ id: 'e1', title: 'Enabler one', isActive: true }],
        useCases: [],
      });
    }
    if (u === '/api/trainer/enablers/e1') {
      return json({
        enabler: {
          title: 'Enabler one',
          descriptionText: 'Text',
          durationValue: 3,
          isActive: true,
        },
      });
    }
    return json({ members: [], quizzes: [], documents: [] });
  });
});

const skillsField = () =>
  screen.getByPlaceholderText(label('trainer.content.skillsPlaceholder'));

describe('course page of a trainer without edit rights (WMCNL-3022)', () => {
  it('is a view: named so, every field read-only, no save, a close button', async () => {
    signInTrainer();
    renderWithProviders(<EditCoursePage />);
    expect(await screen.findByText('Enabler one')).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: label('trainer.content.viewCourse') })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: label('trainer.content.editCourse'),
      })
    ).toBeNull();
    // title, year, chapter, exam part, skills: nothing takes input
    expect(skillsField()).toBeDisabled();
    for (const select of screen.getAllByRole('combobox')) {
      expect(select).toBeDisabled();
    }
    expect(
      screen.queryByRole('button', { name: label('common.save') })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: label('common.close') })
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('names and locks the lesson dialog: duration and active are read-only', async () => {
    signInTrainer();
    renderWithProviders(<EditCoursePage />);
    expect(await screen.findByText('Enabler one')).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', { name: label('content.view') })[0]
    );
    expect(
      await screen.findByRole('heading', {
        name: label('trainer.content.viewLesson'),
      })
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveValue(3));
    expect(screen.getByRole('spinbutton')).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: label('common.active') })
    ).toBeDisabled();
  });
});

describe('course page of an editor', () => {
  it('warns about unsaved changes, on reload and on cancel', async () => {
    signInEditor();
    renderWithProviders(<EditCoursePage />);
    expect(await screen.findByText('Enabler one')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: label('trainer.content.editCourse') })
    ).toBeInTheDocument();

    // untouched: no warning
    expect(screen.queryByRole('status')).toBeNull();
    const untouched = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(untouched);
    expect(untouched.defaultPrevented).toBe(false);

    fireEvent.change(skillsField(), { target: { value: 'Java, QA' } });
    expect(screen.getByRole('status')).toHaveTextContent(
      label('trainer.content.unsavedChanges')
    );
    const reload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);

    // cancel asks first, "no" stays on the page
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(
      screen.getByRole('button', { name: label('common.cancel') })
    );
    expect(confirmSpy).toHaveBeenCalledWith(
      label('trainer.content.confirmDiscard')
    );
    expect(mockRouter.back).not.toHaveBeenCalled();
    // "yes" leaves
    confirmSpy.mockReturnValue(true);
    fireEvent.click(
      screen.getByRole('button', { name: label('common.cancel') })
    );
    expect(mockRouter.back).toHaveBeenCalledTimes(1);

    // back to the loaded value: nothing is unsaved any more
    fireEvent.change(skillsField(), { target: { value: 'Java' } });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('leaves without a question when nothing changed', async () => {
    signInEditor();
    renderWithProviders(<EditCoursePage />);
    expect(await screen.findByText('Enabler one')).toBeInTheDocument();
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(
      screen.getByRole('button', { name: label('common.cancel') })
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('asks before a lesson is switched off in the dialog (WMCNL-3023)', async () => {
    signInEditor();
    renderWithProviders(<EditCoursePage />);
    expect(await screen.findByText('Enabler one')).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole('button', { name: label('common.edit') })[0]
    );
    const active = await screen.findByRole('checkbox', {
      name: label('common.active'),
    });
    await waitFor(() => expect(active).toBeChecked());
    fireEvent.click(active);
    expect(active).not.toBeChecked();

    const lessonPatch = () =>
      authFetchMock.mock.calls.find(
        c =>
          String(c[0]) === '/api/trainer/enablers/e1' &&
          c[1]?.method === 'PATCH'
      );
    const clickDialogSave = () => {
      const buttons = screen.getAllByRole('button', {
        name: label('common.save'),
      });
      fireEvent.click(buttons[buttons.length - 1]);
    };

    // "no": nothing is sent
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    clickDialogSave();
    expect(confirmSpy).toHaveBeenCalledWith(
      label('trainer.content.confirmDeactivateLesson')
    );
    expect(lessonPatch()).toBeUndefined();

    // "yes": it is saved as inactive
    confirmSpy.mockReturnValue(true);
    clickDialogSave();
    await waitFor(() => expect(lessonPatch()).toBeDefined());
    expect(JSON.parse(String(lessonPatch()![1]!.body)).isActive).toBe(false);
  });
});
