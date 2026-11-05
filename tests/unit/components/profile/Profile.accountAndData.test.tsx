import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { Profile } from '@/components/profile/Profile';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import { PasswordChangeError } from '@/lib/auth/password-change';

// Jira WMCNL-2964 (invented statistics and activities), 2965 and 3030 (change
// of the password without the current one), 2966 (e-mail and name as fields),
// 3030 (internal user id visible, activities empty, "Ihrer Azubis").

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('@/contexts/OnboardingContext', () => ({
  useOnboarding: () => ({ restartTour: jest.fn() }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: jest.fn() } },
}));

const UUID = '3f0c9b52-8d1e-4a77-9a55-1c2d3e4f5a6b';

const TRAINEE = {
  id: UUID,
  full_name: 'Anna Azubi',
  role: 'trainee',
  email: 'anna@example.com',
  training_start_date: null,
  birth_date: '2005-04-03',
  avatar: null,
};
const TRAINER = {
  id: UUID,
  full_name: 'Tim Trainer',
  role: 'trainer',
  email: 'tim@example.com',
  training_start_date: null,
  birth_date: null,
  avatar: null,
};

const changePassword = jest.fn();
const updateProfile = jest.fn();

function answer(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

function mockApi(routes: Record<string, unknown>) {
  (authFetch as jest.Mock).mockImplementation((url: string) =>
    url in routes ? answer(routes[url]) : answer({}, false)
  );
}

function renderProfile(profile: Record<string, unknown>) {
  (useAuth as jest.Mock).mockReturnValue({
    user: { id: UUID },
    profile,
    changePassword,
    updateProfile,
    refreshProfile: jest.fn(),
  });
  return renderWithProviders(<Profile />);
}

const TRAINEE_SUMMARY = {
  stats: {
    lessonsCompleted: 4,
    lessonsTotal: 15,
    quizzesPassed: 2,
    useCasesApproved: 1,
  },
  recentActivities: [
    {
      id: 'q1',
      activityType: 'QUIZ_SUBMITTED',
      itemTitle: 'HTML und CSS',
      score: 80,
      status: null,
      createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    },
    {
      id: 'e1:l1',
      activityType: 'LESSON_COMPLETED',
      itemTitle: 'Lektion Eins',
      score: null,
      status: null,
      createdAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    },
  ],
};

async function openPasswordSection() {
  fireEvent.click(screen.getByRole('button', { name: /Passwort ändern/ }));
  await screen.findByLabelText('Aktuelles Passwort');
}

describe('Profile: change of the password asks for the current password', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi({ '/api/trainee/profile-summary': TRAINEE_SUMMARY });
  });

  const fill = (current: string, next: string, again: string) => {
    fireEvent.change(screen.getByLabelText('Aktuelles Passwort'), {
      target: { value: current },
    });
    fireEvent.change(screen.getByLabelText('Neues Passwort'), {
      target: { value: next },
    });
    fireEvent.change(screen.getByLabelText('Passwort bestätigen'), {
      target: { value: again },
    });
  };
  const submit = () =>
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Passwort ändern' }).pop()!
    );

  it('the form has the field for the current password, before the new one', async () => {
    renderProfile(TRAINEE);
    await openPasswordSection();
    const fields = screen
      .getAllByLabelText(/Passwort/)
      .map(el => el.getAttribute('id'));
    expect(fields.slice(0, 3)).toEqual([
      'currentPassword',
      'newPassword',
      'confirmPassword',
    ]);
    expect(screen.getByLabelText('Aktuelles Passwort')).toHaveAttribute(
      'autocomplete',
      'current-password'
    );
  });

  it('refuses an empty current password and does not call the server', async () => {
    renderProfile(TRAINEE);
    await openPasswordSection();
    fill('', 'neues-passwort', 'neues-passwort');
    submit();
    expect(
      await screen.findByText('Bitte gib dein aktuelles Passwort ein.')
    ).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('refuses a new password that is too short, and one that is not repeated', async () => {
    renderProfile(TRAINEE);
    await openPasswordSection();
    fill('aktuell-1', 'kurz', 'kurz');
    submit();
    expect(
      await screen.findByText(
        'Das Passwort muss mindestens 8 Zeichen lang sein.'
      )
    ).toBeInTheDocument();
    fill('aktuell-1', 'neues-passwort', 'anderes-passwort');
    submit();
    expect(
      await screen.findByText('Die Passwörter stimmen nicht überein.')
    ).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('sends the current and the new password and reports the success', async () => {
    changePassword.mockResolvedValue(undefined);
    renderProfile(TRAINEE);
    await openPasswordSection();
    fill('aktuell-1', 'neues-passwort', 'neues-passwort');
    submit();
    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith('aktuell-1', 'neues-passwort')
    );
    expect(
      await screen.findByText('Passwort erfolgreich geändert.')
    ).toBeInTheDocument();
    // the fields are emptied after a success
    expect(screen.getByLabelText('Aktuelles Passwort')).toHaveValue('');
  });

  it('a wrong current password shows the text of the translation system', async () => {
    changePassword.mockRejectedValue(
      new PasswordChangeError('CURRENT_PASSWORD_WRONG')
    );
    renderProfile(TRAINEE);
    await openPasswordSection();
    fill('falsch-1', 'neues-passwort', 'neues-passwort');
    submit();
    expect(
      await screen.findByText('Das aktuelle Passwort ist nicht richtig.')
    ).toBeInTheDocument();
    // the new password stays in the form, the current one is not erased
    expect(screen.getByLabelText('Neues Passwort')).toHaveValue(
      'neues-passwort'
    );
  });

  it('too many attempts and an unknown failure get their own texts, never a message of the authentication', async () => {
    changePassword.mockRejectedValueOnce(
      new PasswordChangeError('TOO_MANY_ATTEMPTS', 60)
    );
    renderProfile(TRAINEE);
    await openPasswordSection();
    fill('x-aktuell1', 'neues-passwort', 'neues-passwort');
    submit();
    expect(
      await screen.findByText(
        'Zu viele Versuche. Bitte warte kurz und versuche es dann erneut.'
      )
    ).toBeInTheDocument();

    changePassword.mockRejectedValueOnce(
      new Error('AuthApiError: Invalid login credentials')
    );
    submit();
    expect(
      await screen.findByText('Das Passwort konnte nicht geändert werden.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Invalid login/)).toBeNull();
  });
});

describe('Profile of a trainee: statistics and activities are the real ones', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the figures and activities of the summary, not the former example values', async () => {
    mockApi({ '/api/trainee/profile-summary': TRAINEE_SUMMARY });
    renderProfile(TRAINEE);

    await waitFor(() =>
      expect(screen.getByTestId('stat-lessons')).toHaveTextContent('4')
    );
    expect(screen.getByTestId('stat-lessons')).toHaveTextContent('von 15');
    expect(screen.getByTestId('stat-quizzes')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-use-cases')).toHaveTextContent('1');
    expect(authFetch).toHaveBeenCalledWith(
      '/api/trainee/profile-summary',
      expect.anything()
    );

    expect(
      screen.getByText('Quiz bestanden: HTML und CSS (80 %)')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Lektion abgeschlossen: Lektion Eins')
    ).toBeInTheDocument();

    // what the page made up before
    const page = document.body.textContent ?? '';
    for (const fake of [
      'JavaScript Grundlagen',
      'Reflexion eingereicht',
      'vor 3 Tagen',
      'Zertifikate',
      'Lernstunden',
      'Ziel erreicht',
      '156',
      '85%',
    ]) {
      expect(page).not.toContain(fake);
    }
  });

  it('a trainee without work sees zeros and an honest empty text, no example data', async () => {
    mockApi({
      '/api/trainee/profile-summary': {
        stats: {
          lessonsCompleted: 0,
          lessonsTotal: 0,
          quizzesPassed: 0,
          useCasesApproved: 0,
        },
        recentActivities: [],
      },
    });
    renderProfile(TRAINEE);
    expect(
      await screen.findByText(/Noch keine Aktivitäten/)
    ).toBeInTheDocument();
    expect(screen.getByTestId('stat-quizzes')).toHaveTextContent('0');
    expect(document.body.textContent).not.toContain('JavaScript Grundlagen');
  });

  it('says so when the figures cannot be loaded, instead of showing invented ones', async () => {
    mockApi({});
    renderProfile(TRAINEE);
    expect(
      await screen.findByText('Die Statistiken konnten nicht geladen werden.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('stat-quizzes')).toBeNull();
  });

  it('names a quiz that is not graded yet or not passed, and an approved use case', async () => {
    mockApi({
      '/api/trainee/profile-summary': {
        stats: {
          lessonsCompleted: 0,
          lessonsTotal: 0,
          quizzesPassed: 0,
          useCasesApproved: 1,
        },
        recentActivities: [
          {
            id: 'a',
            activityType: 'QUIZ_SUBMITTED',
            itemTitle: 'Git',
            score: null,
            status: null,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'b',
            activityType: 'QUIZ_SUBMITTED',
            itemTitle: 'SQL',
            score: 30,
            status: null,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'c',
            activityType: 'USECASE_SUBMITTED',
            itemTitle: 'Shop',
            score: null,
            status: 'APPROVED',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'd',
            activityType: 'USECASE_SUBMITTED',
            itemTitle: 'Blog',
            score: null,
            status: 'PENDING',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    renderProfile(TRAINEE);
    expect(await screen.findByText('Quiz abgegeben: Git')).toBeInTheDocument();
    expect(
      screen.getByText('Quiz nicht bestanden: SQL (30 %)')
    ).toBeInTheDocument();
    expect(screen.getByText('Use Case genehmigt: Shop')).toBeInTheDocument();
    expect(screen.getByText('Use Case abgegeben: Blog')).toBeInTheDocument();
  });
});

describe('Profile of a trainer or admin', () => {
  beforeEach(() => jest.clearAllMocks());

  const TRAINER_SUMMARY = {
    counts: {
      trainees: 3,
      totalEnablers: 10,
      totalUseCases: 4,
      totalLernfelder: 9,
    },
    recentActivities: [
      {
        id: 'q1',
        userId: 't2',
        userFullName: 'Berta Beispiel',
        activityType: 'LESSON_COMPLETED',
        itemTitle: 'Lektion Eins',
        score: null,
        status: null,
        createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      },
      {
        id: 'q2',
        userId: 't3',
        userFullName: null,
        activityType: 'QUIZ_SUBMITTED',
        itemTitle: 'Git',
        score: 90,
        status: null,
        createdAt: new Date(Date.now() - 7200 * 1000).toISOString(),
      },
    ],
  };

  it.each(['trainer', 'admin', 'temp_admin', 'super_admin'])(
    'a %s sees the activities of the trainees, with names and texts of the translation system',
    async role => {
      mockApi({ '/api/trainer/profile': TRAINER_SUMMARY });
      renderProfile({ ...TRAINER, role });
      expect(await screen.findByText('Berta Beispiel')).toBeInTheDocument();
      expect(
        screen.getByText('Lektion abgeschlossen: Lektion Eins')
      ).toBeInTheDocument();
      expect(screen.getByText('Unbekannt')).toBeInTheDocument();
      expect(
        screen.getByText('Quiz bestanden: Git (90 %)')
      ).toBeInTheDocument();
      expect(screen.queryByText('Keine Aktivitäten gefunden')).toBeNull();
    }
  );

  it('does not show the internal user id', async () => {
    mockApi({ '/api/trainer/profile': TRAINER_SUMMARY });
    renderProfile(TRAINER);
    await screen.findByText('Berta Beispiel');
    expect(document.body.textContent).not.toContain(UUID);
    expect(screen.queryByText('Benutzer-ID')).toBeNull();
  });

  it('addresses the trainer with "du" in the empty text', async () => {
    mockApi({ '/api/trainer/profile': { counts: {}, recentActivities: [] } });
    renderProfile(TRAINER);
    expect(
      await screen.findByText(
        'Aktivitäten deiner Azubis werden hier angezeigt.'
      )
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Ihrer Azubis/);
  });
});

describe('Profile: editing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateProfile.mockResolvedValue(undefined);
  });

  it('has one input for the name, the e-mail address is shown and not editable', async () => {
    mockApi({ '/api/trainee/profile-summary': TRAINEE_SUMMARY });
    renderProfile(TRAINEE);
    fireEvent.click(screen.getByLabelText('Profil bearbeiten'));

    // the name: the field under "Vollständiger Name" and no second one above
    const nameInputs = screen
      .getAllByRole('textbox')
      .filter(el => (el as HTMLInputElement).value === 'Anna Azubi');
    expect(nameInputs).toHaveLength(1);
    expect(nameInputs[0]).toHaveAttribute('id', 'fullName');

    // the e-mail address is the login: no input of any kind holds it
    expect(
      screen
        .queryAllByRole('textbox')
        .some(el => (el as HTMLInputElement).value === 'anna@example.com')
    ).toBe(false);
    expect(screen.getByTestId('user-email')).toHaveTextContent(
      'anna@example.com'
    );
    expect(screen.getByTestId('email-read-only-hint')).toBeInTheDocument();
  });

  it('the start of the training is shown, not edited', async () => {
    mockApi({ '/api/trainee/profile-summary': TRAINEE_SUMMARY });
    renderProfile({ ...TRAINEE, training_start_date: '2024-09-01' });
    fireEvent.click(screen.getByLabelText('Profil bearbeiten'));
    expect(screen.getByText('2024-09-01')).toBeInTheDocument();
    expect(
      screen
        .queryAllByRole('textbox')
        .some(el => (el as HTMLInputElement).value === '2024-09-01')
    ).toBe(false);
  });

  it('saves the name and the birth date of a trainee, nothing else', async () => {
    mockApi({ '/api/trainee/profile-summary': TRAINEE_SUMMARY });
    renderProfile(TRAINEE);
    fireEvent.click(screen.getByLabelText('Profil bearbeiten'));
    fireEvent.change(document.getElementById('fullName')!, {
      target: { value: 'Anna Neu' },
    });
    fireEvent.click(screen.getByText('Speichern'));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
    expect(updateProfile).toHaveBeenCalledWith({
      full_name: 'Anna Neu',
      birth_date: '2005-04-03',
    });
  });

  it('saves only the name of a trainer (the birth date and the start of the training stay as they are)', async () => {
    mockApi({ '/api/trainer/profile': { counts: {}, recentActivities: [] } });
    renderProfile({ ...TRAINER, birth_date: '1980-01-01' });
    fireEvent.click(screen.getByLabelText('Profil bearbeiten'));
    fireEvent.change(document.getElementById('fullName')!, {
      target: { value: 'Tim Neu' },
    });
    fireEvent.click(screen.getByText('Speichern'));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
    expect(updateProfile).toHaveBeenCalledWith({ full_name: 'Tim Neu' });
  });

  it('stays in edit mode when the save fails', async () => {
    updateProfile.mockRejectedValue(new Error('refused'));
    mockApi({ '/api/trainee/profile-summary': TRAINEE_SUMMARY });
    renderProfile(TRAINEE);
    fireEvent.click(screen.getByLabelText('Profil bearbeiten'));
    fireEvent.click(screen.getByText('Speichern'));
    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(screen.getByText('Speichern')).toBeInTheDocument();
  });
});
