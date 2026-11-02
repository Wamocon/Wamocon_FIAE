import { act, render, screen } from '@testing-library/react';
import {
  OnboardingProvider,
  useOnboarding,
} from '@/contexts/OnboardingContext';
import { useAuth } from '@/contexts/AuthContext';

jest.mock('@/contexts/AuthContext');
jest.mock('next/navigation', () => ({
  usePathname: () => '/trainee/dashboard',
}));

// WMCNL-2967: the tour names the occupation choice only for people who have the
// entry in their menu (several occupations). For everybody else the step is left
// out when the tour starts, so it never points at nothing.

function Probe() {
  const { steps, restartTour } = useOnboarding();
  return (
    <>
      <button onClick={() => restartTour('main')}>start</button>
      <div data-testid="steps">{steps.map(s => s.id).join(',')}</div>
    </>
  );
}

function start() {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'p1', role: 'trainee', is_active: true },
  });
  // The tour has been seen before, so it does not start by itself
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

describe('OnboardingContext: optional steps', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  it('leaves the occupation choice out when the entry is not on the page', () => {
    const ids = start();
    expect(ids).not.toContain('catalog');
    expect(ids.slice(0, 3)).toEqual([
      'welcome',
      'dashboard',
      'activity-reports',
    ]);
    expect(ids).toContain('profile');
    expect(ids).toContain('school');
  });

  it('keeps it when the entry is there (a person with several occupations)', () => {
    const link = document.createElement('a');
    link.setAttribute('data-tour', 'sidebar-catalog');
    document.body.appendChild(link);
    const ids = start();
    expect(ids).toContain('catalog');
    // right after the profile, before the two steps of the header
    expect(ids.indexOf('catalog')).toBe(ids.indexOf('profile') + 1);
  });
});
