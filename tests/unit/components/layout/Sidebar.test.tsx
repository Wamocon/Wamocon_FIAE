import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { Sidebar } from '@/components/layout/Sidebar';
import { useAuth } from '@/contexts/AuthContext';

jest.mock('@/contexts/AuthContext');

// The sidebar of trainees and trainers must stay as it was (regression), the
// admin part differs per level (see adminMenu.test.ts for the rules).

const TRAINEE_LINKS = [
  '/trainee/dashboard',
  '/trainee/activity-reports',
  '/trainee/school',
  '/trainee/courses',
  '/trainee/trainer-feedback',
  '/trainee/quizzes',
  '/trainee/profile',
];
const TRAINER_LINKS = [
  '/trainer/dashboard',
  '/trainer/activity-reports',
  '/trainer/school',
  '/trainer/content-management',
  '/trainer/quiz-management',
  '/trainer/trainees',
];
const PROFILE = '/trainer/profile';
const ORGS = '/trainer/admin/organizations';
const USERS = '/trainer/admin/users';

function renderFor(
  role: string,
  options: { isPlatformOwner?: boolean; plan?: 'LIGHT' | 'PRO' } = {}
) {
  const upper = role.toUpperCase();
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'p1', full_name: 'Test Person', role, avatar: null },
    signOut: jest.fn(),
    loading: false,
    subscriptionPlan: options.plan ?? 'LIGHT',
    isAdmin: ['ADMIN', 'TEMP_ADMIN', 'SUPER_ADMIN'].includes(upper),
    isPlatformOwner: options.isPlatformOwner ?? false,
  });
  return renderWithProviders(
    <Sidebar
      currentView="dashboard"
      isOpen
      onToggle={() => {}}
      userRole={upper === 'TRAINEE' ? 'trainee' : 'trainer'}
    />
  );
}

const links = () =>
  screen
    .getAllByRole('link')
    .map(a => a.getAttribute('href') as string)
    .filter(Boolean);

describe('Sidebar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trainee: unchanged', () => {
    renderFor('trainee');
    expect(links()).toEqual(TRAINEE_LINKS);
  });

  it('trainee: no admin entry even with the platform flag', () => {
    renderFor('trainee', { isPlatformOwner: true });
    expect(links()).toEqual(TRAINEE_LINKS);
  });

  it('trainer: unchanged', () => {
    renderFor('trainer');
    expect(links()).toEqual([...TRAINER_LINKS, PROFILE]);
  });

  it('trainer: no admin entry even with the platform flag', () => {
    renderFor('trainer', { isPlatformOwner: true });
    expect(links()).toEqual([...TRAINER_LINKS, PROFILE]);
  });

  it('trainer with the PRO plan still gets the HAI button, nobody else changed', () => {
    renderFor('trainer', { plan: 'PRO' });
    expect(screen.getByText('HAI Admin')).toBeInTheDocument();
  });

  it('SUPER_ADMIN: the platform and the users', () => {
    renderFor('SUPER_ADMIN', { isPlatformOwner: true });
    expect(links()).toEqual([...TRAINER_LINKS, ORGS, USERS, PROFILE]);
    expect(screen.getByText('Organisationen und Berufe')).toBeInTheDocument();
    expect(screen.getByText('Benutzerverwaltung')).toBeInTheDocument();
  });

  it('ADMIN of the platform organization counts as the platform admin', () => {
    renderFor('admin', { isPlatformOwner: true });
    expect(links()).toEqual([...TRAINER_LINKS, ORGS, USERS, PROFILE]);
    expect(screen.getByText('Organisationen und Berufe')).toBeInTheDocument();
  });

  it('ADMIN of a customer organization: the own organization and the users', () => {
    renderFor('admin');
    expect(links()).toEqual([...TRAINER_LINKS, ORGS, USERS, PROFILE]);
    expect(screen.getByText('Meine Organisation')).toBeInTheDocument();
    expect(screen.queryByText('Organisationen und Berufe')).toBeNull();
    expect(screen.queryByText('Organisationen')).toBeNull();
  });

  it('TEMP_ADMIN: the own organization and the users, no platform entry', () => {
    renderFor('temp_admin');
    expect(links()).toEqual([...TRAINER_LINKS, ORGS, USERS, PROFILE]);
    expect(screen.getByText('Meine Organisation')).toBeInTheDocument();
    expect(screen.getByText('Benutzerverwaltung')).toBeInTheDocument();
    expect(screen.queryByText('Organisationen und Berufe')).toBeNull();
  });

  it('TEMP_ADMIN in the platform organization is still no platform admin', () => {
    renderFor('temp_admin', { isPlatformOwner: true });
    expect(links()).toEqual([...TRAINER_LINKS, ORGS, USERS, PROFILE]);
    expect(screen.getByText('Meine Organisation')).toBeInTheDocument();
    expect(screen.queryByText('Organisationen und Berufe')).toBeNull();
  });

  it('renders nothing without a profile', () => {
    (useAuth as jest.Mock).mockReturnValue({
      profile: null,
      signOut: jest.fn(),
      loading: false,
      subscriptionPlan: 'LIGHT',
      isAdmin: false,
      isPlatformOwner: false,
    });
    const { container } = renderWithProviders(
      <Sidebar
        currentView="dashboard"
        isOpen
        onToggle={() => {}}
        userRole="trainer"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
