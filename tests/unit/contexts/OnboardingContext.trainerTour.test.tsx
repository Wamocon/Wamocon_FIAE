import { act, render, screen } from '@testing-library/react';
import {
  OnboardingProvider,
  useOnboarding,
} from '@/contexts/OnboardingContext';
import { useAuth } from '@/contexts/AuthContext';

jest.mock('@/contexts/AuthContext');
jest.mock('next/navigation', () => ({
  usePathname: () => '/trainer/dashboard',
}));

// KFB-1182: the tour of a trainer names the menu entry of the quizzes like the
// menu does: "Quiz-Übersicht" for a trainer, "Quiz-Verwaltung" for the platform admin.

function Probe() {
  const { steps, restartTour } = useOnboarding();
  return (
    <>
      <button onClick={() => restartTour('main')}>start</button>
      <div data-testid="steps">
        {steps.map(s => `${s.id}:${s.titleKey}`).join(',')}
      </div>
    </>
  );
}

function start(profile: Record<string, unknown>, isPlatformOwner = false) {
  (useAuth as jest.Mock).mockReturnValue({ profile, isPlatformOwner });
  window.localStorage.setItem('onboarding_main_completed', 'true');
  window.localStorage.setItem('onboarding_hai_completed', 'true');
  render(
    <OnboardingProvider>
      <Probe />
    </OnboardingProvider>
  );
  act(() => {
    screen.getByText('start').click();
  });
  return screen.getByTestId('steps').textContent?.split(',') ?? [];
}

describe('OnboardingContext: tour of a trainer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  it('follows the menu and calls the quizzes "Quiz-Übersicht" for a trainer', () => {
    const steps = start({ id: 't1', role: 'trainer', is_active: true });
    expect(steps.slice(0, 8)).toEqual([
      'welcome:onboarding.welcome.title',
      'dashboard:nav.dashboard',
      'activity-reports:nav.activityReports',
      'school:nav.school',
      'content-management:nav.contentManagement',
      'quiz-management:nav.quizOverview',
      'trainees:nav.trainees',
      'profile:nav.profile',
    ]);
  });

  it('calls the quizzes "Quiz-Verwaltung" for the platform admin', () => {
    const steps = start({ id: 'a1', role: 'super_admin', is_active: true });
    expect(steps).toContain('quiz-management:nav.quizManagement');
  });
});
