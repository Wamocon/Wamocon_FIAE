import { act, render, screen } from '@testing-library/react';
import {
  OnboardingProvider,
  useOnboarding,
} from '@/contexts/OnboardingContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePathname } from 'next/navigation';

jest.mock('@/contexts/AuthContext');
jest.mock('next/navigation', () => ({ usePathname: jest.fn() }));

// The tour starts by itself on the first visit. It points at the sidebar and
// the header of the dashboards, so it must not start on the occupation choice
// page (/berufswahl), which has none of them. It starts once the person is on
// another page.

function Probe() {
  const { isActive } = useOnboarding();
  return <div data-testid="tour">{isActive ? 'active' : 'idle'}</div>;
}

function mount() {
  return render(
    <OnboardingProvider>
      <Probe />
    </OnboardingProvider>
  );
}

describe('OnboardingProvider auto start', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'u1', role: 'trainer' },
    });
  });
  afterEach(() => jest.useRealTimers());

  it('starts the tour on a dashboard after the delay (as before)', () => {
    (usePathname as jest.Mock).mockReturnValue('/trainer/dashboard');
    mount();
    expect(screen.getByTestId('tour')).toHaveTextContent('idle');
    act(() => {
      jest.advanceTimersByTime(1300);
    });
    expect(screen.getByTestId('tour')).toHaveTextContent('active');
  });

  it('does not start the tour on the occupation choice page', () => {
    (usePathname as jest.Mock).mockReturnValue('/berufswahl');
    mount();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('tour')).toHaveTextContent('idle');
  });

  it('starts it after the person left the occupation choice page', () => {
    (usePathname as jest.Mock).mockReturnValue('/berufswahl');
    const view = mount();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('tour')).toHaveTextContent('idle');
    (usePathname as jest.Mock).mockReturnValue('/trainer/dashboard');
    view.rerender(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>
    );
    act(() => {
      jest.advanceTimersByTime(1300);
    });
    expect(screen.getByTestId('tour')).toHaveTextContent('active');
  });

  it('does not start the tour behind the notice of an account that is stopped', () => {
    (usePathname as jest.Mock).mockReturnValue('/trainee/dashboard');
    for (const extra of [
      { trainerActivated: false },
      { isActive: false },
      { organization: { isActive: false } },
    ]) {
      (useAuth as jest.Mock).mockReturnValue({
        profile: { id: 'u1', role: 'trainee', ...extra },
      });
      const view = mount();
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(screen.getByTestId('tour')).toHaveTextContent('idle');
      view.unmount();
    }
  });

  it('starts it once the account is released', () => {
    (usePathname as jest.Mock).mockReturnValue('/trainee/dashboard');
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'u1', role: 'trainee', trainerActivated: false },
    });
    const view = mount();
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('tour')).toHaveTextContent('idle');
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'u1', role: 'trainee', trainerActivated: true },
    });
    view.rerender(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>
    );
    act(() => {
      jest.advanceTimersByTime(1300);
    });
    expect(screen.getByTestId('tour')).toHaveTextContent('active');
  });

  it('does not start a tour that was completed', () => {
    window.localStorage.setItem('onboarding_main_completed', 'true');
    (usePathname as jest.Mock).mockReturnValue('/trainer/dashboard');
    mount();
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('tour')).toHaveTextContent('idle');
  });
});
